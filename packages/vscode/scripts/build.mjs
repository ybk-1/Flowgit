// Bundles the extension and copies the flow schema next to it.
// engines.vscode is ^1.128.0 — see src/engine.ts for why, with the doc links.
import { build } from "esbuild";
import fs from "node:fs";
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

const schemaFrom = path.join(root, "packages", "core", "schema", "flow.schema.json");
const schemaTo = path.join(pkg, "schema", "flow.schema.json");
fs.mkdirSync(path.dirname(schemaTo), { recursive: true });
fs.copyFileSync(schemaFrom, schemaTo);
if (!fs.readFileSync(schemaFrom).equals(fs.readFileSync(schemaTo))) {
  throw new Error("copied schema does not match packages/core/schema/flow.schema.json");
}

fs.copyFileSync(path.join(root, "LICENSE"), path.join(pkg, "LICENSE"));
