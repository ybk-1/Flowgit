// "worksheet" stage: student worksheet (no answers), answer key, and a check report.
//
// What the check looks for and why (see README "参考资料 / References"):
// - Alignment (backward design, "teaching-learning-assessment" consistency): every objective is taught in some step,
//   has an assessment task that some step uses, and has at least one exercise.
// - Checkable objectives: observable verbs, not "understand" or "master" (revised Bloom's taxonomy).
// - Timing: the steps add up to the lesson length.
// - Homework load (China's 2021 double-reduction opinion): none written for grades 1-2; across all subjects at most
//   60 minutes a day for grades 3-6 and 90 for junior high.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 40;
const grade = String(flowInputs.grade ?? "");

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const objectivesDoc = readJson("objectives.json");
const objectives = Array.isArray(objectivesDoc.objectives) ? objectivesDoc.objectives : [];
const tasks = Array.isArray(readJson("assessment.json").tasks) ? readJson("assessment.json").tasks : [];
const exercises = Array.isArray(readJson("exercises.json").exercises) ? readJson("exercises.json").exercises : [];
const plan = fs.readFileSync("lesson-plan.md", "utf8").replace(/\r\n/g, "\n");
const title = plan.match(/^#\s+(.+)$/m)?.[1]?.trim() || String(flowInputs.topic ?? t("练习", "Practice"));

// Steps: "## name（5 分钟）" or "## name (5 min)".
const steps = [...plan.matchAll(/^##\s+(.+?)\s*[（(]\s*(\d+(?:\.\d+)?)\s*(?:分钟|min[a-z]*)\s*[)）]\s*$/gim)].map((m) => ({ name: m[1], minutes: Number(m[2]) }));
const total = steps.reduce((sum, s) => sum + s.minutes, 0);
const stepBodies = plan.split(/^(?=##\s)/m).filter((part) => /^##\s.+?[（(]\s*\d/.test(part));
const mentions = (id) => new RegExp(`\\b${id}\\b`);
const notTaught = objectives.filter((o) => !stepBodies.some((body) => mentions(o.id).test(body)));
const noTask = objectives.filter((o) => !tasks.some((a) => String(a.objective) === String(o.id)));
const unusedTasks = tasks.filter((a) => !stepBodies.some((body) => mentions(a.id).test(body)));
const notPracticed = objectives.filter((o) => !exercises.some((e) => String(e.objective) === String(o.id)));
const vague = /理解|了解|体会|感受|掌握|知道|熟悉|\bunderstand\b|\bknow\b|\bappreciate\b|\bmaster\b|\blearn about\b|\bbe aware\b/i;
const vagueObjectives = objectives.filter((o) => vague.test(String(o.verb ?? "")) || (!o.verb && vague.test(String(o.text ?? ""))));
const levels = objectives.map((o) => String(o.level ?? ""));
const higherOrder = levels.some((l) => ["apply", "analyze", "evaluate", "create"].includes(l));
const hasBoard = /^##\s*(板书|board)/im.test(plan);
const hasHomework = /^##\s*(作业|homework)/im.test(plan);

// Grade band from the grade text.
const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const primaryGrade = (() => {
  const m = grade.match(/(?:小学)?([一二三四五六])年级/) ?? grade.match(/grade\s*(\d)/i);
  if (!m) return 0;
  return cn[m[1]] ?? Number(m[1]);
})();
const juniorHigh = /初[一二三]|初中|七年级|八年级|九年级|grade\s*[789]/i.test(grade);
const homework = exercises.filter((e) => e.use === "homework");
const homeworkMinutes = homework.reduce((sum, e) => sum + (Number(e.minutes) || 0), 0);
let homeworkNote;
if (primaryGrade === 1 || primaryGrade === 2) {
  homeworkNote = homework.length
    ? t(`⚠️ 小学一、二年级不布置家庭书面作业，但有 ${homework.length} 道作业题。`, `⚠️ Grades 1 and 2 get no written homework, but ${homework.length} exercises are homework.`)
    : t("小学一、二年级，没有布置家庭书面作业。", "Grades 1 and 2: no written homework, as required.");
} else {
  const cap = juniorHigh ? 90 : primaryGrade ? 60 : 0;
  homeworkNote = t(
    `课后作业 ${homework.length} 道，预计 ${homeworkMinutes} 分钟。${cap ? `这个学段所有科目的书面作业每天平均不超过 ${cap} 分钟，这一科只占其中一部分。` : ""}`,
    `${homework.length} homework exercises, about ${homeworkMinutes} minutes.${cap ? ` Written homework across all subjects averages at most ${cap} minutes a day at this level; this subject gets a share.` : ""}`,
  );
}
const levelName = { basic: t("基础", "Basic"), medium: t("提高", "Medium"), challenge: t("挑战", "Challenge") };

const classItems = exercises.filter((e) => e.use !== "homework");
const parts = [
  [classItems, t("课堂练习", "In class")],
  [homework, t("课后作业", "Homework")],
].filter(([list]) => list.length);
const worksheet = [
  `# ${title}${t(" 练习单", " — worksheet")}`,
  "",
  t("姓名：__________　班级：__________　日期：__________", "Name: __________   Class: __________   Date: __________"),
  "",
  ...parts.flatMap(([list, heading]) => [
    `## ${heading}`,
    "",
    ...list.flatMap((e, i) => [`**${i + 1}.** ${levelName[e.level] ? `[${levelName[e.level]}] ` : ""}${e.question}`, "", t("答：", "Answer:"), "", ""]),
  ]),
].join("\n");

const answerKey = [
  `# ${title}${t(" 答案", " — answer key")}`,
  "",
  ...parts.flatMap(([list, heading]) => [
    `## ${heading}`,
    "",
    ...list.flatMap((e, i) => [`**${i + 1}.** ${e.question}`, "", `${t("答案", "Answer")}: ${e.answer}　(${e.objective ?? "-"})`, ""]),
  ]),
].join("\n");

const none = t("没有。", "None.");
const objList = (items) => (items.length ? items.map((o) => `- ${o.id} ${o.text ?? ""}`).join("\n") : none);
const check = [
  t("# 备课检查", "# Lesson check"),
  "",
  t(`教案 ${steps.length} 个标了分钟数的环节，共 ${total} 分钟（课时 ${target} 分钟）${total === target ? "，对得上" : "，对不上"}。`, `${steps.length} timed steps, ${total} minutes in all (lesson is ${target})${total === target ? ", matches" : ", does not match"}.`),
  t(`目标的认知层级：${levels.join("、") || "没写"}${higherOrder ? "" : "。⚠️ 没有应用及以上层级的目标"}。`, `Objective levels: ${levels.join(", ") || "none given"}${higherOrder ? "" : ". ⚠️ No objective at apply level or above"}.`),
  hasBoard ? t("有板书设计。", "Board plan included.") : t("⚠️ 没有板书设计。", "⚠️ No board plan."),
  hasHomework ? t("有作业设计。", "Homework design included.") : t("⚠️ 没有作业设计。", "⚠️ No homework design."),
  homeworkNote,
  "",
  t("## 用了看不见的动词的目标（理解、掌握……）", "## Objectives with unobservable verbs (understand, master…)"),
  objList(vagueObjectives),
  "",
  t("## 教案里没讲到的目标", "## Objectives the plan never covers"),
  objList(notTaught),
  "",
  t("## 没有评价任务的目标", "## Objectives with no assessment task"),
  objList(noTask),
  "",
  t("## 教案里没用上的评价任务", "## Assessment tasks no step uses"),
  unusedTasks.length ? unusedTasks.map((a) => `- ${a.id} ${a.task ?? ""}`).join("\n") : none,
  "",
  t("## 没有练习题的目标", "## Objectives with no exercise"),
  objList(notPracticed),
  "",
  t(`练习题 ${exercises.length} 道：课堂 ${classItems.length} 道，作业 ${homework.length} 道。模型出的题和答案请老师自己核对一遍。`, `${exercises.length} exercises: ${classItems.length} in class, ${homework.length} homework. Check the model's questions and answers yourself.`),
  "",
].join("\n");

fs.writeFileSync("worksheet.md", `${worksheet}\n`);
fs.writeFileSync("answer-key.md", `${answerKey}\n`);
fs.writeFileSync("check-report.md", `${check}\n`);
console.log(check);
const issues =
  (total === target ? 0 : 1) + (higherOrder ? 0 : 1) + (hasBoard ? 0 : 1) + (hasHomework ? 0 : 1) + (homeworkNote.startsWith("⚠️") ? 1 : 0) +
  vagueObjectives.length + notTaught.length + noTask.length + unusedTasks.length + notPracticed.length;
console.log(issues ? t(`有 ${issues} 处要看一下，见 check-report.md。`, `${issues} things to look at; see check-report.md.`) : t("检查通过。", "All checks passed."));
