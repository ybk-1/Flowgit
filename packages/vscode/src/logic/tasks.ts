/**
 * Arguments for a VS Code Task.
 *
 * Pass `command` and `args` to `ProcessExecution` or `ShellExecution` as an
 * array. VS Code quotes them. Do not join them into one command line:
 * https://code.visualstudio.com/api/references/vscode-api#ProcessExecution
 * https://code.visualstudio.com/api/references/vscode-api#ShellExecution
 *
 * The flow directory is the working directory, never an argument: a folder
 * name like `R&D` would otherwise reach cmd.exe or PowerShell as text. The
 * remaining arguments are fixed words, a stage id (checked against the
 * schema's pattern) and a version number, so no shell can read them as syntax.
 *
 * On Windows, a `.cmd` / `.bat` shim cannot be spawned directly. The Task
 * layer uses `ShellExecution` with the command strongly quoted. `spawnSpec`
 * runs `status --json` through `cmd.exe /d /s /c` with the shim's path quoted.
 */

/** The stage id pattern in packages/core/schema/flow.schema.json. */
export const STAGE_ID = /^[a-z][a-z0-9_-]*$/;

export class UnsafeArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeArgumentError";
  }
}

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
  const cwd = flowDir;
  switch (action.kind) {
    case "run":
      return { command: cli, args: ["run", stageArg(action.stageId)], cwd };
    case "run-all":
      return { command: cli, args: ["run", "all"], cwd };
    case "board":
      return { command: cli, args: ["board"], cwd };
    case "diff":
      if (!Number.isInteger(action.version) || action.version < 1) throw new UnsafeArgumentError(`not a version: ${action.version}`);
      return { command: cli, args: ["diff", stageArg(action.stageId), String(action.version)], cwd };
    case "trust":
      return { command: cli, args: ["trust"], cwd };
    case "status":
      return { command: cli, args: ["status", "--json"], cwd };
  }
}

function stageArg(id: string): string {
  if (!STAGE_ID.test(id)) throw new UnsafeArgumentError(`not a stage id: ${JSON.stringify(id)}`);
  return id;
}

/** `.cmd` / `.bat` need a shell on Windows. Everything else is a direct process. */
export function useShellExecution(command: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export interface SpawnSpec {
  command: string;
  args: string[];
  shell: false;
  /** Set for cmd.exe, whose command line is built here instead of by Node. */
  windowsVerbatimArguments?: boolean;
}

/** Arguments that mean the same thing to cmd.exe as to the CLI. */
const CMD_SAFE_ARG = /^[A-Za-z0-9_.-]+$/;

export function spawnSpec(executable: string, args: string[], platform: NodeJS.Platform): SpawnSpec {
  if (!useShellExecution(executable, platform)) return { command: executable, args, shell: false };
  // cmd.exe acts on & | < > ^ % and friends even when Node quotes an argument,
  // so only plain words reach it, and the shim's path sits inside quotes
  // (Windows paths cannot contain `"`). `%` would still expand inside quotes.
  if (executable.includes("%") || executable.includes('"')) throw new UnsafeArgumentError(`cannot run ${executable} through cmd.exe`);
  for (const arg of args) {
    if (!CMD_SAFE_ARG.test(arg)) throw new UnsafeArgumentError(`cannot pass ${JSON.stringify(arg)} through cmd.exe`);
  }
  const comspec = platform === process.platform ? process.env.ComSpec || "cmd.exe" : "cmd.exe";
  // With /s, cmd.exe drops the outer pair of quotes and runs the rest as written.
  const line = `"${["\"" + executable + "\"", ...args].join(" ")}"`;
  return { command: comspec, args: ["/d", "/s", "/c", line], shell: false, windowsVerbatimArguments: true };
}
