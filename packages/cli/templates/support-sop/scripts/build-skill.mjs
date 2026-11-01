// 技能阶段：把 sop.md 收成 skill/SKILL.md，并把 cases.json 复制为评测集。
// Skill stage: package sop.md as skill/SKILL.md, and copy cases.json as the eval set.
//
// SKILL.md 用 Skill 的 frontmatter：name、description，正文就是规程本身。
// SKILL.md uses skill frontmatter: name, description, and the SOP as the body.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const inputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const lang = inputs.language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const SKILL_NAME = "support-sop";

function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const sopPath = path.join(dir, "sop.md");
const casesPath = path.join(dir, "cases.json");
if (!fs.existsSync(sopPath)) {
  console.error(say("找不到 sop.md", "sop.md not found"));
  process.exit(1);
}
if (!fs.existsSync(casesPath)) {
  console.error(say("找不到 cases.json", "cases.json not found"));
  process.exit(1);
}

const sop = fs.readFileSync(sopPath, "utf8").trim();
if (!sop) {
  console.error(say("sop.md 是空的", "sop.md is empty"));
  process.exit(1);
}

let cases;
try {
  cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
} catch (err) {
  console.error(say(`cases.json 不是合法的 JSON：${err.message}`, `cases.json is not valid JSON: ${err.message}`));
  process.exit(1);
}
const bad =
  !Array.isArray(cases) ||
  cases.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    return ["customer", "intent", "expected"].some((key) => typeof item[key] !== "string" || !item[key].trim());
  });
if (bad) {
  console.error(
    say(
      "cases.json 必须是数组，每一项都要有非空字符串 customer、intent、expected",
      "cases.json must be an array, and each item needs non-empty string fields customer, intent and expected",
    ),
  );
  process.exit(1);
}

const product = oneLine(inputs.product) || say("这个产品", "this product");
const tone = oneLine(inputs.tone);
const description = say(
  `按「${product}」的客服 SOP 回复${tone ? `（语气：${tone}）` : ""}：判断意图、按步骤处理，该转人工时交给人，不说禁止的话。`,
  `Reply to customers about "${product}" using the support SOP${tone ? ` (tone: ${tone})` : ""}. Classify the intent, follow the handling steps, hand off to a human when the SOP says to, and never say what it forbids.`,
);

const skill = [
  "---",
  `name: ${SKILL_NAME}`,
  `description: ${JSON.stringify(description)}`,
  "---",
  "",
  sop,
  "",
].join("\n");

const skillDir = path.join(dir, "skill");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, "SKILL.md"), skill.endsWith("\n") ? skill : `${skill}\n`);
fs.writeFileSync(path.join(skillDir, "cases.json"), `${JSON.stringify(cases, null, 2)}\n`);
console.log(say(`skill/SKILL.md：已写入客服技能（${cases.length} 条用例）`, `skill/SKILL.md: wrote the support skill (${cases.length} cases)`));
