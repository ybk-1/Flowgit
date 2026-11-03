// 检查阶段：读 site/、copy.json 和 brief.md，写 check-report.md。
// Check stage: read site/, copy.json and brief.md, write check-report.md.
//
// 两档。「必须修」会让这一步失败；「上线前确认」只提醒，因为要看脚本看不到的事实。
// Two tiers. "Must fix" fails the stage. "Confirm before going live" only warns, because it
// depends on facts this script cannot see.
//
// Rules and where they come from (README "参考资料 / References" has the links):
// - WCAG 2.2: 1.1.1 text alternatives; 1.3.1 and 3.3.2 labels; 1.3.5 autocomplete on fields about
//   the visitor; 1.4.3 text contrast 4.5:1; 1.4.11 field borders 3:1; 2.4.2 page title; 2.4.4 link
//   purpose; 3.1.1 page language. Heading order: the W3C WAI headings tutorial.
// - Notice at collection: GDPR art. 13, CCPA regulations § 7012, PIPL art. 17. Collect only what
//   the goal needs: GDPR art. 5(1)(c), PIPL art. 6.
// - Consent boxes are never pre-ticked: CJEU C-673/17 (Planet49), GDPR recital 32.
// - Reviews: FTC 16 CFR 465 and the Endorsement Guides (16 CFR 255); UCPD annex I nos. 23b and 23c;
//   广告法 art. 28; 网络反不正当竞争暂行规定 art. 9.
// - False urgency: FTC "Bringing Dark Patterns to Light" (2022); UCPD annex I no. 7.
// - Absolute claims: 广告法 art. 9; the FTC policy on advertising substantiation.
// - One page, one goal (an attention ratio of 1:1): Unbounce. Specific labels: NN/g.
// - Width and height on images (CLS), no lazy loading on the first image (LCP), and a page weight
//   under 1,600 KiB: web.dev and Lighthouse.
import fs from "node:fs";
import path from "node:path";

const BODY_LIMIT = 500;
const HEADING_LIMIT = 80;
const WEIGHT_LIMIT_KIB = 1600;

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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^﻿/, ""));
}

function readText(abs) {
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/^﻿/, "") : null;
}

function copyEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { heading: "", body: "", button: "", note: "" };
  return {
    heading: String(raw.heading ?? raw.title ?? "").trim(),
    body: String(raw.body ?? raw.text ?? "").trim(),
    button: String(raw.button ?? raw.buttonText ?? "").trim(),
    note: String(raw.note ?? raw.privacy ?? "").trim(),
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
const css = readText(path.join(dir, "site", "style.css"));
const brief = readText(path.join(dir, "brief.md"));
const copies = Object.entries(copyMap(copyDoc))
  .filter(([, raw]) => raw && typeof raw === "object" && !Array.isArray(raw))
  .map(([id, raw]) => ({ id, ...copyEntry(raw) }));
const copyText = copies.map((c) => [c.heading, c.body, c.button, c.note].join("\n")).join("\n");

// ---- Small HTML helpers. The page comes from build.mjs, so simple patterns are enough. ----

function attr(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i").exec(tag);
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** A boolean attribute such as checked, ignoring text inside quoted values. */
function flag(tag, name) {
  return new RegExp(`\\s${name}(?=[\\s=/>])`, "i").test(tag.replace(/"[^"]*"|'[^']*'/g, '""'));
}

function textOf(fragment) {
  return decodeHtml(String(fragment).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const short = (tag) => tag.replace(/\s+/g, " ").slice(0, 160);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function innerById(id) {
  const re = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\sid\\s*=\\s*["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)</\\1>`, "i");
  return re.exec(html)?.[2] ?? null;
}

const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ tag: /<a\b[^>]*>/i.exec(m[0])[0], text: textOf(m[1]) }));

// ---- Markdown helpers for the brief ----

function briefSection(pattern) {
  if (brief === null) return null;
  const parts = brief.split(/^##\s+/m).slice(1);
  const hit = parts.find((part) => pattern.test(part.split("\n")[0]));
  return hit === undefined ? null : hit.slice(hit.indexOf("\n") + 1);
}

const DO_NOT_SAY = /不要说|不要写|不能说|do not say|don't say|avoid/i;
const doNotSay = briefSection(DO_NOT_SAY) ?? "";
// What the brief allows: everything except its "do not say" section.
const briefAllowed =
  brief === null
    ? ""
    : brief
        .split(/^(?=##\s)/m)
        .filter((part) => !(/^##\s/.test(part) && DO_NOT_SAY.test(part.split("\n")[0])))
        .join("");

function quotesIn(text, min = 4) {
  const re = /「([^」]+)」|“([^”]+)”|"([^"]+)"|『([^』]+)』/g;
  return [...String(text).matchAll(re)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]).trim()).filter((q) => [...q].length >= min);
}

// Letters and digits only, so punctuation and spacing differences do not matter.
const squash = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Terms found in the text, skipping ones right after a negation such as 不 / no / not. */
function findTerms(text, terms) {
  const hay = String(text).toLowerCase();
  const found = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    const latin = /^[a-z0-9]/.test(needle);
    let at = hay.indexOf(needle);
    while (at !== -1) {
      const before = hay.slice(Math.max(0, at - 16), at);
      const after = hay[at + needle.length] ?? "";
      const bounded = !latin || (!/[a-z0-9]/.test(hay[at - 1] ?? "") && !/[a-z0-9]/.test(after));
      const negated = /[不没无别勿非][^，。！？；,.!?;\n]{0,2}$/.test(before) || /\b(?:no|not|never|without|don't|won't)\s+(?:\w+\s+)?$/.test(before);
      if (bounded && !negated) {
        found.push(term);
        break;
      }
      at = hay.indexOf(needle, at + 1);
    }
  }
  return [...new Set(found)];
}

// ======================= Must fix =======================

const images = html.match(/<img\b[^>]*>/gi) ?? [];
const alts = [];
for (const tag of images) {
  const alt = attr(tag, "alt");
  if (!alt || !alt.trim()) alts.push(attr(tag, "src") || say("(没有 src)", "(no src)"));
}

const links = [];
for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
  const value = (attr(tag, "href") ?? "").trim();
  if (!value || value === "#" || value.toLowerCase().startsWith("javascript:")) links.push(short(tag));
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
for (const entry of copies) {
  const bodyLen = [...entry.body].length;
  const headingLen = [...entry.heading].length;
  if (bodyLen > BODY_LIMIT) {
    longs.push(say(`${entry.id}：正文 ${bodyLen} 字（上限 ${BODY_LIMIT}）`, `${entry.id}: body is ${bodyLen} characters (limit ${BODY_LIMIT})`));
  }
  if (headingLen > HEADING_LIMIT) {
    longs.push(say(`${entry.id}：标题 ${headingLen} 字（上限 ${HEADING_LIMIT}）`, `${entry.id}: heading is ${headingLen} characters (limit ${HEADING_LIMIT})`));
  }
  const onPage = html.includes(`data-block="${escapeHtml(entry.id)}"`) && (entry.heading === "" || html.includes(escapeHtml(entry.heading)));
  if (!onPage) missing.push(entry.id);
}

const langTitle = [];
const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? "";
if (!(attr(htmlTag, "lang") ?? "").trim()) {
  langTitle.push(say("`<html>` 没有 lang 属性：读屏软件不知道用哪种语言念", "`<html>` has no lang attribute, so screen readers cannot tell which language to read it in"));
}
if (!textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")) {
  langTitle.push(say("没有 `<title>`，或者它是空的", "There is no `<title>`, or it is empty"));
}
// lang has to match the text, or screen readers read Chinese with an English voice (or the reverse).
const pageLang = (attr(htmlTag, "lang") ?? "").trim().toLowerCase();
const bodyText = textOf(/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? "");
const cjkCount = (bodyText.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
const latinCount = (bodyText.match(/[A-Za-z]/g) ?? []).length;
if (cjkCount + latinCount >= 40) {
  const cjkShare = cjkCount / (cjkCount + latinCount);
  if (pageLang.startsWith("en") && cjkShare > 0.3) {
    langTitle.push(
      say(
        `页面写着 lang="${pageLang}"，正文却大多是中文：重新生成文案，或者把输入 language 改成 zh`,
        `The page says lang="${pageLang}" but most of its text is Chinese: regenerate the copy, or set the language input to zh`,
      ),
    );
  }
  if (pageLang.startsWith("zh") && cjkShare < 0.3) {
    langTitle.push(
      say(
        `页面写着 lang="${pageLang}"，正文却大多是英文：重新生成文案，或者把输入 language 改成 en`,
        `The page says lang="${pageLang}" but most of its text is English: regenerate the copy, or set the language input to en`,
      ),
    );
  }
}

// Form controls. Checkboxes and radios are choices; the rest collect something the visitor types.
const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const controls = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/gi)]
  .map((m) => {
    const kind = m[1].toLowerCase();
    return { tag: m[0], type: kind === "input" ? (attr(m[0], "type") || "text").toLowerCase() : kind, id: attr(m[0], "id") ?? "" };
  })
  .filter((c) => !SKIP_TYPES.has(c.type));
const typed = controls.filter((c) => c.type !== "checkbox" && c.type !== "radio");
const labels = [...html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)].map((m) => ({ tag: `<label${m[1]}>`, inner: m[2] }));

function labelOf(control) {
  for (const label of labels) {
    const owns = (control.id && attr(label.tag, "for") === control.id) || label.inner.includes(control.tag);
    if (!owns) continue;
    const text = textOf(label.inner.replace(/<(?:input|select|textarea)\b[^>]*>/gi, " "));
    if (text) return text;
  }
  const labelledby = (attr(control.tag, "aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return labelledby.map((id) => textOf(innerById(id) ?? "")).join(" ").trim();
}

const name = (c) => (c.id ? `#${c.id}` : short(c.tag));
const unlabeled = controls.filter((c) => !labelOf(c)).map(name);

const autofill = [];
for (const c of typed) {
  const tokens = (attr(c.tag, "autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (c.type === "email" && !tokens.includes("email")) {
    autofill.push(say(`${name(c)}：type="email" 要写 autocomplete="email"`, `${name(c)}: type="email" needs autocomplete="email"`));
  }
  if (c.type === "tel" && !tokens.some((t) => t.startsWith("tel"))) {
    autofill.push(say(`${name(c)}：type="tel" 要写 autocomplete="tel"`, `${name(c)}: type="tel" needs autocomplete="tel"`));
  }
}

const preTicked = controls.filter((c) => c.type === "checkbox" && flag(c.tag, "checked")).map((c) => labelOf(c) || name(c));

// The notice must say something itself; a bare link to a policy is not enough.
function noticeOf(control) {
  const ids = (attr(control.tag, "aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => textOf((innerById(id) ?? "").replace(/<a\b[\s\S]*?<\/a>/gi, " "))).join(" ").trim();
}
const noNotice = typed.filter((c) => !noticeOf(c)).map(name);

// The markers the copy prompt asks for, plus the usual ones. Not 待定 / TBD: "price TBD" can be true.
const PLACEHOLDER = /待补充|待填|\bTODO\b|\bTo add:|\[\.\.\.\]|\[…\]/i;
const placeholders = [];
for (const entry of copies) {
  for (const field of ["heading", "body", "button", "note"]) {
    const value = entry[field].replace(/\s+/g, " ").slice(0, 80);
    if (PLACEHOLDER.test(entry[field])) placeholders.push(say(`${entry.id}.${field}：${value}`, `${entry.id}.${field}: ${value}`));
  }
}

// Contrast of the color tokens in style.css, light and dark.
function rootVars(text) {
  const vars = {};
  for (const m of text.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  }
  return vars;
}

function blockAfter(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return { inner: text.slice(open + 1), end: text.length };
}

function parseColor(value, vars, depth = 0) {
  const v = String(value ?? "").trim().toLowerCase();
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  if (ref) return depth < 5 ? parseColor(vars[ref[1]], vars, depth + 1) : null;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) return [m[1], m[2], m[3]].map(Number);
  if (v === "white") return [255, 255, 255];
  if (v === "black") return [0, 0, 0];
  return null;
}

// WCAG 2.2 relative luminance and contrast ratio.
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const contrast = [];
if (css !== null) {
  const media = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/i.exec(css);
  let lightText = css;
  let darkText = "";
  if (media) {
    const block = blockAfter(css, media.index + media[0].length - 1);
    darkText = block.inner;
    lightText = css.slice(0, media.index) + css.slice(block.end);
  }
  const light = rootVars(lightText);
  const modes = [[say("浅色", "Light"), light]];
  if (media) modes.push([say("深色", "Dark"), { ...light, ...rootVars(darkText) }]);
  const PAIRS = [
    ["--text", "--bg", 4.5],
    ["--text", "--card", 4.5],
    ["--muted", "--card", 4.5],
    ["--muted", "--bg", 4.5],
    ["--button-text", "--button-bg", 4.5],
    ["--field-line", "--card", 3],
    ["--field-line", "--bg", 3],
  ];
  for (const [mode, vars] of modes) {
    for (const [fg, bg, min] of PAIRS) {
      const a = parseColor(vars[fg], vars);
      const b = parseColor(vars[bg], vars);
      if (!a || !b) continue;
      const ratio = contrastRatio(a, b);
      if (ratio + 1e-9 < min) {
        contrast.push(
          say(
            `${mode}：${fg}（${vars[fg]}）在 ${bg}（${vars[bg]}）上是 ${ratio.toFixed(2)}:1，至少要 ${min}:1`,
            `${mode}: ${fg} (${vars[fg]}) on ${bg} (${vars[bg]}) is ${ratio.toFixed(2)}:1; it needs at least ${min}:1`,
          ),
        );
      }
    }
  }
}

// ======================= Confirm before going live =======================

const privacy = [];
const isPolicyLink = (a) => /\b(?:privacy-policy|terms-of-service)\b/i.test(attr(a.tag, "rel") ?? "") || /隐私|privacy|条款|terms/i.test(a.text);
if (typed.length && !anchors.some(isPolicyLink)) {
  privacy.push(
    say(
      "表单附近没有隐私政策链接。收集说明讲了谁收、做什么用、存多久、怎么撤回，完整的说明通常放在隐私政策里：有的话把地址填进输入 privacyUrl。",
      "There is no privacy policy link near the form. The notice says who collects, what for, how long and how to withdraw; the full details usually live in a privacy policy. If you have one, set the privacyUrl input.",
    ),
  );
}

const swatches = [...html.matchAll(/<p class="swatch-file">([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1]));
const missingImages = swatches.length
  ? [say(`还没有图片，页面上显示的是「图片待补」：${swatches.join("、")}`, `No image yet, so the page shows "Image to add": ${swatches.join(", ")}`)]
  : [];

const extraFields = [];
if (typed.length > 1) {
  extraFields.push(
    say(
      `表单有 ${typed.length} 个要填的字段（${typed.map((c) => labelOf(c) || name(c)).join("、")}）。每多一个字段，愿意填的人就少一些：只留完成目标必需的。`,
      `The form has ${typed.length} fields to fill in (${typed.map((c) => labelOf(c) || name(c)).join(", ")}). Every extra field costs sign-ups; keep only what the goal needs.`,
    ),
  );
}

const GENERIC = new Set([
  "提交", "确定", "确认", "发送", "点击", "点击这里", "点这里", "这里", "了解更多", "查看更多", "更多", "详情",
  "submit", "send", "ok", "go", "click", "click here", "here", "learn more", "read more", "more", "details", "continue",
]);
const labelKey = (s) => s.toLowerCase().replace(/[\s。，、！!？?…:：>»→]+/g, " ").trim();
const actionTexts = [
  ...[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => textOf(m[1])),
  ...anchors.map((a) => a.text),
];
const vague = [...new Set(actionTexts.filter((text) => GENERIC.has(labelKey(text))))].map((text) =>
  say(`「${text}」：写成动词加结果，例如「留下邮箱，开卖时通知我」`, `"${text}": say the action and what happens, such as "Notify me when it launches"`),
);

// Ids that lead to the form: the section around it, the form itself and everything inside it.
const formTargets = new Set();
for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
  const section = [...html.slice(0, m.index).matchAll(/<section\b[^>]*>/gi)].at(-1);
  const sectionId = section ? attr(section[0], "id") : null;
  if (sectionId) formTargets.add(sectionId);
  for (const t of m[0].matchAll(/<[a-z][^>]*>/gi)) {
    const id = attr(t[0], "id");
    if (id) formTargets.add(id);
  }
}
const offGoal = [];
for (const a of anchors) {
  const href = (attr(a.tag, "href") ?? "").trim();
  if (!href || href === "#" || href.toLowerCase().startsWith("javascript:") || isPolicyLink(a)) continue;
  let target = "";
  try {
    target = href.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
  } catch {
    target = href.slice(1);
  }
  if (target && formTargets.has(target)) continue;
  offGoal.push(`${a.text || short(a.tag)} → ${href}`);
}

const URGENCY = [
  "限时", "仅剩", "只剩", "最后机会", "最后一天", "倒计时", "抢购", "马上抢", "立即抢", "手慢无", "售罄", "即将截止", "名额有限", "错过不再", "今天截止",
  "limited time", "last chance", "hurry", "act now", "ends soon", "ending soon", "while supplies last", "selling out", "almost gone",
  "only a few left", "don't miss out", "countdown", "today only",
];
const urgency = findTerms(copyText, URGENCY)
  .filter((term) => !findTerms(briefAllowed, [term]).length)
  .map((term) =>
    say(`「${term}」：简报里没有真实的截止日期或库存，就不要写`, `"${term}": the brief states no real deadline or stock, so leave it out`),
  );
if (/\bonly \d+ left\b|仅剩\s*\d+|只剩\s*\d+/i.test(copyText) && !urgency.length) {
  urgency.push(say("写了剩余数量：确认库存是真的", "The copy states how many are left: make sure the stock figure is real"));
}

const ABSOLUTE = [
  "最好的", "最佳", "最强", "最优", "最低价", "最便宜", "全网最", "史上最", "第一品牌", "排名第一", "销量第一", "全网第一", "行业第一",
  "国家级", "世界级", "最高级", "顶级", "极品", "独一无二", "万能", "百分百", "100%",
  "the best", "best ever", "world's best", "number one", "no. 1", "no.1", "#1", "unbeatable", "guaranteed",
];
const absolute = findTerms(copyText, ABSOLUTE).map((term) =>
  say(`「${term}」：拿不出证据就删掉；中国广告里很多绝对化用语有证据也不能用`, `"${term}": remove it unless you can prove it; in China many absolute terms are banned in ads even with proof`),
);

const banned = [...new Set(quotesIn(doNotSay, 2))];
const said = findTerms(copyText, banned).map((term) => say(`「${term}」：简报说不要写`, `"${term}": the brief says not to say this`));

const testimonialNotes = [];
const testimonial = copies.find((c) => c.id === "testimonial");
if (testimonial && brief !== null) {
  const quotes = quotesIn(`${testimonial.heading}\n${testimonial.body}`);
  const known = squash(briefAllowed);
  for (const quote of quotes) {
    if (!known.includes(squash(quote))) {
      testimonialNotes.push(
        say(
          `「${quote}」在简报里找不到：不能编造或改写用户的话；如果是翻译，确认意思没变`,
          `"${quote}" is not in the brief. Never invent or reword a customer's words; if it is a translation, make sure it says the same thing`,
        ),
      );
    }
  }
  if (!quotes.length) {
    testimonialNotes.push(
      say(
        "推荐语里没有带引号的用户原话：上线前换成简报里真实的原话（注明是谁说的、有没有免费试用这类关系），或者删掉这个区块",
        "The testimonial has no quoted customer words. Before going live, use a real quote from the brief (who said it, and any tie such as a free sample) or remove the block",
      ),
    );
  }
}

const numbersIn = (text) =>
  String(text)
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1") // 1,200 is one number
    .match(/\d+(?:\.\d+)?/g) ?? [];
const numbers = [];
if (brief !== null) {
  const known = new Set(numbersIn(`${briefAllowed}\n${Object.values(flowInputs).join("\n")}`));
  const unknown = [...new Set(numbersIn(copyText))].filter((n) => !known.has(n) && !known.has(String(Number(n))));
  if (unknown.length) {
    numbers.push(say(`${unknown.join("、")}：简报里没有，核实后再上线`, `${unknown.join(", ")}: not in the brief; verify before going live`));
  }
}

const head = [];
const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
const meta = (key) => metas.find((tag) => (attr(tag, "name") ?? "").toLowerCase() === key);
if (!(attr(meta("description") ?? "", "content") ?? "").trim()) {
  head.push(say("没有 meta description：搜索结果可能随便截一段正文当摘要", "No meta description, so search results may show any passage as the snippet"));
}
if (!meta("viewport")) head.push(say("没有 viewport：手机会按电脑宽度缩小显示", "No viewport meta, so phones shrink the page to desktop width"));

const imageNotes = [];
images.forEach((tag, i) => {
  const src = attr(tag, "src") ?? say("(没有 src)", "(no src)");
  if (!attr(tag, "width") || !attr(tag, "height")) {
    imageNotes.push(say(`${src}：没写 width 和 height，图片加载时页面会跳`, `${src}: no width and height, so the page jumps while it loads`));
  }
  if (i === 0 && (attr(tag, "loading") ?? "").toLowerCase() === "lazy") {
    imageNotes.push(say(`${src}：第一张图常常是首屏最大的元素，不要懒加载`, `${src}: the first image is often the largest thing on screen, so do not lazy-load it`));
  }
});

function filesUnder(abs) {
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    return entry.isFile() ? [{ rel: path.relative(dir, child).split(path.sep).join("/"), size: fs.statSync(child).size }] : [];
  });
}
const weight = [];
const siteFiles = filesUnder(path.join(dir, "site"));
const totalKib = Math.round(siteFiles.reduce((n, f) => n + f.size, 0) / 1024);
if (totalKib > WEIGHT_LIMIT_KIB) {
  const biggest = [...siteFiles].sort((a, b) => b.size - a.size).slice(0, 3).map((f) => `${f.rel} ${Math.round(f.size / 1024)} KiB`);
  weight.push(
    say(
      `site/ 一共 ${totalKib} KiB，超过 ${WEIGHT_LIMIT_KIB} KiB。最大的：${biggest.join("、")}。压缩图片，或者换成 WebP`,
      `site/ is ${totalKib} KiB, over ${WEIGHT_LIMIT_KIB} KiB. Largest: ${biggest.join(", ")}. Compress the images or switch to WebP`,
    ),
  );
}

const cta = [];
if (!/<form\b/i.test(html) && !/<button\b/i.test(html)) {
  cta.push(say("页面上没有表单或按钮：访问者不知道下一步做什么", "The page has no form or button, so visitors have no next step"));
}

// ======================= Report =======================

const checks = [
  { tier: "must", title: say("缺少替代文本的图片", "Images missing alt"), basis: "WCAG 1.1.1", items: alts },
  { tier: "must", title: say("空链接", "Empty links"), basis: "", items: links },
  { tier: "must", title: say("跳级的标题", "Skipped heading levels"), basis: "W3C WAI", items: skips },
  { tier: "must", title: say("过长的区块", "Overly long blocks"), basis: "NN/g", items: longs },
  { tier: "must", title: say("文案里有、页面上没有的区块", "Blocks in the copy missing from the page"), basis: "", items: missing },
  { tier: "must", title: say("页面语言和标题", "Page language and title"), basis: "WCAG 3.1.1, 2.4.2", items: langTitle },
  { tier: "must", title: say("没有标签的输入框", "Inputs without a label"), basis: "WCAG 1.3.1, 3.3.2", items: unlabeled },
  { tier: "must", title: say("缺少自动填充的输入框", "Inputs missing autocomplete"), basis: "WCAG 1.3.5", items: autofill },
  { tier: "must", title: say("预先勾选的框", "Pre-ticked boxes"), basis: say("Planet49 案（C-673/17）；GDPR 鉴于条款 32", "CJEU C-673/17 Planet49; GDPR recital 32"), items: preTicked },
  {
    tier: "must",
    title: say("表单旁边没有收集说明", "Fields without a notice at collection"),
    basis: say("GDPR 第 13 条；CCPA 条例 §7012；个人信息保护法第 17 条", "GDPR art. 13; CCPA regs § 7012; PIPL art. 17"),
    items: noNotice.length
      ? [
          say(
            `${noNotice.join("、")}：在表单里写一两句谁收集（名称和联系方式）、用来做什么、保存多久、怎么撤回，并用 aria-describedby 指向它`,
            `${noNotice.join(", ")}: add a sentence or two in the form saying who collects (name and contact), what for, how long it is kept and how to withdraw, and point aria-describedby at it`,
          ),
        ]
      : [],
  },
  { tier: "must", title: say("没写完的占位文字", "Unfinished placeholders"), basis: "", items: placeholders },
  { tier: "must", title: say("颜色对比度不够", "Low color contrast"), basis: "WCAG 1.4.3, 1.4.11", items: contrast, skipped: css === null },
  { tier: "confirm", title: say("隐私政策链接", "Privacy policy link"), basis: say("GDPR 第 13 条；CCPA 条例 §7012；个人信息保护法第 17 条", "GDPR art. 13; CCPA regs § 7012; PIPL art. 17"), items: privacy },
  { tier: "confirm", title: say("缺的图片", "Missing images"), basis: "", items: missingImages },
  { tier: "confirm", title: say("表单字段", "Form fields"), basis: say("GDPR 第 5 条第 1 款 c 项；个人信息保护法第 6 条", "GDPR art. 5(1)(c); PIPL art. 6"), items: extraFields },
  { tier: "confirm", title: say("含糊的按钮和链接文字", "Vague button and link text"), basis: "NN/g; WCAG 2.4.4", items: vague },
  { tier: "confirm", title: say("不通往表单的链接", "Links that do not lead to the form"), basis: say("Unbounce：一页一个目标", "Unbounce: one page, one goal"), items: offGoal },
  { tier: "confirm", title: say("紧迫感用语", "Urgency wording"), basis: say("FTC 暗黑模式报告；UCPD 附件一第 7 项", "FTC dark patterns report; UCPD annex I no. 7"), items: urgency, skipped: brief === null },
  { tier: "confirm", title: say("绝对化用语", "Absolute claims"), basis: say("广告法第九条；FTC 广告证据政策", "Advertising Law art. 9 (China); FTC substantiation policy"), items: absolute },
  { tier: "confirm", title: say("简报里说不要写的话", "Things the brief says not to say"), basis: "", items: said, skipped: brief === null },
  { tier: "confirm", title: say("推荐语", "Testimonial"), basis: say("FTC 16 CFR 465、255；UCPD 附件一第 23b、23c 项；广告法第二十八条", "FTC 16 CFR 465 and 255; UCPD annex I nos. 23b, 23c; Advertising Law art. 28 (China)"), items: testimonialNotes, skipped: brief === null },
  { tier: "confirm", title: say("简报里没有的数字", "Numbers not in the brief"), basis: "", items: numbers, skipped: brief === null },
  { tier: "confirm", title: say("搜索摘要和手机显示", "Search snippet and phone display"), basis: "Google Search Central", items: head },
  { tier: "confirm", title: say("图片尺寸和加载", "Image size and loading"), basis: "web.dev CLS, LCP", items: imageNotes },
  { tier: "confirm", title: say("页面大小", "Page weight"), basis: "Lighthouse", items: weight },
  { tier: "confirm", title: say("行动按钮", "Call to action"), basis: "Unbounce", items: cta },
];

const mustCount = checks.filter((c) => c.tier === "must").reduce((n, c) => n + c.items.length, 0);
const confirmCount = checks.filter((c) => c.tier === "confirm").reduce((n, c) => n + c.items.length, 0);
const summary =
  !mustCount && !confirmCount
    ? say("没有问题。", "No problems.")
    : !mustCount
      ? say(`没有必须修的问题；上线前确认 ${confirmCount} 项。`, `Nothing to fix; ${confirmCount} to confirm before going live.`)
      : say(`必须修 ${mustCount} 项，上线前确认 ${confirmCount} 项。`, `${mustCount} to fix, ${confirmCount} to confirm before going live.`);

function details(tier) {
  const found = checks.filter((c) => c.tier === tier && c.items.length);
  if (!found.length) return [say("没有。", "None."), ""];
  return found.flatMap((c) => [`### ${c.title}${c.basis ? say(`（${c.basis}）`, ` (${c.basis})`) : ""}`, "", ...c.items.map((item) => `- ${item}`), ""]);
}

const tierName = { must: say("必须修", "Must fix"), confirm: say("上线前确认", "Confirm") };
const result = (c) => (c.items.length ? say(`${c.items.length} 项`, `${c.items.length}`) : c.skipped ? say("跳过", "skipped") : say("通过", "passed"));

const lines = [
  say("# 落地页检查", "# Landing page check"),
  "",
  summary,
  "",
  say("## 必须修", "## Must fix"),
  "",
  say("这些会让这一步失败。", "These fail the stage."),
  "",
  ...details("must"),
  say("## 上线前确认", "## Confirm before going live"),
  "",
  say("只提醒，不会让这一步失败：这些要看脚本看不到的事实。", "Warnings only: they depend on facts this script cannot see."),
  "",
  ...details("confirm"),
  say("## 检查了什么", "## What was checked"),
  "",
  say("| 档 | 检查 | 依据 | 结果 |", "| Tier | Check | Basis | Result |"),
  "| --- | --- | --- | --- |",
  ...checks.map((c) => `| ${tierName[c.tier]} | ${c.title} | ${c.basis || "-"} | ${result(c)} |`),
  "",
  say(
    "这些检查只做提醒，不能代替无障碍测试和法律意见。规则会变，上线前以官方原文为准。",
    "These checks are reminders. They do not replace accessibility testing or legal advice, and rules change: check the official texts before going live.",
  ),
  "",
];

const text = writeReport(lines);
console.log(summary);
if (mustCount) {
  console.error(say("检查没通过。", "Checks failed."));
  console.error(text);
  process.exit(1);
}
