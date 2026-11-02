// "check" stage. Warns only; the report says what to fix and why.
//
// What it checks and where the rules come from (see README "参考资料 / References"):
// - The "golden first three chapters": open on conflict, show the hero's edge by chapter 3.
// - Payoff density: serial readers drop off when chapters go by with nothing paid off; at most two in a row.
// - Every chapter ends on a hook, and every promise (reader expectation) moves forward.
// - Length per chapter against the target, and long paragraphs that read badly on a phone.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.chapterWords) > 0 ? Number(flowInputs.chapterWords) : 2500;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
const json = (file) => JSON.parse(read(file) || "{}");
const setting = json("setting.json");
const chapters = Array.isArray(json("outline.json").chapters) ? json("outline.json").chapters : [];
const text = read("chapters.md");

const promises = Array.isArray(setting.promises) ? setting.promises : [];
const blank = (v) => !String(v ?? "").trim();
const label = (c) => t(`第 ${c.n} 章`, `Chapter ${c.n}`);

const missingParts = chapters.flatMap((c) =>
  [["goal", t("目标", "goal")], ["conflict", t("冲突", "conflict")], ["hook", t("章末钩子", "hook")]].filter(([key]) => blank(c[key])).map(([, name]) => `${label(c)}${t("：", ": ")}${name}`),
);

// Runs of three or more chapters with no payoff.
const droughts = [];
let run = [];
for (const c of [...chapters, { n: null, payoff: "end" }]) {
  if (blank(c.payoff)) run.push(c.n);
  else {
    if (run.length >= 3) droughts.push(t(`第 ${run[0]}–${run.at(-1)} 章连续 ${run.length} 章没有爽点`, `Chapters ${run[0]}–${run.at(-1)}: ${run.length} in a row with no payoff`));
    run = [];
  }
}

const moved = new Set(chapters.flatMap((c) => (Array.isArray(c.promises) ? c.promises.map(String) : [])));
const stalled = promises.filter((p) => !moved.has(String(p.id))).map((p) => `${p.id} ${p.text ?? ""}`.trim());
const edgeAt = chapters.find((c) => c.edge === true)?.n;
const edgeNote =
  edgeAt === undefined
    ? t("⚠️ 细纲里没有标出金手指在哪一章亮出来。", "⚠️ The outline never marks where the hero's edge shows up.")
    : edgeAt <= 3
      ? t(`金手指在第 ${edgeAt} 章亮出来，在黄金三章之内。`, `The edge shows in chapter ${edgeAt}, inside the first three.`)
      : t(`⚠️ 金手指到第 ${edgeAt} 章才亮出来，晚于前三章。`, `⚠️ The edge only shows in chapter ${edgeAt}, after the first three.`);

// Chapters in the full text.
const heading = /^##\s+(.+)$/gm;
const marks = [...text.matchAll(heading)];
const bodies = marks.map((m, i) => ({ title: m[1].trim(), body: text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim() }));
const size = (s) => (en ? (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length : (s.match(/[一-鿿]/g) ?? []).length);
const lengths = bodies.map((b) => {
  const n = size(b.body);
  const off = Math.abs(n - target) / target;
  return `${b.title}${t("：", ": ")}${n}${t(" 字", " words")}${off > 0.2 ? t("（和目标差得多）", " (far from the target)") : ""}`;
});
const paragraphs = (body) => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const quote = /[“"「『]/;
const backgroundStart = bodies
  .filter((b) => {
    const first = paragraphs(b.body)[0] ?? "";
    return !quote.test(first) && size(first) > (en ? 90 : 150);
  })
  .map((b) => b.title);
const longParagraphs = bodies.flatMap((b) => paragraphs(b.body).filter((p) => size(p) > (en ? 150 : 300)).map(() => b.title));
const longCount = [...new Set(longParagraphs)].map((title) => `${title}（${longParagraphs.filter((x) => x === title).length}）`);
const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填|此处省略/i;

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 细纲缺的东西", "## Outline gaps"), missingParts],
  [t("## 爽点断档（最多连续两章没有）", "## Payoff droughts (at most two chapters in a row)"), droughts],
  [t("## 没有推进的期待", "## Expectations never moved forward"), stalled],
  [t("## 开头像背景介绍（第一段没有对话又很长）", "## Openings that read like background (long first paragraph, no dialogue)"), backgroundStart],
  [t("## 手机上读太长的段落", "## Paragraphs too long for a phone"), longCount],
  [t("## 占位符", "## Placeholders"), placeholder.test(text) ? ["chapters.md"] : []],
];
const lines = [
  t("# 网文检查", "# Web novel check"),
  "",
  t(`细纲 ${chapters.length} 章，期待 ${promises.length} 件，正文 ${bodies.length} 章。`, `${chapters.length} chapter outlines, ${promises.length} expectations, ${bodies.length} full chapters.`),
  edgeNote,
  "",
  t(`## 每章字数（目标 ${target}）`, `## Length per chapter (target ${target})`),
  list(lengths),
  "",
  ...sections.flatMap(([title, items]) => [title, list(items), ""]),
  t("这些是写作上的提醒。发布前还要按平台规则和《关于进一步加强网络文学出版管理的通知》自己审一遍内容。", "These are craft reminders. Before publishing, also review the content against the platform's rules."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = sections.reduce((n, [, items]) => n + items.length, 0) + (edgeAt === undefined || edgeAt > 3 ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} things to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
