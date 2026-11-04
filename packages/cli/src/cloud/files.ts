import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Largest file the cloud accepts, and the largest create-flow body. */
export const MAX_SYNC_BYTES = 50 * 1024 * 1024;
/** Most files one cloud flow may hold, including runs/. */
export const MAX_SYNC_FILES = 5000;

/**
 * Directories and files that never sync.
 * `.flowgit/` holds cloud.json and the base hashes, not credentials.
 * The server also refuses `.git/` and `.flowgit-blobs/`.
 */
const SKIP_DIRS = new Set([".git", "node_modules", ".flowgit", ".flowgit-blobs"]);
const SKIP_FILES = new Set(["flowgit.local.json"]);

export interface LocalFile {
  path: string;
  bytes: number;
  sha256: string;
}

export function sha256Buffer(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function hashFile(abs: string): { sha256: string; bytes: number } {
  const hash = crypto.createHash("sha256");
  const stat = fs.statSync(abs);
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let pos = 0;
    while (pos < stat.size) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest("hex"), bytes: stat.size };
}

/** True for paths the CLI neither uploads nor downloads. */
export function ignoredSyncPath(rel: string): boolean {
  if (!rel || rel.includes("\\") || rel.startsWith("/") || rel.includes("\0")) return true;
  const parts = rel.split("/");
  if (parts.includes("..") || parts.some((part) => SKIP_DIRS.has(part))) return true;
  return SKIP_FILES.has(rel);
}

/**
 * A path inside `root`, or an error when it would escape.
 * `.flowgit/` is not synced, but conflict copies are written there on purpose.
 */
export function safeJoin(root: string, rel: string): string {
  if (!rel || rel.includes("\\") || rel.startsWith("/") || rel.includes("\0") || rel.split("/").includes("..")) {
    throw new Error(`路径不合法 / invalid path: ${rel}`);
  }
  const abs = path.resolve(root, ...rel.split("/"));
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`路径不合法 / invalid path: ${rel}`);
  return abs;
}

/** Files that sync, posix relative paths, sorted. Skips symlinks. */
export function listLocalFiles(root: string): LocalFile[] {
  const out: LocalFile[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(childRel)) continue;
      const abs = path.join(dir, entry.name);
      const hashed = hashFile(abs);
      out.push({ path: childRel, bytes: hashed.bytes, sha256: hashed.sha256 });
    }
  };
  walk(root, "");
  return out;
}

/**
 * How many decoded bytes the create-flow endpoint will count for a base64 body.
 * It uses floor(base64Length * 3 / 4), which can be a byte or two over the real size.
 */
export function base64Estimate(bytes: number): number {
  const encoded = Math.ceil(bytes / 3) * 4;
  return Math.floor((encoded * 3) / 4);
}

export interface CreatePack {
  /** Paths sent in the create-flow `files` map. Always includes the flow file. */
  create: string[];
  /** Paths uploaded one by one afterwards. */
  rest: string[];
}

/** Pack a first push into a create call of at most 50 MB, then individual uploads. */
export function packCreate(files: LocalFile[]): CreatePack {
  if (files.length > MAX_SYNC_FILES) {
    throw new Error(`一个流程最多 ${MAX_SYNC_FILES} 个文件 / a flow can have at most ${MAX_SYNC_FILES} files`);
  }
  const flow = files.find((file) => file.path === "flow.json" || file.path === "flow.md");
  if (!flow) throw new Error("根目录要有 flow.json 或 flow.md / the root needs a flow.json or flow.md");
  for (const file of files) {
    if (file.bytes > MAX_SYNC_BYTES) {
      throw new Error(`文件超过 50 MB，不能上传 / file is over 50 MB and cannot be uploaded: ${file.path}`);
    }
  }
  const create = [flow.path];
  let used = base64Estimate(flow.bytes);
  const rest: string[] = [];
  for (const file of files) {
    if (file.path === flow.path) continue;
    const add = base64Estimate(file.bytes);
    if (used + add <= MAX_SYNC_BYTES) {
      create.push(file.path);
      used += add;
    } else rest.push(file.path);
  }
  return { create, rest };
}

export function readFileBytes(root: string, rel: string): Buffer {
  return fs.readFileSync(safeJoin(root, rel));
}
