// "check" stage: keyword coverage, length, and leftover placeholders.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const analysis = JSON.parse(fs.readFileSync("analysis.json", "utf8"));
const resume = fs.readFileSync("resume.md", "utf8");
const letter = fs.readFileSync("cover-letter.md", "utf8");
const keywords = Array.isArray(analysis.keywords) ? analysis.keywords.map(String) : [];
const covered = keywords.filter((word) => resume.toLowerCase().includes(word.toLowerCase()));
const missing = keywords.filter((word) => !covered.includes(word));
const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填/i;
const resumePlaceholders = placeholder.test(resume);
const letterPlaceholders = placeholder.test(letter);
const resumeChars = [...resume].length;
const letterChars = [...letter].length;
const resumeLengthOk = resumeChars >= 40 && resumeChars <= 6000;
const letterLengthOk = letterChars >= 40 && letterChars <= 4000;

const lines = [
  t("# 求职材料检查", "# Job application check"),
  "",
  t(`关键词 ${covered.length}/${keywords.length} 出现在简历里。`, `${covered.length}/${keywords.length} keywords appear in the resume.`),
  missing.length ? t(`还缺：${missing.join("、")}`, `Still missing: ${missing.join(", ")}`) : t("关键词都在。", "Every keyword is there."),
  "",
  t(`简历 ${resumeChars} 字，${resumeLengthOk ? "长度合适" : "长度不合适"}。`, `Resume is ${resumeChars} characters, ${resumeLengthOk ? "a reasonable length" : "not a reasonable length"}.`),
  t(`求职信 ${letterChars} 字，${letterLengthOk ? "长度合适" : "长度不合适"}。`, `Cover letter is ${letterChars} characters, ${letterLengthOk ? "a reasonable length" : "not a reasonable length"}.`),
  "",
  resumePlaceholders || letterPlaceholders
    ? t("还有占位符（[...]、TODO、待补充）。", "Placeholders remain ([...], TODO, 待补充).")
    : t("没有占位符。", "No placeholders."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, lines.join("\n"));
const ok = missing.length === 0 && resumeLengthOk && letterLengthOk && !resumePlaceholders && !letterPlaceholders;
console.log(lines.join("\n"));
if (!ok) {
  console.error(t("检查没通过。", "Checks failed."));
  process.exit(1);
}
console.log(t("检查通过。", "All checks passed."));
