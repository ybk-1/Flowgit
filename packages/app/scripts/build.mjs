// Builds the web app into dist/ as a static site:
// - the board's own files from packages/web/public, unchanged (index.html becomes board.html),
// - board-shell.js and home.js bundled with esbuild from src/ (core's browser entry included),
// - templates/<id>.json: the bundled templates from packages/cli/templates.
// Every path in the pages is relative, so the site works under any folder (flowgit.dev/app/).
import { build } from "esbuild";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dist");
const webPublic = path.join(root, "..", "web", "public");
const templatesDir = path.join(root, "..", "cli", "templates");

/** Hosts a page may call: only the model vendors that accept direct browser calls (checked 2026-11-03). */
export const MODEL_HOSTS = ["https://api.deepseek.com", "https://api.anthropic.com"];
/** Public GitHub, read-only: a repository's file list (API) and its files (raw). */
export const GITHUB_HOSTS = ["https://api.github.com", "https://raw.githubusercontent.com"];
// The local board started by `flowgit board` (bound to this computer only), for stages that need a computer.
export const LOCAL_BOARD_HOSTS = ["http://127.0.0.1:*", "http://localhost:*"];

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  `connect-src 'self' ${[...MODEL_HOSTS, ...GITHUB_HOSTS, ...LOCAL_BOARD_HOSTS].join(" ")}`,
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
fs.mkdirSync(path.join(out, "templates"), { recursive: true });

// 1. The board's modules and styles, as they are.
for (const name of fs.readdirSync(webPublic)) {
  if (name === "index.html") continue;
  fs.cpSync(path.join(webPublic, name), path.join(out, name), { recursive: true });
}
const require = createRequire(path.join(root, "..", "web", "package.json"));
fs.copyFileSync(path.join(path.dirname(require.resolve("i18next/package.json")), "dist", "umd", "i18next.min.js"), path.join(out, "vendor", "i18next.js"));

// 2. Pages.
const relative = (html) => html.replace(/(href|src)="\/(?!\/)/g, '$1="./');
const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
let board = fs.readFileSync(path.join(webPublic, "index.html"), "utf8");
board = board.replace(/<meta name="flowgit-token" content="[^"]*" \/>/, `<meta name="flowgit-token" content="browser" />\n  ${cspMeta}`);
board = board.replace("<title>Flowgit · 看板</title>", '<title>Flowgit · 网页版 / Web app</title>\n  <link rel="stylesheet" href="/app.css" />');
board = board.replace("<body>", `<body class="web-app">\n${fs.readFileSync(path.join(root, "static", "board-bar.html"), "utf8")}`);
// The shell sets globalThis.flowgitTransport, so it must run before the board's modules.
board = board.replace('<script src="/vendor/i18next.js"></script>', '<script type="module" src="/board-shell.js"></script>\n  <script src="/vendor/i18next.js"></script>');
if (!board.includes("board-shell.js") || !board.includes("app-bar")) throw new Error("board.html: the board's index.html changed shape; update scripts/build.mjs");
fs.writeFileSync(path.join(out, "board.html"), relative(board));
const home = fs.readFileSync(path.join(root, "static", "index.html"), "utf8").replace("<!--CSP-->", cspMeta);
fs.writeFileSync(path.join(out, "index.html"), relative(home));
fs.copyFileSync(path.join(root, "static", "app.css"), path.join(out, "app.css"));
// Cloudflare Pages headers: the same policy, plus what a meta tag can't say.
fs.writeFileSync(
  path.join(out, "_headers"),
  `/*\n  Content-Security-Policy: ${CSP}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n`,
);

// 3. Templates: every file, base64, one JSON per template, plus an index.
const index = [];
for (const id of fs.readdirSync(templatesDir).sort()) {
  const dir = path.join(templatesDir, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const flowFile = ["flow.json", "flow.md"].find((name) => fs.existsSync(path.join(dir, name)));
  if (!flowFile) continue;
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, abs).split(path.sep).join("/")] = fs.readFileSync(abs).toString("base64");
  }
  let name = id;
  let description = "";
  let stages = 0;
  if (flowFile === "flow.json") {
    const flow = JSON.parse(fs.readFileSync(path.join(dir, flowFile), "utf8"));
    name = flow.name ?? id;
    description = flow.description ?? "";
    stages = Array.isArray(flow.stages) ? flow.stages.length : 0;
  }
  // flow.json names are in the template's own language; the README heading is "中文 / English",
  // so the home page can show the visitor's language.
  const readme = path.join(dir, "README.md");
  const heading = fs.existsSync(readme) ? /^#\s+(.+?)\s*$/m.exec(fs.readFileSync(readme, "utf8"))?.[1] : undefined;
  if (heading && heading.includes("/ ")) name = heading;
  index.push({ id, name, description, stages, demo: Object.keys(files).some((rel) => rel.startsWith("demo-replies/")) });
  fs.writeFileSync(path.join(out, "templates", `${id}.json`), JSON.stringify({ id, files }));
}
fs.writeFileSync(path.join(out, "templates", "index.json"), JSON.stringify(index));

// 4. Scripts.
await build({
  entryPoints: { "board-shell": path.join(root, "src", "board-shell.ts"), home: path.join(root, "src", "home.ts") },
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  conditions: ["browser"],
  // The board's own i18n module: shared with the page, not bundled twice.
  external: ["./i18n.js"],
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
  logLevel: "warning",
});
console.log(`网页版已构建到 / web app built in ${path.relative(process.cwd(), out) || "."}`);
