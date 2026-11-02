// "check" stage: slide count vs target, dense slides, missing notes. Warns only.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.slides) > 0 ? Number(flowInputs.slides) : 8;

const deck = JSON.parse(fs.readFileSync("slides.json", "utf8"));
const slides = Array.isArray(deck.slides) ? deck.slides : [];
// Bullet length: characters for Chinese, words for English.
const size = (s) => (en ? String(s).trim().split(/\s+/).filter(Boolean).length : [...String(s)].length);
const maxLen = en ? 12 : 30;
const countOk = Math.abs(slides.length - target) <= Math.max(2, Math.round(target * 0.25));
const dense = slides
  .map((slide, i) => ({ n: i + 1, slide, bullets: Array.isArray(slide.bullets) ? slide.bullets : [] }))
  .filter(({ bullets }) => bullets.length > 5 || bullets.some((b) => size(b) > maxLen));
const noNotes = slides.map((slide, i) => ({ n: i + 1, slide })).filter(({ slide }) => !String(slide.notes ?? "").trim());
const emptyBullets = slides
  .map((slide, i) => ({ n: i + 1, slide }))
  .filter(({ slide }) => slide.layout === "bullets" && !(Array.isArray(slide.bullets) && slide.bullets.length));

const none = t("没有。", "None.");
const lines = [
  t("# 演示稿检查", "# Slide deck check"),
  "",
  t(`共 ${slides.length} 页，目标约 ${target} 页，${countOk ? "差不多" : "差得有点多"}。`, `${slides.length} slides against a target of about ${target}: ${countOk ? "close enough" : "quite far off"}.`),
  "",
  t(`## 太满的页（超过 5 条，或一条超过 ${maxLen} 字）`, `## Dense slides (more than 5 bullets, or a bullet over ${maxLen} words)`),
  dense.length ? dense.map(({ n, slide }) => `- ${n}. ${slide.title}`).join("\n") : none,
  "",
  t("## 要点页却没有要点", "## Bullet slides with no bullets"),
  emptyBullets.length ? emptyBullets.map(({ n, slide }) => `- ${n}. ${slide.title}`).join("\n") : none,
  "",
  t("## 没有讲稿的页", "## Slides without notes"),
  noNotes.length ? noNotes.map(({ n, slide }) => `- ${n}. ${slide.title}`).join("\n") : none,
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (countOk ? 0 : 1) + dense.length + noNotes.length + emptyBullets.length;
console.log(issues ? t(`有 ${issues} 处可以改，见 ${out}。`, `${issues} things to improve; see ${out}.`) : t("检查通过。", "All checks passed."));
