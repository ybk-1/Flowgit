/**
 * Line / column from a UTF-16 offset. Newlines are `\n` or `\r\n`
 * (`String#split` with `\r?\n`), so a Windows file and a Unix file agree.
 */
export function positionAt(text: string, offset: number): { line: number; character: number } {
  const safe = Math.max(0, Math.min(offset, text.length));
  const lines = text.split(/\r?\n/);
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    const content = lines[line] ?? "";
    const end = seen + content.length;
    if (safe <= end || line === lines.length - 1) {
      return { line, character: Math.max(0, Math.min(safe - seen, content.length)) };
    }
    const sep = text.startsWith("\r\n", end) ? 2 : 1;
    if (safe < end + sep) return { line, character: content.length };
    seen = end + sep;
  }
  const last = Math.max(0, lines.length - 1);
  return { line: last, character: (lines[last] ?? "").length };
}
