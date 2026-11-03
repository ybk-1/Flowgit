// "check" stage. Warns only; the report says what to fix and why.
//
// Rules and where they come from (see README "参考资料 / References"):
// - Title length: Taobao, Pinduoduo and Douyin count 60 characters with a Chinese character as 2;
//   Amazon allows 75 characters for non-media titles from 2026-07-27. `titleMax` overrides both.
// - Absolute terms: Advertising Law art. 9(3) and SAMR's 2023 enforcement guide.
// - Medical wording on ordinary goods: Advertising Law art. 17.
// - Price comparisons: Provisions on Clearly Marked Prices and Price Fraud (2022), art. 19.
// - Numbers: every number in the copy should come from the product facts.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const platform = String(flowInputs.platform ?? "taobao");
const amazon = platform === "amazon";

// Chinese platforms count a CJK character (and full-width punctuation) as 2.
const width = (s) => (amazon ? [...s].length : [...s].reduce((n, ch) => n + (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? 2 : 1), 0));
const titleMax = Number(flowInputs.titleMax) > 0 ? Number(flowInputs.titleMax) : amazon ? 75 : 60;
const unit = amazon ? t("个字符", " characters") : t("个字符，汉字算 2 个", " characters, a Chinese character counting as 2");

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const facts = read("materials/product.md");
const points = JSON.parse(read("points.json") || "{}");
const titlesDoc = JSON.parse(read("titles.json") || "{}");
const detail = read("detail.md");
const faq = read("faq.md");
const keywords = Array.isArray(points.keywords) ? points.keywords.map(String) : [];
const titles = (Array.isArray(titlesDoc.titles) ? titlesDoc.titles : []).map((x) => String(x?.text ?? x ?? ""));
const lower = (s) => s.toLowerCase();
const copy = [titles.join("\n"), detail, faq].join("\n");

// Advertising Law art. 9(3) names 国家级, 最高级, 最佳; these are the usual same-meaning terms. Not exhaustive.
const absolute = [
  "国家级", "世界级", "最高级", "最佳", "最好", "最强", "最低价", "最便宜", "全网最", "史上最", "销量第一", "排名第一", "全网第一", "第一品牌",
  "顶级", "极品", "独一无二", "万能", "绝对", "100%", "百分百", "No.1", "NO.1",
  "best ever", "best in the world", "best on the market", "number one", "#1", "world's best",
];
// Advertising Law art. 17: ads other than medical/drug/device ads may not claim to treat disease or use medical terms.
const medical = ["治疗", "治愈", "疗效", "根治", "药效", "消炎", "杀菌", "抗癌", "降血压", "降血糖", "预防疾病", "医用级", "cures", "treats", "heals", "medical grade", "prevents disease"];
// Price comparisons need a real basis (Price Fraud Provisions art. 19).
const priceCompare = ["原价", "划线价", "专柜价", "市场价", "吊牌价", "立省", "比别家便宜", "全网最低", "was $", "compare at", "regular price", "list price"];
// Amazon title policy: no promotional phrases or these symbols.
const amazonPromo = ["free shipping", "best seller", "bestseller", "sale", "hot item", "limited time", "discount", "100% quality"];
const amazonSymbols = ["!", "$", "?", "_", "{", "}", "^", "¬", "¦", "~", "#", "<", ">", "*"];

const hits = (list, text) => list.filter((word) => lower(text).includes(lower(word)));
const absoluteHits = hits(absolute, copy);
const medicalHits = hits(medical, copy);
const priceHits = hits(priceCompare, copy);

const titleRows = titles.map((title) => {
  const w = width(title);
  const problems = [];
  if (w > titleMax) problems.push(t(`超长 ${w}/${titleMax}`, `too long ${w}/${titleMax}`));
  const words = amazon ? lower(title).split(/[\s,/|-]+/).filter((x) => x.length > 2) : keywords;
  const repeated = [...new Set(words.filter((word) => lower(title).split(lower(word)).length - 1 > 2))];
  if (repeated.length) problems.push(t(`重复：${repeated.join("、")}`, `repeated: ${repeated.join(", ")}`));
  if (amazon) {
    const promo = hits(amazonPromo, title).filter((word) => new RegExp(`\\b${word}\\b`, "i").test(title));
    if (promo.length) problems.push(`promotional: ${promo.join(", ")}`);
    const symbols = amazonSymbols.filter((s) => title.includes(s));
    if (symbols.length) problems.push(`symbols: ${symbols.join(" ")}`);
    if (title.length > 10 && title === title.toUpperCase()) problems.push("all caps");
  }
  return { title, w, problems };
});

const titleText = lower(titles.join("\n"));
const unused = keywords.filter((word) => !titleText.includes(lower(word)));

// Numbers in the copy that the product facts never mention. List markers, "第 N 屏", "卖点 N" and
// clock times in scene directions ("8:05", "9 a.m.") are ignored.
const numbersIn = (text) =>
  text
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1") // 1,200 is one number
    .replace(/^\s*\d+\.\s/gm, "")
    .replace(/第\s*\d+\s*[屏张页步个]/g, "")
    .replace(/(?:卖点|痛点|场景)\s*\d+/g, "")
    .replace(/\b(screen|image|step|slide|photo|selling point|point)\s*\d+/gi, "")
    .replace(/\b\d{1,2}:\d{2}\b/g, "")
    .replace(/\b\d{1,2}\s*(?:a\.m\.|p\.m\.)/gi, "")
    .match(/\d+(?:\.\d+)?/g) ?? [];
const factNumbers = new Set(numbersIn(`${facts}\n${flowInputs.price ?? ""}`));
const unknownNumbers = [...new Set(numbersIn(copy))].filter((n) => !factNumbers.has(n));

const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填/i;
const placeholders = [["detail.md", detail], ["faq.md", faq]].filter(([, text]) => placeholder.test(text)).map(([name]) => name);
const mainImages = (detail.split(/^##\s/m).find((part) => /^(主图|main images)/i.test(part)) ?? "").match(/^\s*\d+\.\s/gm)?.length ?? 0;
const screens = (detail.match(/^###\s/gm) ?? []).length;
const worries = Array.isArray(points.worries) ? points.worries.length : 0;
const faqCount = (faq.match(/^##\s/gm) ?? []).length;

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const lines = [
  t("# 上架文案检查", "# Listing check"),
  "",
  t(`## 标题（上限 ${titleMax} ${unit}）`, `## Titles (limit ${titleMax}${unit})`),
  ...titleRows.map(({ title, w, problems }) => `- ${problems.length ? "⚠️ " : ""}${title}（${w}）${problems.length ? ` ${problems.join("；")}` : ""}`),
  "",
  t("## 标题里没用上的关键词", "## Keywords no title uses"),
  list(unused),
  "",
  t("## 绝对化用语（《广告法》第九条）", "## Absolute claims (Advertising Law art. 9)"),
  list(absoluteHits),
  "",
  t("## 医疗用语（《广告法》第十七条，普通商品不能用）", "## Medical claims (Advertising Law art. 17; not for ordinary goods)"),
  list(medicalHits),
  "",
  t("## 价格比较（要有真实依据，《明码标价和禁止价格欺诈规定》第十九条）", "## Price comparisons (need a real basis; Price Fraud Provisions art. 19)"),
  list(priceHits),
  "",
  t("## 资料里找不到的数字（核实后再发）", "## Numbers not in the product facts (verify before publishing)"),
  list(unknownNumbers),
  "",
  t("## 占位符", "## Placeholders"),
  list(placeholders),
  "",
  t(`主图 ${mainImages} 张（建议 5 张），详情页 ${screens} 屏（建议 6 到 9 屏），买家顾虑 ${worries} 条，客服问答 ${faqCount} 条。`, `${mainImages} main images (5 suggested), ${screens} detail screens (6 to 9 suggested), ${worries} buyer worries, ${faqCount} Q&A items.`),
  t("这些检查只做提醒，不能代替平台审核和法律意见。", "These checks are reminders only; they do not replace platform review or legal advice."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues =
  titleRows.filter((r) => r.problems.length).length + absoluteHits.length + medicalHits.length + priceHits.length + unknownNumbers.length + placeholders.length;
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
