// "check" stage. Warns only; the report says what to fix and why.
//
// What it checks and where the rules come from (see README "参考资料 / References"):
// - Alignment (ADDIE): every outcome is taught in some lesson, and every lesson has practice.
// - Checkable outcomes: observable verbs, not "understand" or "master" (revised Bloom's taxonomy).
// - Segment length: in Guo, Kim and Rubin's 2014 study of edX videos, engagement peaked at about six minutes
//   and fell steeply after nine.
// - The course page (China's Advertising Law art. 24 on education and training ads; price-fraud rules art. 19):
//   no guaranteed results or income, no learner testimonials, no unfounded price comparisons or urgency,
//   no anxiety marketing.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const wantLessons = Number(flowInputs.lessons) > 0 ? Number(flowInputs.lessons) : 0;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
const json = (file) => JSON.parse(read(file) || "{}");
const analysis = json("analysis.json");
const outcomes = Array.isArray(analysis.outcomes) ? analysis.outcomes : [];
const lessons = Array.isArray(json("outline.json").lessons) ? json("outline.json").lessons : [];
const trial = read("lesson-1.md");
const page = read("course-page.md");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const label = (l) => t(`第 ${l.n} 节`, `Lesson ${l.n}`);

const taught = new Set(lessons.flatMap((l) => (Array.isArray(l.outcomes) ? l.outcomes.map(String) : [])));
const untaught = outcomes.filter((o) => !taught.has(String(o.id))).map((o) => `${o.id} ${o.text ?? ""}`.trim());
const noPractice = lessons.filter((l) => !String(l.practice ?? "").trim()).map(label);
const segments = lessons.flatMap((l) => (Array.isArray(l.segments) ? l.segments.map((s) => ({ lesson: l, ...s })) : []));
const long = segments.filter((s) => num(s.minutes) > 6).map((s) => `${label(s.lesson)}${t(`「${s.title}」`, ` "${s.title}": `)}${num(s.minutes)}${t(" 分钟", " min")}${num(s.minutes) > 9 ? t("（超过 9 分钟，大多数人看不完）", " (over nine; most viewers drop off)") : ""}`);
const totalMinutes = segments.reduce((sum, s) => sum + num(s.minutes), 0);
const vague = /理解|了解|掌握|熟悉|知道|体会|\bunderstand\b|\bknow\b|\bmaster\b|\blearn about\b|\bbe familiar\b|\bappreciate\b/i;
const vagueOutcomes = outcomes.filter((o) => vague.test(String(o.verb ?? "")) || (!o.verb && vague.test(String(o.text ?? "")))).map((o) => `${o.id} ${o.text ?? ""}`.trim());
const higher = outcomes.filter((o) => ["apply", "analyze", "evaluate", "create"].includes(String(o.level))).length;

// The trial lesson: segments from the outline, a practice and a recap.
const trialHeadings = [...trial.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
const trialNotes = [];
if (!trialHeadings.some((h) => /练习|practice/i.test(h))) trialNotes.push(t("试听课没有练习。", "The trial lesson has no practice."));
if (!trialHeadings.some((h) => /小结|总结|recap|summary/i.test(h))) trialNotes.push(t("试听课没有小结。", "The trial lesson has no recap."));
const firstSegments = Array.isArray(lessons[0]?.segments) ? lessons[0].segments : [];
const size = (s) => (en ? (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length : (s.match(/[一-鿿]/g) ?? []).length);
const perMinute = en ? 140 : 200;
const parts = trial.split(/^(?=##\s)/m).filter((p) => /^##\s/.test(p));
for (const p of parts) {
  const m = p.match(/^##\s+.+?[（(]\s*(\d+(?:\.\d+)?)\s*(?:分钟|min[a-z]*)\s*[)）]/i);
  if (!m) continue;
  const minutes = Number(m[1]);
  const spoken = size(p.replace(/^##.*$/m, "").replace(/【[^】]*】|\[(?:Screen|画面)[^\]]*\]/gi, ""));
  const ratio = spoken / (minutes * perMinute);
  // Only flag scripts that run long: a short script is fine when the screen shows a demo while you work.
  if (ratio > 1.5) trialNotes.push(t(`「${p.split("\n")[0].replace(/^##\s+/, "")}」写了约 ${spoken} 字，按每分钟 ${perMinute} 字要讲 ${Math.round(spoken / perMinute)} 分钟，比标的 ${minutes} 分钟长很多。`, `"${p.split("\n")[0].replace(/^##\s+/, "")}" has about ${spoken} words, about ${Math.round(spoken / perMinute)} minutes at ${perMinute} a minute, well over the stated ${minutes}.`));
}
// Practice and recap may carry a time too; only the teaching segments have to match the syllabus.
const timedSegments = parts.filter((p) => {
  const heading = p.split("\n")[0];
  return /[（(]\s*\d/.test(heading) && !/练习|小结|总结|practice|recap|summary/i.test(heading);
});
if (firstSegments.length && timedSegments.length !== firstSegments.length) trialNotes.push(t(`大纲第 1 节有 ${firstSegments.length} 段，逐字稿里带时长的段落数对不上。`, `The syllabus gives lesson 1 ${firstSegments.length} segments; the script's timed sections don't match.`));

// The course page.
const lower = page.toLowerCase();
// A word counts unless it is negated just before ("不保证", "不对结果作任何保证", "no guarantee", "we don't promise").
const negated = (text, at) =>
  /(?:不|没有|没|无|绝不|并非|无法|不能)(?:对[^，。；！？,.;!?\n]{1,8})?(?:作|做|提供|给)?出?(?:任何)?\s*$/.test(text.slice(Math.max(0, at - 16), at)) || /\b(?:no|not|never|don't|doesn't|won't|cannot|can't|without)\s+(?:\w+\s+)?$/i.test(text.slice(Math.max(0, at - 24), at));
const hits = (words) =>
  words.filter((w) => {
    const word = w.toLowerCase();
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) if (!negated(lower, at)) return true;
    return false;
  });
const guarantees = ["保过", "包过", "必过", "稳过", "一次通过", "一次性通过", "保证", "包会", "包学会", "包就业", "保就业", "就业有保障", "速成", "天学会", "月入", "年入", "躺赚", "稳赚", "副业收入", "guaranteed", "guarantee", "pass for sure", "learn it in", "earn $", "passive income", "six figures"];
const testimonials = ["学员说", "学员反馈", "学员评价", "学员证言", "真实案例", "学员案例", "好评率", "人已学", "testimonial", "students say", "what our students", "rated"];
const pricing = ["原价", "划线价", "限时", "仅剩", "名额有限", "涨价", "早鸟", "original price", "was ¥", "was $", "limited time", "only a few seats", "price goes up"];
const anxiety = ["被淘汰", "落后", "焦虑", "来不及", "错过", "left behind", "fall behind", "too late", "obsolete"];
const sectionsPage = [
  [/适合谁|who it is for/i, t("适合谁", "Who it is for")],
  [/不适合|not for/i, t("不适合谁", "Who it is not for")],
  [/价格|退款|price|refund/i, t("价格和退款", "Price and refunds")],
];
const pageHeadings = [...page.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
const missingPage = sectionsPage.filter(([re]) => !pageHeadings.some((h) => re.test(h))).map(([, name]) => name);

const none = t("没有。", "None.");
const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 没有课讲到的学习成果", "## Outcomes no lesson teaches"), untaught],
  [t("## 没有练习的课", "## Lessons with no practice"), noPractice],
  [t("## 超过 6 分钟的视频段", "## Segments over six minutes"), long],
  [t("## 看不见的成果动词（了解、掌握……）", "## Outcome verbs you can't observe (know, understand…)"), vagueOutcomes],
  [t("## 试听课", "## Trial lesson"), trialNotes],
  [t("## 介绍页缺的部分", "## Missing course-page parts"), missingPage],
  [t("## 效果和收入承诺（《广告法》第二十四条）", "## Promised results or income (Advertising Law art. 24)"), hits(guarantees)],
  [t("## 学员证言和人数（不得用受益者名义作证明，也不能编）", "## Testimonials and learner counts (no endorsements by learners; never invented)"), hits(testimonials)],
  [t("## 价格比较和紧迫感（要有真实依据）", "## Price comparisons and urgency (need a real basis)"), hits(pricing)],
  [t("## 制造焦虑", "## Anxiety marketing"), hits(anxiety)],
];
const report = [
  t("# 课程检查", "# Course check"),
  "",
  t(`学习成果 ${outcomes.length} 个（应用及以上 ${higher} 个），课 ${lessons.length} 节${wantLessons && lessons.length !== wantLessons ? `（要的是 ${wantLessons} 节）` : ""}，视频 ${segments.length} 段共 ${totalMinutes} 分钟。`, `${outcomes.length} outcomes (${higher} at apply or above), ${lessons.length} lessons${wantLessons && lessons.length !== wantLessons ? ` (${wantLessons} wanted)` : ""}, ${segments.length} segments, ${totalMinutes} minutes of video.`),
  higher * 2 < outcomes.length ? t("⚠️ 应用及以上层级的成果不到一半，学员学完可能只是“知道”，不会“做”。", "⚠️ Fewer than half the outcomes are at apply or above; learners may know but not be able to do.") : "",
  "",
  ...sections.flatMap(([heading, xs]) => [heading, list(xs), ""]),
  t("命中的词不一定违规（比如“保证金”），但都要人看一眼。这些检查不能代替平台审核和法律意见。", "A hit is not always a breach (\"deposit\" is fine), but a person should look at each. These checks do not replace platform review or legal advice."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${report.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n")}\n`);
console.log(report.join("\n"));
const issues = sections.reduce((n, [, xs]) => n + xs.length, 0) + (higher * 2 < outcomes.length ? 1 : 0) + (wantLessons && lessons.length !== wantLessons ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
