import { host, path } from "./host/current.js";
import type { HostEnv } from "./host/types.js";
import type { Output } from "./types.js";

export function sha256String(s: string): string {
  return host().hash().update(s).digest();
}

export function sha256File(abs: string): string {
  return host().hash().update(host().readFile(abs)).digest();
}

/** Sorted relative file list of a directory (files only, posix separators). */
export function listFiles(absDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of host().readdir(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
  const stat = host().stat(abs);
  if (stat.isDirectory()) {
    const h = host().hash();
    let bytes = 0;
    for (const rel of listFiles(abs)) {
      const fileAbs = path.join(abs, rel);
      h.update(`${rel}\0${sha256File(fileAbs)}\n`);
      bytes += host().stat(fileAbs).size;
    }
    return { sha256: h.digest(), bytes, isDir: true };
  }
  return { sha256: sha256File(abs), bytes: stat.size, isDir: false };
}

export function copyPath(src: string, dst: string): void {
  host().mkdir(path.dirname(dst), { recursive: true });
  host().copy(src, dst);
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

/**
 * True unless `abs` exists and, once symlinks are followed, ends up outside `dir`.
 * A downloaded flow can hold a link such as prompt.md → ~/.ssh/id_rsa; this is how readers notice.
 */
export function staysInside(dir: string, abs: string): boolean {
  let root: string;
  let real: string;
  try {
    root = host().realpath(dir);
    real = host().realpath(abs);
  } catch {
    return true; // missing: there is nothing to read
  }
  const rel = path.relative(root, real);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Bilingual error for a file the flow names that links outside the flow directory. */
export function linkOutsideError(rel: string): Error {
  return new Error(
    `${rel} 是指向流程目录外面的链接，为了安全没有读取；把文件复制进流程目录再试 / ${rel} is a link to a file outside the flow directory, so it was not read; copy the file into the flow directory instead`,
  );
}

/** Read a text file named by the flow (a prompt), refusing a link that leads outside the flow directory. */
export function readFlowText(dir: string, rel: string): string {
  const abs = path.join(dir, rel);
  if (!staysInside(dir, abs)) throw linkOutsideError(rel);
  return host().readFile(abs, "utf8");
}

/** Bytes from base64 (standard or URL-safe), skipping whitespace and other stray characters like Node's Buffer does. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=.*$/s, "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const usable = clean.length % 4 === 1 ? clean.slice(0, -1) : clean;
  const bin = atob(usable + "=".repeat((4 - (usable.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = new TextDecoder();

/** UTF-8 text from bytes, replacing invalid sequences like Node's Buffer does. */
export function bytesToText(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

export function nowIso(): string {
  return host().now().toISOString();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n... [truncated ${s.length - max} chars]`;
}

/** An environment variable, matched case-insensitively on Windows (where PATH is often "Path"). */
export function envValue(env: HostEnv, name: string): string | undefined {
  if (env[name] !== undefined || host().platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** Where a program is on PATH (trying PATHEXT, e.g. ".CMD", on Windows), or undefined. */
export function findOnPath(program: string, env: HostEnv = host().env): string | undefined {
  return host().which(program, env);
}
