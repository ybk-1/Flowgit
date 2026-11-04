// Bundles the extension and copies the flow schema next to it.
// engines.vscode is ^1.128.0 — see src/engine.ts for why, with the doc links.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.dirname(here);
const root = path.resolve(pkg, "../..");
const outfile = path.join(pkg, "dist", "extension.js");

await build({
  entryPoints: [path.join(pkg, "src", "extension.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  // jsonc-parser's "main" is a UMD build whose require("./impl/...") calls
  // esbuild cannot follow; its "module" build is plain ESM and bundles whole.
  mainFields: ["module", "main"],
  sourcemap: true,
  logLevel: "info",
});

const bundled = fs.readFileSync(outfile, "utf8");
if (bundled.includes('require("jsonc-parser")') || bundled.includes("require('jsonc-parser')")) {
  throw new Error("jsonc-parser should be bundled into dist/extension.js");
}
if (!bundled.includes('require("vscode")') && !bundled.includes("require('vscode')")) {
  throw new Error("vscode must stay external");
}

// Load the bundle the way the editor will: alone, with nothing but a stub
// `vscode` next to it. A require the bundle left behind fails here. Every
// property of the stub is an empty class (through its prototype, which
// esbuild's interop keeps), so module-level `extends vscode.TreeItem` loads.
const probe = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-vscode-"));
try {
  fs.mkdirSync(path.join(probe, "node_modules", "vscode"), { recursive: true });
  fs.writeFileSync(path.join(probe, "node_modules", "vscode", "index.js"), "module.exports = Object.create(new Proxy({}, { get: () => class {} }));\n");
  fs.copyFileSync(outfile, path.join(probe, "extension.js"));
  const loaded = spawnSync(process.execPath, ["-e", "const m = require('./extension.js'); if (typeof m.activate !== 'function') process.exit(3);"], {
    cwd: probe,
    encoding: "utf8",
  });
  if (loaded.status !== 0) throw new Error(`dist/extension.js does not load on its own:\n${loaded.stderr}`);
} finally {
  fs.rmSync(probe, { recursive: true, force: true });
}

const schemaFrom = path.join(root, "packages", "core", "schema", "flow.schema.json");
const schemaTo = path.join(pkg, "schema", "flow.schema.json");
fs.mkdirSync(path.dirname(schemaTo), { recursive: true });
fs.copyFileSync(schemaFrom, schemaTo);
if (!fs.readFileSync(schemaFrom).equals(fs.readFileSync(schemaTo))) {
  throw new Error("copied schema does not match packages/core/schema/flow.schema.json");
}

fs.copyFileSync(path.join(root, "LICENSE"), path.join(pkg, "LICENSE"));
