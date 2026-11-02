/**
 * A small RFC 4180 reader. No dependency: quoted fields may contain commas
 * and newlines, a doubled quote is an escaped quote, and a leading UTF-8 BOM
 * is ignored. Records may end with CRLF, LF, or a bare CR.
 */
export function parseCsv(text: string): string[][] {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      // A quote starts a quoted field only at the beginning of that field.
      if (field.length === 0) {
        quoted = true;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
      endRow();
      continue;
    }
    field += ch;
    i += 1;
  }

  if (quoted) throw new Error("CSV 的引号没有闭合 / CSV has an unclosed quote");
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}
