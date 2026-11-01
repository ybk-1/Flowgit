import { spawn, type ChildProcess } from "node:child_process";

/** How long a Unix process tree gets to exit after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 5_000;

export interface CommandResult {
  code: number;
  output: string;
}

export interface CommandOptions {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Piped to stdin. Omit to leave stdin closed. */
  stdin?: string;
  /** Stop the process tree after this many seconds. Unset or < 1 means no limit. */
  timeoutSec?: number;
  onLine?: (line: string) => void;
  /** Stop appending captured output after this many characters. */
  maxCapture?: number;
}

function timeoutMessage(seconds: number): string {
  return `超时（${seconds} 秒），已停止 / Timed out after ${seconds}s and was stopped`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when any process remains in the process group led by `pid`. */
function groupAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence and does not deliver a signal.
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    // EPERM: the group exists but this process cannot signal it.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Stop a detached Unix process tree. The child was spawned with `detached: true`,
 * so its pid is the process-group id. SIGTERM the group, then SIGKILL if anything
 * in the group is still alive after 5 seconds (a shell can die while a child that
 * ignores SIGTERM keeps running).
 */
async function killUnixTree(pid: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // already gone
  }
  const deadline = Date.now() + KILL_GRACE_MS;
  while (groupAlive(pid) && Date.now() < deadline) {
    await delay(50);
  }
  if (!groupAlive(pid)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
  const killDeadline = Date.now() + 2_000;
  while (groupAlive(pid) && Date.now() < killDeadline) {
    await delay(50);
  }
}

/**
 * Stop a Windows process tree.
 * https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill
 */
function killWindowsTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => resolve());
    killer.on("close", () => resolve());
  });
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    await killWindowsTree(pid);
    return;
  }
  await killUnixTree(pid);
}

/**
 * `detached: true` puts the command in its own session, so a terminal
 * SIGINT/SIGTERM/SIGHUP hits Flowgit and not the child. Forward the signal
 * to that process group, then exit the same way we would have without a listener.
 */
function forwardParentSignals(child: ChildProcess): () => void {
  if (process.platform === "win32") return () => {};
  const pid = child.pid;
  if (!pid || pid <= 0) return () => {};
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const onSignal = (signal: NodeJS.Signals) => {
    for (const s of signals) process.removeListener(s, onSignal);
    try {
      process.kill(-pid, signal);
    } catch {
      // already gone
    }
    process.kill(process.pid, signal);
  };
  for (const s of signals) process.on(s, onSignal);
  return () => {
    for (const s of signals) process.removeListener(s, onSignal);
  };
}

/**
 * Run a shell command. On macOS and Linux the shell is its own process group
 * (`detached: true`) so a timeout can signal the shell and every child it started.
 * On Windows a timeout uses `taskkill /T /F` to stop that tree.
 */
export function runCommand(opts: CommandOptions): Promise<CommandResult> {
  const { command, cwd, env, stdin, timeoutSec, onLine, maxCapture = Number.POSITIVE_INFINITY } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      // New process group on Unix so kill(-pid) reaches the shell and its children.
      // Windows stops the tree with taskkill; detached would open a new console.
      detached: process.platform !== "win32",
    });
    let buf = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unbindSignals = forwardParentSignals(child);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unbindSignals();
      fn();
    };

    if (typeof timeoutSec === "number" && timeoutSec > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        void stopProcessTree(child).finally(() => {
          settle(() => reject(new Error(timeoutMessage(timeoutSec))));
        });
      }, timeoutSec * 1000);
    }

    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      if (buf.length < maxCapture) buf += s;
      for (const line of s.split(/\r?\n/)) if (line.trim()) onLine?.(line);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    if (stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }
    child.on("error", (err) => settle(() => reject(err)));
    child.on("close", (code) => {
      // A timeout already owns the outcome; the shell exiting must not become a success.
      if (timedOut) return;
      settle(() => resolve({ code: code ?? 1, output: buf }));
    });
  });
}
