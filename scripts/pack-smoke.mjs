// Packs @flowgit/core and flowgit the way `pnpm publish` would, installs the
// tarballs into an empty folder with npm, and runs the installed CLI on a fresh
// flow. Catches files missing from "files", a broken bin, or workspace links
// that only work inside the monorepo. Run after `pnpm build`:
//
//   node scripts/pack-smoke.mjs
//
// Needs network access to the npm registry for third-party dependencies.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-pack-"));
const win = process.platform === "win32";

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: win, ...opts });
}

function check(ok, message) {
  if (!ok) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

try {
  // 1. Pack both packages. pnpm rewrites "workspace:*" to the real version.
  const tarballs = {};
  for (const [name, dir] of [["@flowgit/core", "packages/core"], ["flowgit", "packages/cli"]]) {
    const out = run("pnpm", ["pack", "--pack-destination", tmp, "--json"], { cwd: path.join(root, dir) });
    const info = JSON.parse(out.slice(out.indexOf("{")));
    tarballs[name] = info;
    const files = info.files.map((f) => f.path);
    check(info.name === name, `${name}: packed as ${path.basename(info.filename)}`);
    check(files.includes("LICENSE") && files.includes("README.md"), `${name}: ships LICENSE and README.md`);
    check(!files.some((f) => f.startsWith("src/") || f.includes(".test.")), `${name}: no sources or tests in the tarball`);
    check(!files.some((f) => /(^|\/)(runs|node_modules)\//.test(f)), `${name}: no runs/ or node_modules/ in the tarball`);
    if (name === "@flowgit/core") {
      check(files.includes("dist/index.js") && files.includes("schema/flow.schema.json"), `${name}: ships dist and the schema`);
    } else {
      check(files.includes("dist/index.js"), `${name}: ships the CLI entry`);
      for (const t of ["short-video", "weekly-report"]) check(files.includes(`templates/${t}/flow.json`), `${name}: ships the ${t} template`);
    }
  }
  // pnpm may report the tarball path as absolute or relative to the destination.
  const tgz = (name) => path.resolve(tmp, tarballs[name].filename);

  // 2. Install the tarballs into an empty project, as a user would from npm.
  const app = path.join(tmp, "app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "smoke", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tgz("@flowgit/core"), tgz("flowgit")], { cwd: app });
  const bin = path.join(app, "node_modules", ".bin", win ? "flowgit.cmd" : "flowgit");
  check(fs.existsSync(bin), "npm created the flowgit bin");
  const cliManifest = JSON.parse(fs.readFileSync(path.join(app, "node_modules", "flowgit", "package.json"), "utf8"));
  const coreVersion = tarballs["@flowgit/core"].version;
  check(cliManifest.dependencies["@flowgit/core"] === coreVersion, `flowgit depends on @flowgit/core ${coreVersion}, not a workspace link`);

  // 3. Use the installed CLI on a fresh flow (llm stage answered by the template's demo replies).
  const cli = path.join(app, "node_modules", "flowgit", "dist", "index.js");
  const flowgit = (args, opts = {}) => run(process.execPath, [cli, ...args], { shell: false, ...opts });
  const version = flowgit(["--version"]).trim();
  check(version === cliManifest.version, `flowgit --version prints ${version}`);
  const flow = path.join(tmp, "flow");
  flowgit(["init", flow]);
  flowgit(["validate"], { cwd: flow });
  flowgit(["providers"], { cwd: flow });
  flowgit(["run", "script", "--input", "topic=smoke test"], {
    cwd: flow,
    env: { ...process.env, FLOWGIT_LLM_MOCK_DIR: path.join(flow, "demo-replies") },
  });
  check(fs.existsSync(path.join(flow, "script.md")), "the installed CLI ran the script stage");
  console.log("\n✓ pack smoke test passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
