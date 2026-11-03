/**
 * Everything core needs from the machine it runs on: files, hashing, running
 * commands, network, environment and time. Core reads and writes only through
 * a Host, so the same logic runs on a computer (`host/node.ts`), in memory
 * (`host/memory.ts`, for tests and as the base of the browser host) and later
 * in the cloud.
 *
 * File calls are synchronous because core's public API is synchronous
 * (loadFlow, listRuns, status ...). A browser host keeps the flow's files in
 * memory and persists them in the background; see `createMemoryHost({ onChange })`.
 */

/** Read-only environment variables, e.g. API keys. */
export type HostEnv = Readonly<Record<string, string | undefined>>;

export interface HostStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  /** Bytes; 0 for a directory. */
  size: number;
  mtimeMs: number;
}

export interface HostDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

/** The parts of `node:path` that core uses. */
export interface HostPath {
  readonly sep: string;
  readonly delimiter: string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  extname(p: string): string;
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
}

/** Incremental SHA-256. */
export interface HostHash {
  update(data: string | Uint8Array): HostHash;
  /** Lowercase hex. */
  digest(): string;
}

export interface HostExecOptions {
  /** A shell command line. */
  command: string;
  cwd: string;
  env: HostEnv;
  /** Piped to stdin. Omit to leave stdin closed. */
  stdin?: string;
  /** Stop the process tree after this many seconds. Unset or < 1 means no limit. */
  timeoutSec?: number;
  onLine?: (line: string) => void;
  /** Stop appending captured output after this many characters. */
  maxCapture?: number;
}

export interface HostExecResult {
  code: number;
  /** stdout and stderr, interleaved. */
  output: string;
}

export interface Host {
  /** "node", "memory", or a custom name. */
  readonly name: string;
  /** `process.platform` on a computer, "browser" in a browser. */
  readonly platform: string;
  /** Process id, used to name temporary files. */
  readonly pid: number;
  readonly path: HostPath;

  readFile(p: string): Uint8Array;
  readFile(p: string, encoding: "utf8"): string;
  writeFile(p: string, data: string | Uint8Array): void;
  readdir(p: string): string[];
  readdir(p: string, options: { withFileTypes: true }): HostDirent[];
  /** Follows symbolic links. Throws when `p` does not exist. */
  stat(p: string): HostStat;
  /** Does not follow symbolic links. Throws when `p` does not exist. */
  lstat(p: string): HostStat;
  mkdir(p: string, options?: { recursive?: boolean }): void;
  rm(p: string, options?: { recursive?: boolean; force?: boolean }): void;
  rename(from: string, to: string): void;
  exists(p: string): boolean;
  /** The path with every symbolic link resolved. Throws when `p` does not exist. */
  realpath(p: string): string;
  /** Copy a file or a directory tree, replacing what is there. */
  copy(from: string, to: string): void;

  /** A new SHA-256 hash. */
  hash(): HostHash;

  /** Run a shell command (script and agent stages). */
  exec(options: HostExecOptions): Promise<HostExecResult>;
  /** Where `program` is on PATH in `env`, or undefined. */
  which(program: string, env: HostEnv): string | undefined;
  /** Resolve a module the way `require.resolve` would from `parentFile`. Throws when it can't. */
  resolveModule(parentFile: string, spec: string): string;
  /** Import a JavaScript module by absolute path (plugin stages). */
  importModule(abs: string): Promise<unknown>;

  /** HTTP for llm, service and image stages. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Environment variables, read-only. */
  readonly env: HostEnv;
  /** The user's home directory (for ~/.flowgit). */
  homedir(): string;
  now(): Date;
}
