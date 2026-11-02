// "check" stage. Warns only; the report says what to fix and why.
//
// Rules and where they come from (see README "参考资料 / References"):
// - Invented data and misleading claims: Measures for Live-Stream Marketing (trial, 2021), art. 18.
// - Absolute terms and medical wording: Advertising Law arts. 9 and 17.
// - Price comparisons: Provisions on Clearly Marked Prices and Price Fraud (2022), art. 19.
// - Numbers: every number in the script should come from the product facts or the price input.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 10;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const facts = read("materials/product.md");
const rundown = JSON.parse(read("rundown.json") || "{}");
const segments = Array.isArray(rundown.segments) ? rundown.segments : [];
const script = read("script.md");
const qa = read("qa.md");
const all = `${script}\n${qa}`;
const lower = (s) => s.toLowerCase();
const hits = (list) => list.filter((word) => lower(all).includes(lower(word)));

const total = segments.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
const headings = [...script.matchAll(/^##\s+(\S+)/gm)].map((m) => m[1].replace(/[：:.、]$/, ""));
const missing = segments.filter((s) => s.id && !headings.includes(s.id)).map((s) => `${s.id} ${s.name ?? ""}`.trim());
const types = ["hook", "pain", "demo", "trust", "price", "close", "recap"];
const typeNames = { hook: t("留人", "hook"), pain: t("痛点", "pain"), demo: t("塑品演示", "demo"), trust: t("信任", "trust"), price: t("价格", "price"), close: t("逼单", "close"), recap: t("返场", "recap") };
const missingTypes = types.filter((type) => !segments.some((s) => s.type === type));

const priceNumber = String(flowInputs.price ?? "").match(/\d+(?:\.\d+)?/)?.[0];
const priceMissing = priceNumber ? !script.includes(priceNumber) : false;

// Art. 18 bans faking sales, attention or view data and misleading viewers. These phrases need a basis in the facts.
const dataClaims = [
  "已售", "已经卖了", "卖爆", "销量", "库存只剩", "只剩", "最后几单", "最后一单", "马上涨价", "马上恢复原价", "仅此一次", "下播就涨", "在线人数", "好评率", "回购率",
  "sold out", "already sold", "only a few left", "last few", "price goes up", "never this cheap", "rated",
];
const absolute = [
  "国家级", "世界级", "最高级", "最佳", "最好", "最强", "最低价", "全网最低", "最便宜", "全网最", "史上最", "销量第一", "排名第一", "全网第一", "第一品牌",
  "顶级", "极品", "独一无二", "万能", "绝对", "100%", "百分百", "No.1", "NO.1",
  "best ever", "best in the world", "best on the market", "number one", "#1", "lowest price ever", "world's best",
];
const medical = ["治疗", "治愈", "疗效", "根治", "包治", "药效", "消炎", "杀菌", "抗癌", "降血压", "降血糖", "预防疾病", "医用级", "cures", "treats", "heals", "medical grade", "prevents disease"];
const priceCompare = ["原价", "划线价", "专柜价", "市场价", "吊牌价", "立省", "比别家便宜", "was $", "retail price", "regular price"];

const numbersIn = (text) => text.replace(/^##\s+\S+/gm, "").replace(/[（(]\s*\d+\s*(分钟|min)\s*[)）]/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
const known = new Set(numbersIn(`${facts}\n${flowInputs.price ?? ""}`));
const unknownNumbers = [...new Set(numbersIn(all))].filter((n) => !known.has(n));

const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填/i;
const placeholders = [["script.md", script], ["qa.md", qa]].filter(([, text]) => placeholder.test(text)).map(([name]) => name);
const qaCount = (qa.match(/^\s*-\s/gm) ?? []).length;

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 没写话术的段落", "## Segments with no script"), missing],
  [t("## 缺少的段落类型", "## Missing segment types"), missingTypes.map((type) => typeNames[type])],
  [t("## 销量、库存、紧迫感（资料里没有就是虚构，《网络直播营销管理办法》第十八条）", "## Sales, stock and urgency claims (invented unless the facts say so; live-stream rules art. 18)"), hits(dataClaims)],
  [t("## 绝对化用语（《广告法》第九条）", "## Absolute claims (Advertising Law art. 9)"), hits(absolute)],
  [t("## 医疗用语（《广告法》第十七条）", "## Medical claims (Advertising Law art. 17)"), hits(medical)],
  [t("## 价格比较（要有真实依据，《明码标价和禁止价格欺诈规定》第十九条）", "## Price comparisons (need a real basis; Price Fraud Provisions art. 19)"), hits(priceCompare)],
  [t("## 资料和价格里找不到的数字（核实后再播）", "## Numbers not in the facts or the price (verify before going live)"), unknownNumbers],
  [t("## 占位符", "## Placeholders"), placeholders],
];
const lines = [
  t("# 直播脚本检查", "# Live-selling script check"),
  "",
  t(`流程表 ${segments.length} 段，共 ${total} 分钟（目标 ${target} 分钟）${total === target ? "，对得上" : "，对不上"}。`, `${segments.length} segments, ${total} minutes in all (target ${target})${total === target ? ", matches" : ", does not match"}.`),
  "",
  ...sections.flatMap(([title, items]) => [title, list(items), ""]),
  priceNumber ? (priceMissing ? t(`话术里没提到价格 ${priceNumber}。`, `The script never mentions the price ${priceNumber}.`) : t(`话术里提到了价格 ${priceNumber}。`, `The script mentions the price ${priceNumber}.`)) : t("没有填价格，跳过价格检查。", "No price given; price check skipped."),
  t(`弹幕问答 ${qaCount} 条。`, `${qaCount} chat Q&A items.`),
  t("这些检查只做提醒，不能代替平台审核和法律意见。", "These checks are reminders only; they do not replace platform review or legal advice."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (total === target ? 0 : 1) + sections.reduce((n, [, items]) => n + items.length, 0) + (priceMissing ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} things to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
