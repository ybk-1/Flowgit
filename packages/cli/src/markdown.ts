/** A small Markdown subset for the gallery. Enough for the template READMEs, with no extra dependency. */

const SOURCE_KEYS = new Set(["依据", "sources", "参考资料", "references"]);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(url: string): string | null {
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  if (url.startsWith("//")) return null;
  return url;
}

/** Inline code, links, bold and emphasis. HTML in the source is escaped. */
export function renderInline(raw: string): string {
  const codes: string[] = [];
  const withCodes = raw.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `%%CODE${codes.length - 1}%%`;
  });
  let html = escapeHtml(withCodes);
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const decoded = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const href = safeUrl(decoded);
    if (!href) return text;
    return `<a href="${escapeHtml(href)}">${text}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/%%CODE(\d+)%%/g, (_m, n: string) => codes[Number(n)] ?? "");
  return html;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function renderTable(rows: string[][]): string {
  const body = rows.filter((cells) => !isSeparator(cells));
  if (!body.length) return "";
  const [head, ...rest] = body;
  const th = head.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const trs = rest.map((cells) => `<tr>${cells.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Render the subset of Markdown the template READMEs use. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim().split(/\s+/)[0] ?? "";
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      const cls = lang && /^[A-Za-z0-9_+-]+$/.test(lang) ? ` class="language-${lang}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? "")) {
        rows.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      const table = renderTable(rows);
      if (table) out.push(table);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      out.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push(renderInline((lines[i] ?? "").replace(/^\s*[-*]\s+/, "")));
        i += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push(renderInline((lines[i] ?? "").replace(/^\s*\d+\.\s+/, "")));
        i += 1;
      }
      out.push(`<ol>${items.map((item) => `<li>${item}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const buf = [line];
    i += 1;
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !blockStart(lines[i] ?? "")) {
      buf.push(lines[i] ?? "");
      i += 1;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

function blockStart(line: string): boolean {
  return /^(#{1,6}\s|```|\s*\|)/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

/** A heading whose whole text is 依据 / Sources, or 参考资料 / References. */
export function isSourcesHeading(text: string): boolean {
  const parts = text
    .trim()
    .split(/\s+\/\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => SOURCE_KEYS.has(part));
}

/**
 * List items (as HTML) under the first 依据 / Sources or 参考资料 / References heading.
 * Empty when the README has no such section.
 */
export function extractSources(md: string): string[] {
  const lines = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let level = 6;
  for (let i = 0; i < lines.length; i++) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[i] ?? "");
    if (!heading) continue;
    if (isSourcesHeading(heading[2] ?? "")) {
      start = i + 1;
      level = heading[1]?.length ?? 2;
      break;
    }
  }
  if (start < 0) return [];
  const items: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = /^(#{1,6})\s+/.exec(line);
    if (heading && (heading[1]?.length ?? 6) <= level) break;
    if (/^\s*[-*]\s+/.test(line)) items.push(renderInline(line.replace(/^\s*[-*]\s+/, "")));
    else if (/^\s*\d+\.\s+/.test(line)) items.push(renderInline(line.replace(/^\s*\d+\.\s+/, "")));
  }
  return items;
}
