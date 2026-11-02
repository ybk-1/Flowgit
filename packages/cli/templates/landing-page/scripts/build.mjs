// 生成阶段：structure.json + copy.json + images/ → site/index.html、site/style.css、site/images/。
// Build stage: structure.json + copy.json + images/ → site/index.html, site/style.css, site/images/.
//
// 缺的图片变成色块加说明。用户写的文字全部转义。页面不引用网络上的脚本、样式、字体或图片。
// A missing image becomes a color block with a caption. Every piece of user text is escaped.
// The page loads no remote script, stylesheet, font or image.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const lang = flowInputs.language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const product = String(flowInputs.product ?? "").trim();
const goal = String(flowInputs.goal ?? "").trim();

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

function assertOffline(name, text) {
  const problems = [];
  if (/<script\b/i.test(text) || /<\/script/i.test(text)) problems.push("script");
  if (/\b(?:src|href)\s*=\s*["']\s*(?:https?:|javascript:)/i.test(text)) problems.push("remote url");
  if (name.endsWith(".css") && (/url\s*\(/i.test(text) || /https?:\/\//i.test(text))) problems.push("css url");
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

let blocks;
try {
  blocks = pageBlocks(readJson(structurePath), readJson(copyPath));
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
for (const block of blocks) {
  const name = findImage(imagesDir, files, block.image);
  if (!name) continue;
  if (![...pictures.values()].includes(name)) fs.copyFileSync(path.join(imagesDir, name), path.join(outImages, name));
  pictures.set(block.id, name);
}

const usedIds = new Set();
const domIds = new Map(blocks.map((block) => [block.id, htmlId(block.id, usedIds)]));
const anchor = blocks.find((block) => block.id === "cta" && block.button) ?? blocks.find((block) => block.button);
const anchorId = anchor ? domIds.get(anchor.id) : "";
const hero = blocks.find((block) => block.id === "hero") ?? blocks[0];
const title = product || hero.heading || say("落地页", "Landing page");
const missingNote = say("图片待补", "Image to add");
const fieldLabel = goal || say("邮箱", "Email");

function visual(block) {
  const file = pictures.get(block.id);
  if (file) return `<img src="images/${encodeURIComponent(file)}" alt="${escapeHtml(block.heading)}">`;
  if (!block.image) return "";
  const caption = block.purpose || block.heading;
  return `<div class="swatch" style="--swatch:${swatchColor(block.id)}">
<p class="swatch-note">${escapeHtml(missingNote)}</p>
<p class="swatch-file">${escapeHtml(block.image)}</p>
${caption ? `<p class="swatch-caption">${escapeHtml(caption)}</p>` : ""}
</div>`;
}

// The input has no name, so submitting sends nothing: the text never ends up in a URL or a server log.
// Give it a name and point the form at your own service when you connect one.
function action(block) {
  if (!block.button) return "";
  if (anchor && block.id === anchor.id) {
    return `<form action="#${anchorId}" method="get">
<label for="reply">${escapeHtml(fieldLabel)}</label>
<input id="reply" type="text" autocomplete="on">
<button type="submit">${escapeHtml(block.button)}</button>
</form>`;
  }
  if (!anchorId) return `<p><span class="button">${escapeHtml(block.button)}</span></p>`;
  return `<a class="button" href="#${anchorId}">${escapeHtml(block.button)}</a>`;
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
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
${sections}
</main>
</body>
</html>
`;

const CSS = `/* Landing page. Phone width, dark mode, no remote fonts or images. */
:root {
  color-scheme: light dark;
  --bg: #faf7f2;
  --text: #1c1917;
  --muted: #57534e;
  --card: #ffffff;
  --line: #e7e5e4;
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
h1, h2, p { overflow-wrap: anywhere; }
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
input[type="text"] {
  width: 100%;
  font: inherit;
  padding: 0.65rem 0.7rem;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
}
a.button:focus-visible, button:focus-visible, input:focus-visible {
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
