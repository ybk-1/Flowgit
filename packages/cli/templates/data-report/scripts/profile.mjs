// "profile" stage. Summarise the CSV in data/ into profile.json.
// Any header works; the sample's columns are only an example.
//
// Rules (see README "依据 / Sources"):
// - NIST measures of location: every numeric column gets min, max, mean and median.
//   For an even count the median is the average of the two middle values.
// - ASA integrity of data: missing cells are counted and left out of the stats.
//   Nothing is filled in.
import fs from "node:fs";
import { findCsv, findCsvMessage, parseCsv, readCsvText } from "./csv.mjs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const fail = (zh, english) => {
  console.error(t(zh, english));
  process.exit(1);
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUM = /^-?\d+(?:\.\d+)?$/;

const found = findCsv();
if (!found.file) fail(...findCsvMessage(found));
const source = found.file;

let parsed;
try {
  parsed = parseCsv(readCsvText(source));
} catch (err) {
  fail(`CSV 读失败：${err.message}`, `Could not read the CSV: ${err.message}`);
}

const { header, rows } = parsed;
if (!header.length || header.every((name) => !name)) fail("CSV 没有表头。", "The CSV has no header.");
const dup = header.filter((name, i) => name && header.indexOf(name) !== i);
if (dup.length) fail(`表头有重复列：${dup.join(", ")}`, `Duplicate column names: ${dup.join(", ")}`);
if (!rows.length) fail("CSV 没有数据行。", "The CSV has no data rows.");

/** Two decimal places, then a JSON number (10.50 becomes 10.5). */
function round2(n) {
  return Number(n.toFixed(2));
}

function medianNumber(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  if (n % 2) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function columnSummary(name) {
  const cells = rows.map((row) => row[name] ?? "");
  const present = cells.filter((cell) => cell !== "");
  const missing = cells.length - present.length;
  const distinct = new Set(present).size;
  const asDate = present.length > 0 && present.every((cell) => DATE.test(cell));
  const asNumber = present.length > 0 && present.every((cell) => NUM.test(cell));
  const base = { name, missing, distinct, min: null, max: null, mean: null, median: null, dateRange: null };
  if (asDate) {
    const sorted = [...present].sort();
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    return { ...base, type: "date", min, max, median: sorted[Math.floor((sorted.length - 1) / 2)], dateRange: { min, max } };
  }
  if (asNumber) {
    const values = present.map(Number);
    return {
      ...base,
      type: "number",
      distinct: new Set(values).size,
      // A loop, not Math.min(...values): spreading a very long column overflows the stack.
      min: values.reduce((a, b) => (b < a ? b : a)),
      max: values.reduce((a, b) => (b > a ? b : a)),
      mean: round2(values.reduce((sum, n) => sum + n, 0) / values.length),
      median: round2(medianNumber(values)),
    };
  }
  const sorted = [...present].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { ...base, type: "string", min: sorted[0] ?? null, max: sorted[sorted.length - 1] ?? null };
}

const columns = header.filter(Boolean).map(columnSummary);
const dateCol = columns.find((col) => col.type === "date");
const profile = {
  source,
  rowCount: rows.length,
  dateRange: dateCol ? { min: dateCol.dateRange.min, max: dateCol.dateRange.max } : null,
  columns,
};

const out = outputs.find((item) => String(item.path).endsWith(".json"))?.path ?? "profile.json";
fs.writeFileSync(out, `${JSON.stringify(profile, null, 2)}\n`);
console.log(t(`画像写好了：${source}，${profile.rowCount} 行，${columns.length} 列，见 ${out}。`, `Profile written: ${source}, ${profile.rowCount} rows, ${columns.length} columns, see ${out}.`));
