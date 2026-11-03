import fs from "node:fs";
import path from "node:path";

/** Directories the sidebar does not walk. `runs` holds history, not a nested flow. */
export const SKIP_WALK_DIRS = new Set(["node_modules", ".git", "runs", ".flowgit"]);

export interface FoundFlow {
  dir: string;
  file?: string;
  conflict: boolean;
}

/**
 * Which flow file counts in one directory.
 * A `flow.md` without frontmatter next to `flow.json` is ignored, matching `findFlowFile` in core.
 * Both real flow files is a conflict: core refuses to guess.
 */
export function pickFlowFile(names: Iterable<string>, flowMdHead?: string): "flow.json" | "flow.md" | "both" | undefined {
  const set = new Set(names);
  const hasJson = set.has("flow.json");
  const hasMd = set.has("flow.md");
  if (hasJson && hasMd) {
    if (flowMdHead !== undefined && looksLikeFlowMd(flowMdHead)) return "both";
    return "flow.json";
  }
  if (hasJson) return "flow.json";
  if (hasMd) return "flow.md";
  return undefined;
}

export function looksLikeFlowMd(head: string): boolean {
  return /^---\r?\n/.test(head.replace(/^\uFEFF/, ""));
}

export function findFlowsOnDisk(roots: string[]): FoundFlow[] {
  const found: FoundFlow[] = [];
  const seen = new Set<string>();
  for (const root of roots) walk(root, seen, found);
  found.sort((a, b) => a.dir.localeCompare(b.dir));
  return found;
}

function walk(dir: string, seen: Set<string>, found: FoundFlow[]): void {
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return;
  }
  if (seen.has(real)) return;
  seen.add(real);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const fileNames = new Set<string>();
  for (const entry of entries) {
    if (entry.isFile()) {
      fileNames.add(entry.name);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    try {
      if (fs.statSync(path.join(dir, entry.name)).isFile()) fileNames.add(entry.name);
    } catch {
      // A broken symlink is not a flow file.
    }
  }

  const head = fileNames.has("flow.md") ? readHead(path.join(dir, "flow.md")) : undefined;
  const pick = pickFlowFile(fileNames, head);
  if (pick === "both") found.push({ dir, conflict: true });
  else if (pick) found.push({ dir, file: path.join(dir, pick), conflict: false });

  for (const entry of entries) {
    if (SKIP_WALK_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(child).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    walk(child, seen, found);
  }
}

function readHead(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(32);
    const n = fs.readSync(fd, buf, 0, 32, 0);
    return buf.toString("utf8", 0, n);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
