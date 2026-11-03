// 生成阶段：structure.json + copy.json + images/ → site/index.html、site/style.css、site/images/。
// Build stage: structure.json + copy.json + images/ → site/index.html, site/style.css, site/images/.
//
// 缺的图片变成色块加说明。用户写的文字全部转义。页面不引用网络上的脚本、样式、字体或图片。
// A missing image becomes a color block with a caption. Every piece of user text is escaped.
// The page loads no remote script, stylesheet, font or image.
//
// Why the page is built this way (sources in README "参考资料 / References"):
// - Form fields get a visible label, the right input type and an autocomplete token (WCAG 2.2
//   1.3.1, 1.3.5, 3.3.2), and the label says whether the field is required (WAI technique H90;
//   Baymard marks both required and optional fields).
// - The collection notice sits right under the fields and is linked with aria-describedby: GDPR
//   art. 13, the CCPA notice at collection and PIPL art. 17 all want it at the point of collection.
// - A consent box, when there is one, is never pre-ticked (CJEU C-673/17 Planet49; GDPR recital 32).
// - Images carry width and height so the layout does not jump (web.dev, Optimize CLS); the first
//   image is not lazy-loaded because it is usually the largest paint (web.dev, LCP and lazy loading).
// - Text colors meet 4.5:1 and field borders 3:1 (WCAG 1.4.3, 1.4.11); check.mjs measures them.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const lang = flowInputs.language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const product = String(flowInputs.product ?? "").trim();
const goal = String(flowInputs.goal ?? "").trim();
const privacyUrlRaw = String(flowInputs.privacyUrl ?? "").trim();
const privacyUrl = /^https?:\/\/[^\s"'<>`]+$/i.test(privacyUrlRaw) ? privacyUrlRaw : "";
if (privacyUrlRaw && !privacyUrl) {
  console.error(say(`privacyUrl 不是 http(s) 链接，已忽略：${privacyUrlRaw}`, `privacyUrl is not an http(s) link, ignored: ${privacyUrlRaw}`));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^﻿/, ""));
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

function pageBlocks(structureDoc, copyDoc) {
  const copies = copyMap(copyDoc);
  const raw = Array.isArray(structureDoc) ? structureDoc : structureDoc?.blocks;
  if (!Array.isArray(raw)) {
    throw new Error("structure.json 需要 blocks 数组 / structure.json needs a blocks array");
  }
  const seen = new Set();
  const blocks = [];
  raw.forEach((block, i) => {
    const id = String(block?.id ?? `block-${i + 1}`).trim() || `block-${i + 1}`;
    seen.add(id);
    const fromCopy = Object.hasOwn(copies, id) ? copies[id] : undefined;
    const points = Array.isArray(block?.points) ? block.points : Array.isArray(block?.keyPoints) ? block.keyPoints : [];
    const image = String(block?.image ?? block?.file ?? fromCopy?.image ?? "").trim();
    blocks.push({
      id,
      purpose: String(block?.purpose ?? "").trim(),
      points: points.map((p) => String(p).trim()).filter(Boolean),
      image,
      alt: String(block?.alt ?? fromCopy?.alt ?? "").trim(),
      ...copyEntry(fromCopy),
    });
  });
  for (const [id, rawCopy] of Object.entries(copies)) {
    if (seen.has(id) || !rawCopy || typeof rawCopy !== "object" || Array.isArray(rawCopy)) continue;
    blocks.push({
      id,
      purpose: "",
      points: [],
      image: String(rawCopy.image ?? "").trim(),
      alt: String(rawCopy.alt ?? "").trim(),
      ...copyEntry(rawCopy),
    });
  }
  return blocks;
}

function listImages(imagesDir) {
  if (!fs.existsSync(imagesDir)) return [];
  return fs.readdirSync(imagesDir).filter((name) => {
    if (!name || name.startsWith(".")) return false;
    const abs = path.join(imagesDir, name);
    return fs.statSync(abs).isFile();
  });
}

/** A file inside images/ whose name matches the block's image field. Nothing outside that folder. */
function findImage(imagesDir, files, image) {
  const raw = String(image ?? "").trim().replace(/\\/g, "/");
  if (!raw || raw.includes("/") || raw.startsWith(".")) return null;
  if (path.basename(raw) !== raw) return null;
  const name = files.find((f) => f === raw) ?? files.find((f) => f.toLowerCase() === raw.toLowerCase());
  if (!name) return null;
  const root = path.resolve(imagesDir);
  const abs = path.resolve(root, name);
  if (!abs.startsWith(root + path.sep)) return null;
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) return null;
  if (!fs.statSync(realFile).isFile()) return null;
  return name;
}

// Image size from the file header (PNG, GIF, JPEG, WebP), so the page can reserve the space before
// the image loads. No dependencies; anything unreadable just gets no size.

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.length < 10 || !/^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function webpSize(buf) {
  if (buf.length < 30 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("latin1", 12, 16);
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return null;
}

/** The EXIF orientation (tag 0x0112) in an APP1 segment, or null. */
function exifOrientation(buf, start, end) {
  if (buf.toString("latin1", start, start + 6) !== "Exif\0\0") return null;
  const tiff = start + 6;
  const little = buf.toString("latin1", tiff, tiff + 2) === "II";
  const u16 = (at) => (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at) => (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let orientation = 1;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the image data starts before any frame header
    const length = buf.readUInt16BE(i + 2);
    if (marker === 0xe1) orientation = exifOrientation(buf, i + 4, i + 2 + length) ?? orientation;
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      // Orientations 5 to 8 turn the photo a quarter turn, and browsers apply them when they draw it.
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
    }
    i += 2 + length;
  }
  return null;
}

function imageSize(abs) {
  try {
    const buf = fs.readFileSync(abs);
    const size = pngSize(buf) ?? gifSize(buf) ?? jpegSize(buf) ?? webpSize(buf);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null; // a truncated or unusual header: leave the size out rather than guess
  }
}

function swatchColor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 33 + ch.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 32% 78%)`;
}

function htmlId(id, used) {
  const base = String(id).replace(/[^A-Za-z0-9_-]/g, "") || "block";
  let next = base;
  let n = 2;
  while (used.has(next)) {
    next = `${base}-${n}`;
    n += 1;
  }
  used.add(next);
  return next;
}

function paragraphs(text) {
  const parts = String(text).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("\n");
}

function firstParagraph(text) {
  return (String(text ?? "").split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();
}

// Links to other pages are allowed (the privacy policy). Anything the browser would fetch on its
// own (scripts, images, stylesheets, fonts) must stay local.
function assertOffline(name, text) {
  const problems = [];
  if (/<script\b/i.test(text) || /<\/script/i.test(text)) problems.push("script");
  if (/\bsrc\s*=\s*["']\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(text)) problems.push("remote src");
  for (const tag of text.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\bhref\s*=\s*["']\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(tag)) problems.push("remote link");
  }
  if (/\b(?:href|action|formaction)\s*=\s*["']\s*javascript:/i.test(text)) problems.push("javascript url");
  if (name.endsWith(".css") && (/url\s*\(/i.test(text) || /@import/i.test(text) || /https?:\/\//i.test(text))) problems.push("css url");
  if (!problems.length) return;
  console.error(say(`${name} 引用了网络或不该出现的脚本（${problems.join("、")}）`, `${name} references the network or a script (${problems.join(", ")})`));
  process.exit(1);
}

const structurePath = path.join(dir, "structure.json");
const copyPath = path.join(dir, "copy.json");
if (!fs.existsSync(structurePath) || !fs.existsSync(copyPath)) {
  console.error(say("缺少 structure.json 或 copy.json", "structure.json or copy.json is missing"));
  process.exit(1);
}

let structureDoc;
let blocks;
try {
  structureDoc = readJson(structurePath);
  blocks = pageBlocks(structureDoc, readJson(copyPath));
} catch (err) {
  console.error(err instanceof SyntaxError ? say(`JSON 无法解析：${err.message}`, `Could not parse JSON: ${err.message}`) : err.message);
  process.exit(1);
}
if (!blocks.length) {
  console.error(say("structure.json 里没有区块", "structure.json has no blocks"));
  process.exit(1);
}

const imagesDir = path.join(dir, "images");
const siteDir = path.join(dir, "site");
const outImages = path.join(siteDir, "images");
fs.rmSync(outImages, { recursive: true, force: true });
fs.mkdirSync(outImages, { recursive: true });

const files = listImages(imagesDir);
const pictures = new Map();
const sizes = new Map();
for (const block of blocks) {
  const name = findImage(imagesDir, files, block.image);
  if (!name) continue;
  if (!sizes.has(name)) {
    fs.copyFileSync(path.join(imagesDir, name), path.join(outImages, name));
    sizes.set(name, imageSize(path.join(imagesDir, name)));
  }
  pictures.set(block.id, name);
}

const usedIds = new Set();
const domIds = new Map(blocks.map((block) => [block.id, htmlId(block.id, usedIds)]));
const anchor = blocks.find((block) => block.id === "cta" && block.button) ?? blocks.find((block) => block.button);
const anchorId = anchor ? domIds.get(anchor.id) : "";
const hero = blocks.find((block) => block.id === "hero") ?? blocks[0];
const missingNote = say("图片待补", "Image to add");

function pageTitle() {
  const heading = hero.heading;
  if (product && heading && !heading.toLowerCase().includes(product.toLowerCase())) return `${product}${say("：", ": ")}${heading}`;
  return heading || product || say("落地页", "Landing page");
}
const title = pageTitle();
const description = firstParagraph(hero.body) || firstParagraph(blocks.find((block) => block.body)?.body);

// ---- Form ----

// type: what the browser shows; autocomplete: lets browsers fill it in and tells assistive tech it
// is the visitor's own detail (WCAG 1.3.5).
const FIELD_KINDS = {
  email: { type: "email", autocomplete: "email", label: say("邮箱", "Email") },
  tel: { type: "tel", autocomplete: "tel", label: say("手机号", "Phone number") },
  name: { type: "text", autocomplete: "name", label: say("称呼", "Name") },
  text: { type: "text", autocomplete: "", label: "" },
};

function guessKind(text) {
  const value = String(text ?? "");
  if (/邮箱|邮件|e-?mail/i.test(value)) return "email";
  if (/手机|电话|phone|mobile|\btel\b|whatsapp/i.test(value)) return "tel";
  return "text";
}

function formFields(doc) {
  const raw = Array.isArray(doc?.form?.fields) ? doc.form.fields : [];
  const fields = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const typed = String(item.type ?? "").trim().toLowerCase();
    const label = String(item.label ?? "").trim();
    const kind = Object.hasOwn(FIELD_KINDS, typed) ? typed : guessKind(`${item.id ?? ""} ${label}`);
    fields.push({
      key: String(item.id ?? kind),
      kind,
      label: label || FIELD_KINDS[kind].label || goal || say("回复", "Reply"),
      required: item.required !== false,
    });
  }
  if (!fields.length) {
    // structure.json without a form (an older one, or the model left it out): one field from the goal.
    const kind = guessKind(goal);
    fields.push({ key: kind, kind, label: FIELD_KINDS[kind].label || goal || say("邮箱", "Email"), required: true });
  }
  return fields.map((field) => ({ ...field, domId: htmlId(`f-${field.key}`, usedIds) }));
}

const fields = formFields(structureDoc);
const consentText = typeof structureDoc?.form?.consent === "string" ? structureDoc.form.consent.replace(/\s+/g, " ").trim() : "";
const noteText = (anchor?.note || blocks.find((block) => block.note)?.note || "").replace(/\s+/g, " ").trim();
const noteId = htmlId("form-note", usedIds);
const privacyLink = privacyUrl
  ? `<a href="${escapeHtml(privacyUrl)}" rel="privacy-policy">${escapeHtml(say("隐私政策", "Privacy policy"))}</a>`
  : "";
const noteHtml =
  noteText || privacyLink
    ? `<p id="${noteId}" class="note">${escapeHtml(noteText)}${noteText && privacyLink ? say("", " ") : ""}${privacyLink}</p>`
    : "";

function fieldHtml(field) {
  const spec = FIELD_KINDS[field.kind];
  const marker = field.required ? say("（必填）", " (required)") : say("（选填）", " (optional)");
  const attrs = [`id="${field.domId}"`, `type="${spec.type}"`];
  if (spec.autocomplete) attrs.push(`autocomplete="${spec.autocomplete}"`);
  if (field.required) attrs.push("required");
  if (noteHtml) attrs.push(`aria-describedby="${noteId}"`);
  return `<label for="${field.domId}">${escapeHtml(field.label)}<span class="req">${escapeHtml(marker)}</span></label>
<input ${attrs.join(" ")}>`;
}

function consentHtml() {
  if (!consentText) return "";
  const id = htmlId("f-consent", usedIds);
  // Never pre-ticked: consent has to be the visitor's own act.
  return `<p class="consent"><input id="${id}" type="checkbox"><label for="${id}">${escapeHtml(consentText)}<span class="req">${escapeHtml(say("（选填）", " (optional)"))}</span></label></p>`;
}

// The inputs have no name, so submitting sends nothing: the text never ends up in a URL or a server
// log. Give them names and point the form at your own service when you connect one.
function action(block) {
  if (!block.button) return "";
  if (anchor && block.id === anchor.id) {
    return [
      `<form action="#${anchorId}" method="get">`,
      ...fields.map(fieldHtml),
      noteHtml,
      consentHtml(),
      `<button type="submit">${escapeHtml(block.button)}</button>`,
      "</form>",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (!anchorId) return `<p><span class="button">${escapeHtml(block.button)}</span></p>`;
  return `<a class="button" href="#${anchorId}">${escapeHtml(block.button)}</a>`;
}

let firstPicture = true;
function visual(block) {
  const file = pictures.get(block.id);
  if (file) {
    const size = sizes.get(file);
    const attrs = [`src="images/${encodeURIComponent(file)}"`, `alt="${escapeHtml(block.alt || block.heading)}"`];
    if (size) attrs.push(`width="${size.width}"`, `height="${size.height}"`);
    attrs.push(firstPicture ? 'fetchpriority="high"' : 'loading="lazy"');
    firstPicture = false;
    return `<img ${attrs.join(" ")}>`;
  }
  if (!block.image) return "";
  const caption = block.alt || block.purpose || block.heading;
  return `<div class="swatch" style="--swatch:${swatchColor(block.id)}">
<p class="swatch-note">${escapeHtml(missingNote)}</p>
<p class="swatch-file">${escapeHtml(block.image)}</p>
${caption ? `<p class="swatch-caption">${escapeHtml(caption)}</p>` : ""}
</div>`;
}

const sections = blocks
  .map((block) => {
    const level = block.id === hero.id ? 1 : 2;
    const heading = block.heading ? `<h${level}>${escapeHtml(block.heading)}</h${level}>` : "";
    const kicker = product && block.id === hero.id ? `<p class="product">${escapeHtml(product)}</p>` : "";
    return `<section class="block" id="${domIds.get(block.id)}" data-block="${escapeHtml(block.id)}">
${visual(block)}
${kicker}
${heading}
${paragraphs(block.body)}
${action(block)}
</section>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="${say("zh-Hans", "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ""}<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
${sections}
</main>
</body>
</html>
`;

const CSS = `/* Landing page. Phone width, dark mode, no remote fonts or images.
   Text is at least 4.5:1 and field borders 3:1 against their backgrounds (WCAG 1.4.3, 1.4.11). */
:root {
  color-scheme: light dark;
  --bg: #faf7f2;
  --text: #1c1917;
  --muted: #57534e;
  --card: #ffffff;
  --line: #e7e5e4;
  --field-line: #78716c;
  --button-bg: #1c1917;
  --button-text: #faf7f2;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
main {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}
.block {
  margin: 0 0 1.25rem;
  padding: 1rem;
  background: var(--card);
  border: 1px solid var(--line);
}
.product {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
}
h1, h2, p, label { overflow-wrap: anywhere; }
h1 { font-size: 2rem; line-height: 1.2; margin: 0.6rem 0; }
h2 { font-size: 1.35rem; line-height: 1.3; margin: 0.6rem 0; }
p { margin: 0.45rem 0; }
img, .swatch { display: block; width: 100%; max-width: 100%; }
img { height: auto; }
.swatch {
  position: relative;
  min-height: 11rem;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.15rem;
  padding: 1rem;
  background: var(--swatch);
  color: #1c1917;
}
.swatch p { position: relative; margin: 0; }
.swatch-note { font-weight: 600; }
a.button, button, .button {
  display: inline-block;
  margin-top: 0.75rem;
  padding: 0.7rem 1rem;
  background: var(--button-bg);
  color: var(--button-text);
  text-decoration: none;
  border: 0;
  font: inherit;
  cursor: pointer;
}
form { display: flex; flex-direction: column; gap: 0.45rem; margin-top: 0.75rem; }
label { font-weight: 600; }
.req { font-weight: 400; color: var(--muted); }
input:not([type="checkbox"]) {
  width: 100%;
  font: inherit;
  padding: 0.65rem 0.7rem;
  border: 1px solid var(--field-line);
  background: var(--bg);
  color: var(--text);
}
.note { margin: 0.1rem 0 0; font-size: 0.9rem; color: var(--muted); }
.note a { color: inherit; }
.consent { display: flex; align-items: flex-start; gap: 0.6rem; margin: 0.25rem 0 0; }
.consent label { font-weight: 400; }
input[type="checkbox"] { flex: none; width: 1.5rem; height: 1.5rem; margin: 0; accent-color: var(--button-bg); }
a.button:focus-visible, button:focus-visible, input:focus-visible, .note a:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}
/* Phone width */
@media (max-width: 40rem) {
  main { padding: 1rem 0.85rem 2.5rem; }
  h1 { font-size: 1.65rem; }
  .block { padding: 0.85rem; }
  a.button, button { display: block; width: 100%; text-align: center; }
}
/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1917;
    --text: #faf7f2;
    --muted: #d6d3d1;
    --card: #292524;
    --line: #44403c;
    --field-line: #a8a29e;
    --button-bg: #faf7f2;
    --button-text: #1c1917;
  }
  .swatch { color: #fafaf9; }
  .swatch::before {
    content: "";
    position: absolute;
    inset: 0;
    background: #0c0a09;
    opacity: 0.45;
  }
}
`;

assertOffline("site/index.html", html);
assertOffline("site/style.css", CSS);
fs.writeFileSync(path.join(siteDir, "index.html"), html);
fs.writeFileSync(path.join(siteDir, "style.css"), CSS);

const copied = pictures.size;
const colors = blocks.filter((block) => block.image && !pictures.has(block.id)).length;
console.log(
  say(
    `site/index.html、site/style.css：${blocks.length} 个区块，${copied} 张图片，${colors} 个色块`,
    `site/index.html, site/style.css: ${blocks.length} blocks, ${copied} images, ${colors} color blocks`,
  ),
);
