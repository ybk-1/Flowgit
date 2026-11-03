#!/usr/bin/env node
// "precheck" stage: check the story and the pagination before anyone draws.
// Warnings only; it stops only when storyboard.json is missing or malformed.
//
// - Units match the layout: a picture book's spreads run 4–5 … to the
//   second-to-last page, then the last page alone; a comic has every page.
// - Page count: picture books print in 8-page signatures (24, 32, 40, 48),
//   and a KDP paperback has at least 24 pages.
// - Word count: most picture book texts run 500 to 600 words, and editors
//   shy away near 1,000 (Writer's Digest); SCBWI's critique events take up
//   to 800. Chinese is held to 1000 characters, the template's own
//   conversion (about 1.6 characters to an English word).
// - Art notes that repeat the words: notes are for what the words can't say
//   (Underdown).
// - Page-turn hooks: every turn counts in a picture book (Writer's Digest);
//   in a comic, a turn follows every odd page.
// - Image descriptions: one for every image, at most 140 characters (KDP).
// - Lines that preach, and a problem solved by anyone but the main
//   character (Mary Kole; SCBWI's critique checklist).
// - The refrain comes back two to five times (Writer's Digest suggests about
//   three).
// - Comic balloons: at most about 25 words a balloon and 50 a panel (Dark
//   Horse's script guide); 40 and 80 characters in Chinese, the template's
//   conversion; every speaker is a character in the story.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const comic = flowInputs.format === "comic";
const pages = Number(flowInputs.pages ?? 32);

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
const story = readJson("story.json") ?? {};
const board = readJson("storyboard.json");
if (!board || !Array.isArray(board.units)) {
  console.error("storyboard.json 不存在或缺少 units / storyboard.json is missing or has no units");
  process.exit(1);
}
const units = board.units.filter((u) => u && typeof u === "object");

const pagesLabel = (p) => (Array.isArray(p) ? (p.length === 2 ? t(`第 ${p[0]}–${p[1]} 页`, `pages ${p[0]}–${p[1]}`) : t(`第 ${p[0]} 页`, `page ${p[0]}`)) : "?");
const key = (p) => (Array.isArray(p) ? p.join("-") : "");
const zhChars = (text) => (String(text ?? "").match(/[㐀-鿿]/g) ?? []).length;
const enWords = (text) => (String(text ?? "").match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;
const count = (text) => (en ? enWords(text) : zhChars(text));
const chars = (text) => [...String(text ?? "").trim()].length;
const fmtList = (items) => (en ? items.join(", ") : items.join("、"));

// The layout this format and page count should have.
const expected = [];
if (comic) for (let n = 1; n <= pages; n++) expected.push([n]);
else {
  for (let n = 4; n + 1 < pages; n += 2) expected.push([n, n + 1]);
  if (pages >= 8) expected.push([pages]);
}
const layoutIssues = [];
if ((board.format ?? "picture-book") !== (comic ? "comic" : "picture-book")) {
  layoutIssues.push(t(`storyboard.json 的 format 是 ${board.format}，输入的形式是 ${comic ? "comic" : "picture-book"}`, `storyboard.json says ${board.format}, but the format input is ${comic ? "comic" : "picture-book"}`));
}
const got = units.map((u) => key(u.pages));
const want = expected.map(key);
const missing = expected.filter((p) => !got.includes(key(p))).map(pagesLabel);
const extra = units.filter((u) => !want.includes(key(u.pages))).map((u) => pagesLabel(u.pages));
if (missing.length) layoutIssues.push(t(`版式里有、分页里没有：${fmtList(missing)}`, `In the layout but not the pagination: ${fmtList(missing)}`));
if (extra.length) layoutIssues.push(t(`分页里多出来的：${fmtList(extra)}`, `In the pagination but not the layout: ${fmtList(extra)}`));
if (!missing.length && !extra.length && got.join(",") !== want.join(",")) layoutIssues.push(t("单元的顺序和版式不一样", "The units are not in the layout's order"));
const duplicates = got.filter((k, i) => got.indexOf(k) !== i);
if (duplicates.length) layoutIssues.push(t(`重复的单元：${fmtList([...new Set(duplicates)])}`, `Repeated units: ${fmtList([...new Set(duplicates)])}`));

const pageIssues = [];
if (!comic && pages % 8) pageIssues.push(t(`${pages} 页不是 8 的倍数：绘本按 8 页一帖印，常见 24、32、40、48 页`, `${pages} pages is not a multiple of 8: picture books print in 8-page signatures, usually 24, 32, 40 or 48 pages`));
if (pages < 24) pageIssues.push(t(`${pages} 页：单独印成 KDP 平装书最少要 24 页`, `${pages} pages: a KDP paperback on its own needs at least 24`));

// Words.
const bookText = comic ? units.flatMap((u) => (u.panels ?? []).flatMap((p) => (p.lines ?? []).map((l) => l.text ?? ""))).join("\n") : units.map((u) => u.text ?? "").join("\n");
const total = count(bookText);
const wordIssues = [];
const limit = en ? 600 : 1000;
if (!comic && total > limit) {
  wordIssues.push(
    t(
      `全书 ${total} 字，超过 1000 字（英文绘本多在 500 到 600 词，接近 1000 词时编辑会犹豫；中文按约 1.6 字一词折算）`,
      `${total} words in all, over 600 (most picture books run 500 to 600 words, and editors shy away near 1,000)`,
    ),
  );
}
if (!comic && units.length && units.every((u) => !String(u.text ?? "").trim())) wordIssues.push(t("所有跨页都没有字", "No spread has any words"));

// Art notes that repeat the words.
const stop = new Set("about after again also back been before came come could down each even ever every from going have here into just like long look looked looks made make more much must next once only onto other over said says some still than that their them then there they this through time took very want went were what when where which while will with would your".split(" "));
function tokens(text) {
  if (en) return new Set((String(text ?? "").toLowerCase().match(/[a-z][a-z'’-]{3,}/g) ?? []).filter((w) => !stop.has(w)));
  const cjk = String(text ?? "").replace(/[^㐀-鿿]/g, "");
  const grams = new Set();
  for (let i = 0; i + 1 < cjk.length; i++) grams.add(cjk.slice(i, i + 2));
  return grams;
}
const repeats = comic
  ? []
  : units
      .filter((u) => {
        const art = tokens(u.art);
        const words = tokens(u.text);
        if (art.size < (en ? 5 : 8) || !words.size) return false;
        const shared = [...art].filter((x) => words.has(x)).length;
        return shared / art.size >= 0.6;
      })
      .map((u) => pagesLabel(u.pages));

// Page-turn hooks.
const noHook = units
  .filter((u, i) => {
    const last = i === units.length - 1;
    const turns = comic ? Array.isArray(u.pages) && u.pages[0] % 2 === 1 && u.pages[0] < pages : !last;
    return turns && !last && !String(u.turn ?? "").trim();
  })
  .map((u) => pagesLabel(u.pages));

// Image descriptions.
const altIssues = [];
const cover = board.cover ?? {};
for (const [label, alt] of [[t("封面", "cover"), cover.alt], ...units.map((u) => [pagesLabel(u.pages), u.alt])]) {
  if (!String(alt ?? "").trim()) altIssues.push(t(`${label}：没有图片描述`, `${label}: no image description`));
  else if (chars(alt) > 140) altIssues.push(t(`${label}：图片描述 ${chars(alt)} 个字符，超过 140`, `${label}: the image description is ${chars(alt)} characters, over 140`));
}

// Preaching, and who solves the problem.
const preachZh = /这个故事告诉我们|告诉我们|懂得了|明白了.{0,4}道理|道理|学会了?分享|要学会|我们要|我们应该|小朋友们?[，,]?要|做一个.{0,8}的好?孩子|分享是/;
const preachEn = /\b(?:learn(?:ed|t)|realized|understood) (?:that|how|to)\b|\bthe (?:moral|lesson)\b|\bwe (?:should|must) (?:always|never)\b|\balways remember\b|\bremember to\b|\bsharing is\b|\bgood (?:boys|girls|children|kids) (?:always|never)\b/i;
const preachRe = en ? preachEn : preachZh;
const sentences = bookText.split(/(?<=[。！？!?.])\s*|\n+/).map((s) => s.trim()).filter(Boolean);
const preaching = [...new Set(sentences.filter((s) => preachRe.test(s)))];

const characters = Array.isArray(story.characters) ? story.characters : [];
const norm = (name) => String(name ?? "").trim().toLowerCase().replace(/^the\s+/, "");
const main = characters.filter((c) => c.role === "main");
const beats = Array.isArray(story.beats) ? story.beats : [];
const storyIssues = [];
if (main.length !== 1) storyIssues.push(t(`主角（role 为 main）应该正好一个，现在有 ${main.length} 个`, `There should be exactly one main character (role main); there are ${main.length}`));
if (story.solvedBy && main.length && !main.some((c) => norm(c.name) === norm(story.solvedBy))) {
  storyIssues.push(t(`解决问题的是 ${story.solvedBy}，不是主角 ${main[0].name}`, `${story.solvedBy} solves the problem, not the main character, ${main[0].name}`));
}
if (!beats.some((b) => b.beat === "resolution")) storyIssues.push(t("没有 resolution：主角怎么自己解决", "No resolution beat: how the main character solves it"));
const tries = beats.filter((b) => b.beat === "try").length;
if (tries !== 3) storyIssues.push(t(`尝试有 ${tries} 次，模板按三次排（一次比一次难或好笑）`, `${tries} ${tries === 1 ? "try" : "tries"}; the template plans three, each harder or funnier`));

// The refrain: matched on its first half, so a last line that changes the ending still counts.
const squash = (text) => String(text ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const refrain = squash(story.refrain);
const refrainIssues = [];
if (refrain.length >= 4) {
  const head = refrain.slice(0, Math.max(4, Math.ceil(refrain.length / 2)));
  const texts = comic ? units.map((u) => (u.panels ?? []).flatMap((p) => (p.lines ?? []).map((l) => l.text)).join(" ")) : units.map((u) => u.text);
  const times = texts.filter((text) => squash(text).includes(head)).length;
  if (times < 2) refrainIssues.push(t(`重复句“${story.refrain}”只出现了 ${times} 次`, `The refrain “${story.refrain}” appears ${times === 1 ? "once" : `${times} times`}`));
  if (times > 5) refrainIssues.push(t(`重复句“${story.refrain}”出现了 ${times} 次，太多会让人腻（一般三次左右）`, `The refrain “${story.refrain}” appears ${times} times; too many wears it out (about three is usual)`));
}

// Comic balloons.
const balloonIssues = [];
const speakerIssues = [];
if (comic) {
  const names = new Set(characters.map((c) => norm(c.name)));
  const perBalloon = en ? 25 : 40;
  const perPanel = en ? 50 : 80;
  const size = (text) => (en ? enWords(text) : zhChars(text));
  for (const unit of units) {
    const panels = Array.isArray(unit.panels) ? unit.panels : [];
    if (!panels.length) balloonIssues.push(t(`${pagesLabel(unit.pages)}：没有分格`, `${pagesLabel(unit.pages)}: no panels`));
    panels.forEach((panel, i) => {
      const where = t(`${pagesLabel(unit.pages)}第 ${i + 1} 格`, `${pagesLabel(unit.pages)}, panel ${i + 1}`);
      let sum = 0;
      for (const line of panel.lines ?? []) {
        const n = size(line.text);
        sum += n;
        if (n > perBalloon) balloonIssues.push(t(`${where}：一个框 ${n} 字，超过 ${perBalloon}`, `${where}: a balloon of ${n} words, over ${perBalloon}`));
        const spoken = !["caption", "sfx"].includes(line.kind);
        if (spoken && !String(line.who ?? "").trim()) speakerIssues.push(t(`${where}：对白没写是谁说的`, `${where}: a balloon with no speaker`));
        else if (spoken && names.size && !names.has(norm(line.who))) speakerIssues.push(t(`${where}：${line.who} 不在故事的角色里`, `${where}: ${line.who} is not a character in the story`));
      }
      if (sum > perPanel) balloonIssues.push(t(`${where}：一格 ${sum} 字，超过 ${perPanel}`, `${where}: ${sum} words in the panel, over ${perPanel}`));
    });
  }
}

const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填|\bXX\b/i;
const placeholders = units
  .filter((u) => [u.text, u.art, u.alt, u.turn, ...(u.panels ?? []).flatMap((p) => [p.art, ...(p.lines ?? []).map((l) => l.text)])].some((x) => placeholder.test(String(x ?? ""))))
  .map((u) => pagesLabel(u.pages));

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const report = [
  [t("## 单元和版式对不上", "## Units that don't match the layout"), layoutIssues],
  [t("## 页数（按 8 页一帖印；KDP 平装书最少 24 页）", "## Page count (8-page signatures; a KDP paperback has at least 24)"), pageIssues],
  ...(comic ? [] : [[t("## 字数（Writer's Digest；SCBWI）", "## Word count (Writer's Digest; SCBWI)"), wordIssues]]),
  ...(comic ? [] : [[t("## 插图说明在重复文字（插图说明只写字里没说的，Underdown）", "## Art notes that repeat the words (notes are for what the words don't say; Underdown)"), repeats]]),
  [t("## 没有翻页钩子", "## No page-turn hook"), noHook],
  [t("## 图片描述（每张图都要有，不超过 140 个字符，KDP）", "## Image descriptions (one for every image, at most 140 characters; KDP)"), altIssues],
  [t("## 像在讲道理的句子（Mary Kole；SCBWI）", "## Lines that preach (Mary Kole; SCBWI)"), preaching],
  [t("## 故事结构（主角自己解决问题）", "## Story structure (the main character solves it)"), storyIssues],
  [t("## 重复句", "## Refrain"), refrainIssues],
  ...(comic
    ? [
        [t("## 字太多的框和格（Dark Horse 脚本格式）", "## Crowded balloons and panels (Dark Horse script guide)"), balloonIssues],
        [t("## 说话人", "## Speakers"), speakerIssues],
      ]
    : []),
  [t("## 占位符", "## Placeholders"), placeholders],
];
const matches = !layoutIssues.length;
const lines = [
  t("# 画前检查", "# Pre-art check"),
  "",
  t(
    `${units.length} 个单元（${comic ? "漫画" : "绘本"}，${pages} 页）${matches ? "，和版式对得上" : "，和版式对不上"}。`,
    `${units.length} ${units.length === 1 ? "unit" : "units"} (${comic ? "comic" : "picture book"}, ${pages} pages)${matches ? ", matching the layout" : ", not matching the layout"}.`,
  ),
  comic ? t(`对白一共 ${total} 字。`, `${total} ${total === 1 ? "word" : "words"} in balloons.`) : t(`全书 ${total} 字（上限 1000）。`, `${total} ${total === 1 ? "word" : "words"} in all (limit 600).`),
  "",
  ...report.flatMap(([title, items]) => [title, list(items), ""]),
  t("这些检查只做提醒，最后由编辑和你自己判断。", "These checks are reminders only; the editor and you make the call."),
  "",
];

const out = outputs[0]?.path ?? "precheck-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = report.reduce((n, [, items]) => n + items.length, 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
