/**
 * Arguments for a VS Code Task.
 *
 * Pass `command` and `args` to `ProcessExecution` or `ShellExecution` as an
 * array. VS Code quotes them. Do not join them into one command line:
 * https://code.visualstudio.com/api/references/vscode-api#ProcessExecution
 * https://code.visualstudio.com/api/references/vscode-api#ShellExecution
 *
 * On Windows, a `.cmd` / `.bat` shim cannot be spawned directly. The Task
 * layer uses `ShellExecution` (still an argument array). `spawnSpec` does the
 * same for `status --json`: `cmd.exe` plus one argv element per argument.
 */

export type FlowgitAction =
  | { kind: "run"; stageId: string }
  | { kind: "run-all" }
  | { kind: "board" }
  | { kind: "diff"; stageId: string; version: number }
  | { kind: "trust" }
  | { kind: "status" };

export interface TaskLaunch {
  /** Executable path. Never a shell line. */
  command: string;
  /** One element per argument. Stage ids and paths stay whole, spaces included. */
  args: string[];
  cwd: string;
}

export function taskLaunch(cli: string, flowDir: string, action: FlowgitAction): TaskLaunch {
  const base = ["-C", flowDir];
  switch (action.kind) {
    case "run":
      return { command: cli, args: [...base, "run", action.stageId], cwd: flowDir };
    case "run-all":
      return { command: cli, args: [...base, "run", "all"], cwd: flowDir };
    case "board":
      return { command: cli, args: [...base, "board"], cwd: flowDir };
    case "diff":
      return { command: cli, args: [...base, "diff", action.stageId, String(action.version)], cwd: flowDir };
    case "trust":
      return { command: cli, args: [...base, "trust"], cwd: flowDir };
    case "status":
      return { command: cli, args: [...base, "status", "--json"], cwd: flowDir };
  }
}

/** `.cmd` / `.bat` need a shell on Windows. Everything else is a direct process. */
export function useShellExecution(command: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export interface SpawnSpec {
  command: string;
  args: string[];
  shell: false;
}

export function spawnSpec(executable: string, args: string[], platform: NodeJS.Platform): SpawnSpec {
  if (useShellExecution(executable, platform)) {
    const comspec = platform === process.platform ? process.env.ComSpec || "cmd.exe" : "cmd.exe";
    return { command: comspec, args: ["/d", "/s", "/c", executable, ...args], shell: false };
  }
  return { command: executable, args, shell: false };
}
