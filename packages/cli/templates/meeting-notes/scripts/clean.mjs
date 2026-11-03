// "clean" stage. Turn transcript/ (.txt, .srt, .vtt) into clean.md.
//
// Consecutive cues from the same speaker become one block. Timecodes inside
// the words are dropped; each block keeps the start of its first cue as [m:ss]
// (or [h:mm:ss] past an hour) so later stages can cite that time. A block is
// split once it runs two minutes (one minute for lines with no speaker), so a
// cite lands near the words it is about.
// See README "依据 / Sources": the timestamp stays so a decision can be checked
// against what was actually said.
//
// Layouts read:
// - .srt / .vtt, with "Name: words" or a WebVTT <v Name> voice tag in a cue;
// - .txt with one utterance per line: "[00:07:30] Name: words", "7:30 Name: words" or "Name: words";
// - .txt with a speaker line and the words below it: "Name  07:30" (or "Name (07:30)"), then the words.
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const lang = flowInputs.language === "en" ? "en" : "zh";
const en = lang === "en";
const t = (zh, english) => (en ? english : zh);

/** A speaker's block is split once it runs this long, so a cite stays close to the words. */
const MAX_BLOCK_MS = 120_000;
/** Lines with no speaker are grouped into blocks of at most this long. */
const MAX_UNLABELED_MS = 60_000;

const cjkOrPunct = /[㐀-鿿，。！？、；：]/;

/** UTF-8 (with or without a BOM), UTF-16 with a BOM, or GBK / GB18030, which Chinese Windows tools often save. */
function readText(file) {
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

function joinText(a, b) {
  if (!a) return b ?? "";
  if (!b) return a;
  const left = a.trimEnd();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  const leftCh = left.slice(-1);
  const rightCh = right[0];
  if (cjkOrPunct.test(leftCh) && cjkOrPunct.test(rightCh)) return left + right;
  return `${left} ${right}`;
}

const TIME = String.raw`\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?|\d{1,3}:\d{2}`;
/** "[00:07:30] 林夏：…" or "7:30 Lin Xia: …": one utterance per line, time first. */
const TIME_FIRST = new RegExp(`^\\[?(${TIME})\\]?\\s*(.*)$`);
/** "林夏  07:30" or "Lin Xia (7:30)": a speaker line, with the words on the lines below. */
const NAME_THEN_TIME = new RegExp(`^(.{1,40}?)(?:\\s+[\\[(（]?|[\\[(（])(${TIME})[\\])）]?$`);

/** Milliseconds from 00:07:30,000 / 00:07:30.000 / 7:30, or null. */
function parseClock(token) {
  const raw = String(token).trim().replace(/^\[|\]$/g, "");
  let m = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(raw);
  if (m) {
    const frac = m[4] ? Number(m[4].padEnd(3, "0").slice(0, 3)) : 0;
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + frac;
  }
  m = /^(\d{1,3}):(\d{2})$/.exec(raw);
  if (m && Number(m[2]) < 60) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  return null;
}

/** [m:ss] under an hour, [h:mm:ss] after. 12 min 30 sec is 12:30. */
function stampFromMs(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Whether a label looks like a person's name rather than the start of a sentence. */
function isName(label) {
  const name = String(label).trim();
  if (!name || name.length > 30) return false;
  if (/^\d+$/.test(name)) return false;
  if (/[:：，。！？；、,!?;"“”]/.test(name)) return false;
  if (/https?$/i.test(name)) return false;
  return name.split(/\s+/).length <= 4;
}

/** "林夏：…" or "Lin Xia: …" → { speaker, text }; null when the colon belongs to the words (10:30, 3:1, https://). */
function splitSpeaker(line) {
  const m = /^([^:：\n]{1,30})([:：])(\s*)([\s\S]*)$/.exec(line);
  if (!m || !isName(m[1])) return null;
  // "会议改到 10:30" or "3:1": a time or a ratio, not a speaker label
  if (m[2] === ":" && !m[3] && /\d$/.test(m[1]) && /^\d/.test(m[4])) return null;
  return { speaker: m[1].trim(), text: m[4].trim() };
}

function parseSpoken(body) {
  let text = String(body).replace(/\r/g, "");
  let speaker = "";
  const v = /<v(?:\.[^\s>]+)*\s+([^>]+)>/i.exec(text);
  if (v) {
    speaker = v[1].trim();
    text = text.replace(/<v(?:\.[^\s>]+)*\s+[^>]*>/gi, "").replace(/<\/v>/gi, "");
  }
  text = text.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").trim();
  if (!speaker) {
    const labeled = splitSpeaker(text);
    if (labeled) {
      speaker = labeled.speaker;
      text = labeled.text;
    }
  }
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return { speaker, text: lines.reduce((acc, line) => joinText(acc, line), "") };
}

function cuesFromTimed(text) {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0]) && !lines.some((line) => line.includes("-->"))) continue;
    let start = 0;
    if (/^\d+$/.test(lines[0])) start = 1;
    const timeAt = lines.findIndex((line, index) => index >= start && line.includes("-->"));
    if (timeAt < 0) continue;
    const startMs = parseClock(lines[timeAt].split("-->")[0]);
    if (startMs == null) continue;
    const spoken = parseSpoken(lines.slice(timeAt + 1).join("\n"));
    if (!spoken.text) continue;
    cues.push({ startMs, ...spoken });
  }
  return cues;
}

/** "林夏  07:30" → { speaker, startMs }, or null. */
function headerOf(line) {
  const m = NAME_THEN_TIME.exec(line);
  if (!m || !isName(m[1])) return null;
  const startMs = parseClock(m[2]);
  return startMs == null ? null : { speaker: m[1].trim(), startMs };
}

/** A speaker line, then the words: the layout many transcription tools export as .txt. */
function cuesFromHeaders(lines) {
  const seen = new Map();
  for (const line of lines) {
    const header = headerOf(line);
    if (header) seen.set(header.speaker, (seen.get(header.speaker) ?? 0) + 1);
  }
  // A header starts a paragraph, or names someone who has more than one: "会议改到 10:30" in the middle of the words is not one.
  const headers = lines.map((line, index) => {
    const header = headerOf(line);
    if (!header) return null;
    return index === 0 || !lines[index - 1] || seen.get(header.speaker) >= 2 ? header : null;
  });
  if (!headers.some(Boolean)) return null;
  const cues = [];
  let current = null;
  lines.forEach((line, index) => {
    if (headers[index]) {
      if (current?.text) cues.push(current);
      current = { ...headers[index], text: "" };
      return;
    }
    if (!line) return;
    current ??= { startMs: 0, speaker: "", text: "" };
    current.text = joinText(current.text, line);
  });
  if (current?.text) cues.push(current);
  return cues;
}

function cuesFromPlain(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
  const fromHeaders = cuesFromHeaders(lines);
  if (fromHeaders) return fromHeaders;
  const timedAt = (line) => {
    const tm = TIME_FIRST.exec(line);
    const startMs = tm ? parseClock(tm[1]) : null;
    return startMs == null ? null : { startMs, rest: tm[2] };
  };
  // When utterances start with a time, a line without one continues the last utterance,
  // unless it opens with the name of someone who speaks on a timed line: "补一句：…" is not a speaker.
  const timed = lines.some((line) => line && timedAt(line));
  const known = new Set(lines.map((line) => (line && timedAt(line) ? parseSpoken(timedAt(line).rest).speaker : "")).filter(Boolean));
  const cues = [];
  let current = null;
  const push = () => {
    if (current?.text) cues.push(current);
    current = null;
  };
  for (const line of lines) {
    if (!line) continue;
    const at = timedAt(line);
    if (at) {
      push();
      const spoken = parseSpoken(at.rest);
      current = { startMs: at.startMs, speaker: spoken.speaker, text: spoken.text };
      continue;
    }
    const split = splitSpeaker(line);
    const labeled = split && (!timed || known.has(split.speaker)) ? split : null;
    if (labeled && labeled.speaker !== current?.speaker) {
      // no time on this line: keep the last time seen
      const startMs = current?.startMs ?? cues[cues.length - 1]?.startMs ?? 0;
      push();
      current = { startMs, ...labeled };
      continue;
    }
    current ??= { startMs: 0, speaker: "", text: "" };
    current.text = joinText(current.text, labeled ? labeled.text : line);
  }
  push();
  return cues;
}

function mergeCues(cues) {
  const blocks = [];
  for (const cue of cues) {
    if (!cue.text) continue;
    const speaker = cue.speaker || "";
    const last = blocks[blocks.length - 1];
    const limit = speaker ? MAX_BLOCK_MS : MAX_UNLABELED_MS;
    if (last && last.speaker === speaker && cue.startMs - last.startMs < limit) last.text = joinText(last.text, cue.text);
    else blocks.push({ startMs: cue.startMs, speaker, text: cue.text });
  }
  return blocks;
}

function tagsOf(name) {
  const base = name.toLowerCase();
  const tags = [];
  if (/(^|[^a-z])zh([^a-z]|$)/.test(base)) tags.push("zh");
  if (/(^|[^a-z])en([^a-z]|$)/.test(base)) tags.push("en");
  return tags;
}

const dir = "transcript";
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error("没有 transcript/ 目录 / no transcript/ directory");
  process.exit(1);
}
const exts = new Set([".txt", ".srt", ".vtt"]);
const files = fs
  .readdirSync(dir)
  .filter((name) => {
    const abs = path.join(dir, name);
    return fs.statSync(abs).isFile() && exts.has(path.extname(name).toLowerCase());
  })
  .sort((a, b) => a.localeCompare(b));
const untagged = files.filter((name) => tagsOf(name).length === 0);
const chosen = untagged.length ? untagged : files.filter((name) => tagsOf(name).includes(lang));
if (!chosen.length) {
  console.error(
    `没有找到语言为 ${lang} 的记录。请在 transcript/ 放入 .txt、.srt 或 .vtt（文件名不带 zh/en 时优先用你的文件）。 / no transcript for language "${lang}" in transcript/ (.txt, .srt or .vtt; a file whose name has no zh/en tag is used first)`,
  );
  process.exit(1);
}

const blocks = [];
for (const name of chosen) {
  const raw = readText(path.join(dir, name));
  const cues = raw.includes("-->") ? cuesFromTimed(raw) : cuesFromPlain(raw);
  blocks.push(...mergeCues(cues));
}
if (!blocks.length) {
  console.error("记录里没有能整理的发言 / the transcript has no cues to clean");
  process.exit(1);
}

const colon = en ? ": " : "：";
const lines = blocks.map((block) => {
  const stamp = `[${stampFromMs(block.startMs)}]`;
  return block.speaker ? `${stamp} ${block.speaker}${colon}${block.text}` : `${stamp} ${block.text}`;
});
const names = chosen.map((name) => `transcript/${name}`);
const header = [t("# 整理后的记录", "# Cleaned transcript"), "", t(`来源：${names.join("、")}`, `Source: ${names.join(", ")}`), ""];
const body = `${header.join("\n")}\n${lines.join("\n\n")}\n`;
const out = outputs[0]?.path ?? "clean.md";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(t(`整理了 ${blocks.length} 段，见 ${out}。`, `Cleaned ${blocks.length} blocks into ${out}.`));
if (blocks.length > 1 && blocks.every((block) => block.startMs === 0)) {
  console.log(
    t(
      "提醒：记录里没有时间，每段的出处都是 [0:00]，没法按时间核对。能导出带时间的 .srt、.vtt 或 .txt 就换成那个。",
      "Note: the transcript has no times, so every block starts at [0:00] and cites can't be checked. Export it with times (.srt, .vtt or a .txt with times) if you can.",
    ),
  );
}
const unlabeled = blocks.filter((block) => !block.speaker).length;
if (unlabeled === blocks.length) {
  console.log(
    t(
      "提醒：记录里没有发言人，待办的负责人只能从说话内容里找。能导出带发言人的记录就换成那个。",
      "Note: the transcript names no speakers, so owners can only come from what was said. Export it with speaker names if you can.",
    ),
  );
}
