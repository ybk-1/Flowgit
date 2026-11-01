import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Output } from "./types.js";

export function sha256String(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function sha256File(abs: string): string {
  const h = createHash("sha256");
  h.update(fs.readFileSync(abs));
  return h.digest("hex");
}

/** Sorted relative file list of a directory (files only, posix separators). */
export function listFiles(absDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, r);
      else if (entry.isFile()) out.push(r);
    }
  };
  walk(absDir, "");
  return out;
}

export interface PathHash {
  sha256: string;
  bytes: number;
  isDir: boolean;
}

/** Hash a file, or a directory (hash of its sorted "relpath\0filehash" lines). */
export function hashPath(abs: string): PathHash {
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const h = createHash("sha256");
    let bytes = 0;
    for (const rel of listFiles(abs)) {
      const fileAbs = path.join(abs, rel);
      h.update(`${rel}\0${sha256File(fileAbs)}\n`);
      bytes += fs.statSync(fileAbs).size;
    }
    return { sha256: h.digest("hex"), bytes, isDir: true };
  }
  return { sha256: sha256File(abs), bytes: stat.size, isDir: false };
}

export function copyPath(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
}

export function isDirOutput(output: Output): boolean {
  return output.type === "dir" || output.path.endsWith("/");
}

/** Normalized relative path of an output (no trailing slash). */
export function outputRel(output: Output): string {
  return output.path.replace(/\/+$/, "");
}

const TEXT_EXT = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".htm", ".xml",
  ".srt", ".vtt", ".otio", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".toml", ".ini",
]);

export function isTextType(type: string, filePath?: string): boolean {
  const t = type.toLowerCase();
  if (t.startsWith("text/")) return true;
  if (t === "application/json" || t.endsWith("+json")) return true;
  if (t.endsWith("+xml") || t.endsWith("+yaml") || t === "application/yaml" || t === "application/x-yaml") return true;
  if (t.startsWith("flowgit/")) return true;
  if (filePath && TEXT_EXT.has(path.extname(filePath).toLowerCase())) return true;
  return false;
}

export function wantsJson(type: string, filePath?: string): boolean {
  const t = type.toLowerCase();
  if (t === "application/json" || t.endsWith("+json")) return true;
  return !!filePath && path.extname(filePath).toLowerCase() === ".json";
}

/** True if `rel` stays inside the flow directory (no absolute paths, no "..").  */
export function isSafeRelative(rel: string): boolean {
  if (!rel || path.isAbsolute(rel)) return false;
  const parts = rel.split(/[\\/]+/);
  return !parts.includes("..");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n... [truncated ${s.length - max} chars]`;
}

/** An environment variable, matched case-insensitively on Windows (where PATH is often "Path"). */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[name] !== undefined || process.platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** Where a program is on PATH (trying PATHEXT, e.g. ".CMD", on Windows), or undefined. */
export function findOnPath(program: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const win = process.platform === "win32";
  const dirs = (envValue(env, "PATH") ?? "").split(path.delimiter).filter(Boolean);
  const exts = (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const hasExt = exts.some((e) => program.toUpperCase().endsWith(e.toUpperCase()));
  const names = win && !hasExt ? exts.map((e) => `${program}${e.toLowerCase()}`) : [program];
  for (const dir of dirs) {
    for (const name of names) {
      const abs = path.join(dir.replace(/^"|"$/g, ""), name);
      try {
        if (!fs.statSync(abs).isFile()) continue;
        if (!win) fs.accessSync(abs, fs.constants.X_OK);
        return abs;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}
