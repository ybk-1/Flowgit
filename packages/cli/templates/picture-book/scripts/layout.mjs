#!/usr/bin/env node
// "layout" stage. Lay out the book for the page count and format, so the
// pagination stage fills in units instead of doing arithmetic.
//
// Picture book (the common 32-page plan, in multiples of 8): page 1 is a
// right-hand page, pages 1 to 3 are front matter (title, copyright,
// dedication), the story runs in spreads from 4–5 to the second-to-last
// page, and the last page stands alone on the left.
//
// Comic: every page is a unit. Page 1 is a right-hand page, so a page turn
// follows every odd page: the last panel of an odd page is where a hook
// goes, and the first panel of the next even page is where it pays off.
//
// Image sizes follow KDP's print rules: 300 DPI, and art that runs to the
// edge extends 0.125 in (3.2 mm) past the trim at the top, the bottom and
// the outside edge (a spread has two outside edges).
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const comic = flowInputs.format === "comic";
const pages = Number(flowInputs.pages ?? 32);

const DPI = 300;
const BLEED = 0.125;

/** "8.5x8.5in", "210x285mm", "8 × 10 in" → { w, h } in inches, or null. */
function parseTrim(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*(in|inch|inches|"|mm|cm|英寸|毫米|厘米)?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const unit = (m[3] ?? (Number(m[1]) > 30 ? "mm" : "in")).toLowerCase();
  const scale = /mm|毫米/.test(unit) ? 1 / 25.4 : /cm|厘米/.test(unit) ? 1 / 2.54 : 1;
  const w = Number(m[1]) * scale;
  const h = Number(m[2]) * scale;
  return w > 0 && h > 0 ? { w, h } : null;
}
const px = (inches) => Math.ceil(Math.round(inches * DPI * 1000) / 1000);
const fileName = (unitPages) => `p${unitPages.map((n) => String(n).padStart(2, "0")).join("-")}.png`;

if (!Number.isInteger(pages) || pages < 1) {
  console.error(`页数要是正整数，现在是 ${flowInputs.pages} / pages must be a whole number, got ${flowInputs.pages}`);
  process.exit(1);
}
if (!comic && (pages < 8 || pages % 2)) {
  console.error(`绘本的页数要是 8 以上的双数，现在是 ${pages} / a picture book needs an even page count of 8 or more, got ${pages}`);
  process.exit(1);
}
const trim = parseTrim(flowInputs.trim ?? "8.5x8.5in");
if (!trim) {
  console.error(`看不懂成书尺寸“${flowInputs.trim}”，请写成 8.5x8.5in 或 210x285mm / can't read the trim size "${flowInputs.trim}"; write it like 8.5x8.5in or 210x285mm`);
  process.exit(1);
}

const single = { w: px(trim.w + BLEED), h: px(trim.h + 2 * BLEED) };
const spread = { w: px(2 * trim.w + 2 * BLEED), h: px(trim.h + 2 * BLEED) };
const side = (n) => (n % 2 ? t("右页", "right") : t("左页", "left"));

const units = [];
if (comic) {
  for (let n = 1; n <= pages; n++) {
    const turn = n % 2 === 1 && n < pages;
    units.push({ pages: [n], where: side(n), turn: turn ? t("翻页前最后一页", "a page turn follows") : "", file: fileName([n]) });
  }
} else {
  for (let n = 4; n + 1 < pages; n += 2) units.push({ pages: [n, n + 1], where: t("跨页", "spread"), turn: "", file: fileName([n, n + 1]) });
  units.push({ pages: [pages], where: t("左页，最后一页", "left, the last page"), turn: "", file: fileName([pages]) });
}

const mm = (inches) => Math.round(inches * 25.4);
const inch = (n) => String(Math.round(n * 1000) / 1000);
const spreads = units.filter((u) => u.pages.length === 2).length;
const lines = [t("# 版式", "# Layout"), ""];
lines.push(
  t(
    `${comic ? "漫画" : "绘本"}，${pages} 页，成书 ${inch(trim.w)}×${inch(trim.h)} 英寸（${mm(trim.w)}×${mm(trim.h)} 毫米）。`,
    `A ${comic ? "comic" : "picture book"} of ${pages} pages, trimmed to ${inch(trim.w)} × ${inch(trim.h)} in (${mm(trim.w)} × ${mm(trim.h)} mm).`,
  ),
  t(
    `图按 300 DPI 加出血（上、下和外侧各 0.125 英寸）：单页 ${single.w}×${single.h} 像素${comic ? "" : `，跨页 ${spread.w}×${spread.h} 像素`}，封面 ${single.w}×${single.h} 像素。`,
    `Images at 300 DPI with bleed (0.125 in at the top, the bottom and the outside): ${single.w} × ${single.h} px for a page${comic ? "" : `, ${spread.w} × ${spread.h} px for a spread`}, and ${single.w} × ${single.h} px for the cover.`,
  ),
  "",
);
if (comic) {
  lines.push(
    t(
      "第 1 页在右边，所以每个奇数页后面翻页：奇数页的最后一格留悬念，翻过去的偶数页第一格揭晓。",
      "Page 1 is a right-hand page, so a page turn follows every odd page: end an odd page on a hook and pay it off in the first panel of the next even page.",
    ),
    "",
  );
} else {
  lines.push(
    t("前页（模板自动排，分页时不用写）：", "Front matter (the template sets it; leave it out of the pagination):"),
    t("- 第 1 页（右页）：书名页", "- Page 1 (right): title page"),
    t("- 第 2 页（左页）：版权页", "- Page 2 (left): copyright page"),
    t("- 第 3 页（右页）：献词", "- Page 3 (right): dedication"),
    "",
  );
}
lines.push(
  t("故事单元（分页时一个单元一项，`pages` 照抄）：", "Story units (one pagination item per unit; copy `pages` as given):"),
  "",
  comic ? t("| 单元 | pages | 位置 | 翻页 | 图的文件名 |", "| Unit | pages | Side | Page turn | Image file |") : t("| 单元 | pages | 位置 | 图的文件名 |", "| Unit | pages | Where | Image file |"),
  comic ? "| --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- |",
  ...units.map((u, i) =>
    comic ? `| ${i + 1} | [${u.pages.join(", ")}] | ${u.where} | ${u.turn} | ${u.file} |` : `| ${i + 1} | [${u.pages.join(", ")}] | ${u.where} | ${u.file} |`,
  ),
  "",
  comic
    ? t(`共 ${units.length} 个单元，一页一个。`, `${units.length} ${units.length === 1 ? "unit" : "units"}, one per page.`)
    : t(
        `共 ${units.length} 个单元：${spreads} 个跨页，1 个单页。每个单元之后翻页。`,
        `${units.length} units: ${spreads} spreads and 1 single page. A page turn follows every unit.`,
      ),
  t("封面另画一张：cover.png。", "The cover is one more image: cover.png."),
  "",
);

const out = outputs[0]?.path ?? "layout.md";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(
  t(
    `排好了 ${units.length} 个单元（${comic ? "漫画" : "绘本"}，${pages} 页），见 ${out}。`,
    `Laid out ${units.length} ${units.length === 1 ? "unit" : "units"} (${comic ? "comic" : "picture book"}, ${pages} pages); see ${out}.`,
  ),
);
