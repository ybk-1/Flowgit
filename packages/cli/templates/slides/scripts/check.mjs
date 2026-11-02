// "check" stage. Warns only.
//
// What it checks and why (see README "参考资料 / References"):
// - Every slide title except the cover and section dividers is a full-sentence claim of at most two lines
//   (assertion-evidence slides, Alley; governing thought first, Minto's Pyramid Principle).
// - Little text on screen and no notes that repeat it (Mayer's coherence and redundancy principles).
// - Bullet slides are a minority; evidence slides carry their evidence; the deck ends with a next step.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.slides) > 0 ? Number(flowInputs.slides) : 8;

const deck = JSON.parse(fs.readFileSync("slides.json", "utf8"));
const slides = (Array.isArray(deck.slides) ? deck.slides : []).map((slide, i) => ({ ...slide, n: i + 1 }));
// Length: words in English, characters (without spaces and punctuation) in Chinese.
const size = (s) => (en ? String(s ?? "").trim().split(/\s+/).filter(Boolean).length : [...String(s ?? "").replace(/[\s\p{P}]/gu, "")].length);
const onScreen = (slide) => {
  const ev = slide.evidence ?? {};
  const parts = [...(slide.bullets ?? []), ev.caption, ev.description, ev.text, ...(ev.items ?? []), ...(ev.data ?? []).map((d) => d.label)];
  return parts.filter(Boolean).join(" ");
};

const claimSlides = slides.filter((s) => !["cover", "section"].includes(s.layout));
const titleMin = en ? 4 : 8;
const titleMax = en ? 15 : 30;
const textMax = en ? 35 : 60;
const weakTitles = claimSlides.filter((s) => size(s.title) < titleMin);
const longTitles = claimSlides.filter((s) => size(s.title) > titleMax);
const dense = slides.filter((s) => size(onScreen(s)) > textMax || (s.bullets ?? []).length > 4);
const bulletSlides = slides.filter((s) => s.layout === "bullets");
const bulletShareOk = bulletSlides.length <= Math.ceil(slides.length / 3);
const noEvidence = slides.filter((s) => s.layout === "evidence" && !s.evidence);
const noNotes = slides.filter((s) => !String(s.notes ?? "").trim());
const echoNotes = slides.filter((s) => {
  const screen = onScreen(s);
  return screen && String(s.notes ?? "").trim() && String(s.notes).includes(screen.slice(0, 20)) && size(s.notes) <= size(screen) * 1.2;
});
const countOk = Math.abs(slides.length - target) <= Math.max(2, Math.round(target * 0.25));
const endsWithAction = slides.length > 0 && slides[slides.length - 1].layout === "close";
const hasThought = Boolean(String(deck.governingThought ?? "").trim());

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((s) => `- ${s.n}. ${s.title}`).join("\n") : none);
const sections = [
  [t(`## 标题不像一句结论（少于 ${titleMin} 个字）`, `## Titles that are topics, not claims (under ${titleMin} words)`), weakTitles],
  [t(`## 标题超过两行（多于 ${titleMax} 个字）`, `## Titles over two lines (over ${titleMax} words)`), longTitles],
  [t(`## 屏幕上字太多（超过 ${textMax} 个字或 4 条要点）`, `## Too much text on screen (over ${textMax} words or 4 bullets)`), dense],
  [t("## 证据页没有证据", "## Evidence slides without evidence"), noEvidence],
  [t("## 没有讲稿", "## Slides without notes"), noNotes],
  [t("## 讲稿只是在念屏幕上的字", "## Notes that just read the slide"), echoNotes],
];
const lines = [
  t("# 演示稿检查", "# Slide deck check"),
  "",
  t(`共 ${slides.length} 页，目标约 ${target} 页，${countOk ? "差不多" : "差得有点多"}。`, `${slides.length} slides against a target of about ${target}: ${countOk ? "close enough" : "quite far off"}.`),
  hasThought ? t(`核心结论：${deck.governingThought}`, `Governing thought: ${deck.governingThought}`) : t("⚠️ 没有写核心结论（governingThought）。", "⚠️ No governing thought (governingThought)."),
  t(`要点页 ${bulletSlides.length} 页${bulletShareOk ? "" : "，超过三分之一，改几页成图表、画面或步骤"}。`, `${bulletSlides.length} bullet slides${bulletShareOk ? "" : ", over a third; turn some into charts, visuals or steps"}.`),
  endsWithAction ? t("最后一页是下一步。", "The last slide is a next step.") : t("⚠️ 最后一页不是下一步（close）。", "⚠️ The last slide is not a next step (close)."),
  "",
  ...sections.flatMap(([title, items]) => [title, list(items), ""]),
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (countOk ? 0 : 1) + (hasThought ? 0 : 1) + (bulletShareOk ? 0 : 1) + (endsWithAction ? 0 : 1) + sections.reduce((n, [, items]) => n + items.length, 0);
console.log(issues ? t(`有 ${issues} 处可以改，见 ${out}。`, `${issues} things to improve; see ${out}.`) : t("检查通过。", "All checks passed."));
