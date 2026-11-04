import fs from "node:fs";

/** The same key the board stores in localStorage (`packages/web/public/i18n.js`). */
export const BOARD_LANG_KEY = "flowgit.board.lang";

export function readLanguage(file: string): "zh" | "en" | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { lang?: unknown };
    return data.lang === "zh" || data.lang === "en" ? data.lang : null;
  } catch {
    return null;
  }
}

export function writeLanguage(file: string, lang: "zh" | "en"): void {
  fs.mkdirSync(pathDir(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ lang }));
}

function pathDir(file: string): string {
  const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return slash < 0 ? "." : file.slice(0, slash);
}
