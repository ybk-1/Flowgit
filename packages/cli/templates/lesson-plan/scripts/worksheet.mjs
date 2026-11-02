// "worksheet" stage: student worksheet (no answers), answer key, and a check on minutes and objective coverage.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 40;

const objectivesDoc = JSON.parse(fs.readFileSync("objectives.json", "utf8"));
const objectives = Array.isArray(objectivesDoc.objectives) ? objectivesDoc.objectives : [];
const exercisesDoc = JSON.parse(fs.readFileSync("exercises.json", "utf8"));
const exercises = Array.isArray(exercisesDoc.exercises) ? exercisesDoc.exercises : [];
const plan = fs.readFileSync("lesson-plan.md", "utf8").replace(/\r\n/g, "\n");
const title = plan.match(/^#\s+(.+)$/m)?.[1]?.trim() || String(flowInputs.topic ?? t("练习", "Practice"));

// Steps: "## name（5 分钟）" or "## name (5 min)".
const steps = [...plan.matchAll(/^##\s+(.+?)\s*[（(]\s*(\d+(?:\.\d+)?)\s*(?:分钟|min[a-z]*)\s*[)）]\s*$/gim)].map((m) => ({ name: m[1], minutes: Number(m[2]) }));
const headings = (plan.match(/^##\s+/gm) ?? []).length;
const total = steps.reduce((sum, s) => sum + s.minutes, 0);
const ids = objectives.map((o) => String(o.id));
const taught = (id) => new RegExp(`\\b${id}\\b`).test(plan);
const notTaught = ids.filter((id) => !taught(id));
const notPracticed = ids.filter((id) => !exercises.some((e) => String(e.objective) === id));
const levelName = { basic: t("基础", "Basic"), medium: t("提高", "Medium"), challenge: t("挑战", "Challenge") };

const worksheet = [
  `# ${title}${t(" 练习单", " — worksheet")}`,
  "",
  t("姓名：__________　班级：__________　日期：__________", "Name: __________   Class: __________   Date: __________"),
  "",
  ...exercises.flatMap((e, i) => [`**${i + 1}.** ${levelName[e.level] ? `[${levelName[e.level]}] ` : ""}${e.question}`, "", t("答：", "Answer:"), "", ""]),
].join("\n");

const answerKey = [
  `# ${title}${t(" 答案", " — answer key")}`,
  "",
  ...exercises.flatMap((e, i) => [`**${i + 1}.** ${e.question}`, "", `${t("答案", "Answer")}: ${e.answer}　(${e.objective ?? "-"})`, ""]),
].join("\n");

const none = t("没有。", "None.");
const check = [
  t("# 备课检查", "# Lesson check"),
  "",
  t(`教案 ${headings} 个环节，其中 ${steps.length} 个标了分钟数，共 ${total} 分钟（课时 ${target} 分钟）${total === target ? "，对得上" : "，对不上"}。`, `${headings} steps in the plan, ${steps.length} with minutes, ${total} minutes in all (lesson is ${target})${total === target ? ", matches" : ", does not match"}.`),
  "",
  t("## 教案里没讲到的目标", "## Objectives the plan never covers"),
  notTaught.length ? notTaught.map((id) => `- ${id} ${objectives.find((o) => o.id === id)?.text ?? ""}`).join("\n") : none,
  "",
  t("## 没有练习题的目标", "## Objectives with no exercise"),
  notPracticed.length ? notPracticed.map((id) => `- ${id} ${objectives.find((o) => o.id === id)?.text ?? ""}`).join("\n") : none,
  "",
  t(`练习题 ${exercises.length} 道。`, `${exercises.length} exercises.`),
  "",
].join("\n");

fs.writeFileSync("worksheet.md", `${worksheet}\n`);
fs.writeFileSync("answer-key.md", `${answerKey}\n`);
fs.writeFileSync("check-report.md", `${check}\n`);
console.log(check);
const issues = (total === target ? 0 : 1) + notTaught.length + notPracticed.length;
console.log(issues ? t(`有 ${issues} 处要看一下，见 check-report.md。`, `${issues} things to look at; see check-report.md.`) : t("检查通过。", "All checks passed."));
