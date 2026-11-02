// 检查阶段：读 site/index.html 和 copy.json，写 check-report.md。
// Check stage: read site/index.html and copy.json, write check-report.md.
//
// 缺替代文本的图片、空链接、跳级的标题、过长的区块，以及文案里有但页面上没有的区块。
// Images missing alt, empty links, skipped heading levels, overly long blocks,
// and blocks present in copy.json but missing from the page.
import fs from "node:fs";
import path from "node:path";

const BODY_LIMIT = 500;
const HEADING_LIMIT = 80;

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const lang = flowInputs.language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function copyEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { heading: "", body: "", button: "" };
  return {
    heading: String(raw.heading ?? raw.title ?? "").trim(),
    body: String(raw.body ?? raw.text ?? "").trim(),
    button: String(raw.button ?? raw.buttonText ?? "").trim(),
  };
}

function copyMap(doc) {
  const raw = Array.isArray(doc) ? doc : doc?.blocks ?? doc;
  if (Array.isArray(raw)) {
    const out = Object.create(null);
    for (const item of raw) {
      if (item && typeof item === "object" && item.id) out[String(item.id)] = item;
    }
    return out;
  }
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

function writeReport(lines) {
  const outRel = outputs[0]?.path ?? "check-report.md";
  const outAbs = path.resolve(dir, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const text = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  fs.writeFileSync(outAbs, text);
  return text;
}

function fail(message) {
  const text = writeReport([say("# 落地页检查", "# Landing page check"), "", message, ""]);
  console.error(text);
  process.exit(1);
}

const htmlPath = path.join(dir, "site", "index.html");
const copyPath = path.join(dir, "copy.json");
if (!fs.existsSync(htmlPath)) fail(say("找不到 site/index.html。", "site/index.html is missing."));
if (!fs.existsSync(copyPath)) fail(say("找不到 copy.json。", "copy.json is missing."));

let copyDoc;
try {
  copyDoc = readJson(copyPath);
} catch (err) {
  fail(say(`copy.json 无法解析：${err.message}`, `Could not parse copy.json: ${err.message}`));
}

const html = fs.readFileSync(htmlPath, "utf8");
const alts = [];
for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
  const alt = /\balt="([^"]*)"/.exec(tag);
  const value = alt ? alt[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
  if (!value) {
    const src = /\bsrc="([^"]*)"/.exec(tag);
    alts.push(src ? src[1] : say("(没有 src)", "(no src)"));
  }
}

const links = [];
for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
  const href = /\bhref="([^"]*)"/.exec(tag);
  const value = href ? href[1].trim() : "";
  if (!value || value === "#" || value.toLowerCase().startsWith("javascript:")) links.push(tag.replace(/\s+/g, " ").slice(0, 160));
}

const skips = [];
let prev = 0;
for (const level of [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]))) {
  if (level > prev + 1) {
    skips.push(
      prev === 0
        ? say(`开头是 h${level}，应从 h1 开始`, `starts at h${level}, expected h1`)
        : say(`h${prev} 之后是 h${level}`, `h${prev} then h${level}`),
    );
  }
  prev = level;
}

const longs = [];
const missing = [];
for (const [id, raw] of Object.entries(copyMap(copyDoc))) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
  const entry = copyEntry(raw);
  const bodyLen = [...entry.body].length;
  const headingLen = [...entry.heading].length;
  if (bodyLen > BODY_LIMIT) {
    longs.push(say(`${id}：正文 ${bodyLen} 字（上限 ${BODY_LIMIT}）`, `${id}: body is ${bodyLen} characters (limit ${BODY_LIMIT})`));
  }
  if (headingLen > HEADING_LIMIT) {
    longs.push(say(`${id}：标题 ${headingLen} 字（上限 ${HEADING_LIMIT}）`, `${id}: heading is ${headingLen} characters (limit ${HEADING_LIMIT})`));
  }
  const onPage = html.includes(`data-block="${escapeHtml(id)}"`) && (entry.heading === "" || html.includes(escapeHtml(entry.heading)));
  if (!onPage) missing.push(id);
}

function section(title, items) {
  return [`## ${title}`, "", items.length ? items.map((item) => `- ${item}`).join("\n") : say("没有。", "None."), ""];
}

const summary = [alts, links, skips, longs, missing].every((list) => list.length === 0)
  ? say("没有问题。", "No problems.")
  : say(
      `问题：缺替代文本 ${alts.length}，空链接 ${links.length}，跳级 ${skips.length}，过长 ${longs.length}，缺失 ${missing.length}。`,
      `Problems: missing alt ${alts.length}, empty links ${links.length}, skipped headings ${skips.length}, long blocks ${longs.length}, missing blocks ${missing.length}.`,
    );

const lines = [
  say("# 落地页检查", "# Landing page check"),
  "",
  ...section(say("缺少替代文本的图片", "Images missing alt"), alts),
  ...section(say("空链接", "Empty links"), links),
  ...section(say("跳级的标题", "Skipped heading levels"), skips),
  ...section(say("过长的区块", "Overly long blocks"), longs),
  ...section(say("文案里有、页面上没有的区块", "Blocks in the copy missing from the page"), missing),
  summary,
  "",
];

const text = writeReport(lines);
console.log(summary);
if (summary !== say("没有问题。", "No problems.")) {
  console.error(say("检查没通过。", "Checks failed."));
  console.error(text);
  process.exit(1);
}
