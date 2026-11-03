#!/usr/bin/env node
// "landing-brief" stage: the brief for the landing-page sub-flow, built from
// materials/facts.md so the page says what the rest of the launch says.
//
// The sub-flow's prompts and check read the brief by its "## " headings
// (selling points, tone, must-have facts, proof, form and privacy, do not
// say), so those sections are copied as they are. Price and availability
// joins the must-have facts. "Where visitors come from" is written here: the
// launch's own assets link to the page, and they all lead with the headline
// in messaging.json, so the top of the page picks up that promise (message
// match).
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const out = outputs[0]?.path ?? "subflows/landing-page/brief.md";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync("materials/facts.md")) fail("找不到 materials/facts.md / materials/facts.md is missing");
const facts = fs.readFileSync("materials/facts.md", "utf8").replace(/\r\n/g, "\n");
let messaging;
try {
  messaging = JSON.parse(fs.readFileSync("messaging.json", "utf8"));
} catch (err) {
  fail(`messaging.json 不存在或不是合法的 JSON / messaging.json is missing or not valid JSON: ${err.message}`);
}

const sections = facts
  .split(/^##\s+/m)
  .slice(1)
  .map((part) => ({ title: part.split("\n")[0].trim(), body: part.slice(part.indexOf("\n") + 1).trim() }));
const find = (pattern) => sections.find((s) => pattern.test(s.title));

// [heading in the brief, the fact file section(s) it comes from]
const wanted = [
  ["产品是什么 / What it is", [/产品是什么|What it is/i]],
  ["卖点 / Selling points", [/卖点|Selling points/i]],
  ["访问者从哪里来 / Where visitors come from", null],
  ["语气 / Tone", [/语气|Tone/i]],
  ["必须写上的事实 / Must-have facts", [/必须写上的事实|Must-have facts/i, /价格和购买方式|Price and availability/i]],
  ["证据 / Proof", [/证据|Proof/i]],
  ["表单和隐私 / Form and privacy", [/表单和隐私|Form and privacy/i]],
  ["不要说的话 / Do not say", [/不要说|Do not say/i]],
];

const headline = String(messaging?.headline ?? "").trim();
const tier = Number(messaging?.tier?.level);
const zhFrom = tier === 3 ? "这次发布的邮件和 X、LinkedIn 帖子里的链接" : "这次发布的新闻稿、发布邮件、Product Hunt 页面和 X、LinkedIn 帖子里的链接";
const enFrom =
  tier === 3
    ? "Links in this launch's email and its X and LinkedIn posts"
    : "Links in this launch's press release, launch email, Product Hunt listing, and X and LinkedIn posts";
const visitors = headline
  ? `${zhFrom}。这些物料都用同一句发布标题：「${headline}」。页面开头要接住这句话。\n\n${enFrom}. They all lead with the same launch headline: "${headline}". The top of the page should pick up that promise.`
  : `${zhFrom}。页面开头要说清楚访问者能得到什么。\n\n${enFrom}. The top of the page should say what the visitor gets.`;

const missing = [];
const blocks = [];
for (const [heading, patterns] of wanted) {
  if (!patterns) {
    blocks.push(`## ${heading}`, "", visitors, "");
    continue;
  }
  const bodies = patterns.map(find).filter(Boolean).map((s) => s.body).filter(Boolean);
  if (!bodies.length) {
    missing.push(heading);
    continue;
  }
  blocks.push(`## ${heading}`, "", bodies.join("\n"), "");
}

const product = String(flowInputs.product ?? "").trim() || facts.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
const lines = [
  `# ${product}`,
  "",
  "这份简报由 product-launch 的「落地页简报」阶段从 materials/facts.md 生成。要改内容，改那份资料再运行。 / This brief is written by product-launch's landing-brief stage from materials/facts.md. To change it, edit the facts and run again.",
  "",
  ...blocks,
];

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join("\n").replace(/\n+$/, "")}\n`);
const en = flowInputs.language === "en";
const note = missing.length
  ? en
    ? ` The facts have no ${missing.map((h) => `"${h.split(" / ")[1]}"`).join(", ")} section; the landing page works without it, but add it if you can.`
    : ` 资料里没有「${missing.map((h) => h.split(" / ")[0]).join("」「")}」，落地页没有它也能做，能补就补上。`
  : "";
console.log(en ? `Wrote ${out}.${note}` : `写好了 ${out}。${note}`);
