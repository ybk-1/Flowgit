// 导出阶段：把 draft.md + images.json + photos/ 合成 post.md 和 post.html。
// Export stage: assemble draft.md + images.json + photos/ into post.md and post.html.
//
// 照片按 images.json 的顺序放进文章。找不到文件时，用画面描述做占位。
// Photos follow images.json order. A missing file becomes a placeholder with the scene description.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const lang = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}").language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);

const draftPath = path.join(dir, "draft.md");
const imagesPath = path.join(dir, "images.json");
if (!fs.existsSync(draftPath) || !fs.existsSync(imagesPath)) {
  console.error(say("缺少 draft.md 或 images.json", "draft.md or images.json is missing"));
  process.exit(1);
}

const draft = fs.readFileSync(draftPath, "utf8").replace(/^\uFEFF/, "");
const imagesDoc = JSON.parse(fs.readFileSync(imagesPath, "utf8"));
const rawImages = Array.isArray(imagesDoc) ? imagesDoc : imagesDoc.images;
if (!Array.isArray(rawImages) || rawImages.length === 0) {
  console.error(say("images.json 里没有图片", "images.json has no images"));
  process.exit(1);
}

function titleOf(markdown) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const line = markdown.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || say("未命名", "Untitled");
}

function bodyWithoutTitle(markdown, title) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => /^#\s+/.test(line) && line.replace(/^#\s+/, "").trim() === title);
  if (index < 0) return markdown.trim();
  return [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** A small Markdown subset: ATX headings, lists, paragraphs. Enough for a post body. */
function markdownToHtml(markdown) {
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      list.push(item[1].trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join("\n");
}

const photosDir = path.join(dir, "photos");
const photoFiles = fs.existsSync(photosDir)
  ? fs.readdirSync(photosDir).filter((name) => !name.startsWith(".") && fs.statSync(path.join(photosDir, name)).isFile())
  : [];

function findPhoto(image) {
  if (image.file && photoFiles.includes(image.file)) return image.file;
  const base = String(image.file || image.id || "").trim();
  if (!base) return undefined;
  const stem = path.parse(base).name.toLowerCase();
  return photoFiles.find((name) => path.parse(name).name.toLowerCase() === stem);
}

const images = rawImages.map((image, i) => {
  const file = String(image.file ?? image.filename ?? "");
  const prompt = String(image.prompt ?? image.description ?? image.scene ?? "").trim();
  const alt = String(image.alt ?? image.altText ?? image.purpose ?? "").trim();
  const purpose = String(image.purpose ?? "").trim();
  const found = findPhoto({ file, id: image.id });
  return {
    id: image.id || `img${i + 1}`,
    file: found || file || `${image.id || `img${i + 1}`}.jpg`,
    found: Boolean(found),
    prompt,
    alt,
    purpose,
  };
});

const title = titleOf(draft) || (typeof imagesDoc.title === "string" ? imagesDoc.title.trim() : "") || say("未命名", "Untitled");
const body = bodyWithoutTitle(draft, title);
const note = say("配图待补", "Image to add");
const figuresHeading = say("配图", "Images");

function photoSrc(file) {
  return `photos/${file.split(/[\\/]/).map((part) => encodeURIComponent(part)).join("/")}`;
}

const figureMd = images
  .map((image) => {
    if (image.found) return `![${image.alt}](${photoSrc(image.file)})`;
    const lines = [`> **${note}**`, ">"];
    if (image.purpose) lines.push(`> ${image.purpose}`, ">");
    if (image.prompt) lines.push(`> ${image.prompt}`);
    if (image.alt) lines.push(">", `> ${image.alt}`);
    return lines.join("\n");
  })
  .join("\n\n");

const postMd = `# ${title}\n\n${body}\n\n## ${figuresHeading}\n\n${figureMd}\n`;

const figureHtml = images
  .map((image) => {
    const caption = image.purpose ? `<figcaption>${inline(image.purpose)}</figcaption>` : "";
    if (image.found) {
      return `<figure>\n<img src="${photoSrc(image.file)}" alt="${escapeHtml(image.alt)}">\n${caption}\n</figure>`;
    }
    const desc = image.prompt ? `<p class="placeholder-desc">${inline(image.prompt)}</p>` : "";
    const alt = image.alt ? `<p class="placeholder-alt">${inline(image.alt)}</p>` : "";
    return `<figure class="placeholder">\n<p class="placeholder-note">${escapeHtml(note)}</p>\n${desc}\n${alt}\n${caption}\n</figure>`;
  })
  .join("\n");

const postHtml = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #222; }
  img { max-width: 100%; height: auto; }
  figure { margin: 1.5rem 0; }
  figcaption { color: #555; font-size: 0.9rem; }
  figure.placeholder { border: 1px dashed #999; padding: 1rem; background: #fafafa; }
  .placeholder-note { font-weight: 600; margin: 0; }
</style>
</head>
<body>
<article>
<h1>${escapeHtml(title)}</h1>
${markdownToHtml(body)}
<section class="images">
<h2>${escapeHtml(figuresHeading)}</h2>
${figureHtml}
</section>
</article>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, "post.md"), postMd.endsWith("\n") ? postMd : `${postMd}\n`);
fs.writeFileSync(path.join(dir, "post.html"), postHtml.endsWith("\n") ? postHtml : `${postHtml}\n`);

const present = images.filter((image) => image.found).length;
const missing = images.length - present;
console.log(
  say(
    `post.md、post.html：标题「${title}」，${images.length} 张图，${present} 张已有照片，${missing} 张占位`,
    `post.md, post.html: title "${title}", ${images.length} images, ${present} on disk, ${missing} placeholders`,
  ),
);
