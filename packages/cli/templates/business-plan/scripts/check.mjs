// "check" stage. Warns only; the report says what to fix and why.
//
// What it checks and where the rules come from (see README "参考资料 / References"):
// - Structure: Sequoia's business-plan outline, with "why now" early; titles that state a claim.
// - Market size: bottom-up, customers × annual price must equal the stated SAM.
// - Unit economics: LTV = ARPA × margin ÷ churn, payback = CAC ÷ (ARPA × margin); investors commonly look for
//   LTV:CAC of 3 or more and payback within about 12 months (benchmarks vary by segment).
// - Arithmetic: profit = revenue − costs, and the use of funds adds up to the ask.
// - Numbers in the plan that are not in the facts or the two JSON files.
// - Promised returns: promising principal or returns to the public is a mark of illegal fund-raising
//   (Regulations on Preventing and Handling Illegal Fund-raising, 2021, art. 2).
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
const json = (file) => JSON.parse(read(file) || "{}");
const facts = read("materials/company.md");
const market = json("market.json");
const fin = json("financials.json");
const plan = read("business-plan.md");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const close = (a, b, tol = 0.1) => (b === 0 ? a === 0 : Math.abs(a - b) / Math.abs(b) <= tol);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// Structure.
const parts = [
  ["purpose", /公司定位|使命|purpose/i, t("公司定位", "Purpose")],
  ["problem", /问题|痛点|problem/i, t("问题", "Problem")],
  ["solution", /解决方案|solution/i, t("解决方案", "Solution")],
  ["whyNow", /为什么是现在|为何现在|why now/i, t("为什么是现在", "Why now")],
  ["market", /市场|market/i, t("市场", "Market")],
  ["competition", /竞争|competition|competitors/i, t("竞争", "Competition")],
  ["product", /产品|product/i, t("产品", "Product")],
  ["model", /商业模式|盈利模式|business model/i, t("商业模式", "Business model")],
  ["team", /团队|team/i, t("团队", "Team")],
  ["financials", /财务|financials/i, t("财务", "Financials")],
  ["ask", /融资|the ask|fundrais|use of funds/i, t("融资计划", "The ask")],
];
const headings = [...plan.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
const nameOf = (h) => h.split(/[：:]/)[0];
const indexOf = (re) => headings.findIndex((h) => re.test(nameOf(h)));
const missing = parts.filter(([, re]) => indexOf(re) < 0).map(([, , name]) => name);
const whyNowAt = indexOf(parts[3][1]);
const marketAt = indexOf(parts[4][1]);
const whyNowLate = whyNowAt >= 0 && marketAt >= 0 && whyNowAt > marketAt;
const noClaim = headings.filter((h) => {
  const claim = h.split(/[：:]/).slice(1).join(":").trim();
  return claim.length < 4;
});

// Market size.
const customers = num(market.customers?.count);
const price = num(market.price?.value);
const sam = num(market.sam?.value);
const som = num(market.som?.value);
const tam = num(market.tam?.value);
const marketNotes = [];
if (!customers || !price) marketNotes.push(t("市场规模缺客户数或客单价，没法自下而上地算。", "The market size lacks a customer count or a price, so it is not bottom-up."));
else if (!close(customers * price, sam) && close(customers * price * 12, sam))
  marketNotes.push(t(`客户数 × 客单价 × 12 才等于市场规模 ${fmt(sam)}：客单价 ${fmt(price)} 像是月费。price.value 要填一年的钱（${fmt(price * 12)}）。`, `Only customers × price × 12 gives the stated ${fmt(sam)}: the price ${fmt(price)} looks monthly. price.value should be the yearly amount (${fmt(price * 12)}).`));
else if (!close(customers * price, sam)) marketNotes.push(t(`客户数 ${fmt(customers)} × 客单价 ${fmt(price)} = ${fmt(customers * price)}，和写的市场规模 ${fmt(sam)} 对不上。`, `${fmt(customers)} customers × ${fmt(price)} = ${fmt(customers * price)}, not the stated ${fmt(sam)}.`));
if (som && sam && som > sam) marketNotes.push(t("能拿到的份额（SOM）比可服务市场（SAM）还大。", "The obtainable share (SOM) is larger than the serviceable market (SAM)."));
if (tam && sam && tam < sam) marketNotes.push(t("总市场（TAM）比可服务市场（SAM）小。", "The total market (TAM) is smaller than the serviceable market (SAM)."));
const unsourced = [["customers", market.customers?.source], ["price", market.price?.source]].filter(([, s]) => !String(s ?? "").trim()).map(([k]) => k);
if (unsourced.length) marketNotes.push(t(`这些数字没写出处：${unsourced.join("、")}。`, `No source for: ${unsourced.join(", ")}.`));
const competitors = Array.isArray(market.competitors) ? market.competitors : [];
if (!competitors.some((c) => c.type === "indirect")) marketNotes.push(t("没有间接竞争（客户现在凑合用的办法）。", "No indirect competition (how customers make do today)."));

// Unit economics.
const u = fin.unit ?? {};
const arpa = num(u.arpa);
const gm = num(u.grossMargin) > 1 ? num(u.grossMargin) / 100 : num(u.grossMargin);
const churn = num(u.monthlyChurn) > 1 ? num(u.monthlyChurn) / 100 : num(u.monthlyChurn);
const cac = num(u.cac);
const unitNotes = [];
let ratio = 0;
let payback = 0;
if (arpa && gm && churn && cac) {
  const ltv = (arpa * gm) / churn;
  ratio = ltv / cac;
  payback = cac / (arpa * gm);
  if (u.ltv !== undefined && !close(num(u.ltv), ltv)) unitNotes.push(t(`LTV 写的是 ${fmt(num(u.ltv))}，按公式算是 ${fmt(ltv)}。`, `LTV is stated as ${fmt(num(u.ltv))}; the formula gives ${fmt(ltv)}.`));
  if (u.paybackMonths !== undefined && !close(num(u.paybackMonths), payback)) unitNotes.push(t(`回本月数写的是 ${fmt(num(u.paybackMonths))}，按公式算是 ${fmt(payback)}。`, `Payback is stated as ${fmt(num(u.paybackMonths))} months; the formula gives ${fmt(payback)}.`));
  if (ratio < 3) unitNotes.push(t(`LTV:CAC 只有 ${fmt(ratio)}，投资人通常希望 3 以上。`, `LTV:CAC is only ${fmt(ratio)}; investors usually look for 3 or more.`));
  if (payback > 12) unitNotes.push(t(`获客成本要 ${fmt(payback)} 个月才回本，通常希望 12 个月以内（企业级销售可以更长）。`, `Acquisition cost takes ${fmt(payback)} months to pay back; about 12 or fewer is the usual hope (longer for enterprise sales).`));
} else unitNotes.push(t("单位经济缺客单价、毛利、流失率或获客成本，没法算。", "Unit economics lack ARPA, margin, churn or CAC, so they cannot be computed."));

// Projection and the ask.
const years = Array.isArray(fin.years) ? fin.years : [];
const finNotes = [];
for (const y of years) {
  if (!close(num(y.revenue) - num(y.costs), num(y.profit), 0.01)) finNotes.push(t(`第 ${y.year} 年：收入 − 成本 ≠ 利润。`, `Year ${y.year}: revenue − costs ≠ profit.`));
}
for (let i = 1; i < years.length; i++) {
  const before = num(years[i - 1].revenue);
  const growth = before ? num(years[i].revenue) / before : 0;
  if (growth > 3) finNotes.push(t(`第 ${years[i].year} 年收入是上一年的 ${fmt(growth)} 倍，要在假设里写清依据。`, `Year ${years[i].year} revenue is ${fmt(growth)}× the year before; the assumptions must justify it.`));
}
const ask = num(fin.ask);
const funds = Array.isArray(fin.useOfFunds) ? fin.useOfFunds : [];
const fundsTotal = funds.reduce((sum, f) => sum + num(f.amount), 0);
if (ask && !close(fundsTotal, ask, 0.001)) finNotes.push(t(`资金用途加起来是 ${fmt(fundsTotal)}，融资额是 ${fmt(ask)}。`, `The use of funds adds up to ${fmt(fundsTotal)}; the ask is ${fmt(ask)}.`));
if (num(flowInputs.ask) && ask && !close(ask, num(flowInputs.ask), 0.001)) finNotes.push(t(`融资额 ${fmt(ask)} 和输入的 ${fmt(num(flowInputs.ask))} 不一样。`, `The ask ${fmt(ask)} differs from the input ${fmt(num(flowInputs.ask))}.`));
if (!Array.isArray(fin.milestones) || !fin.milestones.length) finNotes.push(t("没写这笔钱花完时要达到的里程碑。", "No milestone for when this money runs out."));

// Numbers in the plan that have no basis. Numbers in the JSON count in common display units too (万 and 亿 in Chinese,
// k, M and B in English, and fractions as percentages).
const numbersIn = (text) =>
  text
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1") // 1,200 is one number
    .replace(/^#+\s*\d+[.、]?\s*/gm, "")
    .replace(/^\s*\d+[.、)]\s+/gm, "")
    .match(/\d+(?:\.\d+)?/g) ?? [];
const known = new Set(numbersIn(`${facts}\n${flowInputs.ask ?? ""}`));
const addForms = (value) => {
  const v = Math.abs(value);
  const forms = [v, ...(en ? [v / 1e3, v / 1e6, v / 1e9] : [v / 1e4, v / 1e8]), ...(v <= 1 ? [v * 100] : [])];
  for (const x of forms) {
    known.add(String(Number(x.toFixed(2))));
    known.add(String(Math.round(x)));
    known.add(x.toFixed(1));
  }
};
const walk = (v) => (typeof v === "number" ? addForms(v) : v && typeof v === "object" ? Object.values(v).forEach(walk) : typeof v === "string" ? numbersIn(v).forEach((n) => known.add(n)) : undefined);
walk(market);
walk(fin);
if (ratio) addForms(ratio);
if (payback) addForms(payback);
if (churn) addForms(1 / churn); // average customer lifetime in months
const unknownNumbers = [...new Set(numbersIn(plan))].filter((n) => !known.has(n) && !known.has(String(Number(n))));

const lower = plan.toLowerCase();
// A word counts unless it is negated just before ("不保证", "no guarantee", "we don't promise").
const negated = (text, at) => /(?:不|没有|没|无|绝不|并非)\s*$/.test(text.slice(Math.max(0, at - 3), at)) || /\b(?:no|not|never|don't|doesn't|won't|cannot|can't|without)\s+(?:\w+\s+)?$/i.test(text.slice(Math.max(0, at - 24), at));
const hits = (words) =>
  words.filter((w) => {
    const word = w.toLowerCase();
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) if (!negated(lower, at)) return true;
    return false;
  });
const returns = ["保本", "保底", "稳赚", "无风险", "零风险", "年化收益", "固定收益", "保证收益", "保证回报", "承诺回报", "还本付息", "guaranteed return", "risk-free", "fixed return", "annual yield", "principal protected"];
const hype = ["颠覆", "国内唯一", "全球唯一", "行业唯一", "唯一一家", "全球领先", "国内领先", "遥遥领先", "革命性", "没有竞争", "没有竞争对手", "行业第一", "disruptive", "the only", "first-ever", "world-leading", "revolutionary", "no competition", "no competitors"];

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 缺的部分（红杉结构）", "## Missing parts (Sequoia's outline)"), missing],
  [t("## 标题没写结论", "## Titles without a claim"), noClaim],
  [t("## 市场规模", "## Market size"), marketNotes],
  [t("## 单位经济", "## Unit economics"), unitNotes],
  [t("## 财务预测和融资", "## Projection and the ask"), finNotes],
  [t("## 资料里找不到的数字（核实或写进假设）", "## Numbers not in your facts (verify, or list as assumptions)"), unknownNumbers],
  [t("## 承诺投资回报（《防范和处置非法集资条例》第二条）", "## Promised returns (illegal fund-raising rules, art. 2)"), hits(returns)],
  [t("## 说不清依据的大词", "## Big claims with no proof"), hits(hype)],
];
const lines = [
  t("# 商业计划书检查", "# Business plan check"),
  "",
  ratio ? t(`LTV:CAC = ${fmt(ratio)}，回本 ${fmt(payback)} 个月。`, `LTV:CAC = ${fmt(ratio)}, payback ${fmt(payback)} months.`) : t("没算出单位经济。", "Unit economics not computed."),
  whyNowLate ? t("⚠️ “为什么是现在”放在了市场之后，应该尽早出现。", "⚠️ \"Why now\" comes after the market; it belongs early.") : t("“为什么是现在”的位置没问题。", "\"Why now\" is placed early enough."),
  "",
  ...sections.flatMap(([title, items]) => [title, list(items), ""]),
  t("这些检查只做提醒，不能代替财务、法务和投资人的判断。", "These checks are reminders only; they do not replace financial, legal or investor judgment."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = sections.reduce((n, [, items]) => n + items.length, 0) + (whyNowLate ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
