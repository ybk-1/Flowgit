/**
 * Build a portable copy, then an installer.
 *
 * pnpm's default isolated node_modules are symlinks into the store. This does
 * not change the repo's node-linker. `pnpm deploy --legacy`
 * (https://pnpm.io/cli/deploy) writes a self-contained folder without turning
 * on inject-workspace-packages for the repo, and electron-builder packages it
 * (https://www.electron.build/configuration/configuration).
 *
 * asar is off: script stages and `flowgit init` run this binary with
 * ELECTRON_RUN_AS_NODE, which does not read app.asar.
 * https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node
 *
 * Fuses are set in package.json `build.electronFuses`
 * (https://www.electron.build/configuration/configuration and
 * https://www.electronjs.org/docs/latest/tutorial/fuses). RunAsNode stays on.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(desktop, "..", "..");
// pnpm deploy stays inside the workspace (its bin links break outside it).
// electron-builder then runs on a copy with no pnpm-workspace.yaml above it,
// so it does not pack the rest of the monorepo.
// https://www.electron.build/configuration/configuration
// https://pnpm.io/cli/deploy
const deployed = path.join(desktop, ".deploy");
const staged = path.join(os.tmpdir(), "flowgit-desktop-stage");
const release = path.join(desktop, "release");
const wantWin = process.argv.includes("--win") || (!process.argv.includes("--linux") && process.platform === "win32");

fs.rmSync(deployed, { recursive: true, force: true });
fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(release, { recursive: true });

const deploy = spawnSync(
  "pnpm",
  ["--filter", "@flowgit/desktop", "--legacy", "deploy", "--prod", deployed],
  { cwd: repo, stdio: "inherit" },
);
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

fs.rmSync(staged, { recursive: true, force: true });
// Keep the symlinks pnpm wrote. `cp -a` is not on Windows; fs.cpSync copies links as links.
fs.cpSync(deployed, staged, { recursive: true, verbatimSymlinks: true });

const deployedPkg = path.join(staged, "package.json");
const meta = JSON.parse(fs.readFileSync(deployedPkg, "utf8"));
meta.build ??= {};
meta.build.directories ??= {};
meta.build.directories.output = release;
fs.writeFileSync(deployedPkg, JSON.stringify(meta, null, 2));

const args = [
  "--filter",
  "@flowgit/desktop",
  "exec",
  "electron-builder",
  "--projectDir",
  staged,
  wantWin ? "--win" : "--linux",
  "--publish",
  "never",
];
try {
  const require = createRequire(path.join(desktop, "package.json"));
  const electronDist = path.join(path.dirname(require.resolve("electron/package.json")), "dist");
  const binary = process.platform === "win32" ? "electron.exe" : "electron";
  if (fs.existsSync(path.join(electronDist, binary))) args.push(`--config.electronDist=${electronDist}`);
} catch {
  // electron-builder downloads the version named in build.electronVersion.
}

const built = spawnSync("pnpm", args, { cwd: repo, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
const unpacked = path.join(release, wantWin ? "win-unpacked" : "linux-unpacked");
const binaryName = wantWin ? "Flowgit.exe" : "flowgit";
if (!fs.existsSync(path.join(unpacked, binaryName))) {
  console.error(`打包结果里没有程序 / packaged binary missing: ${path.join(unpacked, binaryName)}`);
  process.exit(1);
}
console.log(`已打包 / packaged ${unpacked}`);
