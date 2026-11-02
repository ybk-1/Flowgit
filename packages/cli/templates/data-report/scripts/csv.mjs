// CSV parser for this template only. Scripts must not import Flowgit.
// Handles a leading BOM, CRLF, quoted fields, commas inside quotes, and "" escapes.

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
