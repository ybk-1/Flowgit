import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { buildGallery } from "../gallery.js";
import { c } from "../format.js";
import { escapeHtml, renderMarkdown } from "../markdown.js";
import { findRepoRegistry, loadCommunityRegistry, registryLocation, REPO_WEB_URL } from "../registry.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Printed once when `packages/app/dist/` is not there yet. */
export const APP_PLACEHOLDER_LINE =
  "网页版还没构建，/app/ 用了占位页 / The web app is not built; /app/ is a placeholder";

const SCHEMA_REL = "packages/core/schema/flow.schema.json";

export interface HeaderLine {
  name: string;
  value: string;
  /** `! Name` removes a header set by an earlier matching rule. */
  unset: boolean;
}

export interface HeaderRule {
  path: string;
  lines: HeaderLine[];
}

/**
 * Cloudflare Pages `_headers`.
 * Every matching rule is applied, in order, and a repeated header's values are
 * joined with a comma. `! Name` removes a header set by an earlier rule.
 * https://developers.cloudflare.com/pages/configuration/headers/
 * https://developers.cloudflare.com/pages/configuration/headers/#detach-a-header
 */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) {
      if (!current) continue;
      const unset = /^\s+!\s+([^:\s]+)\s*$/.exec(line);
      if (unset?.[1]) {
        current.lines.push({ name: unset[1], value: "", unset: true });
        continue;
      }
      const set = /^\s+([^:]+):\s*(.*)$/.exec(line);
      if (set?.[1]) current.lines.push({ name: set[1].trim(), value: set[2] ?? "", unset: false });
      continue;
    }
    current = { path: line.trim(), lines: [] };
    rules.push(current);
  }
  return rules;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One splat, as in Cloudflare's `_headers` path patterns. */
export function headerRuleMatches(pattern: string, requestPath: string): boolean {
  const parts = pattern.split("*");
  if (parts.length > 2) return false;
  const body = parts.map((part) => escapeRegExp(part)).join(".*");
  return new RegExp(`^${body}$`).test(requestPath);
}

/**
 * Headers a request would receive. `!` clears a name before a later line in
 * the same or a later rule sets it, so the values are not comma-joined.
 */
export function headersFor(text: string, requestPath: string): Map<string, string> {
  const acc = new Map<string, string>();
  for (const rule of parseHeadersFile(text)) {
    if (!headerRuleMatches(rule.path, requestPath)) continue;
    for (const line of rule.lines) {
      const key = line.name.toLowerCase();
      if (line.unset) acc.delete(key);
      else if (acc.has(key)) acc.set(key, `${acc.get(key)}, ${line.value}`);
      else acc.set(key, line.value);
    }
  }
  return acc;
}

/** `/*` in the app build becomes `/app/*`, so the app policy does not cover the rest of the site. */
export function prefixAppHeaderPath(pattern: string): string {
  if (pattern.startsWith("/")) return `/app${pattern}`;
  return `/app/${pattern}`;
}

/** Headers for every page of the site, the web app included. Never Content-Security-Policy. */
const SITE_HEADERS: HeaderLine[] = [
  { name: "X-Content-Type-Options", value: "nosniff", unset: false },
  { name: "Referrer-Policy", value: "no-referrer", unset: false },
];

/**
 * Rewrite the app build's `_headers` onto the site root.
 * Pages applies every matching rule and joins a repeated header with a comma,
 * so the site's `/*` rule never sets Content-Security-Policy, and the `/app/*`
 * rule leaves out the headers `/*` already sends with the same value. The app
 * policy is then the only Content-Security-Policy on `/app/*`, without `!`
 * lines. A header both rules set with different values would be joined, so it
 * fails the build instead.
 * https://developers.cloudflare.com/pages/configuration/headers/
 */
export function mergeAppHeaders(appHeaders: string): string {
  const site = new Map(SITE_HEADERS.map((line) => [line.name.toLowerCase(), line.value]));
  const rules = parseHeadersFile(appHeaders).map((rule) => ({
    path: prefixAppHeaderPath(rule.path),
    lines: rule.lines.filter((line) => {
      const key = line.name.toLowerCase();
      if (line.unset || !site.has(key)) return true;
      if (site.get(key) === line.value) return false;
      throw new Error(
        `网页版的 _headers 给 ${line.name} 设了 "${line.value}"，和整站的 "${site.get(key)}" 不同，两个值会被拼在一起 / ` +
          `the web app's _headers sets ${line.name} to "${line.value}", unlike the site's "${site.get(key)}"; Pages would join the two`,
      );
    }),
  }));
  const out: string[] = [
    "# Cloudflare Pages applies every matching rule, in order, and joins a repeated header with a comma.",
    "# https://developers.cloudflare.com/pages/configuration/headers/",
    "# The /* rule below never sets Content-Security-Policy; /app/* sets the policy copied from packages/app/dist/_headers.",
    "",
    "/*",
    ...SITE_HEADERS.map((line) => `  ${line.name}: ${line.value}`),
    "",
  ];
  for (const rule of rules) {
    out.push(rule.path);
    for (const line of rule.lines) {
      out.push(line.unset ? `  ! ${line.name}` : `  ${line.name}: ${line.value}`);
    }
    out.push("");
  }
  return `${out.join("\n")}`;
}

export function findRepoRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "site", "index.html")) && fs.existsSync(path.join(dir, SCHEMA_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export interface SiteBuildOptions {
  outDir: string;
  cwd?: string;
  repoRoot?: string;
  /** Defaults to packages/app/dist in the repo. Pass a missing path to force the placeholder. */
  appDist?: string;
  registry?: string;
  log?: (line: string) => void;
}

export interface SiteBuildResult {
  outDir: string;
  /** True when /app/ is the coming-soon page. */
  placeholder: boolean;
}

/** GitHub-style heading slug: punctuation drops out, and " / " becomes "--". */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/ /g, "-");
}

function rewriteOutsideFences(md: string, fn: (chunk: string) => string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith("```") ? part : fn(part)))
    .join("");
}

function headingTexts(md: string): string[] {
  const texts: string[] = [];
  rewriteOutsideFences(md, (chunk) => {
    for (const line of chunk.split("\n")) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading?.[2]) texts.push(heading[2].replace(/[*_`]/g, "").trim());
    }
    return chunk;
  });
  return texts;
}

function addHeadingIds(html: string, texts: string[]): string {
  const seen = new Map<string, number>();
  let i = 0;
  return html.replace(/<h([1-6])>/g, (_m, level: string) => {
    const base = githubSlug(texts[i++] ?? "") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    return `<h${level} id="${escapeHtml(id)}">`;
  });
}

function mapDocUrl(url: string, fromDoc: string, names: Set<string>): string {
  if (/^(https?:|mailto:)/i.test(url) || url.startsWith("#")) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const pathPart = hashAt >= 0 ? url.slice(0, hashAt) : url;
  if (!pathPart) return url;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(pathPart, `https://flowgit.local/docs/${fromDoc}`).pathname);
  } catch {
    return url;
  }
  if (pathname === "/packages/core/schema/flow.schema.json" || pathname.endsWith("/packages/core/schema/flow.schema.json")) {
    return `/schema/flow/0.1.json${hash}`;
  }
  if (pathname.startsWith("/docs/")) {
    const rest = pathname.slice("/docs/".length).replace(/\/$/, "");
    const name = rest.endsWith(".md") ? rest.slice(0, -3) : rest;
    if (name && !name.includes("/") && names.has(name)) return `/docs/${name}/${hash}`;
  }
  const repoPath = pathname.replace(/^\/+/, "");
  if (!repoPath || repoPath.startsWith("docs/")) return url;
  const kind = path.posix.extname(repoPath) ? "blob" : "tree";
  return `${REPO_WEB_URL}/${kind}/main/${repoPath}${hash}`;
}

function rewriteDocLinks(md: string, fromDoc: string, names: Set<string>): string {
  return rewriteOutsideFences(md, (chunk) =>
    chunk.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_full, text: string, url: string) => `[${text}](${mapDocUrl(url, fromDoc, names)})`),
  );
}

interface DocPage {
  name: string;
  title: string;
  html: string;
  headings: { id: string; text: string; level: number }[];
}

function renderDoc(md: string, fromDoc: string, names: Set<string>): { html: string; title: string; headings: DocPage["headings"] } {
  const texts = headingTexts(md);
  const rewritten = rewriteDocLinks(md, fromDoc, names);
  const html = addHeadingIds(renderMarkdown(rewritten), texts);
  const headings: DocPage["headings"] = [];
  const seen = new Map<string, number>();
  for (const text of texts) {
    const base = githubSlug(text) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    const level = 0;
    headings.push({ id, text, level });
  }
  // Levels come from the rendered tags, in the same order.
  let i = 0;
  for (const match of html.matchAll(/<h([1-6]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)) {
    const item = headings[i];
    if (item && match[1] && match[2]) {
      item.level = Number(match[1]);
      item.id = match[2];
      item.text = (match[3] ?? "").replace(/<[^>]+>/g, "");
    }
    i += 1;
  }
  const title = texts[0] || fromDoc.replace(/\.md$/, "");
  return { html, title, headings };
}

function docPages(docsDir: string): DocPage[] {
  const files = fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith(".md") && fs.statSync(path.join(docsDir, name)).isFile());
  const names = new Set(files.map((name) => name.slice(0, -3)));
  const order = (name: string) => (name === "guide" ? "0" : name === "spec" ? "1" : `2${name}`);
  return files
    .map((file) => file.slice(0, -3))
    .sort((a, b) => order(a).localeCompare(order(b)))
    .map((name) => {
      const md = fs.readFileSync(path.join(docsDir, `${name}.md`), "utf8");
      const rendered = renderDoc(md, `${name}.md`, names);
      return { name, title: rendered.title, html: rendered.html, headings: rendered.headings };
    });
}

const SITE_CSS = `/*
 * Flowgit website (docs and the /app placeholder).
 * Swiss grid: heavy rules, sharp corners, type that does the work.
 * Light and dark follow the system. This file is the site's own stylesheet.
 */
:root {
  color-scheme: light;
  --bg: #f3f4f6;
  --surface: #ffffff;
  --ink: #0a0a0b;
  --muted: #5d6169;
  --rule: #0a0a0b;
  --hair: #c6c9d0;
  --accent: #2233ee;
  --accent-ink: #ffffff;
  --code-bg: #111318;
  --code-ink: #e6e9ef;
  --font-ui: "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-display: "Helvetica Neue", "Arial Black", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0d1015;
    --surface: #141922;
    --ink: #e7ebf2;
    --muted: #8b94a5;
    --rule: #e7ebf2;
    --hair: #252c38;
    --accent: #8eaaef;
    --accent-ink: #0d1015;
    --code-bg: #080a0e;
    --code-ink: #e6e9ef;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-ui);
  line-height: 1.5;
}
a { color: inherit; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 2px solid var(--ink);
}
.brand {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 28px;
  letter-spacing: -0.04em;
  text-decoration: none;
  line-height: 1;
}
.nav {
  display: flex;
  flex-wrap: wrap;
  margin-left: auto;
}
.nav a {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 8px 14px;
  border-left: 2px solid var(--ink);
  text-decoration: none;
  font-weight: 700;
}
.nav a[aria-current="page"] { background: var(--ink); color: var(--bg); }
.layout {
  display: grid;
  grid-template-columns: minmax(200px, 280px) minmax(0, 1fr);
  align-items: start;
}
.toc {
  position: sticky;
  top: 0;
  max-height: 100vh;
  overflow: auto;
  padding: 16px 14px 28px;
  border-right: 2px solid var(--ink);
}
.toc-label {
  margin: 14px 0 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc a { display: block; padding: 5px 0; text-decoration: none; }
.toc a[aria-current="page"] { font-weight: 800; }
.toc .page-toc a { color: var(--muted); font-size: 14px; }
.doc { min-width: 0; padding: 22px 22px 64px; }
.doc h1 {
  margin: 0 0 16px;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: clamp(32px, 5vw, 56px);
  letter-spacing: -0.04em;
  line-height: 1.02;
}
.prose { max-width: 78ch; }
.prose h2, .prose h3 {
  font-family: var(--font-display);
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin: 1.4em 0 0.4em;
}
.prose pre {
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 14px 16px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
}
.prose code { font-family: var(--font-mono); font-size: 0.92em; }
.prose .table-wrap { overflow-x: auto; margin: 0 0 1em; }
.prose table { border-collapse: collapse; width: 100%; font-size: 14px; }
.prose th, .prose td { border: 1px solid var(--hair); padding: 6px 8px; vertical-align: top; text-align: left; }
.prose a { color: var(--accent); }
.placeholder { padding: 28px 22px 72px; max-width: 68ch; }
.placeholder h1 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: clamp(36px, 8vw, 68px);
  letter-spacing: -0.04em;
  line-height: 0.98;
}
.placeholder p { font-size: 18px; }
.placeholder a { color: var(--accent); }
@media (max-width: 720px) {
  .layout { grid-template-columns: 1fr; }
  .toc {
    position: static;
    max-height: none;
    border-right: 0;
    border-bottom: 2px solid var(--ink);
  }
  .nav a { border-left: 0; border-top: 2px solid var(--ink); min-height: 44px; }
  .brand { font-size: 24px; }
  .doc { padding: 16px 16px 48px; }
}
`;

function siteHeader(current: "docs" | "gallery" | "app" | ""): string {
  const item = (href: string, id: "docs" | "gallery" | "app", label: string) =>
    `<a href="${href}"${current === id ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="top">
  <a class="brand" href="/">Flowgit</a>
  <nav class="nav" aria-label="页面">
    ${item("/docs/", "docs", "文档")}
    ${item("/gallery/", "gallery", "画廊")}
    ${item("/app/", "app", "网页版")}
    <a href="/schema/flow/0.1.json">Schema</a>
    <a href="${REPO_WEB_URL}">GitHub</a>
  </nav>
</header>`;
}

function tocHtml(pages: DocPage[], current: string | undefined): string {
  const docs = pages
    .map((page) => {
      const href = `/docs/${page.name}/`;
      const currentAttr = page.name === current ? ' aria-current="page"' : "";
      return `<li><a href="${href}"${currentAttr}>${escapeHtml(page.title)}</a></li>`;
    })
    .join("");
  const here = pages.find((page) => page.name === current);
  const onPage = (here?.headings ?? [])
    .filter((heading) => heading.level >= 2 && heading.level <= 3)
    .map((heading) => `<li><a href="#${escapeHtml(heading.id)}">${heading.text}</a></li>`)
    .join("");
  return `<nav class="toc" aria-label="目录">
  <p class="toc-label">目录</p>
  <ol>${docs}</ol>
  ${onPage ? `<p class="toc-label">本页</p><ol class="page-toc">${onPage}</ol>` : ""}
</nav>`;
}

function docShell(pages: DocPage[], page: DocPage | undefined, bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Flowgit</title>
<link rel="stylesheet" href="/assets/site.css" />
</head>
<body>
${siteHeader("docs")}
<div class="layout">
${tocHtml(pages, page?.name)}
<main class="doc">
${bodyHtml}
</main>
</div>
</body>
</html>
`;
}

function placeholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>网页版即将上线 / The web app is coming soon · Flowgit</title>
<link rel="stylesheet" href="/assets/site.css" />
</head>
<body>
${siteHeader("app")}
<main class="placeholder">
  <h1>网页版即将上线 / The web app is coming soon</h1>
  <p>浏览器里的 Flowgit 会放在这个地址。现在可以先用命令行：<code>flowgit init</code>。 / The browser app will live at this address. Until then, start from the command line: <code>flowgit init</code>.</p>
  <p><a href="/">返回首页 / Back to the home page</a> · <a href="/docs/">文档 / Docs</a></p>
</main>
</body>
</html>
`;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/** Internal href/src targets under `root` that do not resolve to a file. External URLs are ignored. */
export function findDeadLinks(root: string): string[] {
  const dead: string[] = [];
  const htmlFiles = walkFiles(root).filter((file) => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)) {
      const raw = match[1] ?? "";
      if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^(https?:|mailto:|data:|javascript:)/i.test(raw)) continue;
      const noHash = raw.split("#")[0]?.split("?")[0] ?? "";
      if (!noHash) continue;
      let decoded = noHash;
      try {
        decoded = decodeURIComponent(noHash);
      } catch {
        // keep the raw path
      }
      const abs = decoded.startsWith("/")
        ? path.resolve(root, decoded.replace(/^\/+/, ""))
        : path.resolve(path.dirname(file), decoded);
      const inside = path.relative(root, abs);
      if (inside.startsWith("..") || path.isAbsolute(inside)) {
        dead.push(`${path.relative(root, file)} -> ${raw}`);
        continue;
      }
      const asFile = fs.existsSync(abs) && fs.statSync(abs).isFile();
      const asIndex = fs.existsSync(path.join(abs, "index.html"));
      if (!asFile && !asIndex) dead.push(`${path.relative(root, file)} -> ${raw}`);
    }
  }
  return dead;
}

function copyApp(appDist: string, outDir: string): void {
  const headersPath = path.join(appDist, "_headers");
  if (!fs.existsSync(headersPath)) {
    throw new Error("网页版构建结果里没有 _headers，不能手写内容安全策略 / the web app build has no _headers; the policy is not copied by hand");
  }
  const dest = path.join(outDir, "app");
  fs.cpSync(appDist, dest, { recursive: true });
  // Pages reads the _headers file in the build output root, not a nested copy.
  // https://developers.cloudflare.com/pages/configuration/headers/
  fs.rmSync(path.join(dest, "_headers"), { force: true });
  fs.writeFileSync(path.join(outDir, "_headers"), mergeAppHeaders(fs.readFileSync(headersPath, "utf8")));
}

/** Write the static site. Throws a bilingual error when an internal link is dead. */
export async function buildSite(options: SiteBuildOptions): Promise<SiteBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = options.repoRoot ?? findRepoRoot(cwd) ?? findRepoRoot(moduleDir);
  if (!repoRoot) {
    throw new Error("找不到仓库根目录（需要 site/index.html） / could not find the repository root (site/index.html)");
  }
  const outDir = path.resolve(cwd, options.outDir);
  if (outDir === path.resolve(repoRoot) || outDir === path.parse(outDir).root) {
    throw new Error("输出目录不能是仓库根目录 / the output directory cannot be the repository root");
  }
  const inRepo = path.relative(outDir, path.resolve(repoRoot));
  if (!inRepo.startsWith("..") && !path.isAbsolute(inRepo)) {
    throw new Error("输出目录不能包含仓库 / the output directory cannot contain the repository");
  }
  // The directory is replaced, so it must be empty or an earlier site build (it has assets/site.css).
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length && !fs.existsSync(path.join(outDir, "assets", "site.css"))) {
    throw new Error(
      `${outDir} 已经有别的文件，不是之前生成的官网，什么都没删 / ${outDir} has other files and is not an earlier site build; nothing was deleted`,
    );
  }
  const log = options.log ?? (() => {});
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "assets", "site.css"), SITE_CSS);
  fs.copyFileSync(path.join(repoRoot, "site", "index.html"), path.join(outDir, "index.html"));

  const registry = options.registry ?? registryLocation(process.env, repoRoot);
  await buildGallery({ outDir: path.join(outDir, "gallery"), cwd: repoRoot, registry });

  const pages = docPages(path.join(repoRoot, "docs"));
  const indexBody = `<article class="prose"><h1>文档</h1><p>这些页面照仓库里的 <code>docs/*.md</code> 渲染，中英文都保留。 / These pages are the repository's <code>docs/*.md</code> files, in both languages, as written.</p><p><a href="/registry.json">registry.json</a></p><ul>${pages
    .map((page) => `<li><a href="/docs/${page.name}/">${escapeHtml(page.title)}</a></li>`)
    .join("")}</ul></article>`;
  fs.mkdirSync(path.join(outDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "docs", "index.html"), docShell(pages, undefined, indexBody, "文档 / Docs"));
  for (const page of pages) {
    const dir = path.join(outDir, "docs", page.name);
    fs.mkdirSync(dir, { recursive: true });
    const body = `<article class="prose">${page.html}</article>`;
    fs.writeFileSync(path.join(dir, "index.html"), docShell(pages, page, body, page.title));
  }

  const schemaSrc = path.join(repoRoot, SCHEMA_REL);
  const schemaDest = path.join(outDir, "schema", "flow", "0.1.json");
  fs.mkdirSync(path.dirname(schemaDest), { recursive: true });
  fs.copyFileSync(schemaSrc, schemaDest);

  const appDist = options.appDist ?? path.join(repoRoot, "packages", "app", "dist");
  const placeholder = !fs.existsSync(path.join(appDist, "index.html"));
  if (placeholder) {
    fs.mkdirSync(path.join(outDir, "app"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "app", "index.html"), placeholderHtml());
    fs.writeFileSync(
      path.join(outDir, "_headers"),
      ["# No web app build, so there is no app Content-Security-Policy to merge.", "/*", ...SITE_HEADERS.map((line) => `  ${line.name}: ${line.value}`), ""].join("\n"),
    );
    log(APP_PLACEHOLDER_LINE);
  } else {
    copyApp(appDist, outDir);
  }

  const localRegistry = findRepoRegistry(repoRoot);
  if (localRegistry) {
    const loaded = await loadCommunityRegistry(localRegistry);
    if (!loaded.ok && loaded.kind === "invalid") {
      throw new Error([`社区模板登记不合法 / the community registry is invalid: ${loaded.from}`, ...loaded.errors].join("\n"));
    }
    fs.writeFileSync(path.join(outDir, "registry.json"), `${JSON.stringify(loaded.ok ? loaded.entries : [], null, 2)}\n`);
  }

  const dead = findDeadLinks(outDir);
  if (dead.length) {
    throw new Error(["站内有死链 / dead internal links:", ...dead.map((item) => `  ${item}`)].join("\n"));
  }
  return { outDir, placeholder };
}

export function registerSite(program: Command, fail: (err: unknown) => never): void {
  const site = program.command("site").description("官网静态页面 / the website");
  site
    .command("build")
    .description("生成整站到一个目录，并检查站内死链 / write the whole site into a directory and check internal links")
    .option("--out <dir>", "输出目录 / output directory", "site-dist")
    .action(async (opts: { out: string }) => {
      try {
        const result = await buildSite({ outDir: opts.out, log: (line) => console.log(line) });
        console.log(`${c.green("✓")} 已生成官网 / wrote the website: ${result.outDir}`);
      } catch (err) {
        fail(err);
      }
    });
}
