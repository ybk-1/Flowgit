import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCommand } from "../executors/command.js";
import type { Host, HostDirent, HostEnv, HostHash, HostStat } from "./types.js";

/** An environment variable, matched case-insensitively on Windows (where PATH is often "Path"). */
function envValue(env: HostEnv, name: string): string | undefined {
  if (env[name] !== undefined || process.platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** Where a program is on PATH (trying PATHEXT, e.g. ".CMD", on Windows), or undefined. */
function which(program: string, env: HostEnv): string | undefined {
  const win = process.platform === "win32";
  const dirs = (envValue(env, "PATH") ?? "").split(path.delimiter).filter(Boolean);
  const exts = (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const hasExt = exts.some((e) => program.toUpperCase().endsWith(e.toUpperCase()));
  const names = win && !hasExt ? exts.map((e) => `${program}${e.toLowerCase()}`) : [program];
  for (const dir of dirs) {
    for (const name of names) {
      const abs = path.join(dir.replace(/^"|"$/g, ""), name);
      try {
        if (!fs.statSync(abs).isFile()) continue;
        if (!win) fs.accessSync(abs, fs.constants.X_OK);
        return abs;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

function readFile(p: string): Uint8Array;
function readFile(p: string, encoding: "utf8"): string;
function readFile(p: string, encoding?: "utf8"): string | Uint8Array {
  return encoding ? fs.readFileSync(p, encoding) : fs.readFileSync(p);
}

function readdir(p: string): string[];
function readdir(p: string, options: { withFileTypes: true }): HostDirent[];
function readdir(p: string, options?: { withFileTypes: true }): string[] | HostDirent[] {
  return options?.withFileTypes ? fs.readdirSync(p, { withFileTypes: true }) : fs.readdirSync(p);
}

/** The host for a computer: `node:fs`, `node:child_process` and the real environment. Behaves exactly as core did before hosts. */
export const nodeHost: Host = {
  name: "node",
  get platform() {
    return process.platform;
  },
  get pid() {
    return process.pid;
  },
  path,
  readFile,
  writeFile: (p, data) => fs.writeFileSync(p, data),
  readdir,
  stat: (p): HostStat => fs.statSync(p),
  lstat: (p): HostStat => fs.lstatSync(p),
  mkdir: (p, options) => {
    fs.mkdirSync(p, options);
  },
  rm: (p, options) => fs.rmSync(p, options),
  rename: (from, to) => fs.renameSync(from, to),
  exists: (p) => fs.existsSync(p),
  realpath: (p) => fs.realpathSync(p),
  copy: (from, to) => fs.cpSync(from, to, { recursive: true, force: true }),
  hash: (): HostHash => {
    const h = createHash("sha256");
    const api: HostHash = {
      update(data) {
        h.update(data);
        return api;
      },
      digest: () => h.digest("hex"),
    };
    return api;
  },
  exec: (options) => runCommand({ ...options, env: options.env as NodeJS.ProcessEnv }),
  which,
  // The parent filename may be absent (a flow without package.json); createRequire only needs its path.
  resolveModule: (parentFile, spec) => createRequire(parentFile).resolve(spec),
  importModule: (abs) => import(pathToFileURL(abs).href) as Promise<unknown>,
  // Looked up on every call, so a test that stubs globalThis.fetch still sees its stub.
  fetch: (input, init) => globalThis.fetch(input, init),
  get env() {
    return process.env;
  },
  homedir: () => os.homedir(),
  now: () => new Date(),
};
