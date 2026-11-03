#!/usr/bin/env node
// "check" stage: check the art in art/ for print. Warnings only.
//
// - Every unit and the cover has an image, named as art-brief.md says.
// - Enough pixels for 300 DPI with bleed (KDP: images at least 300 DPI, and
//   art that runs to the edge extends 0.125 in past the trim at the top,
//   the bottom and the outside edge).
// - The right proportions for a page or a spread (a different shape gets
//   cropped or leaves a gap).
// - Files the template can't use, and files that match no unit.
// - With aiArt on: KDP asks publishers to disclose AI-generated images;
//   China's Measures for Labeling AI-Generated Synthetic Content (art. 10)
//   ask whoever publishes it online to declare it and use the platform's
//   label; the US Copyright Office registers only the human-authored parts
//   and asks applicants to disclose AI-generated material.
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const aiArt = flowInputs.aiArt === true || flowInputs.aiArt === "true";

const DPI = 300;
const BLEED = 0.125;

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
const board = readJson("storyboard.json");
if (!board || !Array.isArray(board.units)) {
  console.error("storyboard.json 不存在或缺少 units / storyboard.json is missing or has no units");
  process.exit(1);
}

/** "8.5x8.5in", "210x285mm" → { w, h } in inches, or null. */
function parseTrim(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*(in|inch|inches|"|mm|cm|英寸|毫米|厘米)?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const unit = (m[3] ?? (Number(m[1]) > 30 ? "mm" : "in")).toLowerCase();
  const scale = /mm|毫米/.test(unit) ? 1 / 25.4 : /cm|厘米/.test(unit) ? 1 / 2.54 : 1;
  return { w: Number(m[1]) * scale, h: Number(m[2]) * scale };
}
const trim = parseTrim(flowInputs.trim ?? "8.5x8.5in") ?? { w: 8.5, h: 8.5 };
const px = (inches) => Math.ceil(Math.round(inches * DPI * 1000) / 1000);
const sizeOf = (pages) =>
  pages.length === 2 ? { w: px(2 * trim.w + 2 * BLEED), h: px(trim.h + 2 * BLEED) } : { w: px(trim.w + BLEED), h: px(trim.h + 2 * BLEED) };
const baseName = (pages) => `p${pages.map((n) => String(n).padStart(2, "0")).join("-")}`;

/** Width and height of a PNG or JPEG, read from its header, or null. */
function imageSize(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    if (head.readUInt32BE(0) === 0x89504e47 && head.toString("ascii", 12, 16) === "IHDR") {
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    }
    if (head[0] !== 0xff || head[1] !== 0xd8) return null;
    // Walk the JPEG segments to the frame header (SOFn).
    const size = fs.fstatSync(fd).size;
    const seg = Buffer.alloc(9);
    let pos = 2;
    while (pos + 4 <= size) {
      fs.readSync(fd, seg, 0, 9, pos);
      if (seg[0] !== 0xff) return null;
      const marker = seg[1];
      if (marker === 0xff) {
        pos += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2;
        continue;
      }
      const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (sof) return { w: seg.readUInt16BE(7), h: seg.readUInt16BE(5) };
      if (marker === 0xd9 || marker === 0xda) return null;
      pos += 2 + seg.readUInt16BE(2);
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// What art/ should hold.
const wanted = [
  { name: "cover", label: t("封面", "cover"), size: sizeOf([1]) },
  ...board.units.filter((u) => Array.isArray(u?.pages) && u.pages.length).map((u) => ({ name: baseName(u.pages), alias: `p${u.pages.join("-")}`, label: baseName(u.pages), size: sizeOf(u.pages) })),
];
const files = fs.existsSync("art") ? fs.readdirSync("art").filter((f) => !f.startsWith(".") && !/^readme(\.md|\.txt)?$/i.test(f)) : [];
const usable = files.filter((f) => /\.(png|jpe?g)$/i.test(f));
const unusable = files.filter((f) => /\.(webp|heic|heif|tiff?|gif|bmp|psd|svg|avif)$/i.test(f));
const stem = (f) => path.basename(f, path.extname(f)).toLowerCase();

const missing = [];
const small = [];
const shape = [];
let found = 0;
for (const item of wanted) {
  const file = usable.find((f) => stem(f) === item.name || (item.alias && stem(f) === item.alias));
  if (!file) {
    missing.push(`${item.name}.png`);
    continue;
  }
  found++;
  const size = imageSize(path.join("art", file));
  if (!size) {
    small.push(t(`${file}：读不出尺寸`, `${file}: can't read its size`));
    continue;
  }
  const need = item.size;
  if (size.w < need.w || size.h < need.h) {
    const dpi = Math.floor(Math.min((size.w / need.w) * DPI, (size.h / need.h) * DPI));
    small.push(t(`${file}：${size.w}×${size.h}，要 ${need.w}×${need.h}（现在只有约 ${dpi} DPI）`, `${file}: ${size.w} × ${size.h}, needs ${need.w} × ${need.h} (about ${dpi} DPI now)`));
  }
  const ratio = size.w / size.h;
  const wantRatio = need.w / need.h;
  if (Math.abs(ratio - wantRatio) / wantRatio > 0.02) {
    shape.push(
      t(
        `${file}：宽高比 ${ratio.toFixed(2)}，应该是 ${wantRatio.toFixed(2)}（${need.w}×${need.h}），印的时候会被裁掉或留白`,
        `${file}: aspect ratio ${ratio.toFixed(2)}, should be ${wantRatio.toFixed(2)} (${need.w} × ${need.h}); it would be cropped or leave a gap`,
      ),
    );
  }
}
const names = new Set(wanted.flatMap((w) => [w.name, w.alias].filter(Boolean)));
const stray = usable.filter((f) => !names.has(stem(f)));

const issuesMissing = missing.length ? [t(`缺 ${missing.length} 张：${missing.join("、")}`, `${missing.length} missing: ${missing.join(", ")}`)] : [];
const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const report = [
  [t("## 缺的图（文件名见 art-brief.md）", "## Missing images (names in art-brief.md)"), issuesMissing],
  [t("## 像素不够（300 DPI 加出血，KDP）", "## Too few pixels (300 DPI with bleed; KDP)"), small],
  [t("## 比例不对", "## Wrong proportions"), shape],
  [t("## 模板认不了的格式（用 PNG 或 JPEG）", "## Formats the template can't read (use PNG or JPEG)"), unusable],
  [t("## 对不上任何一页的文件", "## Files that match no page"), stray],
];
const aiNotes = aiArt
  ? [
      t(
        "- KDP：发布时在 AI 内容的问题里如实说明，封面和内页里 AI 生成的图都算；只用 AI 修改或检查自己画的图属于“AI 辅助”，不用说明。",
        "- KDP: answer the AI content questions truthfully when you publish; AI-generated images on the cover and inside both count. Art you drew yourself and only refined or checked with AI is “AI-assisted” and needs no disclosure.",
      ),
      t(
        "- 中国：《人工智能生成合成内容标识办法》第十条，在网上发布 AI 生成的图片要主动声明，并使用平台的标识功能；生成服务加上的标识不能删改或隐匿。",
        "- China: under art. 10 of the Measures for Labeling AI-Generated Synthetic Content, declare AI-generated images when you publish them online and use the platform's label; don't remove or hide the label the generator added.",
      ),
      t(
        "- 美国版权局：AI 生成的部分不受版权保护；登记时说明哪些是 AI 生成的，写清人创作的部分（文字、选择和编排）。",
        "- US Copyright Office: AI-generated material isn't protected by copyright; when registering, disclose it and describe the human-authored parts (the text, the selection and arrangement).",
      ),
      t("- 在版权页写明哪些图用了 AI 生成。", "- Say on the copyright page which images are AI-generated."),
    ]
  : [];

const lines = [
  t("# 印刷检查", "# Print check"),
  "",
  t(`${wanted.length} 张图：有 ${found} 张，缺 ${wanted.length - found} 张。`, `${wanted.length} images: ${found} in place, ${wanted.length - found} missing.`),
  t(
    `尺寸按成书 ${Math.round(trim.w * 1000) / 1000}×${Math.round(trim.h * 1000) / 1000} 英寸、300 DPI、出血 0.125 英寸算。`,
    `Sizes assume a trim of ${Math.round(trim.w * 1000) / 1000} × ${Math.round(trim.h * 1000) / 1000} in, 300 DPI and 0.125 in bleed.`,
  ),
  "",
  ...report.flatMap(([title, items]) => [title, list(items), ""]),
  ...(aiArt ? [t("## AI 插图要做的标识和声明", "## Labels and disclosures for AI art"), ...aiNotes, ""] : []),
  t("这些检查只做提醒，不能代替印厂的打样和平台审核。", "These checks are reminders only; they do not replace a printer's proof or platform review."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = report.reduce((n, [, items]) => n + items.length, 0);
const tail = aiArt ? t("另有 AI 插图的标识和声明要做，见报告。", " Labels and disclosures for the AI art are listed in the report.") : "";
console.log(
  issues
    ? t(`有 ${issues} 处要看一下，见 ${out}。${tail}`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.${tail}`)
    : t(`检查通过。${tail}`, `All checks passed.${tail}`),
);
