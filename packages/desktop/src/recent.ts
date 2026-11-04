import fs from "node:fs";
import path from "node:path";

/** Recent flows are a JSON array of absolute paths. Nothing else is stored. */
export function readRecent(file: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

/** Remember `dir` first. Paths only, de-duplicated, capped. */
export function rememberRecent(file: string, dir: string, limit = 12): string[] {
  const abs = path.resolve(dir);
  const next = [abs, ...readRecent(file).filter((item) => path.resolve(item) !== abs)].slice(0, limit);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next));
  return next;
}
