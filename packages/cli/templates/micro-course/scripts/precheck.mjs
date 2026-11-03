#!/usr/bin/env node
// "precheck" stage: before recording. Warns only; the report says what to fix and why.
//
// The numbers and word lists come from rules.md (passed on the command line so
// Flowgit hashes it); the README's "依据 / Sources" has the links.
// - Objective: an observable verb (revised Bloom's taxonomy).
// - Segments: 2 to 4, six minutes or less each, adding up to the target
//   (Guo, Kim & Rubin 2014; Brame 2016). Length is estimated from the narration.
// - A question after each segment, with a pause (Szpunar, Khan & Schacter 2013).
// - An opening that says what the learner will be able to do, and a recap.
// - Slides: a sentence headline (Garner & Alley 2013), a visual for teaching
//   slides, at most three short phrases on screen (Mayer: redundancy, coherence).
// - Narration that says "you" (Mayer: personalization).
// - Quiz: 3 to 5 questions of 3 or 4 options, one right, feedback, no "all of
//   the above", right answers not always in one place and not the longest by far
//   (Haladyna, Downing & Rodriguez 2002).
// - Statistics come from the brief; no promised results (Advertising Law art. 24);
//   nothing the brief says not to say; no placeholders.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const rulesFile = process.argv[2] ?? "rules.md";
const out = outputs[0]?.path ?? "precheck-report.md";
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 6;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n") : null);

function readJson(file) {
  const text = read(file);
  if (text == null) fail(t(`找不到 ${file}`, `${file} not found`));
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(t(`${file} 不是合法的 JSON：${err.message}`, `${file} is not valid JSON: ${err.message}`));
  }
}

let rules;
{
  const fenced = read(rulesFile)?.match(/```json\n([\s\S]*?)\n```/);
  if (!fenced) fail(t(`${rulesFile} 里没有 JSON 规则块`, `${rulesFile} has no JSON rules block`));
  try {
    rules = JSON.parse(fenced[1]);
  } catch (err) {
    fail(t(`${rulesFile} 的 JSON 不合法：${err.message}`, `The JSON in ${rulesFile} is invalid: ${err.message}`));
  }
}

const plan = readJson("plan.json");
const script = readJson("script.json");
const brief = read("materials/brief.md") ?? "";
const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);
const L = en ? "en" : "zh";

// ---- Counting (rules.md "怎么数 / How to count") ----
const spokenUnits = (text) =>
  en ? (String(text).match(/[A-Za-z0-9'’-]+/g) ?? []).length : (String(text).match(/[㐀-鿿]|[A-Za-z0-9]+/g) ?? []).length;
const wide = /[⺀-鿿　-〿＀-￯가-힯]/;
/** Chinese: a Han character or fullwidth mark is 1, anything else 0.5. English: characters. */
const width = (text) => (en ? [...String(text)].length : [...String(text)].reduce((n, ch) => n + (wide.test(ch) ? 1 : 0.5), 0));
const words = (text) => (String(text).match(/[A-Za-z0-9'’-]+/g) ?? []).length;
const rate = Number(rules.speakingRate?.[L]) || (en ? 140 : 200);
const minutesOf = (text) => spokenUnits(text) / rate;
const fmtMin = (m) => (Math.round(m * 10) / 10).toString();
const short = (s, n = 24) => {
  const chars = [...String(s)];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : chars.join("");
};
const q = (s) => t(`「${s}」`, `"${s}"`);

const planSegments = list(plan.segments);
const segments = list(script.segments).map((seg, i) => ({
  id: str(seg?.id) || `s${i + 1}`,
  n: i + 1,
  slides: list(seg?.slides).map((slide, k) => ({
    id: `${str(seg?.id) || `s${i + 1}`}-${k + 1}`,
    kind: str(slide?.kind),
    headline: str(slide?.headline),
    onScreen: list(slide?.onScreen).map(str).filter(Boolean),
    visual: str(slide?.visual),
    narration: str(slide?.narration),
  })),
}));
const segName = (id) => {
  const p = planSegments.find((s) => str(s?.id) === id);
  return p ? `${id}${t(`「${str(p.title)}」`, ` "${str(p.title)}"`)}` : id;
};
const slidesAll = segments.flatMap((s) => s.slides);
const narrationOf = (seg) => seg.slides.map((s) => s.narration).join("\n");

// ---- Objective ----
const objectiveIssues = [];
{
  const text = str(plan.objective?.text);
  const verb = str(plan.objective?.verb);
  const vagueWords = list(rules.vague).map(String);
  const isVague = (s) =>
    vagueWords.some((w) => (/^[\x00-\x7f]+$/.test(w) ? new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s) : s.includes(w)));
  if (!text) objectiveIssues.push(t("教学设计里没有学习目标。", "The plan has no learning objective."));
  else if (isVague(verb) || (!verb && isVague(text)))
    objectiveIssues.push(
      t(
        `目标的动词${q(verb || text)}看不见、没法检验。换成学员做得出来、你看得到的事，比如「做出」「算出」「找出」。`,
        `The objective's verb ${q(verb || text)} can't be seen or checked. Use something the learner does that you can see, such as "build", "calculate" or "find".`,
      ),
    );
}

// ---- Segments and length ----
const lengthIssues = [];
const seg = rules.segments ?? {};
const maxMinutes = Number(seg.maxMinutes) || 6;
{
  const n = segments.length;
  if (n < (seg.min ?? 2) || n > (seg.max ?? 4))
    lengthIssues.push(t(`讲稿有 ${n} 段，建议 ${seg.min ?? 2} 到 ${seg.max ?? 4} 段。`, `The script has ${n} segments; ${seg.min ?? 2} to ${seg.max ?? 4} is the aim.`));
  const planIds = planSegments.map((p) => str(p?.id));
  const scriptIds = segments.map((s) => s.id);
  if (planIds.join() !== scriptIds.join())
    lengthIssues.push(t(`讲稿的段（${scriptIds.join("、")}）和教学设计（${planIds.join("、")}）对不上。`, `The script's segments (${scriptIds.join(", ")}) don't match the plan's (${planIds.join(", ")}).`));
  const planned = planSegments.reduce((sum, p) => sum + (Number(p?.minutes) || 0), 0);
  if (Math.abs(planned - target) > 0.05)
    lengthIssues.push(t(`教学设计里各段的分钟数加起来是 ${fmtMin(planned)}，目标是 ${target}。`, `The plan's segment minutes add up to ${fmtMin(planned)}; the target is ${target}.`));
  if (target > maxMinutes * (seg.max ?? 4))
    lengthIssues.push(
      t(
        `目标 ${target} 分钟，超过 ${seg.max ?? 4} 段、每段 ${maxMinutes} 分钟能装下的长度，建议拆成两节课。`,
        `A target of ${target} minutes is more than ${seg.max ?? 4} segments of ${maxMinutes} minutes can hold; split it into two lessons.`,
      ),
    );
  for (const p of planSegments) {
    if ((Number(p?.minutes) || 0) > maxMinutes)
      lengthIssues.push(t(`${segName(str(p.id))}计划 ${p.minutes} 分钟，超过 ${maxMinutes} 分钟。`, `${segName(str(p.id))} is planned at ${p.minutes} minutes, over ${maxMinutes}.`));
  }
  for (const s of segments) {
    const m = minutesOf(narrationOf(s));
    if (m > maxMinutes)
      lengthIssues.push(
        t(`${segName(s.id)}按讲稿估约 ${fmtMin(m)} 分钟，超过 ${maxMinutes} 分钟：拆成两段，或者删掉不服务目标的内容。`, `${segName(s.id)} runs about ${fmtMin(m)} minutes from its narration, over ${maxMinutes}: split it, or cut what doesn't serve the objective.`),
      );
  }
  const total = segments.reduce((sum, s) => sum + minutesOf(narrationOf(s)), 0);
  const tol = Number(seg.tolerance) || 0.2;
  if (total > 0 && Math.abs(total - target) / target > tol)
    lengthIssues.push(
      t(
        `按讲稿估全课约 ${fmtMin(total)} 分钟（每分钟 ${rate} 字），目标 ${target} 分钟，差了 ${Math.round((Math.abs(total - target) / target) * 100)}%。`,
        `The narration runs about ${fmtMin(total)} minutes at ${rate} words a minute against a target of ${target}, ${Math.round((Math.abs(total - target) / target) * 100)}% off.`,
      ),
    );
}

// ---- Questions after each segment ----
const questionIssues = [];
const pauseCue = en ? /\bpause\b/i : /暂停/;
for (const s of segments) {
  const questions = s.slides.filter((slide) => slide.kind === "question");
  if (!questions.length) questionIssues.push(t(`${segName(s.id)}讲完后没有小问题。`, `${segName(s.id)} has no question at the end.`));
  else if (!questions.some((slide) => pauseCue.test(slide.narration)))
    questionIssues.push(t(`${segName(s.id)}的小问题没有请学员暂停视频，学员来不及想。`, `${segName(s.id)}'s question doesn't ask learners to pause the video, so they won't have time to think.`));
}

// ---- Opening and close ----
const shapeIssues = [];
if (slidesAll[0] && slidesAll[0].kind !== "intro")
  shapeIssues.push(t("第一张不是开场（intro）：开头要说清学完能做成什么。", "The first slide isn't the opening (intro): start by saying what the learner will be able to do."));
if (segments.length && !segments.at(-1).slides.some((slide) => slide.kind === "recap"))
  shapeIssues.push(t("最后一段没有小结和练习（recap）。", "The last segment has no recap and practice (recap)."));

// ---- Slides ----
const slideIssues = [];
const hMax = Number(rules.slides?.headlineMax?.[L]) || (en ? 80 : 28);
const hMin = Number(rules.slides?.headlineMin?.[L]) || (en ? 3 : 6);
const keysMax = Number(rules.slides?.onScreenMax) || 3;
const keyMax = Number(rules.slides?.onScreenItemMax?.[L]) || (en ? 32 : 12);
for (const slide of slidesAll) {
  const h = slide.headline;
  if (!h) slideIssues.push(t(`${slide.id} 没有标题。`, `${slide.id} has no headline.`));
  else if (width(h) > hMax)
    slideIssues.push(t(`${slide.id} 的标题${q(short(h))}约 ${Math.ceil(width(h))} 个字，超过 ${hMax}：两行放不下。`, `${slide.id}'s headline ${q(short(h, 40))} is ${width(h)} characters, over ${hMax}: more than two lines.`));
  else if ((en ? words(h) : width(h)) < hMin)
    slideIssues.push(t(`${slide.id} 的标题${q(h)}像主题词，不像一句话：写出你要学员记住的结论。`, `${slide.id}'s headline ${q(h)} reads like a topic label: state the point you want the learner to keep.`));
  if (slide.onScreen.length > keysMax)
    slideIssues.push(t(`${slide.id} 屏幕上有 ${slide.onScreen.length} 处字，最多 ${keysMax} 处：讲的话不要再印在屏幕上。`, `${slide.id} has ${slide.onScreen.length} phrases on screen, ${keysMax} at most: don't print the narration on screen too.`));
  for (const key of slide.onScreen) {
    if (width(key) > keyMax)
      slideIssues.push(t(`${slide.id} 屏幕上的${q(short(key))}太长（约 ${Math.ceil(width(key))} 个字，最多 ${keyMax}）。`, `${slide.id}'s on-screen ${q(short(key, 40))} is too long (${width(key)} characters, ${keyMax} at most).`));
  }
  if ((slide.kind === "teach" || slide.kind === "intro") && !slide.visual)
    slideIssues.push(t(`${slide.id} 是讲解，但没写画面：用截图、录屏或图来证明标题。`, `${slide.id} teaches but has no visual: prove the headline with a screenshot, recording or chart.`));
  if (!slide.narration) slideIssues.push(t(`${slide.id} 没有讲稿。`, `${slide.id} has no narration.`));
}

// ---- Speaking to the learner ----
const voiceIssues = [];
const youCue = en ? /\byou(?:r|rs|'re|'ll|'ve|rself)?\b/i : /你/;
for (const s of segments) {
  if (!youCue.test(narrationOf(s))) voiceIssues.push(t(`${segName(s.id)}的讲稿一次也没对学员说「你」。`, `${segName(s.id)}'s narration never says "you" to the learner.`));
}

// ---- Quiz ----
const quizIssues = [];
const quiz = list(plan.quiz);
const qr = rules.quiz ?? {};
if (quiz.length < (qr.min ?? 3) || quiz.length > (qr.max ?? 5))
  quizIssues.push(t(`测验有 ${quiz.length} 道题，建议 ${qr.min ?? 3} 到 ${qr.max ?? 5} 道。`, `The quiz has ${quiz.length} questions; ${qr.min ?? 3} to ${qr.max ?? 5} is the aim.`));
const lower = (s) => String(s).toLowerCase();
quiz.forEach((item, i) => {
  const label = t(`第 ${i + 1} 题`, `Question ${i + 1}`);
  const options = list(item?.options).map(str);
  const answer = item?.answer;
  if (options.length < (qr.optionsMin ?? 3) || options.length > (qr.optionsMax ?? 4))
    quizIssues.push(t(`${label}有 ${options.length} 个选项，建议 ${qr.optionsMin ?? 3} 到 ${qr.optionsMax ?? 4} 个。`, `${label} has ${options.length} options; ${qr.optionsMin ?? 3} or ${qr.optionsMax ?? 4} is the aim.`));
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length)
    quizIssues.push(t(`${label}的答案序号 ${answer} 不在选项里。`, `${label}'s answer index ${answer} isn't one of its options.`));
  if (new Set(options.map(lower)).size < options.length) quizIssues.push(t(`${label}有重复的选项。`, `${label} repeats an option.`));
  for (const o of options) {
    if (list(qr.avoid).some((w) => lower(o).includes(lower(w))))
      quizIssues.push(t(`${label}用了${q(o)}：学员只要认出两个对的就能猜中，换成一个具体的错误。`, `${label} uses ${q(o)}: spotting two right options is enough to guess it; use a specific mistake instead.`));
    else if (list(qr.careful).some((w) => lower(o).includes(lower(w))))
      quizIssues.push(t(`${label}用了${q(o)}：只能确认学员知道哪些错，确认不了他会做，慎用。`, `${label} uses ${q(o)}: it only shows the learner knows what's wrong, not what's right; use it with care.`));
  }
  if (Number.isInteger(answer) && options[answer] && options.length > 1) {
    const others = options.filter((_, k) => k !== answer).map(width);
    if (width(options[answer]) > 1.5 * Math.max(...others))
      quizIssues.push(t(`${label}的正确选项比别的长很多，学员会靠长度猜。`, `${label}'s right option is much longer than the others; learners will guess by length.`));
  }
  if (!str(item?.feedback)) quizIssues.push(t(`${label}没有解释。`, `${label} has no feedback.`));
  if (!segments.some((s) => s.id === str(item?.segment)))
    quizIssues.push(t(`${label}考的段${q(str(item?.segment))}不在讲稿里。`, `${label} tests segment ${q(str(item?.segment))}, which isn't in the script.`));
});
if (quiz.length >= 3 && new Set(quiz.map((item) => item?.answer)).size === 1)
  quizIssues.push(t("每道题的正确答案都在同一个位置。", "Every right answer is in the same position."));

// ---- Statistics not in the brief ----
const allText = [
  str(plan.title),
  str(plan.objective?.text),
  str(plan.hook),
  str(plan.practice),
  ...list(plan.recap).map(str),
  ...slidesAll.flatMap((s) => [s.headline, ...s.onScreen, s.narration]),
].join("\n");
const statPattern = en
  ? /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b|per cent\b|times\b|x\b|million\b|billion\b|people\b|users\b|students\b|learners\b|customers\b)/gi
  : /(\d[\d,]*(?:\.\d+)?)\s*(?:%|％|倍|万|亿|成(?=的|用户|学员|人)|(?:个|位|名)?(?:人|用户|学员|同学))/g;
const briefDigits = new Set((brief.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((d) => d.replace(/,/g, "")));
const unknownStats = [...new Set([...allText.matchAll(statPattern)].filter((m) => !briefDigits.has(m[1].replace(/,/g, ""))).map((m) => m[0].trim()))];

// ---- Promised results (Advertising Law art. 24) ----
const lowerAll = allText.toLowerCase();
// A word counts unless it is negated just before ("不保证", "no guarantee", "we don't promise").
const negated = (text, at) =>
  /(?:不|没有|没|无|绝不|并非|无法|不能)(?:对[^，。；！？,.;!?\n]{1,8})?(?:作|做|提供|给)?出?(?:任何)?\s*$/.test(text.slice(Math.max(0, at - 16), at)) ||
  /\b(?:no|not|never|don't|doesn't|won't|cannot|can't|without)\s+(?:\w+\s+)?$/i.test(text.slice(Math.max(0, at - 24), at));
const promiseHits = list(rules.promises).filter((w) => {
  const word = String(w).toLowerCase();
  for (let at = lowerAll.indexOf(word); at >= 0; at = lowerAll.indexOf(word, at + 1)) if (!negated(lowerAll, at)) return true;
  return false;
});

// ---- Do not say (the brief's own list) ----
const dontSection = brief.split(/^##\s+/m).find((part) => /不要说的话|do not say|don't say/i.test(part.split("\n")[0])) ?? "";
const dontPhrases = [...dontSection.matchAll(/「([^」]{2,})」|“([^”]{2,})”|"([^"]{2,})"/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
const dontHits = dontPhrases.filter((p) => lowerAll.includes(p.toLowerCase()));

// ---- Placeholders ----
const placeholderHits = list(rules.placeholders).filter((p) => allText.includes(p));

// ---- Report ----
const none = t("没有。", "None.");
const listOf = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 学习目标（修订版布鲁姆分类）", "## Objective (revised Bloom's taxonomy)"), objectiveIssues],
  [t("## 分段和时长（Guo 等 2014；Brame 2016）", "## Segments and length (Guo et al. 2014; Brame 2016)"), lengthIssues],
  [t("## 每段后的小问题（Szpunar 等 2013）", "## A question after each segment (Szpunar et al. 2013)"), questionIssues],
  [t("## 开头和收尾", "## Opening and close"), shapeIssues],
  [t("## 幻灯片（Garner 和 Alley 2013；Mayer）", "## Slides (Garner & Alley 2013; Mayer)"), slideIssues],
  [t("## 对着学员说（Mayer 的个性化原则）", "## Speaking to the learner (Mayer's personalization principle)"), voiceIssues],
  [t("## 测验（Haladyna 等 2002）", "## Quiz (Haladyna et al. 2002)"), quizIssues],
  [t("## 资料里找不到的统计数字（核实后再讲）", "## Statistics not in the brief (check them before recording)"), unknownStats.map((s) => q(s))],
  [t("## 效果承诺（《广告法》第二十四条）", "## Promised results (China's Advertising Law art. 24)"), promiseHits.map((s) => q(s))],
  [t("## 资料里说不要说的话", "## Things the brief says not to say"), dontHits.map((s) => q(s))],
  [t("## 占位符", "## Placeholders"), placeholderHits.map((s) => q(s))],
];

const fmtClock = (minutes) => {
  const s = Math.round(minutes * 60);
  if (en) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒`;
};
const table = [
  t("| 段 | 计划 | 按讲稿估 | 幻灯片 |", "| Segment | Planned | From the narration | Slides |"),
  "| --- | --- | --- | --- |",
  ...segments.map((s) => {
    const p = planSegments.find((x) => str(x?.id) === s.id);
    return `| ${segName(s.id)} | ${p ? t(`${p.minutes} 分钟`, `${p.minutes} min`) : "—"} | ${fmtClock(minutesOf(narrationOf(s)))} | ${s.slides.length} |`;
  }),
];
const totalMinutes = segments.reduce((sum, s) => sum + minutesOf(narrationOf(s)), 0);
const lines = [
  t("# 录前检查", "# Pre-record check"),
  "",
  t(
    `目标 ${target} 分钟，按讲稿估约 ${fmtClock(totalMinutes)}（每分钟 ${rate} 字）。测验 ${quiz.length} 道。`,
    `Target ${target} minutes; the narration runs about ${fmtClock(totalMinutes)} at ${rate} words a minute. ${quiz.length} quiz ${quiz.length === 1 ? "question" : "questions"}.`,
  ),
  "",
  ...table,
  "",
  ...sections.flatMap(([heading, items]) => [heading, listOf(items), ""]),
  t("这些检查只做提醒，不能代替你对内容的判断和平台的审核。", "These checks are reminders only; they don't replace your judgment or the platform's review."),
  "",
];
fs.writeFileSync(out, `${lines.join("\n")}\n`);
const issues = sections.reduce((n, [, items]) => n + items.length, 0);
console.log(
  issues
    ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`)
    : t(`检查通过，见 ${out}。`, `All checks passed; see ${out}.`),
);
