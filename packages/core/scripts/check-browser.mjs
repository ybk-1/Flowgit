// Bundles the browser entry (dist/browser.js, after `pnpm build`) the way a web app would and
// fails if the result needs Node: an unresolvable built-in, or any "node:" left in the output.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let result;
try {
  result = await build({
    entryPoints: [path.join(root, "dist", "browser.js")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    metafile: true,
  });
} catch (err) {
  console.error("浏览器入口打包失败 / The browser entry failed to bundle:");
  for (const e of err.errors ?? [err]) console.error(`  ${e.text ?? e.message}${e.location ? ` (${e.location.file}:${e.location.line})` : ""}`);
  process.exit(1);
}
const code = result.outputFiles.map((f) => f.text).join("\n");
// Every import esbuild saw that names a Node built-in. esbuild already refuses to resolve one
// for platform "browser"; this also catches one left external. A dependency's error message that
// merely mentions a node: module (the Anthropic SDK names `import('node:buffer')` in a string)
// is text, not an import, so it is not counted.
const builtins = new Set(builtinModules);
const hits = [];
for (const [file, input] of Object.entries(result.metafile.inputs)) {
  for (const imp of input.imports) {
    if (imp.path.startsWith("node:") || builtins.has(imp.path)) hits.push(`${imp.path} ← ${file}`);
  }
}
if (hits.length) {
  console.error(`浏览器入口导入了 node: 模块 / The browser bundle imports node: modules:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
const kb = Math.round(code.length / 1024);
console.log(`浏览器入口可以打包，不含 node: 模块（${kb} KB）/ The browser entry bundles without node: modules (${kb} KB)`);
