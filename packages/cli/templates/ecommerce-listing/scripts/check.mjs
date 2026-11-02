// "check" stage: title length, keyword use, absolute claims, placeholders. Warns only.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const titleMax = Number(flowInputs.titleMax) > 0 ? Number(flowInputs.titleMax) : 30;

const points = JSON.parse(fs.readFileSync("points.json", "utf8"));
const titlesDoc = JSON.parse(fs.readFileSync("titles.json", "utf8"));
const detail = fs.readFileSync("detail.md", "utf8");
const faq = fs.readFileSync("faq.md", "utf8");
const keywords = Array.isArray(points.keywords) ? points.keywords.map(String) : [];
const titles = (Array.isArray(titlesDoc.titles) ? titlesDoc.titles : []).map((x) => String(x?.text ?? x ?? ""));

// Common absolute claims (China's Advertising Law, art. 9, bans superlatives like these). Not exhaustive.
const banned = [
  "最好", "最佳", "最强", "最低价", "最便宜", "最高级", "全网最", "史上最", "销量第一", "排名第一", "全网第一", "第一品牌",
  "国家级", "世界级", "顶级", "极品", "万能", "绝对", "100%", "百分百", "No.1", "NO.1",
  "best ever", "best in the world", "best on the market", "number one", "#1", "guaranteed",
];
const lower = (s) => s.toLowerCase();
const all = [titles.join("\n"), detail, faq].join("\n");
const hits = banned.filter((word) => lower(all).includes(lower(word)));
const longTitles = titles.filter((title) => [...title].length > titleMax);
const titleText = lower(titles.join("\n"));
const unused = keywords.filter((word) => !titleText.includes(lower(word)));
const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填/i;
const placeholders = [["detail.md", detail], ["faq.md", faq]].filter(([, text]) => placeholder.test(text)).map(([name]) => name);
const mainImages = (detail.match(/^\s*\d+\.\s/gm) ?? []).length;

const none = t("没有。", "None.");
const lines = [
  t("# 上架文案检查", "# Listing check"),
  "",
  t(`## 标题（上限 ${titleMax} 字）`, `## Titles (limit ${titleMax} characters)`),
  ...titles.map((title) => `- ${[...title].length > titleMax ? "⚠️ " : ""}${title}（${[...title].length}）`),
  "",
  t("## 标题里没用上的关键词", "## Keywords no title uses"),
  unused.length ? unused.map((word) => `- ${word}`).join("\n") : none,
  "",
  t("## 绝对化用语", "## Absolute claims"),
  hits.length ? hits.map((word) => `- ${word}`).join("\n") : none,
  "",
  t("## 占位符", "## Placeholders"),
  placeholders.length ? placeholders.map((name) => `- ${name}`).join("\n") : none,
  "",
  t(`主图 ${mainImages} 张。`, `${mainImages} main images.`),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = longTitles.length + hits.length + placeholders.length;
console.log(
  issues
    ? t(`有 ${issues} 处要改，见 ${out}。`, `${issues} things to fix; see ${out}.`)
    : t("检查通过。", "All checks passed."),
);
