// 汇总阶段：按文件名把 knowledge/ 里的 .md / .txt 合并成 knowledge.md。
// Collect stage: merge .md / .txt files in knowledge/ into knowledge.md, by file name.
//
// 模型阶段读到文件夹时只能看到文件列表，看不到正文，所以后面的阶段读这份文件。
// An llm stage only sees a file list for a directory, so later stages read this file.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const lang = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}").language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const TEXT = /\.(md|txt)$/i;

const knowledgeDir = path.join(dir, "knowledge");
if (!fs.existsSync(knowledgeDir) || !fs.statSync(knowledgeDir).isDirectory()) {
  console.error(say("找不到 knowledge/ 目录", "knowledge/ directory not found"));
  process.exit(1);
}

/** Relative paths using "/", skipping dotfiles and anything that is not .md or .txt. */
function textFiles(abs, rel) {
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const childAbs = path.join(abs, entry.name);
    if (entry.isDirectory()) out.push(...textFiles(childAbs, childRel));
    else if (entry.isFile() && TEXT.test(entry.name)) out.push(childRel);
  }
  return out;
}

const files = textFiles(knowledgeDir, "").sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
if (!files.length) {
  console.error(say("knowledge/ 里没有 .md 或 .txt 文件", "knowledge/ has no .md or .txt files"));
  process.exit(1);
}

const parts = [
  say("# 资料汇总", "# Knowledge"),
  "",
  say(
    "按文件名合并 knowledge/ 里的 .md 与 .txt。模型阶段只能看到文件夹的文件列表，所以后面的阶段读的是这份文件。",
    "Text files in knowledge/ (.md and .txt), merged by file name. Model stages only see a directory as a file list, so later stages read this file.",
  ),
  "",
];
for (const rel of files) {
  const text = fs.readFileSync(path.join(knowledgeDir, ...rel.split("/")), "utf8").replace(/\s+$/, "");
  parts.push(`## ${rel}`, "", text, "");
}
fs.writeFileSync(path.join(dir, "knowledge.md"), `${parts.join("\n").trimEnd()}\n`);
console.log(say(`knowledge.md：合并了 ${files.length} 个文件`, `knowledge.md: merged ${files.length} files`));
