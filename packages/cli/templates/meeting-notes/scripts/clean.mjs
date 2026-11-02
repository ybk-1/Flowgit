// "clean" stage. Turn transcript/ (.txt, .srt, .vtt) into clean.md.
//
// Consecutive cues from the same speaker become one block. Timecodes inside
// the words are dropped; each block keeps the start of its first cue as [m:ss]
// (or [h:mm:ss] past an hour) so later stages can cite that time.
// See README "依据 / Sources": the timestamp stays so a decision can be checked
// against what was actually said.
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const lang = flowInputs.language === "en" ? "en" : "zh";
const en = lang === "en";
const t = (zh, english) => (en ? english : zh);

const cjkOrPunct = /[\u3400-\u9fff，。！？、；：]/;

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

function parseSpoken(body) {
  let text = String(body).replace(/\r/g, "");
  let speaker = "";
  const v = /<v\s+([^>]+)>/i.exec(text);
  if (v) {
    speaker = v[1].trim();
    text = text.replace(/<v\s+[^>]*>/gi, "").replace(/<\/v>/gi, "");
  }
  text = text.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").trim();
  if (!speaker) {
    const sm = /^([^:：\n]{1,40})[:：]\s*([\s\S]*)$/.exec(text);
    if (sm && !/^\d{1,2}$/.test(sm[1].trim())) {
      speaker = sm[1].trim();
      text = sm[2].trim();
    }
  }
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return { speaker, text: lines.reduce((acc, line) => joinText(acc, line), "") };
}

function cuesFromTimed(text) {
  const blocks = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split(/\n{2,}/);
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
    if (!spoken.text && !spoken.speaker) continue;
    cues.push({ startMs, ...spoken });
  }
  return cues;
}

function cuesFromPlain(text) {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const cues = [];
  let current = null;
  const timeRe = /^\[?(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?|\d{1,3}:\d{2})\]?\s*(.*)$/;
  const push = () => {
    if (current && (current.text || current.speaker)) cues.push(current);
    current = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const tm = timeRe.exec(line);
    const startMs = tm ? parseClock(tm[1]) : null;
    if (tm && startMs != null) {
      push();
      const spoken = parseSpoken(tm[2]);
      current = { startMs, speaker: spoken.speaker, text: spoken.text };
      continue;
    }
    const spoken = parseSpoken(line);
    if (!current) {
      current = { startMs: 0, speaker: spoken.speaker, text: spoken.speaker ? spoken.text : line };
      continue;
    }
    if (spoken.speaker && spoken.speaker !== current.speaker) {
      push();
      current = { startMs: cues.length ? cues[cues.length - 1].startMs : 0, speaker: spoken.speaker, text: spoken.text };
      continue;
    }
    current.text = joinText(current.text, spoken.speaker ? spoken.text : line);
  }
  push();
  return cues;
}

function mergeCues(cues) {
  const blocks = [];
  for (const cue of cues) {
    const speaker = cue.speaker || "";
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) last.text = joinText(last.text, cue.text);
    else blocks.push({ startMs: cue.startMs, speaker, text: cue.text });
  }
  return blocks.filter((block) => block.text);
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
  const raw = fs.readFileSync(path.join(dir, name), "utf8");
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
