import { posixPath } from "./posix-path.js";
import { sha256 } from "./sha256.js";
import type { HostExecOptions, HostExecResult, Host, HostDirent, HostEnv, HostStat } from "./types.js";

/** Bilingual error for a stage that can only run on a computer (script, agent, MCP, plugin). */
export function needsComputerError(what = "这个阶段 / this stage"): Error {
  const [zh, en] = what.includes(" / ") ? what.split(" / ") : [what, what];
  return Object.assign(
    new Error(`${zh}要在电脑上运行（用 flowgit 命令或本机看板）/ ${en} needs to run on a computer (with the flowgit command or the local board)`),
    { code: "FLOWGIT_NEEDS_COMPUTER" },
  );
}

/** What changed in a memory host, for a browser host that persists files in the background. */
export type MemoryChange =
  | { type: "write"; path: string; data: Uint8Array }
  | { type: "mkdir"; path: string }
  | { type: "rm"; path: string };

export interface MemoryHostOptions {
  /** Files to start with, by absolute path. Parent directories are created. */
  files?: Record<string, string | Uint8Array>;
  env?: HostEnv;
  /** Working directory for relative paths. Default "/". */
  cwd?: string;
  /** Home directory (FLOWGIT_HOME defaults to <home>/.flowgit). Default "/home". */
  home?: string;
  /** Default "browser". */
  platform?: string;
  /** Run shell commands. Default: a bilingual "needs a computer" error. */
  exec?: (options: HostExecOptions) => Promise<HostExecResult>;
  /** Default: the global fetch. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Import a plugin module. Default: a bilingual "needs a computer" error. */
  importModule?: (abs: string) => Promise<unknown>;
  now?: () => Date;
  /** Called after every change, e.g. to save it to browser storage. */
  onChange?: (change: MemoryChange) => void;
}

export interface MemoryHost extends Host {
  /** Every file, by absolute path, sorted. */
  files(): string[];
}

type Entry = { kind: "file"; data: Uint8Array; mtimeMs: number } | { kind: "dir"; mtimeMs: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fsError(code: string, syscall: string, p: string): Error {
  return Object.assign(new Error(`${code}: ${messages[code] ?? code}, ${syscall} '${p}'`), {
    code,
    syscall,
    path: p,
  });
}

const messages: Record<string, string> = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  ENOTEMPTY: "directory not empty",
};

/** A host that keeps every file in memory. For tests, and the base of the browser host. */
export function createMemoryHost(options: MemoryHostOptions = {}): MemoryHost {
  const cwd = options.cwd ?? "/";
  const path = posixPath(() => cwd);
  const entries = new Map<string, Entry>([["/", { kind: "dir", mtimeMs: 0 }]]);
  const now = options.now ?? (() => new Date());
  const env: HostEnv = options.env ?? {};
  const notify = options.onChange ?? (() => {});

  const key = (p: string) => path.resolve(p);
  const get = (p: string) => entries.get(key(p));
  const stamp = () => now().getTime();

  const requireParentDir = (abs: string, syscall: string) => {
    const parent = entries.get(path.dirname(abs));
    if (!parent) throw fsError("ENOENT", syscall, abs);
    if (parent.kind !== "dir") throw fsError("ENOTDIR", syscall, abs);
  };

  const children = (abs: string): string[] => {
    const prefix = abs === "/" ? "/" : `${abs}/`;
    const names = new Set<string>();
    for (const k of entries.keys()) {
      if (k !== abs && k.startsWith(prefix)) names.add(k.slice(prefix.length).split("/")[0]!);
    }
    return [...names].sort();
  };

  const descendants = (abs: string): string[] => {
    const prefix = abs === "/" ? "/" : `${abs}/`;
    return [...entries.keys()].filter((k) => k === abs || k.startsWith(prefix));
  };

  const statOf = (entry: Entry): HostStat => ({
    isFile: () => entry.kind === "file",
    isDirectory: () => entry.kind === "dir",
    isSymbolicLink: () => false,
    size: entry.kind === "file" ? entry.data.length : 0,
    mtimeMs: entry.mtimeMs,
  });

  const mkdir = (p: string, opts?: { recursive?: boolean }) => {
    const abs = key(p);
    const existing = entries.get(abs);
    if (existing) {
      if (existing.kind === "dir" && opts?.recursive) return;
      throw fsError("EEXIST", "mkdir", abs);
    }
    if (opts?.recursive) {
      const parent = path.dirname(abs);
      if (parent !== abs) mkdir(parent, opts);
    } else requireParentDir(abs, "mkdir");
    entries.set(abs, { kind: "dir", mtimeMs: stamp() });
    notify({ type: "mkdir", path: abs });
  };

  const writeFile = (p: string, data: string | Uint8Array) => {
    const abs = key(p);
    requireParentDir(abs, "open");
    if (entries.get(abs)?.kind === "dir") throw fsError("EISDIR", "open", abs);
    const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
    entries.set(abs, { kind: "file", data: bytes, mtimeMs: stamp() });
    notify({ type: "write", path: abs, data: bytes });
  };

  const rm = (p: string, opts?: { recursive?: boolean; force?: boolean }) => {
    const abs = key(p);
    const entry = entries.get(abs);
    if (!entry) {
      if (opts?.force) return;
      throw fsError("ENOENT", "rm", abs);
    }
    if (entry.kind === "dir" && !opts?.recursive) throw fsError("EISDIR", "rm", abs);
    for (const k of descendants(abs)) entries.delete(k);
    notify({ type: "rm", path: abs });
  };

  function readFile(p: string): Uint8Array;
  function readFile(p: string, encoding: "utf8"): string;
  function readFile(p: string, encoding?: "utf8"): string | Uint8Array {
    const abs = key(p);
    const entry = entries.get(abs);
    if (!entry) throw fsError("ENOENT", "open", abs);
    if (entry.kind !== "file") throw fsError("EISDIR", "read", abs);
    return encoding ? decoder.decode(entry.data) : entry.data.slice();
  }

  function readdir(p: string): string[];
  function readdir(p: string, opts: { withFileTypes: true }): HostDirent[];
  function readdir(p: string, opts?: { withFileTypes: true }): string[] | HostDirent[] {
    const abs = key(p);
    const entry = entries.get(abs);
    if (!entry) throw fsError("ENOENT", "scandir", abs);
    if (entry.kind !== "dir") throw fsError("ENOTDIR", "scandir", abs);
    const names = children(abs);
    if (!opts?.withFileTypes) return names;
    return names.map((name) => {
      const kind = entries.get(path.join(abs, name))!.kind;
      return { name, isFile: () => kind === "file", isDirectory: () => kind === "dir" };
    });
  }

  const stat = (p: string): HostStat => {
    const entry = get(p);
    if (!entry) throw fsError("ENOENT", "stat", key(p));
    return statOf(entry);
  };

  const copy = (from: string, to: string) => {
    const src = key(from);
    const dst = key(to);
    const entry = entries.get(src);
    if (!entry) throw fsError("ENOENT", "cp", src);
    if (entry.kind === "file") {
      writeFile(dst, entry.data);
      return;
    }
    if (!entries.has(dst)) mkdir(dst, { recursive: true });
    for (const name of children(src)) copy(path.join(src, name), path.join(dst, name));
  };

  for (const [p, data] of Object.entries(options.files ?? {})) {
    mkdir(path.dirname(key(p)), { recursive: true });
    writeFile(p, data);
  }

  return {
    name: "memory",
    platform: options.platform ?? "browser",
    pid: 1,
    path,
    readFile,
    writeFile,
    readdir,
    stat,
    lstat: stat,
    mkdir,
    rm,
    rename(from, to) {
      const src = key(from);
      const dst = key(to);
      if (!entries.has(src)) throw fsError("ENOENT", "rename", src);
      requireParentDir(dst, "rename");
      if (entries.get(dst)?.kind === "dir" && children(dst).length) throw fsError("ENOTEMPTY", "rename", dst);
      const moved = descendants(src).map((k) => [k, entries.get(k)!] as const);
      for (const k of descendants(dst)) entries.delete(k);
      for (const [k] of moved) entries.delete(k);
      for (const [k, entry] of moved) entries.set(dst + k.slice(src.length), entry);
      notify({ type: "rm", path: src });
      for (const [k, entry] of moved) {
        const at = dst + k.slice(src.length);
        notify(entry.kind === "file" ? { type: "write", path: at, data: entry.data } : { type: "mkdir", path: at });
      }
    },
    exists: (p) => entries.has(key(p)),
    realpath(p) {
      const abs = key(p);
      if (!entries.has(abs)) throw fsError("ENOENT", "realpath", abs);
      return abs;
    },
    copy,
    hash: sha256,
    exec: options.exec ?? (async () => Promise.reject(needsComputerError())),
    which: () => undefined,
    resolveModule(_parent, spec) {
      throw Object.assign(needsComputerError(`插件 ${spec} / plugin ${spec}`), { code: "MODULE_NOT_FOUND" });
    },
    importModule: options.importModule ?? (async (abs) => Promise.reject(needsComputerError(`插件 ${abs} / plugin ${abs}`))),
    fetch:
      options.fetch ??
      ((input, init) => {
        if (typeof globalThis.fetch !== "function") return Promise.reject(new Error("这里没有 fetch / fetch is not available here"));
        return globalThis.fetch(input, init);
      }),
    env,
    homedir: () => options.home ?? "/home",
    now,
    files: () => [...entries].filter(([, e]) => e.kind === "file").map(([k]) => k).sort(),
  };
}
