import type { HostExecOptions, HostExecResult, MemoryHost } from "@flowgit/core";

/**
 * The sandbox interface (#175, K4). A cloud run has no computer: a stage that runs a command
 * (script; later agent and others) goes to a sandbox, which K4 implements with Cloudflare
 * Containers (https://developers.cloudflare.com/containers/) in `src/sandbox/` and `container/`.
 * Until one is bound, the cloud host's `exec` refuses with core's "needs a computer" error and
 * those stages are handed to a computer instead (see `COMPUTER_EXECUTORS` in runs/plan.ts).
 *
 * What goes in: the flow's files, the command, the environment (the run's keys under their own
 * names), and limits. What comes back: the exit code, the output, and the files that changed,
 * which the room writes back into the flow (and so into R2) the same way a board write does.
 */
export interface SandboxRequest {
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

export type SandboxFile = { data: Uint8Array } | { blob: { sha256: string; size: number } };

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
  /** Files created or changed, by relative path; `null` for a file the command deleted. */
  changed: Record<string, Uint8Array | null>;
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
  options: { network?: boolean; memoryMb?: number; blobOf?: (data: Uint8Array) => { sha256: string; size: number } | undefined } = {},
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
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(exec.env)) if (typeof value === "string") env[key] = value;
    const timeSec = Math.min(exec.timeoutSec && exec.timeoutSec >= 1 ? exec.timeoutSec : DEFAULT_LIMITS.timeSec, MAX_LIMITS.timeSec);
    const result = await sandbox.run(
      {
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
    for (const [path, data] of Object.entries(result.changed)) {
      const parts = path.split("/");
      if (!path || parts.some((part) => !part || part === "." || part === "..") || path.startsWith(".git/") || path.startsWith(".flowgit-blobs/")) continue;
      const abs = `${root}/${path}`;
      if (data === null) {
        if (host.exists(abs)) host.rm(abs, { recursive: true, force: true });
        continue;
      }
      host.mkdir(host.path.dirname(abs), { recursive: true });
      host.writeFile(abs, data);
    }
    return { code: result.code, output: result.output };
  };
}
