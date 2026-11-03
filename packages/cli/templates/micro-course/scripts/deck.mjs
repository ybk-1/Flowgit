#!/usr/bin/env node
// "deck" stage: three things to record from.
//
// - deck/index.html: the slides at 16:9, one assertion headline each with the
//   visual that proves it (Garner & Alley's assertion–evidence design). Arrow
//   keys or a click move between slides, N shows the narration, F goes full
//   screen, and printing gives one slide a page. A screenshot named after the
//   slide (images/s2-1.png, .jpg, .jpeg or .webp) shows up by itself; until
//   then the slide says which file to add and what it should show.
// - teleprompter.md: the narration by segment and slide, with times estimated
//   from the speaking rate in rules.md (passed on the command line so Flowgit
//   hashes that file).
// - quiz.md: the end-of-lesson quiz with answers and feedback, and the
//   questions asked after each segment.
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const rulesFile = process.argv[2] ?? "rules.md";
const deckDir = outputs[0]?.path ?? "deck/";
const teleprompterFile = outputs[1]?.path ?? "teleprompter.md";
const quizFile = outputs[2]?.path ?? "quiz.md";

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
const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);

/** Spoken length: Han characters plus runs of letters or digits in Chinese; words in English. */
const spokenUnits = (text) =>
  en ? (String(text).match(/[A-Za-z0-9'’-]+/g) ?? []).length : (String(text).match(/[㐀-鿿]|[A-Za-z0-9]+/g) ?? []).length;
const rate = Number(rules.speakingRate?.[en ? "en" : "zh"]) || (en ? 140 : 200);
const secondsOf = (text) => (spokenUnits(text) / rate) * 60;
const clock = (seconds) => {
  const s = Math.round(seconds);
  if (en) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒`;
};

const planSegments = list(plan.segments);
const segments = list(script.segments).map((seg, i) => {
  const id = str(seg?.id) || `s${i + 1}`;
  const planned = planSegments.find((p) => str(p?.id) === id) ?? planSegments[i] ?? {};
  const slides = list(seg?.slides).map((slide, k) => ({
    id: `${id}-${k + 1}`,
    kind: str(slide?.kind) || "teach",
    headline: str(slide?.headline),
    onScreen: list(slide?.onScreen).map(str).filter(Boolean),
    visual: str(slide?.visual),
    narration: str(slide?.narration),
  }));
  return { id, n: i + 1, title: str(planned.title) || id, minutes: Number(planned.minutes) || 0, slides };
});
if (!segments.length) fail(t("script.json 里没有段落", "script.json has no segments"));
const title = str(plan.title) || String(flowInputs.topic ?? "").trim();
const totalSeconds = segments.reduce((sum, seg) => sum + seg.slides.reduce((s, slide) => s + secondsOf(slide.narration), 0), 0);
const segLabel = (seg) => t(`第 ${seg.n} 段`, `Segment ${seg.n}`);
const kindLabel = {
  intro: t("开场", "Opening"),
  teach: t("讲解", "Teaching"),
  question: t("小问题", "Question"),
  recap: t("小结", "Recap"),
};

// ---- deck/index.html ----
const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const slideCount = segments.reduce((n, seg) => n + seg.slides.length, 0);
let index = 0;
const sections = segments.flatMap((seg) =>
  seg.slides.map((slide) => {
    index += 1;
    const keys = slide.onScreen.length ? `<ul class="keys">${slide.onScreen.map((k) => `<li>${html(k)}</li>`).join("")}</ul>` : "";
    const evidence = slide.visual
      ? `<div class="evidence"><img alt="${html(slide.visual)}" data-base="../images/${slide.id}" hidden><div class="placeholder"><strong>${html(
          t(`放截图：images/${slide.id}.png`, `Add a screenshot: images/${slide.id}.png`),
        )}</strong><span>${html(slide.visual)}</span></div></div>`
      : "";
    const pause = slide.kind === "question" ? `<p class="pause">${html(t("暂停一下，自己试一试", "Pause and try it yourself"))}</p>` : "";
    return [
      `<section class="slide kind-${html(slide.kind)}${slide.visual ? " has-visual" : ""}" id="${slide.id}" data-index="${index}">`,
      `<header class="meta"><span>${html(`${segLabel(seg)} · ${seg.title}`)}</span><span>${index} / ${slideCount}</span></header>`,
      pause,
      `<h1>${html(slide.headline)}</h1>`,
      evidence,
      keys,
      `<aside class="notes"><b>${html(`${slide.id} · ${kindLabel[slide.kind] ?? slide.kind} · ${clock(secondsOf(slide.narration))}`)}</b>${html(slide.narration)}</aside>`,
      "</section>",
    ]
      .filter(Boolean)
      .join("\n");
  }),
);

const page = `<!doctype html>
<html lang="${en ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<style>
:root {
  --bg: #f7f6f2; --ink: #16181d; --muted: #6b6f78; --accent: #1d4ed8; --card: #ffffff; --line: #d9d6cc;
  --question: #12305f;
  --u: min(1vw, 1.7778vh);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #0d0f13; color: var(--ink); }
body { display: grid; place-items: center; overflow: hidden; }
.slide {
  display: none; position: relative; width: calc(var(--u) * 100); height: calc(var(--u) * 56.25);
  background: var(--bg); padding: calc(var(--u) * 4.5) calc(var(--u) * 6) calc(var(--u) * 4);
  flex-direction: column; gap: calc(var(--u) * 2); overflow: hidden;
}
.slide.active { display: flex; }
.meta { display: flex; justify-content: space-between; font-size: calc(var(--u) * 1.4); color: var(--muted); letter-spacing: 0.02em; }
h1 { margin: 0; font-size: calc(var(--u) * 3.4); line-height: 1.3; font-weight: 700; max-width: 92%; text-wrap: balance; }
.evidence { flex: 1; min-height: 0; display: grid; place-items: center; }
.evidence img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: calc(var(--u) * 0.6); box-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 2) rgb(0 0 0 / 0.12); background: var(--card); }
.placeholder {
  width: 100%; height: 100%; border: calc(var(--u) * 0.2) dashed var(--line); border-radius: calc(var(--u) * 0.8);
  display: flex; flex-direction: column; justify-content: center; gap: calc(var(--u) * 1); padding: calc(var(--u) * 3);
  color: var(--muted); font-size: calc(var(--u) * 1.8); line-height: 1.5;
}
.placeholder strong { color: var(--accent); font-size: calc(var(--u) * 1.6); }
.keys { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: calc(var(--u) * 1.2); }
.keys li { background: var(--card); border: 1px solid var(--line); border-radius: calc(var(--u) * 0.6); padding: calc(var(--u) * 0.8) calc(var(--u) * 1.6); font-size: calc(var(--u) * 2.4); font-weight: 600; }
.slide:not(.has-visual) .keys { flex: 1; align-content: center; justify-content: center; }
.slide:not(.has-visual) .keys li { font-size: calc(var(--u) * 3.6); }
.kind-question { background: var(--question); color: #fff; }
.kind-question .meta { color: rgb(255 255 255 / 0.7); }
.kind-question .placeholder { color: rgb(255 255 255 / 0.75); border-color: rgb(255 255 255 / 0.35); }
.kind-question .placeholder strong { color: #9fc0ff; }
.kind-question .keys li { background: rgb(255 255 255 / 0.1); border-color: rgb(255 255 255 / 0.3); color: #fff; }
.pause { margin: 0; font-size: calc(var(--u) * 1.8); color: #9fc0ff; font-weight: 600; }
.kind-intro h1, .kind-recap h1 { font-size: calc(var(--u) * 4); }
.notes {
  display: none; position: absolute; left: 0; right: 0; bottom: 0; max-height: 45%; overflow: auto;
  background: rgb(13 15 19 / 0.92); color: #f2f2f2; font-size: calc(var(--u) * 1.6); line-height: 1.6;
  padding: calc(var(--u) * 1.6) calc(var(--u) * 6);
}
.notes b { display: block; color: #9fc0ff; font-size: calc(var(--u) * 1.2); margin-bottom: calc(var(--u) * 0.4); }
body.show-notes .notes { display: block; }
.bar { position: fixed; left: 0; bottom: 0; height: 3px; background: var(--accent); transition: width 0.2s; }
.help { position: fixed; right: 12px; bottom: 10px; font: 12px/1.4 system-ui, sans-serif; color: #8a8f99; }
@media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
@media print {
  @page { size: 13.333in 7.5in; margin: 0; }
  html, body { background: none; overflow: visible; height: auto; display: block; }
  .slide, .slide.active { display: flex; width: 13.333in; height: 7.5in; --u: 0.13333in; page-break-after: always; break-after: page; }
  .notes, .bar, .help { display: none !important; }
}
</style>
</head>
<body>
${sections.join("\n")}
<div class="bar"></div>
<div class="help">${html(t("← → 翻页 · N 讲稿 · F 全屏", "← → move · N notes · F full screen"))}</div>
<script>
const slides = [...document.querySelectorAll(".slide")];
let at = Math.max(0, slides.findIndex((s) => "#" + s.id === location.hash));
function show(i) {
  at = Math.min(Math.max(i, 0), slides.length - 1);
  slides.forEach((s, k) => s.classList.toggle("active", k === at));
  document.querySelector(".bar").style.width = ((at + 1) / slides.length) * 100 + "%";
  history.replaceState(null, "", "#" + slides[at].id);
}
document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(at + 1); }
  else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); show(at - 1); }
  else if (e.key === "Home") show(0);
  else if (e.key === "End") show(slides.length - 1);
  else if (e.key === "n" || e.key === "N") document.body.classList.toggle("show-notes");
  else if (e.key === "f" || e.key === "F") (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
});
addEventListener("hashchange", () => { const k = slides.findIndex((s) => "#" + s.id === location.hash); if (k >= 0 && k !== at) show(k); });
document.addEventListener("click", (e) => { if (!e.target.closest(".notes")) show(at + (e.clientX < innerWidth / 3 ? -1 : 1)); });
// A screenshot named after the slide replaces the placeholder: images/s2-1.png, .jpg, .jpeg or .webp.
for (const img of document.querySelectorAll("img[data-base]")) {
  const exts = ["png", "jpg", "jpeg", "webp"];
  let k = 0;
  img.onload = () => { img.hidden = false; img.nextElementSibling?.remove(); };
  img.onerror = () => { if (++k < exts.length) img.src = img.dataset.base + "." + exts[k]; };
  img.src = img.dataset.base + "." + exts[0];
}
show(at);
</script>
</body>
</html>
`;
fs.mkdirSync(deckDir, { recursive: true });
fs.writeFileSync(path.join(deckDir, "index.html"), page);

// ---- teleprompter.md ----
const tp = [
  t(`# 提词稿：${title}`, `# Teleprompter script: ${title}`),
  "",
  t(
    `一张幻灯片一段，照着念。全课约 ${clock(totalSeconds)}，按每分钟 ${rate} 字估；你说得快或慢，改 rules.md 的 speakingRate。`,
    `One paragraph per slide; read it as written. The whole lesson runs about ${clock(totalSeconds)} at ${rate} words a minute; change speakingRate in rules.md if you speak faster or slower.`,
  ),
  "",
  t(
    "一段录成一个文件，按段命名：录屏存成 recordings/s1.mp4，只录声音存成 recordings/s1.m4a。录完用转写工具导出字幕，存成 recordings/s1.srt。",
    "Record one file per segment, named by segment: a screen recording as recordings/s1.mp4, audio only as recordings/s1.m4a. Then export captions from a transcription tool as recordings/s1.srt.",
  ),
  "",
];
for (const seg of segments) {
  const seconds = seg.slides.reduce((s, slide) => s + secondsOf(slide.narration), 0);
  tp.push(
    t(
      `## ${seg.id} · ${segLabel(seg)}：${seg.title}（约 ${clock(seconds)}${seg.minutes ? `，计划 ${seg.minutes} 分钟` : ""}）`,
      `## ${seg.id} · ${segLabel(seg)}: ${seg.title} (about ${clock(seconds)}${seg.minutes ? `; planned ${seg.minutes} min` : ""})`,
    ),
    "",
  );
  for (const slide of seg.slides) {
    tp.push(t(`### 【${slide.id}】${slide.headline}`, `### [${slide.id}] ${slide.headline}`), "");
    const notes = [];
    if (slide.visual) notes.push(t(`画面：${slide.visual}`, `On screen: ${slide.visual}`));
    if (slide.onScreen.length) notes.push(t(`屏幕上的字：${slide.onScreen.join("、")}`, `Words on screen: ${slide.onScreen.join("; ")}`));
    if (slide.kind === "question") notes.push(t("问完停两秒，给学员暂停的时间。", "After the question, wait two seconds so learners can pause."));
    if (notes.length) tp.push(...notes.map((n) => `> ${n}`), "");
    tp.push(slide.narration, "");
  }
}
fs.writeFileSync(teleprompterFile, `${tp.join("\n").replace(/\n+$/, "")}\n`);

// ---- quiz.md ----
const letters = "ABCDEFGH";
const quiz = list(plan.quiz);
const objective = str(plan.objective?.text);
const qz = [
  t(`# 课后测验：${title}`, `# Quiz: ${title}`),
  "",
  t(
    `${quiz.length} 道选择题${objective ? `，考的是：${objective}` : ""}。每道只有一个正确答案。可以复制进你上架平台的测验或考试功能。`,
    `${quiz.length} multiple-choice ${quiz.length === 1 ? "question" : "questions"}${objective ? ` on the objective: ${objective}` : ""}. Each has one right answer. Paste them into your platform's quiz tool, such as a Udemy quiz.`,
  ),
  "",
];
quiz.forEach((q, i) => {
  const options = list(q?.options).map(str);
  const answer = Number.isInteger(q?.answer) ? q.answer : -1;
  const seg = segments.find((s) => s.id === str(q?.segment));
  qz.push(`## ${i + 1}. ${str(q?.question)}`, "");
  options.forEach((o, k) => qz.push(`- ${letters[k] ?? k + 1}. ${o}${k === answer ? " ✓" : ""}`));
  qz.push(
    "",
    t(
      `**答案：${letters[answer] ?? "？"}。**${str(q?.feedback)}${seg ? `（考${segLabel(seg)}）` : ""}`,
      `**Answer: ${letters[answer] ?? "?"}.** ${str(q?.feedback)}${seg ? ` (tests ${segLabel(seg).toLowerCase()})` : ""}`,
    ),
    "",
  );
});
qz.push(t("## 每段后的小问题", "## Questions after each segment"), "", t("视频里每段最后会问，答案在下一句。这里汇总一份，方便做讲义。", "Each segment's video ends with its question and then the answer. They are collected here for handouts."), "");
for (const p of planSegments) {
  const seg = segments.find((s) => s.id === str(p?.id));
  if (!seg || !str(p?.question?.prompt)) continue;
  qz.push(
    t(`- ${segLabel(seg)}：${str(p.question.prompt)}`, `- ${segLabel(seg)}: ${str(p.question.prompt)}`),
    t(`  答：${str(p.question.answer)}`, `  Answer: ${str(p.question.answer)}`),
  );
}
fs.writeFileSync(quizFile, `${qz.join("\n").replace(/\n+$/, "")}\n`);

console.log(
  t(
    `写好了 ${path.join(deckDir, "index.html").replace(/\\/g, "/")}（${slideCount} 张幻灯片）、${teleprompterFile}（约 ${clock(totalSeconds)}）和 ${quizFile}（${quiz.length} 道题）。`,
    `Wrote ${path.join(deckDir, "index.html").replace(/\\/g, "/")} (${slideCount} slides), ${teleprompterFile} (about ${clock(totalSeconds)}) and ${quizFile} (${quiz.length} questions).`,
  ),
);
