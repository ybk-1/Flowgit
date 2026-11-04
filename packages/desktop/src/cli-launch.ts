import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Run the Flowgit CLI with Electron acting as Node.
 * https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node
 * ELECTRON_RUN_AS_NODE is set on the child environment only.
 */

export function flowgitEntry(from: string = import.meta.url): string {
  const require = createRequire(from);
  return path.join(path.dirname(require.resolve("flowgit/package.json")), "dist", "index.js");
}

export function cliChildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" };
}

export function runFlowgit(
  args: string[],
  baseEnv: NodeJS.ProcessEnv,
  execPath: string = process.execPath,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const entry = flowgitEntry();
  return new Promise((resolve, reject) => {
    execFile(
      execPath,
      [entry, ...args],
      { env: cliChildEnv(baseEnv), windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && typeof err.code !== "number") {
          reject(err);
          return;
        }
        resolve({ code: typeof err?.code === "number" ? err.code : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
