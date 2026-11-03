// "check" stage. Writes check-report.md and exits 0 unless actions.json is the wrong shape.
//
// Content warnings (no owner or date named, owner missing from the transcript, due date,
// source time, duplicates) never block. A format error does. Rules and sources: README "依据 / Sources".
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((item) => `- ${item}`).join("\n") : none);

const ALLOWED = ["owner", "task", "due", "source"];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** A transcript as clean.mjs reads it: UTF-8, UTF-16 with a BOM, or GBK / GB18030. */
function readTranscript(file) {
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

function transcriptText() {
  const parts = [read("clean.md")];
  if (fs.existsSync("transcript") && fs.statSync("transcript").isDirectory()) {
    for (const name of fs.readdirSync("transcript")) {
      const abs = path.join("transcript", name);
      if (!fs.statSync(abs).isFile()) continue;
      if (![".txt", ".srt", ".vtt"].includes(path.extname(name).toLowerCase())) continue;
      parts.push(readTranscript(abs));
    }
  }
  return parts.join("\n");
}

/** YYYY-MM-DD as a real calendar day, or null. */
function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Date.UTC(year, month - 1, day);
}

/** Same stamp clean.mjs writes: 12:30, or h:mm:ss past an hour. */
function normalizeStamp(value) {
  const raw = String(value ?? "").trim().replace(/^\[|\]$/g, "");
  let m = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,]\d{1,3})?$/.exec(raw);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3]);
    if (min > 59 || sec > 59) return null;
    const pad = (n) => String(n).padStart(2, "0");
    if (h > 0) return `${h}:${pad(min)}:${pad(sec)}`;
    return `${min}:${pad(sec)}`;
  }
  m = /^(\d{1,3}):(\d{2})$/.exec(raw);
  if (m && Number(m[2]) < 60) return `${Number(m[1])}:${m[2]}`;
  return null;
}

function stampsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g)) {
    const stamp = normalizeStamp(match[1]);
    if (stamp) found.add(stamp);
  }
  return found;
}

function appears(name, text) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  // a Chinese name sits inside the words with nothing around it: "让周衡去问"
  if (/[\u3400-\u9fff]/.test(trimmed)) return text.includes(trimmed);
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function formatProblems(data) {
  if (!Array.isArray(data)) return [t("actions.json 必须是数组。", "actions.json must be an array.")];
  const problems = [];
  data.forEach((item, index) => {
    const where = `#${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(t(`${where} 不是对象。`, `${where} is not an object.`));
      return;
    }
    for (const key of ALLOWED) {
      // owner and due may be "": nobody took it, or no date was named. The report asks for them.
      const mayBeEmpty = key === "owner" || key === "due";
      if (typeof item[key] !== "string" || (!mayBeEmpty && !item[key].trim())) {
        problems.push(t(`${where} 缺少 ${key}。`, `${where} is missing ${key}.`));
      }
    }
    for (const key of Object.keys(item)) {
      if (!ALLOWED.includes(key)) problems.push(t(`${where} 有多余字段 ${key}。`, `${where} has an unexpected field ${key}.`));
    }
  });
  return problems;
}

const out = outputs[0]?.path ?? "check-report.md";
const meetingDay = parseDay(flowInputs.date);
const record = transcriptText();
const knownStamps = stampsIn(read("clean.md"));
const minuteStamps = [...stampsIn(read("minutes.md"))].filter((stamp) => !knownStamps.has(stamp));

let parsed;
let format = [];
try {
  parsed = JSON.parse(read("actions.json") || "");
} catch (err) {
  format = [t(`actions.json 不是合法的 JSON：${err.message}`, `actions.json is not valid JSON: ${err.message}`)];
}
if (!format.length) format = formatProblems(parsed);

const lines = [t("# 会议纪要检查", "# Meeting notes check"), ""];

if (format.length) {
  lines.push(
    t("## 格式错误", "## Format errors"),
    list(format),
    "",
    t("格式不对，这一步先停下来。改好 actions.json 再跑。内容问题只会写在报告里，不会拦。", "The shape is wrong, so this stage stops. Fix actions.json and run it again. Content warnings stay in the report and do not stop the stage."),
    "",
  );
  fs.writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  process.exit(1);
}

const actions = parsed;
const missing = [];
const owners = [];
const dates = [];
const sources = [];
const seen = new Map();
const duplicates = [];
actions.forEach((item, index) => {
  const where = `#${index + 1}`;
  const owner = item.owner.trim();
  const task = item.task.trim().replace(/\s+/g, " ");
  if (!owner) missing.push(t(`${where} ${task}：会上没人接下，请指定一个负责人。`, `${where} ${task}: nobody took it; name one owner.`));
  else if (!appears(owner, record)) owners.push(t(`${where} ${owner} 不在记录里。`, `${where} ${owner} does not appear in the transcript.`));
  const due = parseDay(item.due);
  if (!item.due.trim()) missing.push(t(`${where} ${task}：会上没说什么时候做完，请补上日期。`, `${where} ${task}: no date was named; add one.`));
  else if (due == null) dates.push(t(`${where} ${item.due} 不是 YYYY-MM-DD 的有效日期。`, `${where} ${item.due} is not a valid YYYY-MM-DD date.`));
  else if (meetingDay == null) dates.push(t(`${where} 会议日期“${flowInputs.date ?? ""}”不是 YYYY-MM-DD，没法判断是否早于会议。`, `${where} meeting date "${flowInputs.date ?? ""}" is not YYYY-MM-DD, so it cannot be compared.`));
  else if (due < meetingDay) dates.push(t(`${where} ${item.due} 早于会议 ${flowInputs.date}。`, `${where} ${item.due} is before the meeting on ${flowInputs.date}.`));
  const stamp = normalizeStamp(item.source);
  if (!stamp || !knownStamps.has(stamp)) sources.push(t(`${where} 出处 ${item.source} 对不上整理稿里的起始时间。`, `${where} source ${item.source} is not a block start in the cleaned transcript.`));
  const key = `${owner.toLowerCase()}\0${task.toLowerCase()}`;
  if (seen.has(key)) duplicates.push(t(`${where} 与 ${seen.get(key)} 重复：${owner} / ${task}`, `${where} duplicates ${seen.get(key)}: ${owner} / ${task}`));
  else seen.set(key, where);
});

const described = actions.map((item) => t(
  `${item.owner.trim() || "（负责人待定）"}：${item.task.trim()}（${item.due.trim() || "日期待定"}，出处 ${String(item.source).trim()}）`,
  `${item.owner.trim() || "(owner TBD)"}: ${item.task.trim()} (${item.due.trim() || "date TBD"}, source ${String(item.source).trim()})`,
));
const sections = [
  [t("## 待办", "## Actions"), described],
  [t("## 要补上的负责人或日期", "## Owners or dates to fill in"), missing],
  [t("## 负责人不在记录里", "## Owners missing from the transcript"), owners],
  [t("## 日期不是有效日期，或早于会议", "## Dates that are invalid or before the meeting"), dates],
  [t("## 出处时间对不上记录", "## Source times missing from the transcript"), sources],
  [t("## 重复的待办", "## Duplicate actions"), duplicates],
  [t("## 纪要里对不上的出处时间", "## Decision times missing from the transcript"), minuteStamps],
];
const issues = missing.length + owners.length + dates.length + sources.length + duplicates.length + minuteStamps.length;
lines.push(
  t(`待办 ${actions.length} 条。`, `${actions.length} ${actions.length === 1 ? "action" : "actions"}.`),
  "",
  ...sections.flatMap(([title, items]) => [title, list(items), ""]),
  issues
    ? t(`有 ${issues} 处要看一下。这些检查只做提醒，纪要可以继续往下写，请你自己通读。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at. These checks only warn, so you can keep going; read the minutes yourself.`)
    : t("检查通过。这些检查只做提醒，不能代替你自己通读纪要。", "All checks passed. These checks only warn; they do not replace reading the minutes yourself."),
  "",
);
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
