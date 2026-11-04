import type { HostExecOptions, HostExecResult, MemoryHost } from "@flowgit/core";
import { BLOB_DIR, MAX_FILE_BYTES, prefixOf } from "../storage/flow-store.js";

/**
 * The sandbox interface (#175, K4). A cloud run has no computer: a stage that runs a command
 * (script; later agent and others) goes to a sandbox, which K4 implements with Cloudflare
 * Containers (https://developers.cloudflare.com/containers/) in `src/sandbox/` and `container/`.
 * Until one is bound, the cloud host's `exec` refuses with core's "needs a computer" error and
 * those stages are handed to a computer instead (see `COMPUTER_EXECUTORS` in runs/plan.ts).
 *
 * What goes in: the flow's files, the command, the environment, and limits. The environment never
 * holds the workspace's vault keys (they are taken out by name before the request is made): a
 * command could write a key into an output file even with the network off. What comes back: the
 * exit code, the output, and the files that changed, which the room writes back into the flow (and
 * so into R2) the same way a board write does.
 *
 * Large files (over 4 MB) are never sent or returned as bytes, so they stay out of the room's
 * memory: a file in `files` can be `{ blob }`, which the sandbox reads from R2 at
 * `${blobPrefix}${sha256}`, and a changed file can come back as `{ blob }` once the sandbox has
 * written its bytes there itself.
 */
export interface SandboxRequest {
  /** The flow, for the sandbox's own logs and R2 access. */
  flowId: string;
  /** R2 key prefix of the flow's content-addressed blobs: "flows/<flow id>/.flowgit-blobs/". */
  blobPrefix: string;
  /** A shell command line, run with `sh -c` in `cwd`. */
  command: string;
  /** Relative to the flow's root; "" is the root. */
  cwd: string;
  /** The flow's files by relative path. Large files (blobs) are passed by reference. */
  files: Record<string, SandboxFile>;
  /** Exactly the variables the process sees (nothing from the sandbox's own environment). */
  env: Record<string, string>;
  stdin?: string;
  limits: SandboxLimits;
}

export interface BlobRef {
  sha256: string;
  size: number;
}

export type SandboxFile = { data: Uint8Array } | { blob: BlobRef };

export interface SandboxLimits {
  /** Wall-clock seconds before the process tree is stopped. */
  timeSec: number;
  /** Memory for the whole process tree. */
  memoryMb: number;
  /** false: no network at all. true: outbound HTTPS only, never the sandbox's own network. */
  network: boolean;
  /** Stop capturing output after this many characters. */
  maxOutputChars: number;
}

export interface SandboxResult {
  code: number;
  /** stdout and stderr, interleaved. */
  output: string;
  /**
   * Files created or changed, by relative path; `null` for a file the command deleted, and
   * `{ blob }` for a large file the sandbox already wrote to R2 at `${blobPrefix}${sha256}`.
   */
  changed: Record<string, Uint8Array | { blob: BlobRef } | null>;
  /** True when a limit stopped the command (the code is then non-zero). */
  limited?: "time" | "memory" | "output";
}

export interface Sandbox {
  run(request: SandboxRequest, onLine?: (line: string) => void): Promise<SandboxResult>;
}

export const DEFAULT_LIMITS: SandboxLimits = { timeSec: 600, memoryMb: 1024, network: false, maxOutputChars: 200_000 };
/** Upper bounds a stage's `timeoutSec` can't go past. */
export const MAX_LIMITS: SandboxLimits = { timeSec: 3600, memoryMb: 4096, network: true, maxOutputChars: 1_000_000 };

/**
 * A Host `exec` that runs in `sandbox`: sends the flow's files from `host` (under `root`), and
 * writes back what changed. Stage env is passed as given; nothing of the Worker's own leaks in.
 */
export function sandboxExec(
  sandbox: Sandbox,
  host: MemoryHost,
  root: string,
  options: {
    flowId: string;
    network?: boolean;
    memoryMb?: number;
    /** The blob a file's bytes point at (a large file's stub), if any. */
    blobOf?: (data: Uint8Array) => BlobRef | undefined;
    /** The bytes to keep in the flow for a large file the sandbox stored itself. */
    stubFor?: (ref: BlobRef) => Uint8Array;
    /** Environment names never passed to the sandbox (the workspace's vault keys). */
    withheld?: string[];
  },
): (exec: HostExecOptions) => Promise<HostExecResult> {
  return async (exec) => {
    const rel = (abs: string) => abs.slice(root.length + 1);
    if (exec.cwd !== root && !exec.cwd.startsWith(`${root}/`)) throw new Error(`沙箱只能在流程目录里运行 / the sandbox only runs inside the flow: ${exec.cwd}`);
    const files: Record<string, SandboxFile> = {};
    for (const abs of host.files()) {
      if (!abs.startsWith(`${root}/`)) continue;
      const data = host.readFile(abs);
      const blob = options.blobOf?.(data);
      files[rel(abs)] = blob ? { blob } : { data };
    }
    const withheld = new Set(options.withheld ?? []);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(exec.env)) if (typeof value === "string" && !withheld.has(key)) env[key] = value;
    const timeSec = Math.min(exec.timeoutSec && exec.timeoutSec >= 1 ? exec.timeoutSec : DEFAULT_LIMITS.timeSec, MAX_LIMITS.timeSec);
    const result = await sandbox.run(
      {
        flowId: options.flowId,
        blobPrefix: `${prefixOf(options.flowId)}${BLOB_DIR}/`,
        command: exec.command,
        cwd: exec.cwd === root ? "" : rel(exec.cwd),
        files,
        env,
        ...(exec.stdin !== undefined ? { stdin: exec.stdin } : {}),
        limits: {
          timeSec,
          memoryMb: Math.min(options.memoryMb ?? DEFAULT_LIMITS.memoryMb, MAX_LIMITS.memoryMb),
          network: options.network ?? DEFAULT_LIMITS.network,
          maxOutputChars: Math.min(exec.maxCapture ?? DEFAULT_LIMITS.maxOutputChars, MAX_LIMITS.maxOutputChars),
        },
      },
      exec.onLine,
    );
    // Check sizes before writing anything, so a stage that made a file too big changes nothing.
    for (const [path, data] of Object.entries(result.changed)) {
      const size = data === null ? 0 : data instanceof Uint8Array ? data.byteLength : data.blob.size;
      if (size > MAX_FILE_BYTES) {
        throw new Error(`沙箱写出的文件太大（最多 ${MAX_FILE_BYTES / 1024 / 1024} MB）/ the sandbox wrote a file over ${MAX_FILE_BYTES / 1024 / 1024} MB: ${path}`);
      }
    }
    for (const [path, data] of Object.entries(result.changed)) {
      const parts = path.split("/");
      if (!path || parts.some((part) => !part || part === "." || part === "..") || path.startsWith(".git/") || path.startsWith(".flowgit-blobs/")) continue;
      const abs = `${root}/${path}`;
      if (data === null) {
        if (host.exists(abs)) host.rm(abs, { recursive: true, force: true });
        continue;
      }
      let bytes: Uint8Array;
      if (data instanceof Uint8Array) bytes = data;
      else {
        if (!options.stubFor || !/^[0-9a-f]{64}$/.test(data.blob.sha256)) continue;
        bytes = options.stubFor(data.blob);
      }
      host.mkdir(host.path.dirname(abs), { recursive: true });
      host.writeFile(abs, bytes);
    }
    return { code: result.code, output: result.output };
  };
}
