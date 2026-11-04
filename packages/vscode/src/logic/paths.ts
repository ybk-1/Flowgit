import path from "node:path";

type PathApi = Pick<typeof path, "resolve" | "relative" | "isAbsolute">;

/** Absolute path of `relative` if it stays inside `root`. */
export function pathInside(root: string, relative: string, p: PathApi = path): string | undefined {
  if (!relative || relative.includes("\0")) return undefined;
  const abs = p.resolve(root, relative);
  const rel = p.relative(root, abs);
  if (rel === "") return abs;
  if (rel.startsWith("..") || p.isAbsolute(rel)) return undefined;
  return abs;
}
