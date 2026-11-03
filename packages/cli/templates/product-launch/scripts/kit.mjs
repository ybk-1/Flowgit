#!/usr/bin/env node
// "kit" stage: launch-kit.md, everything to copy and paste on launch day in
// one file: the key times, each Product Hunt field and the X and LinkedIn
// posts with their lengths, the email's subject and preview text, and where
// every asset is. Lengths follow the JSON block in rules.md (passed on the
// command line so Flowgit hashes that file).
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const out = outputs[0]?.path ?? "launch-kit.md";
const rulesFile = process.argv[2] ?? "rules.md";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null);

let rules;
try {
  const fenced = read(rulesFile)?.match(/```json\n([\s\S]*?)\n```/);
  if (!fenced) fail(t(`${rulesFile} 里没有 JSON 规则块`, `${rulesFile} has no JSON rules block`));
  rules = JSON.parse(fenced[1]);
} catch (err) {
  fail(t(`${rulesFile} 的 JSON 不合法：${err.message}`, `The JSON in ${rulesFile} is invalid: ${err.message}`));
}

let posts;
try {
  posts = JSON.parse(read("posts.json") ?? "");
} catch (err) {
  fail(t(`posts.json 不存在或不是合法的 JSON：${err.message}`, `posts.json is missing or not valid JSON: ${err.message}`));
}
const ph = posts?.productHunt ?? {};
const str = (v) => (typeof v === "string" ? v.trim() : "");

const codePoints = (s) => [...String(s)].length;
function xWeighted(text) {
  const cfg = rules.x;
  let urls = 0;
  // A URL stops at the first character outside printable ASCII.
  const rest = String(text).replace(/https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/gi, () => {
    urls += 1;
    return "";
  });
  let raw = urls * cfg.transformedURLLength * cfg.scale;
  for (const ch of rest) {
    const cp = ch.codePointAt(0);
    const range = cfg.ranges.find((r) => cp >= r.start && cp <= r.end);
    raw += range ? range.weight : cfg.defaultWeight;
  }
  return Math.round((raw / cfg.scale) * 10) / 10;
}
const over = (n, max) => (n > max ? t("，超了", ", over") : "");

/** A fenced block that survives backticks inside the text. */
function fenced(text) {
  const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return [`${fence}text`, String(text), fence];
}

// ---- Key times, from launch-plan.md ----
const plan = read("launch-plan.md") ?? "";
const planLine = (pattern) => plan.split("\n").find((l) => pattern.test(l))?.trim() ?? "";
const keyTimes = [
  planLine(/^(公开发布|Public launch)[:：]/),
  planLine(/^Product Hunt (上线|goes live)[:：]/),
  planLine(/^(新闻稿第一行|Release line)[:：]/),
].filter(Boolean);
const tierLine = plan.split("\n").find((l) => /^(一级|二级|三级|Tier \d)/.test(l.trim()))?.trim() ?? "";
const tier = /^(三级|Tier 3)/.test(tierLine) ? 3 : 0;

// ---- Email: the subject and preview lines ----
const email = read("email.md") ?? "";
const emailLine = (pattern) => {
  const line = email.split("\n").find((l) => pattern.test(l.trim()));
  return line ? line.trim().replace(pattern, "").trim() : "";
};
const subject = emailLine(/^(主题|Subject)\s*[:：]/i);
const preview = emailLine(/^(预览文字|Preview text)\s*[:：]/i);

// ---- Landing page ----
const landingSummary = (read("landing-check.md") ?? "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";

const product = String(flowInputs.product ?? "").trim();
const tagline = str(ph.tagline);
const description = str(ph.description);
const x = str(posts?.x);
const linkedin = str(posts?.linkedin);
const lines = [t(`# 发布物料包：${product}`, `# Launch kit: ${product}`), ""];
if (tierLine) lines.push(tierLine, "");

lines.push(t("## 关键时间", "## Key times"), "");
lines.push(...(keyTimes.length ? keyTimes.map((l) => `- ${l}`) : [t("- （launch-plan.md 里没有找到）", "- (Not found in launch-plan.md)")]));
lines.push("", t("完整的时间表见 launch-plan.md。", "The full timeline is in launch-plan.md."), "");

if (tier !== 3) {
  lines.push(
    "## Product Hunt",
    "",
    t(
      "只收英文。每一栏单独复制进 Product Hunt 的发布表单；第一条评论在上线后马上发。",
      "English only. Copy each field into Product Hunt's launch form on its own; post the first comment as soon as the launch is live.",
    ),
    "",
    t("### 名称（Name）", "### Name"),
    "",
    ...fenced(str(ph.name)),
    "",
    t(
      `### 标语（Tagline，${codePoints(tagline)}/${rules.productHunt.taglineMax}${over(codePoints(tagline), rules.productHunt.taglineMax)}）`,
      `### Tagline (${codePoints(tagline)}/${rules.productHunt.taglineMax}${over(codePoints(tagline), rules.productHunt.taglineMax)})`,
    ),
    "",
    ...fenced(tagline),
    "",
    t(
      `### 简介（Description，${codePoints(description)}/${rules.productHunt.descriptionMax}${over(codePoints(description), rules.productHunt.descriptionMax)}）`,
      `### Description (${codePoints(description)}/${rules.productHunt.descriptionMax}${over(codePoints(description), rules.productHunt.descriptionMax)})`,
    ),
    "",
    ...fenced(description),
    "",
    t("### maker 的第一条评论（First comment）", "### Maker's first comment"),
    "",
    ...fenced(str(ph.firstComment)),
    "",
  );
  if (str(ph.translation)) {
    lines.push(t("### 中文对照（不用提交）", "### Translation (not for submitting)"), "", ...str(ph.translation).split("\n").map((l) => (l.trim() ? `> ${l}` : ">")), "");
  }
}

const xn = xWeighted(x);
const ln = codePoints(linkedin);
lines.push(
  t(`## X（加权 ${xn}/${rules.x.maxWeightedTweetLength}${over(xn, rules.x.maxWeightedTweetLength)}）`, `## X (weighted ${xn}/${rules.x.maxWeightedTweetLength}${over(xn, rules.x.maxWeightedTweetLength)})`),
  "",
  ...fenced(x),
  "",
  t(`## LinkedIn（${ln}/${rules.linkedin.textMax}${over(ln, rules.linkedin.textMax)}）`, `## LinkedIn (${ln}/${rules.linkedin.textMax}${over(ln, rules.linkedin.textMax)})`),
  "",
  ...fenced(linkedin),
  "",
  t("## 邮件", "## Email"),
  "",
  t(
    `- 主题（${codePoints(subject)}/${rules.email.subjectMax}${over(codePoints(subject), rules.email.subjectMax)}）：${subject || "（email.md 里没有「主题：」）"}`,
    `- Subject (${codePoints(subject)}/${rules.email.subjectMax}${over(codePoints(subject), rules.email.subjectMax)}): ${subject || '(no "Subject:" line in email.md)'}`,
  ),
  t(
    `- 预览文字（${codePoints(preview)}/${rules.email.previewMax}${over(codePoints(preview), rules.email.previewMax)}）：${preview || "（email.md 里没有「预览文字：」）"}`,
    `- Preview text (${codePoints(preview)}/${rules.email.previewMax}${over(codePoints(preview), rules.email.previewMax)}): ${preview || '(no "Preview text:" line in email.md)'}`,
  ),
  "",
  t(
    "正文和页脚见 email.md。在邮件平台里打开一键退订（List-Unsubscribe），只发给同意接收的人。",
    "The body and footer are in email.md. Turn on one-click unsubscribe (List-Unsubscribe) in your email platform, and send only to people who agreed to it.",
  ),
  "",
  t("## 每份物料在哪", "## Where everything is"),
  "",
  t("| 物料 | 文件 |", "| Asset | File |"),
  "| --- | --- |",
  t("| 发布计划和时间表 | launch-plan.md |", "| Launch plan and timeline | launch-plan.md |"),
  t("| 媒体资料 | fact-sheet.md |", "| Fact sheet | fact-sheet.md |"),
  t("| 新闻稿 | press-release.md |", "| Press release | press-release.md |"),
  t("| 发布邮件 | email.md |", "| Launch email | email.md |"),
  t("| Product Hunt 和帖子 | posts.json（上面已经排好） |", "| Product Hunt and posts | posts.json (laid out above) |"),
  t("| 常见问题 | faq.md |", "| FAQ | faq.md |"),
  t(
    `| 落地页 | site/index.html，用浏览器打开；检查报告 landing-check.md${landingSummary ? `：${landingSummary}` : ""} |`,
    `| Landing page | site/index.html, open it in a browser; its check is landing-check.md${landingSummary ? `: ${landingSummary}` : ""} |`,
  ),
  t("| 发布前检查 | check-report.md（下一步写） |", "| Pre-launch check | check-report.md (the next stage writes it) |"),
  "",
);

fs.writeFileSync(out, `${lines.join("\n").replace(/\n+$/, "")}\n`);
console.log(
  t(
    `写好了 ${out}：X 加权 ${xn}/${rules.x.maxWeightedTweetLength}，LinkedIn ${ln}/${rules.linkedin.textMax}${tier === 3 ? "" : `，Product Hunt 标语 ${codePoints(tagline)}/${rules.productHunt.taglineMax}`}。`,
    `Wrote ${out}: X weighted ${xn}/${rules.x.maxWeightedTweetLength}, LinkedIn ${ln}/${rules.linkedin.textMax}${tier === 3 ? "" : `, Product Hunt tagline ${codePoints(tagline)}/${rules.productHunt.taglineMax}`}.`,
  ),
);
