import { spawn } from "node:child_process";
import { spawnSpec } from "./tasks.js";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a CLI with an argument array. `shell` stays false so nothing is concatenated. */
export function spawnCaptured(command: string, args: string[], cwd: string, platform: NodeJS.Platform = process.platform): Promise<CommandResult> {
  const spec = spawnSpec(command, args, platform);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawn(spec.command, spec.args, { cwd, shell: false, windowsHide: true });
    } catch (err) {
      finish({ code: 127, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < 2_000_000) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 200_000) stderr += chunk;
    });
    child.on("error", (err) => finish({ code: 127, stdout, stderr: stderr || err.message }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}
