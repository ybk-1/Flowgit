import fs from "node:fs";
import path from "node:path";

/**
 * A `node` command at the end of PATH, so script stages can run without a Node install.
 *
 * ELECTRON_RUN_AS_NODE makes this Electron binary start as Node:
 * https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node
 * The variable is set inside the shim only, never on the main process environment.
 *
 * Script stages already run with `shell: true`. On Windows, PATHEXT lets `node`
 * resolve to `node.cmd`:
 * https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/path
 */

export function shimFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "node.cmd" : "node";
}

/** The shim script for this launch. Rewritten on every start with the current execPath. */
export function shimContents(execPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const quoted = `"${execPath.replace(/"/g, '""')}"`;
    return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${quoted} %*\r\n`;
  }
  const quoted = `'${execPath.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\n# https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node\nexport ELECTRON_RUN_AS_NODE=1\nexec ${quoted} "$@"\n`;
}

/** Write the shim and return its directory. Does not change PATH or process.env. */
export function writeShim(dir: string, execPath: string, platform: NodeJS.Platform = process.platform): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, shimFileName(platform));
  fs.writeFileSync(file, shimContents(execPath, platform), { mode: 0o755 });
  if (platform !== "win32") fs.chmodSync(file, 0o755);
  return dir;
}

function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

/**
 * Put `shimDir` at the end of PATH, dropping an earlier copy of the same directory.
 * A Node install that is already on PATH stays in front and keeps being used.
 * Does not set ELECTRON_RUN_AS_NODE.
 */
export function appendShimDir(env: NodeJS.ProcessEnv, shimDir: string): void {
  const key = pathKey(env);
  const current = env[key] ?? "";
  const wanted = path.resolve(shimDir);
  const parts = current.split(path.delimiter).filter((entry) => entry.length > 0 && path.resolve(entry) !== wanted);
  env[key] = [...parts, shimDir].join(path.delimiter);
}
