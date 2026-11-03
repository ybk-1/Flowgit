// "report" stage. Assemble report.md and a self-contained report.html.
// Numbers in the analysis that are not in profile.json or aggregates.json are
// listed in check-report.md. The rest of the report is written by this script
// from those two files, or is the user's own question, so it is not checked. That list warns and does not fail the stage.
// Missing files and JSON that will not parse are format errors and do fail it.
//
// Rules (see README "依据 / Sources"):
// - ASA: do not present a figure that is not in the computed artifacts; say so
//   instead of stopping the report.
// - Minto: the analysis should open with the answer, so a heading-first draft is listed.
// - WCAG 1.4.3: the page colors follow light and dark the same way the SVG files do.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const fail = (zh, english) => {
  console.error(t(zh, english));
  process.exit(1);
};

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

function readJson(file) {
  const text = read(file);
  if (!text.trim()) fail(`找不到或是空的 ${file}。`, `${file} is missing or empty.`);
  try {
    return { text, data: JSON.parse(text) };
  } catch (err) {
    fail(`${file} 不是合法的 JSON：${err.message}`, `${file} is not valid JSON: ${err.message}`);
  }
}

const analysis = read("analysis.md").replace(/\r\n/g, "\n").trim();
if (!analysis) fail("analysis.md 是空的。", "analysis.md is empty.");
const profileFile = readJson("profile.json");
const aggregatesFile = readJson("aggregates.json");
const profile = profileFile.data;
const aggregates = aggregatesFile.data;
const chartList = Array.isArray(aggregates.charts) ? aggregates.charts : [];
if (!chartList.length) fail("aggregates.json 里没有图表。", "aggregates.json has no charts.");

const question = String(flowInputs.question ?? "").trim() || t("数据报告", "Data report");
const audience = String(flowInputs.audience ?? "").trim();
const dateNote = profile.dateRange
  ? t(
      `日期从 ${profile.dateRange.min} 到 ${profile.dateRange.max}。`,
      `Dates run from ${profile.dateRange.min} to ${profile.dateRange.max}.`,
    )
  : t("没有日期列。", "There is no date column.");
const missingNote = (profile.columns ?? []).map((col) => `- ${col.name}: ${col.missing}`).join("\n");
const chartNote = chartList.map((chart) => `- ${chart.title}${en ? ` (${chart.file})` : `（${chart.file}）`}`).join("\n");

const report = [
  `# ${question}`,
  "",
  audience ? t(`写给：${audience}`, `For: ${audience}`) : "",
  "",
  analysis,
  "",
  t("## 数据说明", "## Data note"),
  "",
  t(`数据来自 ${profile.source ?? "data/"}，共 ${profile.rowCount} 行。${dateNote}`, `Data: ${profile.source ?? "data/"}, ${profile.rowCount} rows. ${dateNote}`),
  "",
  t("各列缺失个数：", "Missing values by column:"),
  "",
  missingNote,
  "",
  t("## 图表", "## Charts"),
  "",
  chartNote,
  "",
]
  .filter((line, i, all) => line !== "" || all[i - 1] !== "")
  .join("\n");

const tokens = (text) => text.match(/\d+(?:\.\d+)?/g) ?? [];
const known = new Set([...tokens(profileFile.text), ...tokens(aggregatesFile.text)]);
const unknown = [...new Set(tokens(analysis))].filter((token) => !known.has(token));
const uncited = chartList.filter((chart) => !analysis.includes(`charts/${chart.id}.svg`)).map((chart) => chart.file);
const firstLine = analysis.split("\n").find((line) => line.trim()) ?? "";
const answerBuried = /^#{1,6}\s/.test(firstLine) ? [t("分析以标题开头，结论没有写在第一段。", "The analysis starts with a heading, so the answer is not the first paragraph.")] : [];

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((item) => `- ${item}`).join("\n") : none);
const check = [
  t("# 数据报告检查", "# Data report check"),
  "",
  t(
    "这些检查只做提醒，不会让这一步失败。文件缺失、JSON 解析失败，或图表规格不合法，会让碰到它的那一步失败。",
    "These checks only warn. They do not fail this stage. A missing file, JSON that cannot be parsed, or an invalid chart spec fails the stage that hit it.",
  ),
  "",
  t("## 对不上的数字", "## Numbers that do not match"),
  "",
  list(unknown),
  "",
  t("## 没被引用的图", "## Charts the analysis never cites"),
  "",
  list(uncited),
  "",
  t("## 开头不是结论", "## Answer is not first"),
  "",
  list(answerBuried),
  "",
].join("\n");

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, strong) => `<strong>${strong}</strong>`)
    .replace(/charts\/([a-z][a-z0-9-]*)\.svg/g, (_, id) => `<a href="#chart-${id}">charts/${id}.svg</a>`);
}

function markdownHtml(md) {
  const lines = md.split("\n");
  const html = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };
  for (const line of lines) {
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const item = /^-\s+(.*)$/.exec(line);
    if (item) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

const figures = chartList
  .map((chart) => {
    const file = chart.file;
    if (!file || !fs.existsSync(file)) return "";
    const xml = fs.readFileSync(file, "utf8").replace(/^\s*<\?xml[^>]*>\s*/, "");
    // The title is already inside the SVG; the caption says how the numbers were made.
    const how = `${chart.agg}(${chart.y}) · ${chart.x}${chart.filter ? ` · ${chart.filter}` : ""}`;
    const rowsNote = t(
      `用了 ${chart.usedRows} 行，跳过 ${chart.skippedRows} 行（空格子或不是数字）`,
      `${chart.usedRows} rows used, ${chart.skippedRows} skipped (empty or not a number)`,
    );
    return `<figure id="chart-${esc(chart.id)}">${xml}<figcaption>${esc(file)} · ${esc(how)} · ${esc(rowsNote)}</figcaption></figure>`;
  })
  .join("\n");

const page = `<!doctype html>
<html lang="${en ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(question)}</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #1b1f27; --muted: #3e4a5c; --line: #d5dbe3; --code: #eef2f6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #121418; --fg: #f4f6f8; --muted: #d5dbe3; --line: #2c3442; --code: #1c2230; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font-family: "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif;
    line-height: 1.6; }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.8rem; line-height: 1.3; margin: 0 0 0.6em; }
  h2 { font-size: 1.25rem; margin: 1.4em 0 0.4em; }
  a { color: inherit; }
  code { background: var(--code); padding: 0 0.3em; border-radius: 4px; }
  figure { margin: 1.2em 0; }
  figure svg { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; }
  figcaption { color: var(--muted); font-size: 0.92rem; margin-top: 0.4em; }
</style>
</head>
<body>
<main>
${markdownHtml(report)}
${figures}
</main>
</body>
</html>
`;

const mdOut = outputs.find((item) => String(item.path).endsWith(".md") && !String(item.path).includes("check"))?.path ?? "report.md";
const htmlOut = outputs.find((item) => String(item.path).endsWith(".html"))?.path ?? "report.html";
const checkOut = outputs.find((item) => String(item.path).includes("check"))?.path ?? "check-report.md";
fs.writeFileSync(mdOut, report.endsWith("\n") ? report : `${report}\n`);
fs.writeFileSync(htmlOut, page);
fs.writeFileSync(checkOut, check);

const issues = unknown.length + uncited.length + answerBuried.length;
console.log(check);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${checkOut}。`, `${issues} things to look at; see ${checkOut}.`) : t("检查通过。", "All checks passed."));
