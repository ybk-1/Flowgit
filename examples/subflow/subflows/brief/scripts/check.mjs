// Sub-flow check: the brief must exist and start with a heading.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const en = flowInputs.language === "en";
const say = (zh, english) => (en ? english : zh);
const brief = fs.existsSync("brief.md") ? fs.readFileSync("brief.md", "utf8").trim() : "";
const heading = brief.split(/\r?\n/).some((line) => /^#\s+\S/.test(line.trim()));
if (!brief || !heading) {
  console.error(say("brief.md 需要一个标题", "brief.md needs a heading"));
  process.exit(1);
}
fs.writeFileSync("check.txt", "ok\n");
console.log(say("check.txt：通过", "check.txt: ok"));
