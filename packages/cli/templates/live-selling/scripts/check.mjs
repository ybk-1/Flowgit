// "check" stage: minutes add up, every segment scripted, price mentioned, absolute claims, placeholders. Warns only.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 10;

const rundown = JSON.parse(fs.readFileSync("rundown.json", "utf8"));
const segments = Array.isArray(rundown.segments) ? rundown.segments : [];
const script = fs.readFileSync("script.md", "utf8");
const qa = fs.readFileSync("qa.md", "utf8");
const total = segments.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
const headings = [...script.matchAll(/^##\s+(\S+)/gm)].map((m) => m[1]);
const missing = segments.filter((s) => s.id && !headings.some((h) => h.replace(/[：:.、]$/, "") === s.id)).map((s) => `${s.id} ${s.name ?? ""}`.trim());
// The price input often carries the number; check the first number in it shows up in the script.
const priceNumber = String(flowInputs.price ?? "").match(/\d+(?:\.\d+)?/)?.[0];
const priceMissing = priceNumber ? !script.includes(priceNumber) : false;

// Common absolute claims (China's Advertising Law, art. 9, bans superlatives like these). Not exhaustive.
const banned = [
  "最好", "最佳", "最强", "最低价", "全网最低", "最便宜", "全网最", "史上最", "销量第一", "排名第一", "全网第一", "第一品牌",
  "国家级", "世界级", "顶级", "极品", "万能", "绝对", "100%", "百分百", "根治", "包治", "No.1", "NO.1",
  "best ever", "best in the world", "best on the market", "number one", "#1", "lowest price ever", "guaranteed", "cures",
];
const all = `${script}\n${qa}`.toLowerCase();
const hits = banned.filter((word) => all.includes(word.toLowerCase()));
const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填/i;
const placeholders = [["script.md", script], ["qa.md", qa]].filter(([, text]) => placeholder.test(text)).map(([name]) => name);
const qaCount = (qa.match(/^\s*-\s/gm) ?? []).length;

const none = t("没有。", "None.");
const lines = [
  t("# 直播脚本检查", "# Live-selling script check"),
  "",
  t(`流程表 ${segments.length} 段，共 ${total} 分钟（目标 ${target} 分钟）${total === target ? "，对得上" : "，对不上"}。`, `${segments.length} segments, ${total} minutes in all (target ${target})${total === target ? ", matches" : ", does not match"}.`),
  "",
  t("## 没写话术的段落", "## Segments with no script"),
  missing.length ? missing.map((s) => `- ${s}`).join("\n") : none,
  "",
  t("## 绝对化用语", "## Absolute claims"),
  hits.length ? hits.map((word) => `- ${word}`).join("\n") : none,
  "",
  t("## 占位符", "## Placeholders"),
  placeholders.length ? placeholders.map((name) => `- ${name}`).join("\n") : none,
  "",
  priceNumber ? (priceMissing ? t(`话术里没提到价格 ${priceNumber}。`, `The script never mentions the price ${priceNumber}.`) : t(`话术里提到了价格 ${priceNumber}。`, `The script mentions the price ${priceNumber}.`)) : t("没有填价格，跳过价格检查。", "No price given; price check skipped."),
  t(`弹幕问答 ${qaCount} 条。`, `${qaCount} chat Q&A items.`),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (total === target ? 0 : 1) + missing.length + hits.length + placeholders.length + (priceMissing ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要改，见 ${out}。`, `${issues} things to fix; see ${out}.`) : t("检查通过。", "All checks passed."));
