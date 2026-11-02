// "check" stage: citations, uncited sources, unanswered questions, bare paragraphs.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const questions = JSON.parse(fs.readFileSync("questions.json", "utf8"));
const list = Array.isArray(questions.questions) ? questions.questions : [];
const report = fs.readFileSync("report.md", "utf8");
const sourceFiles = fs.readdirSync("sources").filter((name) => name.endsWith(".md")).sort();
const citedNames = [...report.matchAll(/\[([^\]\s]+\.md)\]/g)].map((match) => match[1]);
const cited = sourceFiles.filter((name) => citedNames.includes(name));
const uncited = sourceFiles.filter((name) => !cited.includes(name));
const missing = [...new Set(citedNames.filter((name) => !sourceFiles.includes(name)))];
const unanswered = list.filter((q) => q.id && !report.includes(String(q.id))).map((q) => q.id);
const paragraphs = report
  .split(/\n\s*\n/)
  .map((part) => part.trim())
  .filter((part) => part && !part.startsWith("#"));
const bare = paragraphs.filter((part) => !/\[[^\]\s]+\.md\]/.test(part));

const lines = [
  t("# 调研报告检查", "# Research report check"),
  "",
  t("## 没被引用的来源", "## Sources never cited"),
  uncited.length ? uncited.map((name) => t(`- 没被引用的来源：${name}`, `- source never cited: ${name}`)).join("\n") : t("没有。", "None."),
  "",
  t("## 引用了不存在的来源", "## Citations of missing sources"),
  missing.length ? missing.map((name) => `- ${name}`).join("\n") : t("没有。", "None."),
  "",
  t("## 没有被回答的子问题", "## Sub-questions no section answers"),
  unanswered.length ? unanswered.map((id) => `- ${id}`).join("\n") : t("没有。", "None."),
  "",
  t("## 没有出处的段落", "## Paragraphs without a citation"),
  bare.length ? bare.map((part) => `- ${part.replace(/\s+/g, " ").slice(0, 80)}`).join("\n") : t("没有。", "None."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.log(
  t(
    `没被引用 ${uncited.length}，不存在的引用 ${missing.length}，未回答 ${unanswered.length}，无出处段落 ${bare.length}。`,
    `Uncited ${uncited.length}, missing citations ${missing.length}, unanswered ${unanswered.length}, bare paragraphs ${bare.length}.`,
  ),
);
