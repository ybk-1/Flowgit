#!/usr/bin/env node
// "captions" stage: one caption file per segment, and timeline.json for the render stage.
//
// For each segment it picks the sound and the picture:
// - sound: recordings/<id>.m4a|mp3|wav|aac|flac|ogg|opus, else the sound of
//   recordings/<id>.mp4|mov|m4v|webm|mkv, else the AI voice voice/<id>.mp3,
//   else none (a silent video, timed from the narration);
// - picture: the screen recording recordings/<id>.mp4 (or .mov, …), else the slides.
// The segment lasts as long as its sound (or its screen recording); each slide
// gets a share of that time in proportion to how much is said over it.
//
// Captions: recordings/<id>.srt or .vtt when you supplied one (they follow what
// you actually said); otherwise the narration is cut into captions and timed
// the same way: Chinese one line of up to 16 characters, English up to two
// lines of 42, never splitting a word or a formula, each shown at least 5/6 of
// a second and, when its neighbours can spare the time, long enough to read at
// the reading speed (rules.md "Captions"). With an AI voice the spoken notice
// is the first caption. Both SRT and WebVTT are
// written as captions/<n>-<id>.srt and .vtt, next to video/<n>-<id>.mp4.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const rulesFile = process.argv[2] ?? "rules.md";
const captionsDir = outputs[0]?.path ?? "captions/";
const timelineFile = outputs[1]?.path ?? "timeline.json";
const L = en ? "en" : "zh";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n") : null);

function readJson(file, required = true) {
  const text = read(file);
  if (text == null) {
    if (required) fail(t(`找不到 ${file}`, `${file} not found`));
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(t(`${file} 不是合法的 JSON：${err.message}`, `${file} is not valid JSON: ${err.message}`));
  }
}

let rules;
{
  const fenced = read(rulesFile)?.match(/```json\n([\s\S]*?)\n```/);
  if (!fenced) fail(t(`${rulesFile} 里没有 JSON 规则块`, `${rulesFile} has no JSON rules block`));
  try {
    rules = JSON.parse(fenced[1]);
  } catch (err) {
    fail(t(`${rulesFile} 的 JSON 不合法：${err.message}`, `The JSON in ${rulesFile} is invalid: ${err.message}`));
  }
}

const script = readJson("script.json");
const plan = readJson("plan.json", false) ?? {};
const voiceInfo = readJson(path.join("voice", "voice.json"), false);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);
const capRules = rules.captions?.[L] ?? (en ? { lineMax: 42, lines: 2 } : { lineMax: 16, lines: 1 });
const lineMax = Number(capRules.lineMax) || (en ? 42 : 16);
const maxLines = Number(capRules.lines) || (en ? 2 : 1);
const minSeconds = Number(rules.captions?.minSeconds) || 0.833;
const cpsMax = Number(capRules.cpsMax) || (en ? 20 : 9);
const rate = Number(rules.speakingRate?.[L]) || (en ? 140 : 200);
const notice = str(rules.aiNotice?.[L]);
const video = rules.video ?? {};

// ---- Media ----
const VIDEO_EXTS = [".mp4", ".mov", ".m4v", ".webm", ".mkv"];
const AUDIO_EXTS = [".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg", ".opus"];
const hasProbe = (() => {
  const r = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
})();
const recordings = fs.existsSync("recordings") ? fs.readdirSync("recordings") : [];
const findRecording = (id, exts) => {
  const name = recordings.find((n) => path.parse(n).name.toLowerCase() === id && exts.includes(path.extname(n).toLowerCase()));
  return name ? path.join("recordings", name).replace(/\\/g, "/") : null;
};

/** Duration and stream kinds from ffprobe; null when ffprobe is missing or can't read the file. */
function probe(file) {
  if (!hasProbe) return null;
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    const info = JSON.parse(r.stdout);
    const kinds = list(info.streams).map((s) => s.codec_type);
    return { seconds: Number(info.format?.duration) || 0, video: kinds.includes("video"), audio: kinds.includes("audio") };
  } catch {
    return null;
  }
}

// ---- Counting ----
const spokenUnits = (text) =>
  en ? (String(text).match(/[A-Za-z0-9'’-]+/g) ?? []).length : (String(text).match(/[㐀-鿿]|[A-Za-z0-9]+/g) ?? []).length;
const secondsOf = (text) => (spokenUnits(text) / rate) * 60;
const len = (s) => [...s].length;
// How long a piece of narration takes to say, next to other pieces: English by
// characters (closer to syllables than a word count), Chinese by spoken units.
const weightOf = (text) => (en ? len(String(text).replace(/\s+/g, " ").trim()) : spokenUnits(text));

// ---- Cutting narration into captions ----
// Chinese narration is cut into units that are never split: a word (found with
// the dictionary behind Intl.Segmenter), a Chinese punctuation mark, or a run of
// anything else up to a space or a Chinese character (letters, digits, 1,000,
// 10:30, a web address). A run that opens a bracket goes on, spaces included,
// until the bracket closes, so a formula such as =SUMIF(C:C, F2, B:B) stays whole
// with its punctuation.
const HAN = /[\u3400-\u9FFF\uF900-\uFAFF]/u;
const WIDE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u2018\u2019\u201C\u201D\u2026\u2014]/u;
const MARK = /^[，。！？；：、…]$/u; // a phrase ends after these
const CLOSER = /^[」』”’）》〉】]$/u; // stays with the mark before it
const OPENER = /^[「『“‘（《〈【]$/u; // stays with what follows it
const OPENS = "([{";
const CLOSES = ")]}";
const zhWords = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "word" }) : null;

function zhUnits(text) {
  const chars = [...String(text).replace(/\s+/g, " ").trim()];
  const runEnd = (k) => {
    while (k < chars.length && chars[k] !== " " && !WIDE.test(chars[k])) k += 1;
    return k;
  };
  const units = [];
  let space = false;
  for (let i = 0; i < chars.length; ) {
    if (chars[i] === " ") {
      space = true;
      i += 1;
      continue;
    }
    let j = i + 1;
    if (HAN.test(chars[i])) {
      while (j < chars.length && HAN.test(chars[j])) j += 1;
      const run = chars.slice(i, j).join("");
      const words = zhWords ? [...zhWords.segment(run)].map((s) => s.segment) : [...run];
      // Without a dictionary a whole run may come back as one "word": use characters then.
      words.flatMap((w) => (len(w) > lineMax / 2 ? [...w] : [w])).forEach((w, k) => units.push({ text: w, space: k === 0 && space }));
      space = false;
      i = j;
      continue;
    }
    if (!WIDE.test(chars[i])) {
      j = runEnd(i);
      let depth = 0;
      for (let k = i; k < j; k++) depth += OPENS.includes(chars[k]) ? 1 : CLOSES.includes(chars[k]) ? -1 : 0;
      if (depth > 0) {
        let k = j;
        while (k < chars.length && depth > 0 && k - i < 2 * lineMax) {
          depth += OPENS.includes(chars[k]) ? 1 : CLOSES.includes(chars[k]) ? -1 : 0;
          k += 1;
        }
        if (depth <= 0) j = runEnd(k);
      }
    }
    units.push({ text: chars.slice(i, j).join(""), space });
    space = false;
    i = j;
  }
  return units;
}

const isWide = (u) => WIDE.test([...u.text][0]);
const zhClean = (s) => s.replace(/[，。、；：,;:]+$/u, "").trim();
const AFTER_ZH = new Set("的 地 吗 呢 吧 啊".split(" "));
const BEFORE_ZH = new Set("和 或 或者 但 但是 而 而且 就 才 也 都 还 再 把 被 让 给 从 到 对 跟 向 往 为 用 按 在 比 因为 所以 如果 然后 可以 能 要 会".split(" "));
const CLAUSE_COST = { "；": 0, "：": 0, ";": 0, ":": 0, "，": 5, ",": 5, "、": 60 };
const CAPTION_COST = 150;

const MEASURE = /[个张笔条种位次份本件道页只些]$/u;

/** Cost of a caption break between two units: low at a comma or colon, higher inside a list; a number, column letter or cell stays with the word after it ("5 笔", "F 列", "G2 里"), a conjunction or preposition with what it introduces, and a measure word, a little, with its noun. */
function zhBreakCost(before, after) {
  if (before.end) return CLAUSE_COST[before.end] ?? 0;
  if (OPENER.test(before.text) || MARK.test(after.text) || CLOSER.test(after.text)) return 1000;
  const han = HAN.test([...after.text][0]);
  if (han && /^([0-9][0-9.,:%]*|[A-Za-z]|[A-Za-z]{1,3}[0-9]+)$/.test(before.text)) return 400;
  if (BEFORE_ZH.has(before.text)) return 100;
  if (han && MEASURE.test(before.text)) return 90;
  if (after.space || isWide(before) !== isWide(after)) return 60;
  if (AFTER_ZH.has(before.text)) return 30;
  if (BEFORE_ZH.has(after.text)) return 40;
  return 80;
}

/** One caption's text: a comma, colon or list mark between clauses becomes a space, and none is left at the end. */
function zhText(units) {
  let out = "";
  units.forEach((u, k) => {
    if (k > 0) out = units[k - 1].end ? `${zhClean(out)} ` : u.space ? `${out} ` : out;
    out += u.text;
  });
  return zhClean(out);
}

/** Chinese: one line per caption; each sentence cut into captions of about equal length where it reads best, short sentences sharing a line. */
function zhCues(text) {
  const units = zhUnits(text);
  // Clauses end after a Chinese mark (with any closing quote glued to it), or
  // after , ; : ! ? at the end of a run of letters that a space or a Chinese
  // character follows (not inside 1,000 or C:C).
  let mark = null;
  units.forEach((u, k) => {
    const next = units[k + 1];
    if (isWide(u) ? MARK.test(u.text) : /[,;:!?]$/.test(u.text) && (!next || next.space || isWide(next))) mark = [...u.text].at(-1);
    const glued = next && !next.space && (MARK.test(next.text) || CLOSER.test(next.text));
    if (mark && !glued) {
      u.end = mark;
      mark = null;
    }
  });
  const sentences = [];
  let sentence = [];
  for (const u of units) {
    sentence.push(u);
    if (u.end && /[。！？…!?]/u.test(u.end)) {
      sentences.push(sentence);
      sentence = [];
    }
  }
  if (sentence.length) sentences.push(sentence);

  const lines = [];
  for (const su of sentences) {
    // best[j]: cheapest captions holding su[0..j): each caption costs its length
    // squared (so they come out about even) plus a fixed amount, and each break
    // costs zhBreakCost.
    const n = su.length;
    const best = new Array(n + 1).fill(null);
    best[0] = { cost: 0, from: -1 };
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const size = len(zhText(su.slice(i, j)));
        // A formula longer than a line gets a caption of its own (with its full stop).
        if (size > lineMax && su.slice(i, j).filter((u) => !MARK.test(u.text) && !CLOSER.test(u.text)).length > 1) break;
        const cost = best[i].cost + size ** 2 + CAPTION_COST + (i > 0 ? zhBreakCost(su[i - 1], su[i]) : 0);
        if (!best[j] || cost < best[j].cost) best[j] = { cost, from: i };
      }
    }
    let cut = [];
    for (let j = n; j > 0; j = best[j].from) cut.unshift(zhText(su.slice(best[j].from, j)));
    cut = cut.filter(Boolean);
    // A short sentence shares a line with the one before it when both fit.
    const prev = lines.at(-1);
    if (prev != null && cut.length && len(prev) < lineMax / 2 && len(`${prev} ${cut[0]}`) <= lineMax) lines[lines.length - 1] = `${prev} ${cut.shift()}`;
    lines.push(...cut);
  }
  return lines.filter(Boolean).map((line) => [line]);
}

// English line and caption breaks follow the Netflix English Timed Text Style
// Guide: keep a caption to one line when it fits, break after punctuation or
// before a conjunction or preposition, and don't leave an article, possessive
// or preposition at the end of a line.
const BREAK_BEFORE = new Set("and but or so because then to in on at for with from of into that which when if where while until after before".split(" "));
const HOLD_AFTER = new Set("a an the to of in on at for with from into by your my our their his her its this these those".split(" "));
/** Cost of breaking between two words, in squared characters (10 characters off balance cost 200). */
function breakCost(before, after) {
  if (/[,;:—–]$/.test(before)) return 0;
  if (HOLD_AFTER.has(before.toLowerCase())) return 800;
  if (BREAK_BEFORE.has(after.toLowerCase())) return 100;
  return 200;
}

/** Best way to put words on at most maxLines lines of lineMax characters, or null. */
function wrapWords(words) {
  const whole = words.join(" ");
  if (len(whole) <= lineMax || words.length === 1) return { lines: [whole], cost: len(whole) ** 2 };
  // best[j][l]: cheapest l lines holding words[0..j)
  const n = words.length;
  const best = Array.from({ length: n + 1 }, () => new Array(maxLines + 1).fill(null));
  best[0][0] = { cost: 0, from: -1 };
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const line = words.slice(i, j).join(" ");
      if (len(line) > lineMax && j - i > 1) break;
      for (let l = 1; l <= maxLines; l++) {
        const prev = best[i][l - 1];
        if (!prev) continue;
        const cost = prev.cost + len(line) ** 2 + (i > 0 ? breakCost(words[i - 1], words[i]) : 0);
        if (!best[j][l] || cost < best[j][l].cost) best[j][l] = { cost, from: i };
      }
    }
  }
  for (let l = 2; l <= maxLines; l++) {
    if (!best[n][l]) continue;
    const lines = [];
    for (let j = n, k = l; k > 0; k--) {
      const i = best[j][k].from;
      lines.unshift(words.slice(i, j).join(" "));
      j = i;
    }
    return { lines, cost: best[n][l].cost };
  }
  return null;
}

/** Words of a sentence; a bracket that opens keeps the words up to its close together (=SUMIF(C:C, F2, B:B)) while they fit on a line. */
function enWords(sentence) {
  const words = [];
  let depth = 0;
  for (const w of sentence.split(" ")) {
    if (depth > 0 && len(`${words.at(-1)} ${w}`) <= lineMax) words[words.length - 1] += ` ${w}`;
    else {
      words.push(w);
      depth = 0;
    }
    for (const c of w) depth = Math.max(0, depth + (OPENS.includes(c) ? 1 : CLOSES.includes(c) ? -1 : 0));
  }
  return words;
}

/** English: each sentence cut into as few captions as fit, of about equal length, each on up to maxLines lines. */
function enCues(text) {
  const sentences = String(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cues = [];
  for (const sentence of sentences) {
    const words = enWords(sentence);
    const n = words.length;
    // best[j]: fewest captions holding words[0..j), then the most even ones.
    const best = new Array(n + 1).fill(null);
    best[0] = { count: 0, cost: 0, from: -1, lines: [] };
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        if (!best[i]) continue;
        const wrapped = wrapWords(words.slice(i, j));
        if (!wrapped) {
          if (j - i > 1) break;
          continue;
        }
        const count = best[i].count + 1;
        const cost = best[i].cost + len(words.slice(i, j).join(" ")) ** 2 + wrapped.cost / 4 + (i > 0 ? breakCost(words[i - 1], words[i]) : 0);
        const cur = best[j];
        if (!cur || count < cur.count || (count === cur.count && cost < cur.cost)) best[j] = { count, cost, from: i, lines: wrapped.lines };
      }
    }
    const pieces = [];
    for (let j = n; j > 0; j = best[j].from) pieces.unshift(best[j].lines);
    cues.push(...pieces);
  }
  return cues;
}
const cuesOf = (text) => (en ? enCues(text) : zhCues(text));

/** Merge a caption shorter than the minimum into its neighbour when the two still fit. */
function mergeShort(cues) {
  const fits = (a, b) => (en ? a.lines.length + b.lines.length <= maxLines : len(`${a.lines.join(" ")} ${b.lines.join(" ")}`) <= lineMax);
  const out = [];
  for (const cue of cues) {
    const prev = out.at(-1);
    if (prev && (prev.end - prev.start < minSeconds || cue.end - cue.start < minSeconds) && fits(prev, cue)) {
      prev.lines = en ? [...prev.lines, ...cue.lines] : [`${prev.lines.join(" ")} ${cue.lines.join(" ")}`];
      prev.end = cue.end;
    } else {
      out.push({ ...cue });
    }
  }
  return out;
}

/** The least time a caption needs: the minimum, and long enough to read at the reading speed (counted as the check counts it). */
// (One millisecond more, so the times still hold after they are rounded to milliseconds.)
const needOf = (cue) => Math.max(minSeconds, len(cue.lines.join(en ? " " : "")) / cpsMax + 0.001);

/** Give a caption still under the time it needs some time from a neighbour that can spare it. */
function lengthenShort(cues) {
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    let need = needOf(cue) - (cue.end - cue.start);
    if (need <= 0) continue;
    const next = cues[i + 1];
    if (next) {
      const spare = Math.min(need, next.end - next.start - needOf(next));
      if (spare > 0) {
        cue.end += spare;
        next.start += spare;
        need -= spare;
      }
    }
    const prev = cues[i - 1];
    if (need > 0 && prev) {
      const spare = Math.min(need, prev.end - prev.start - needOf(prev));
      if (spare > 0) {
        prev.end -= spare;
        cue.start -= spare;
      }
    }
  }
  return cues;
}

// ---- Caption files ----
const stamp = (seconds, sep) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const toSrt = (cues) => `${cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.lines.join("\n")}`).join("\n\n")}\n`;
const toVtt = (cues) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.lines.join("\n")}`).join("\n\n")}\n`;

/** Your own SRT or WebVTT: cues with times; WebVTT voice and style tags are dropped. */
function parseCaptions(text) {
  const time = (s) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(s);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : NaN;
  };
  const cues = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const start = time(a);
    const end = time(b);
    const words = lines
      .slice(at + 1)
      .map((l) => l.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    if (Number.isFinite(start) && Number.isFinite(end) && words.length) cues.push({ start, end, lines: words });
  }
  return cues;
}

// ---- Build ----
const planSegments = list(plan.segments);
const segments = list(script.segments).filter((s) => /^s[1-9][0-9]*$/.test(str(s?.id)));
if (!segments.length) fail(t("script.json 里没有段", "script.json has no segments"));
fs.mkdirSync(captionsDir, { recursive: true });
for (const name of fs.readdirSync(captionsDir)) {
  if (/\.(srt|vtt)$/i.test(name)) fs.rmSync(path.join(captionsDir, name), { force: true });
}

const notes = [];
const timeline = {
  width: Number(video.width) || 1920,
  height: Number(video.height) || 1080,
  fps: Number(video.fps) || 30,
  language: L,
  aiLabel: str(rules.aiLabel?.[L]),
  segments: [],
};

segments.forEach((seg, i) => {
  const id = str(seg.id);
  const n = i + 1;
  const base = `${String(n).padStart(2, "0")}-${id}`;
  const slides = list(seg.slides).map((s, k) => ({
    id: `${id}-${k + 1}`,
    kind: str(s?.kind) || "teach",
    headline: str(s?.headline),
    onScreen: list(s?.onScreen).map(str).filter(Boolean),
    visual: str(s?.visual),
    narration: str(s?.narration),
  }));

  // Sound and picture.
  const screen = findRecording(id, VIDEO_EXTS);
  const screenInfo = screen ? probe(screen) : null;
  const audioFile = findRecording(id, AUDIO_EXTS);
  const aiFile = voiceInfo?.ai && list(voiceInfo.segments).some((v) => v?.id === id) ? path.join("voice", `${id}.mp3`).replace(/\\/g, "/") : null;
  let audio = { source: "none", file: null };
  if (audioFile) audio = { source: "recording", file: audioFile };
  else if (screen && (screenInfo?.audio ?? true)) audio = { source: "recording", file: screen };
  else if (aiFile && fs.existsSync(aiFile)) audio = { source: "ai", file: aiFile };
  const picture = screen ? { source: "recording", file: screen } : { source: "slides", file: null };

  const spokenNotice = audio.source === "ai" ? str(voiceInfo?.notice) || notice : "";
  const estimate = secondsOf([spokenNotice, ...slides.map((s) => s.narration)].join(" "));
  let seconds = estimate;
  let measured = false;
  if (audio.file) {
    const info = probe(audio.file);
    if (info?.seconds) {
      seconds = info.seconds;
      measured = true;
    }
  }
  if (!measured && screenInfo?.seconds) {
    seconds = screenInfo.seconds;
    measured = true;
  }
  if ((audio.file || screen) && !measured)
    notes.push(t(`${id}：量不出录音的时长（没装 FFmpeg？），先按讲稿估了 ${Math.round(estimate)} 秒。`, `${id}: couldn't measure the recording (is FFmpeg installed?), so it is timed from the narration at ${Math.round(estimate)}s.`));

  // Slides share the segment's time in proportion to what is said over them.
  const weights = slides.map((s, k) => Math.max(1, weightOf(s.narration) + (k === 0 ? weightOf(spokenNotice) : 0)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let clock = 0;
  const timedSlides = slides.map((s, k) => {
    const start = clock;
    clock = k === slides.length - 1 ? seconds : clock + (seconds * weights[k]) / totalWeight;
    return { id: s.id, kind: s.kind, headline: s.headline, onScreen: s.onScreen, visual: s.visual, start: Math.round(start * 1000) / 1000, end: Math.round(clock * 1000) / 1000 };
  });

  // Captions: yours, or cut from the narration and timed inside each slide.
  const yours = recordings.find((name) => path.parse(name).name.toLowerCase() === id && /\.(srt|vtt)$/i.test(name));
  let cues;
  let source;
  if (yours) {
    cues = parseCaptions(read(path.join("recordings", yours)) ?? "");
    source = "yours";
    if (!cues.length) notes.push(t(`${id}：recordings/${yours} 里读不出字幕。`, `${id}: no captions could be read from recordings/${yours}.`));
  } else {
    cues = [];
    slides.forEach((s, k) => {
      const texts = [...(k === 0 && spokenNotice ? cuesOf(spokenNotice) : []), ...cuesOf(s.narration)];
      const w = texts.map((lines) => Math.max(1, weightOf(lines.join(" ")) || len(lines.join(""))));
      const sum = w.reduce((a, b) => a + b, 0);
      let at = timedSlides[k].start;
      const span = timedSlides[k].end - timedSlides[k].start;
      texts.forEach((lines, j) => {
        const start = at;
        at = j === texts.length - 1 ? timedSlides[k].end : at + (span * w[j]) / sum;
        cues.push({ start, end: at, lines });
      });
    });
    cues = lengthenShort(mergeShort(cues));
    source = "script";
  }
  const srt = path.join(captionsDir, `${base}.srt`).replace(/\\/g, "/");
  const vtt = path.join(captionsDir, `${base}.vtt`).replace(/\\/g, "/");
  fs.writeFileSync(srt, toSrt(cues));
  fs.writeFileSync(vtt, toVtt(cues));

  const planned = planSegments.find((p) => str(p?.id) === id);
  timeline.segments.push({
    id,
    n,
    title: str(planned?.title) || id,
    seconds: Math.round(seconds * 1000) / 1000,
    timedFrom: measured ? "media" : "narration",
    audio,
    picture,
    captions: { source, srt, vtt, cues: cues.length },
    slides: timedSlides,
  });
});

fs.writeFileSync(timelineFile, `${JSON.stringify(timeline, null, 2)}\n`);
const soundName = { recording: t("你的录音", "your recording"), ai: t("AI 配音", "AI voice"), none: t("没有声音", "no sound") };
for (const s of timeline.segments) {
  console.log(
    t(
      `${s.id}：${Math.round(s.seconds)} 秒，${soundName[s.audio.source]}，画面用${s.picture.source === "recording" ? "录屏" : "幻灯片"}，字幕 ${s.captions.cues} 条（${s.captions.source === "yours" ? "你的" : "按讲稿切的"}）`,
      `${s.id}: ${Math.round(s.seconds)}s, ${soundName[s.audio.source]}, ${s.picture.source === "recording" ? "screen recording" : "slides"}, ${s.captions.cues} captions (${s.captions.source === "yours" ? "yours" : "cut from the narration"})`,
    ),
  );
}
for (const note of notes) console.warn(note);
console.log(t(`写好了 ${timelineFile} 和 ${captionsDir} 里的字幕。`, `Wrote ${timelineFile} and the captions in ${captionsDir}.`));
