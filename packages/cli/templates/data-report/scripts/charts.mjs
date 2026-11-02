// "charts" stage. Read charts.json, aggregate the CSV in data/, write SVG by hand
// plus aggregates.json. No chart library and no Flowgit imports.
//
// Rules (see README "依据 / Sources"):
// - FT Visual Vocabulary: bars sorted by value; lines in time order with a marker
//   per point; magnitude bars start at 0.
// - Few, Visual Communication: bar length is the value, so the baseline is zero.
// - Few, tables: a table prints every aggregated value as text.
// - WCAG 1.4.3: text and background switch together for light and dark.
// - WCAG 1.4.1: the value is also written as text, not carried by color alone.
// - ASA: missing cells are skipped and counted, never filled in. The script is
//   the reproducible aggregation; it does not evaluate filter text as code.
import fs from "node:fs";
import path from "node:path";
import { findCsv, findCsvMessage, parseCsv, readCsvText } from "./csv.mjs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const fail = (zh, english) => {
  console.error(t(zh, english));
  process.exit(1);
};

const AGG = new Set(["sum", "mean", "count", "median"]);
const TYPES = new Set(["bar", "line", "table"]);
const ID = /^[a-z][a-z0-9-]{0,40}$/;
const NUM = /^-?\d+(?:\.\d+)?$/;
// A bar or a table with more groups than this stops being readable; a line can hold more points.
const MAX_GROUPS = 30;
const MAX_POINTS = 1000;

const found = findCsv();
if (!found.file) fail(...findCsvMessage(found));
if (!fs.existsSync("charts.json")) fail("找不到 charts.json。", "charts.json is missing.");

let spec;
let parsed;
try {
  spec = JSON.parse(fs.readFileSync("charts.json", "utf8"));
} catch (err) {
  fail(`charts.json 不是合法的 JSON：${err.message}`, `charts.json is not valid JSON: ${err.message}`);
}
try {
  parsed = parseCsv(readCsvText(found.file));
} catch (err) {
  fail(`CSV 读失败：${err.message}`, `Could not read the CSV: ${err.message}`);
}

const charts = spec?.charts;
if (!Array.isArray(charts) || !charts.length) fail("charts.json 里没有 charts 数组。", "charts.json has no charts array.");
const { header, rows } = parsed;
const columns = new Set(header.filter(Boolean));
// Columns with at least one number: the only ones sum, mean and median can use.
const numericColumns = new Set([...columns].filter((name) => rows.some((row) => NUM.test(row[name] ?? ""))));

/** Order labels as numbers when every label is a number, otherwise as text (ISO dates sort as text). */
function labelOrder(points) {
  const numeric = points.every((point) => NUM.test(point.x));
  return (a, b) => (numeric ? Number(a.x) - Number(b.x) : a.x < b.x ? -1 : a.x > b.x ? 1 : 0);
}

function round2(n) {
  return Number(n.toFixed(2));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function parseFilter(filter) {
  const text = String(filter ?? "").trim();
  if (!text) return [];
  return text.split("&").map((part) => {
    // Any column name (Chinese headers too); the first operator splits the name from the value.
    const match = part.trim().match(/^(.+?)\s*(<=|>=|=|<|>)\s*(.+)$/);
    if (!match) {
      fail(
        `筛选写不了：${part.trim()}。只用 column=value、column>=value 这类比较，用 & 连接，不要写代码。`,
        `Cannot read filter: ${part.trim()}. Use comparisons such as column=value or column>=value, joined with &, never code.`,
      );
    }
    const [, name, op, raw] = match;
    const field = name.trim();
    if (!columns.has(field)) fail(`筛选用了不存在的列 ${field}。`, `Filter uses an unknown column ${field}.`);
    return { field, op, value: raw.trim() };
  });
}

function matchOne(cell, op, raw) {
  if (cell === "") return false;
  const numeric = NUM.test(cell) && NUM.test(raw);
  const left = numeric ? Number(cell) : cell;
  const right = numeric ? Number(raw) : raw;
  if (op === "=") return left === right;
  if (op === ">") return left > right;
  if (op === "<") return left < right;
  if (op === ">=") return left >= right;
  if (op === "<=") return left <= right;
  return false;
}

function keep(row, clauses) {
  return clauses.every((clause) => matchOne(row[clause.field] ?? "", clause.op, clause.value));
}

/** @param {number[]} values @param {string} agg */
function combine(values, agg) {
  // Round sums too, so 0.1 + 0.2 is written as 0.3 and not 0.30000000000000004.
  if (agg === "sum") return round2(values.reduce((sum, n) => sum + n, 0));
  if (agg === "mean") return round2(values.reduce((sum, n) => sum + n, 0) / values.length);
  if (agg === "median") return round2(median(values));
  return values.length;
}

const seen = new Set();
const built = [];

for (const chart of charts) {
  const id = String(chart?.id ?? "");
  const type = chart?.type;
  const x = String(chart?.x ?? "");
  const y = String(chart?.y ?? "");
  const agg = chart?.agg;
  const title = String(chart?.title ?? "").trim();
  if (!ID.test(id)) fail(`图表 id 不合法：${id}。用小写字母、数字和连字符。`, `Invalid chart id: ${id}. Use lowercase letters, digits and hyphens.`);
  if (seen.has(id)) fail(`图表 id 重复：${id}。`, `Duplicate chart id: ${id}.`);
  seen.add(id);
  if (!TYPES.has(type)) fail(`图表 ${id} 的类型只能是 bar、line 或 table。`, `Chart ${id} must be a bar, line or table.`);
  if (!AGG.has(agg)) fail(`图表 ${id} 的汇总只能是 sum、mean、count 或 median。`, `Chart ${id} aggregation must be sum, mean, count or median.`);
  if (!columns.has(x) || !columns.has(y)) {
    fail(`图表 ${id} 用了表里没有的列（${x}, ${y}）。`, `Chart ${id} uses a column that is not in the table (${x}, ${y}).`);
  }
  if (!title) fail(`图表 ${id} 没有标题。`, `Chart ${id} has no title.`);
  if (agg !== "count" && !numericColumns.has(y)) {
    fail(
      `图表 ${id} 的 y 列 ${y} 里没有数字，${agg} 算不了。换一个数字列，或者把 agg 改成 count。`,
      `Chart ${id}: column ${y} holds no numbers, so ${agg} cannot run. Pick a numeric column, or use count.`,
    );
  }

  const clauses = parseFilter(chart.filter);
  const filtered = rows.filter((row) => keep(row, clauses));
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  let usedRows = 0;
  let skippedRows = 0;
  for (const row of filtered) {
    const label = row[x] ?? "";
    if (!label) {
      skippedRows++;
      continue;
    }
    if (agg === "count") {
      const bucket = groups.get(label) ?? [];
      bucket.push(1);
      groups.set(label, bucket);
      usedRows++;
      continue;
    }
    const raw = row[y] ?? "";
    if (!NUM.test(raw)) {
      skippedRows++;
      continue;
    }
    const bucket = groups.get(label) ?? [];
    bucket.push(Number(raw));
    groups.set(label, bucket);
    usedRows++;
  }
  if (!usedRows) {
    fail(
      `图表 ${id} 没有可汇总的行。检查列、筛选和缺失值。`,
      `Chart ${id} has no rows to aggregate. Check the columns, the filter and missing values.`,
    );
  }
  const limit = type === "line" ? MAX_POINTS : MAX_GROUPS;
  if (groups.size > limit) {
    fail(
      `图表 ${id} 按 ${x} 分出 ${groups.size} 组，${type} 最多 ${limit} 组。换一个唯一值少的列，或者加筛选。`,
      `Chart ${id} splits ${x} into ${groups.size} groups; a ${type} holds at most ${limit}. Pick a column with fewer distinct values, or add a filter.`,
    );
  }
  let points = [...groups.entries()].map(([label, values]) => ({ x: label, y: combine(values, agg) }));
  const byLabel = labelOrder(points);
  if (type === "bar") {
    points.sort((a, b) => b.y - a.y || byLabel(a, b));
  } else {
    points.sort(byLabel);
  }
  built.push({
    id,
    title,
    type,
    x,
    y,
    agg,
    filter: String(chart.filter ?? ""),
    file: `charts/${id}.svg`,
    usedRows,
    skippedRows,
    points,
  });
}

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const numText = (n) => JSON.stringify(n);

const STYLE = `
:root { color-scheme: light dark; }
.bg { fill: #ffffff; }
.fg { fill: #1b1f27; }
.muted { fill: #3e4a5c; }
.bar, .dot { fill: #1e4d8c; }
.line { stroke: #1e4d8c; fill: none; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.grid { stroke: #d5dbe3; stroke-width: 1; }
text { font-family: "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif; }
.title { font-size: 18px; font-weight: 600; }
.lab, .val { font-size: 14px; }
.tick { font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .bg { fill: #121418; }
  .fg { fill: #f4f6f8; }
  .muted { fill: #d5dbe3; }
  .bar, .dot { fill: #a9c7ff; }
  .line { stroke: #a9c7ff; }
  .grid { stroke: #2c3442; }
}
`;

function svgDoc(width, height, title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
<title>${esc(title)}</title>
<style>${STYLE}</style>
<rect class="bg" width="100%" height="100%"/>
${body}
</svg>
`;
}

function labelWidth(points) {
  const longest = points.reduce((n, point) => Math.max(n, [...point.x].length), 1);
  return Math.min(280, Math.max(96, longest * 16));
}

/** Rough advance width so a long English title is not clipped. */
function fitWidth(title, contentWidth) {
  let text = 0;
  for (const ch of title) text += ch.charCodeAt(0) > 255 ? 18 : 10;
  return Math.max(contentWidth, Math.ceil(text) + 40);
}

function barSvg(chart) {
  const labelW = labelWidth(chart.points);
  const barMax = 460;
  const rowH = 36;
  const width = fitWidth(chart.title, labelW + barMax + 140);
  const height = 56 + chart.points.length * rowH + 20;
  const values = chart.points.map((point) => point.y);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const span = maxV - minV || 1;
  const x0 = labelW + 16 + ((0 - minV) / span) * barMax;
  const bars = chart.points
    .map((point, i) => {
      const y = 52 + i * rowH;
      const x = labelW + 16 + ((Math.min(point.y, 0) - minV) / span) * barMax;
      const w = Math.max(1, (Math.abs(point.y) / span) * barMax);
      const valueX = point.y >= 0 ? x + w + 8 : x - 8;
      const anchor = point.y >= 0 ? "start" : "end";
      return `<text class="fg lab" x="${labelW}" y="${y + 18}" text-anchor="end">${esc(point.x)}</text><rect class="bar" x="${x}" y="${y}" width="${w}" height="24" rx="4"/><text class="fg val" x="${valueX}" y="${y + 17}" text-anchor="${anchor}">${esc(numText(point.y))}</text>`;
    })
    .join("");
  const axis = `<line class="grid" x1="${x0}" y1="48" x2="${x0}" y2="${height - 12}"/>`;
  const body = `<text class="fg title" x="16" y="32">${esc(chart.title)}</text>${axis}${bars}`;
  return svgDoc(width, height, chart.title, body);
}

function lineSvg(chart) {
  const width = fitWidth(chart.title, 880);
  const height = 420;
  const pad = { l: 72, r: 24, t: 56, b: 48 };
  const values = chart.points.map((point) => point.y);
  const yMin = values.reduce((a, b) => Math.min(a, b), 0);
  const top = values.reduce((a, b) => Math.max(a, b), 0);
  const yMax = top === yMin ? yMin + 1 : top;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const xAt = (i) => (chart.points.length === 1 ? pad.l + innerW / 2 : pad.l + (i / (chart.points.length - 1)) * innerW);
  const yAt = (v) => pad.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const last = chart.points.length - 1;
  // The first and last labels hang inward so they are not cut off at the edges.
  const anchorAt = (i) => (last === 0 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle");
  const coords = chart.points.map((point, i) => [xAt(i), yAt(point.y)]);
  const d = coords.map((pair, i) => `${i ? "L" : "M"}${pair[0].toFixed(1)} ${pair[1].toFixed(1)}`).join(" ");
  const step = Math.max(1, Math.ceil(chart.points.length / 8));
  const ticks = chart.points
    .map((point, i) => ({ point, i }))
    .filter(({ i }) => i % step === 0 || i === chart.points.length - 1)
    .map(({ point, i }) => `<text class="muted tick" x="${xAt(i)}" y="${height - 18}" text-anchor="${anchorAt(i)}">${esc(point.x)}</text>`);
  const grid = [...new Set([yMin, 0, yMax])]
    .map((tick) => {
      const y = yAt(tick);
      return `<line class="grid" x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}"/><text class="muted tick" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${esc(numText(tick))}</text>`;
    })
    .join("");
  const peak = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const low = values.reduce((best, v, i) => (v < values[best] ? i : best), 0);
  const labelAt = new Set([0, last, peak, low]);
  const dots = coords
    .map((pair, i) => {
      const label = labelAt.has(i) ? `<text class="fg val" x="${pair[0]}" y="${pair[1] - 10}" text-anchor="${anchorAt(i)}">${esc(numText(chart.points[i].y))}</text>` : "";
      return `<circle class="dot" cx="${pair[0]}" cy="${pair[1]}" r="4"/>${label}`;
    })
    .join("");
  const body = `<text class="fg title" x="16" y="32">${esc(chart.title)}</text>${grid}<path class="line" d="${d}"/>${dots}${ticks.join("")}`;
  return svgDoc(width, height, chart.title, body);
}

function tableSvg(chart) {
  const labelW = Math.max(labelWidth(chart.points), 160);
  const width = fitWidth(chart.title, labelW + 280);
  const rowH = 32;
  const height = 88 + chart.points.length * rowH;
  const head = `<text class="muted lab" x="20" y="68">${esc(chart.x)}</text><text class="muted lab" x="${labelW + 24}" y="68">${esc(`${chart.agg}(${chart.y})`)}</text><line class="grid" x1="16" y1="78" x2="${width - 16}" y2="78"/>`;
  const bodyRows = chart.points
    .map((point, i) => {
      const y = 104 + i * rowH;
      return `<text class="fg lab" x="20" y="${y}">${esc(point.x)}</text><text class="fg val" x="${labelW + 24}" y="${y}">${esc(numText(point.y))}</text>`;
    })
    .join("");
  const body = `<text class="fg title" x="16" y="32">${esc(chart.title)}</text>${head}${bodyRows}`;
  return svgDoc(width, height, chart.title, body);
}

const dirOut = outputs.find((item) => String(item.path).endsWith("/"))?.path ?? "charts/";
fs.mkdirSync(dirOut, { recursive: true });
for (const name of fs.readdirSync(dirOut)) {
  if (name.endsWith(".svg")) fs.rmSync(path.join(dirOut, name));
}
for (const chart of built) {
  const xml = chart.type === "line" ? lineSvg(chart) : chart.type === "table" ? tableSvg(chart) : barSvg(chart);
  fs.writeFileSync(path.join(dirOut, `${chart.id}.svg`), xml);
}

const aggregates = { charts: built };
const jsonOut = outputs.find((item) => String(item.path).endsWith(".json"))?.path ?? "aggregates.json";
fs.writeFileSync(jsonOut, `${JSON.stringify(aggregates, null, 2)}\n`);
console.log(t(`画出 ${built.length} 张图，汇总见 ${jsonOut}。`, `Drew ${built.length} charts. Aggregates: ${jsonOut}.`));
