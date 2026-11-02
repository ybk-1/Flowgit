// Parent summary: one line from the brief the sub-flow copied back.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const topic = typeof flowInputs.topic === "string" ? flowInputs.topic : "";
const brief = fs.existsSync("brief.md") ? fs.readFileSync("brief.md", "utf8") : "";
const heading = brief.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("#")) ?? "";
const title = heading.replace(/^#+\s*/, "") || topic;
fs.writeFileSync("summary.md", `# 摘要 / Summary\n\n题目 / topic: ${topic}\n\n${title}\n`);
console.log(`summary.md: ${title}`);
