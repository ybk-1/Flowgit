// CSV parser for this template only. Scripts must not import Flowgit.
// Handles a leading BOM, CRLF, quoted fields, commas inside quotes, and "" escapes.
import fs from "node:fs";

/**
 * The table to analyse: the only .csv file in data/, whatever its name.
 * @returns {{ file: string } | { error: "missing" | "none" } | { error: "many", files: string[] }}
 */
export function findCsv(dir = "data") {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: "missing" };
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".csv") && fs.statSync(`${dir}/${name}`).isFile())
    .sort();
  if (files.length === 1) return { file: `${dir}/${files[0]}` };
  if (!files.length) return { error: "none" };
  return { error: "many", files };
}

/**
 * Read a CSV as text. UTF-8 first; if the bytes are not valid UTF-8, read them as
 * GB18030, which covers the GBK files that Excel saves on Chinese Windows.
 */
export function readCsvText(file) {
  const bytes = fs.readFileSync(file);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

/** Bilingual message for a findCsv() error, as [zh, en]. */
export function findCsvMessage(found) {
  if (found.error === "many") {
    return [
      `data/ 里有 ${found.files.length} 个 CSV（${found.files.join("、")}），只留下要分析的那一个。`,
      `data/ has ${found.files.length} CSV files (${found.files.join(", ")}). Keep only the one to analyse.`,
    ];
  }
  return ["data/ 里没有 CSV。把要分析的表存成 .csv 放进去。", "There is no CSV in data/. Save the table to analyse as a .csv file there."];
}

/** @returns {{ header: string[], rows: Record<string, string>[] }} */
export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, "");
  const table = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (!(row.length === 1 && row[0] === "")) table.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) table.push(row);
  }
  if (!table.length) return { header: [], rows: [] };
  const header = table[0].map((cell) => cell.trim());
  const rows = table.slice(1).map((cells) => {
    /** @type {Record<string, string>} */
    const obj = {};
    header.forEach((name, i) => {
      obj[name] = (cells[i] ?? "").trim();
    });
    return obj;
  });
  return { header, rows };
}
