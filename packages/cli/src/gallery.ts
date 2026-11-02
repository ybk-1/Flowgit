import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFlowFile, flowToMermaid, readFlowFile, renderSkillMd, type Flow } from "@flowgit/core";
import { escapeHtml, extractSources, renderMarkdown } from "./markdown.js";
import { loadCommunityRegistry, registryLocation, splitGitFragment, type CommunityEntry } from "./registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(here, "..", "templates");
const DEFAULT_TEMPLATE = "short-video";

/**
 * Draw the diagram `flowToMermaid` already produced.
 * The gallery is a static folder. Loading Mermaid from a CDN would make every
 * page depend on the network and on a third-party script, and GitHub Pages is
 * not part of this build. The flowchart subset Flowgit emits (nodes, `<br/>`,
 * `-->`) is small enough to lay out as an inline SVG.
 */
export function mermaidToSvg(source: string): string {
  const nodes: { id: string; title: string; sub: string }[] = [];
  const edges: { from: string; to: string }[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const node = /^(\w+)\["([\s\S]*)"\]$/.exec(line);
    if (node) {
      const parts = unescapeMermaid(node[2] ?? "").split("<br/>");
      nodes.push({ id: node[1] ?? "", title: parts[0] ?? "", sub: parts.slice(1).join(" ") });
      continue;
    }
    const edge = /^(\w+)\s+-->\s+(\w+)$/.exec(line);
    if (edge) edges.push({ from: edge[1] ?? "", to: edge[2] ?? "" });
  }
  if (!nodes.length) return "";
  const incoming = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);
  const column = new Map<string, number>();
  const walk = (id: string, stack: Set<string>): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const ups = incoming.get(id) ?? [];
    const value = ups.length ? Math.max(...ups.map((up) => walk(up, stack))) + 1 : 0;
    stack.delete(id);
    column.set(id, value);
    return value;
  };
  for (const node of nodes) walk(node.id, new Set());
  const columns: (typeof nodes)[] = [];
  for (const node of nodes) {
    const index = column.get(node.id) ?? 0;
    (columns[index] ??= []).push(node);
  }
  const maxText = Math.max(...nodes.flatMap((n) => [textUnits(n.title), textUnits(n.sub)]));
  const boxW = Math.min(280, Math.max(148, Math.ceil(maxText + 28)));
  const boxH = 64;
  const gapX = 56;
  const gapY = 22;
  const pad = 18;
  const colW = boxW + gapX;
  const maxRows = Math.max(1, ...columns.map((col) => col.length));
  const width = pad * 2 + columns.length * boxW + Math.max(0, columns.length - 1) * gapX;
  const height = pad * 2 + maxRows * boxH + Math.max(0, maxRows - 1) * gapY;
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, ci) => {
    const totalH = col.length * boxH + Math.max(0, col.length - 1) * gapY;
    const y0 = (height - totalH) / 2;
    col.forEach((node, ri) => pos.set(node.id, { x: pad + ci * colW, y: y0 + ri * (boxH + gapY) }));
  });
  const arrows = edges
    .map((edge) => {
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      if (!a || !b) return "";
      const x1 = a.x + boxW;
      const y1 = a.y + boxH / 2;
      const x2 = b.x;
      const y2 = b.y + boxH / 2;
      const mid = (x1 + x2) / 2;
      return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2 - 1} ${y2}" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#fg-arrow)"/>`;
    })
    .join("");
  const shapes = nodes
    .map((node) => {
      const p = pos.get(node.id);
      if (!p) return "";
      const title = escapeXml(fitText(node.title, boxW - 24));
      const sub = escapeXml(fitText(node.sub, boxW - 24));
      return `<g><title>${escapeXml(node.title)} ${escapeXml(node.sub)}</title><rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" fill="var(--surface)" stroke="currentColor" stroke-width="2"/><text x="${p.x + boxW / 2}" y="${p.y + 26}" text-anchor="middle" fill="currentColor" font-family="var(--font-ui), sans-serif" font-size="14">${title}</text><text x="${p.x + boxW / 2}" y="${p.y + 46}" text-anchor="middle" fill="var(--muted)" font-family="var(--font-mono), monospace" font-size="12">${sub}</text></g>`;
    })
    .join("");
  return `<svg class="graph-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(nodes.map((n) => n.title).join(" → "))}"><defs><marker id="fg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>${arrows}${shapes}</svg>`;
}

function unescapeMermaid(s: string): string {
  return s.replaceAll("#gt;", ">").replaceAll("#lt;", "<").replaceAll("#quot;", '"').replaceAll("#35;", "#");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textUnits(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? 14 : 7.2;
  return w;
}

function fitText(s: string, max: number): string {
  if (textUnits(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 255 ? 14 : 7.2;
    if (w + cw > max - 14) return `${out}…`;
    out += ch;
    w += cw;
  }
  return out;
}

export function splitBilingual(text: string): { zh: string; en: string } {
  const trimmed = text.trim();
  const spaced = trimmed.indexOf(" / ");
  if (spaced > 0) {
    const zh = trimmed.slice(0, spaced).trim();
    const en = trimmed.slice(spaced + 3).trim();
    if (zh && en) return { zh, en };
  }
  // "周报（入门示例）/ Weekly report" has no spaces around the slash.
  const tight = /^(.*[\u3400-\u9fff）】」])\s*\/\s*([A-Za-z].*)$/.exec(trimmed);
  if (tight?.[1] && tight[2]) return { zh: tight[1].trim(), en: tight[2].trim() };
  return { zh: trimmed, en: trimmed };
}

function flowLanguages(flow: Flow): ("zh" | "en")[] {
  const set = new Set<"zh" | "en">();
  if (flow.language === "zh" || flow.language === "en") set.add(flow.language);
  const input = flow.inputs?.language;
  if (input && Array.isArray(input.enum)) {
    for (const value of input.enum) {
      if (value === "zh" || value === "en") set.add(value);
    }
  }
  if (!set.size) set.add("zh");
  return [...set];
}

function asFlow(data: unknown): Flow | undefined {
  if (!data || typeof data !== "object") return undefined;
  const flow = data as Flow;
  if (typeof flow.name !== "string" || !Array.isArray(flow.stages)) return undefined;
  return flow;
}

function readmeTitle(md: string, flow: Flow): { zh: string; en: string } {
  const heading = /^#\s+(.+)$/m.exec(md);
  if (heading?.[1]) return splitBilingual(heading[1].replace(/[*_`]/g, ""));
  return splitBilingual(flow.name);
}

interface PageModel {
  id: string;
  kind: "bundled" | "community";
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  languages: string[];
  tags: string[];
  stages: { name: string; executor: string }[];
  readmeHtml: string;
  sources: string[];
  skill: string;
  initCommand: string;
  svg: string;
  license?: string;
  author?: string;
  sourceHref?: string;
}

function pageFromDir(id: string, dir: string, kind: PageModel["kind"], extra: { license?: string; author?: string; sourceHref?: string } = {}): PageModel | undefined {
  let file: string | undefined;
  try {
    file = findFlowFile(dir);
  } catch {
    return undefined;
  }
  if (!file) return undefined;
  const flow = asFlow(readFlowFile(file));
  if (!flow) return undefined;
  const readmePath = path.join(dir, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const author = extra.author ?? flow.author?.name;
  const license = extra.license ?? flow.license;
  return {
    id,
    kind,
    name: readmeTitle(readme, flow),
    description: splitBilingual(flow.description ?? ""),
    languages: flowLanguages(flow),
    tags: (flow.tags ?? []).filter((tag): tag is string => typeof tag === "string" && tag.length > 0),
    stages: flow.stages.map((stage) => ({ name: stage.name, executor: stage.executor.type })),
    readmeHtml: readme ? renderMarkdown(readme) : "",
    sources: extractSources(readme),
    skill: renderSkillMd(flow, path.basename(file)),
    initCommand: `flowgit init my-${id} -t ${id}`,
    svg: mermaidToSvg(flowToMermaid(flow)),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    ...(extra.sourceHref ? { sourceHref: extra.sourceHref } : {}),
  };
}

function bundledDirs(): string[] {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir)
    .filter((id) => {
      try {
        return !!findFlowFile(path.join(templatesDir, id));
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a === DEFAULT_TEMPLATE ? -1 : b === DEFAULT_TEMPLATE ? 1 : a.localeCompare(b)));
}

function checkoutRoot(registryFile: string): string | undefined {
  if (/^https?:\/\//i.test(registryFile)) return undefined;
  const abs = path.resolve(registryFile.startsWith("file:") ? fileURLToPath(registryFile) : registryFile);
  if (path.basename(path.dirname(abs)) !== "registry") return undefined;
  return path.dirname(path.dirname(abs));
}

function localCommunityDir(root: string | undefined, entry: CommunityEntry): string | undefined {
  if (!root) return undefined;
  const sub = splitGitFragment(entry.git).path;
  if (!sub) return undefined;
  const abs = path.resolve(root, sub);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  try {
    if (!findFlowFile(abs)) return undefined;
  } catch {
    return undefined;
  }
  return abs;
}

/** GitHub tree URL when the entry points at github.com; otherwise the clone URL without the fragment. */
export function communityWebUrl(entry: CommunityEntry): string {
  const split = splitGitFragment(entry.git);
  const branch = entry.ref || "main";
  const match = split.url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?$/i);
  if (match) {
    const base = `https://github.com/${match[1]}/${match[2]}`;
    return split.path ? `${base}/tree/${branch}/${split.path}` : base;
  }
  return split.url;
}

function bi(zh: string, en: string): string {
  return `<span class="zh">${escapeHtml(zh)}</span><span class="en">${escapeHtml(en)}</span>`;
}

const ICONS: Record<string, string> = {
  human: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 19c1.4-3 3.8-4.5 7-4.5S17.6 16 19 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  llm: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  script: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 9l3 3-3 3M12 15h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  agent: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7V5h6v2M9 12h.01M15 12h.01M9 16h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  service: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 12h16M12 4c2.2 2.4 3.3 5 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5-3.3-8s1.1-5.6 3.3-8z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  workflow: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="6" height="6" fill="none" stroke="currentColor" stroke-width="2"/><rect x="15" y="14" width="6" height="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7h4a3 3 0 013 3v4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  mcp: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l3-3 3 3-3 3M10 17l-3 3-3-3 3-3M14 7l-4 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function execIcons(stages: { executor: string }[]): string {
  return stages
    .map((stage) => {
      const type = stage.executor;
      const svg = ICONS[type] ?? ICONS.script;
      return `<span class="exec" title="${escapeHtml(type)}">${svg}<span class="sr">${escapeHtml(type)}</span></span>`;
    })
    .join("");
}

function shell(opts: { title: string; depth: number; body: string }): string {
  const prefix = opts.depth === 0 ? "" : "../".repeat(opts.depth);
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="${prefix}assets/gallery.css" />
</head>
<body>
${opts.body}
<script src="${prefix}assets/gallery.js"></script>
</body>
</html>
`;
}

function header(depth: number): string {
  const home = depth === 0 ? "index.html" : `${"../".repeat(depth)}index.html`;
  return `<header class="top">
  <a class="brand-block" href="${home}">
    <p class="brand">Flowgit</p>
    <p class="brand-name">${bi("模板画廊", "Template gallery")}</p>
  </a>
  <div class="lang-switch" role="group" aria-label="中文 / English">
    <button type="button" data-lang-btn="zh" aria-pressed="true">中文</button>
    <button type="button" data-lang-btn="en" aria-pressed="false">English</button>
  </div>
</header>`;
}

function homePage(pages: PageModel[], cards: HomeCard[], note?: string): string {
  const tags = [...new Set(cards.flatMap((card) => card.tags))].sort((a, b) => a.localeCompare(b));
  const tagButtons = [
    `<button type="button" data-tag="" aria-pressed="true">${bi("全部", "All")}</button>`,
    ...tags.map((tag) => `<button type="button" data-tag="${escapeHtml(tag)}" aria-pressed="false">${escapeHtml(tag)}</button>`),
  ].join("");
  const noteHtml = note ? `<p class="banner" role="status">${escapeHtml(note)}</p>` : "";
  const cardHtml = cards
    .map((card) => {
      const external = card.external ? ` target="_blank" rel="noreferrer"` : "";
      const count = card.stages
        ? `<p class="count"><span class="num">${card.stages.length}</span> ${bi("个阶段", "stages")}</p><p class="execs">${execIcons(card.stages)}</p>`
        : `<p class="count">${bi("社区模板", "Community template")}</p>`;
      const langs = card.languages.map((lang) => `<span class="pill">${escapeHtml(lang)}</span>`).join("");
      const tagList = card.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
      return `<a class="card" href="${escapeHtml(card.href)}"${external} data-tags="${escapeHtml(JSON.stringify(card.tags))}" data-search="${escapeHtml([card.id, card.name.zh, card.name.en, card.description.zh, card.description.en, ...card.tags].join(" ").toLowerCase())}">
  <p class="kicker">${card.kind === "bundled" ? bi("自带", "Bundled") : bi("社区", "Community")} <span class="id">${escapeHtml(card.id)}</span></p>
  <h2>${bi(card.name.zh, card.name.en)}</h2>
  <p class="one-line">${bi(card.description.zh, card.description.en)}</p>
  <div class="card-meta">${count}<p class="pills">${langs}</p></div>
  ${tagList ? `<ul class="tags">${tagList}</ul>` : ""}
</a>`;
    })
    .join("\n");
  const body = `${header(0)}
<main>
  <section class="hero">
    <h1>${bi("挑一个流程，拿去用", "Pick a flow and start from it")}</h1>
    <p class="lede">${bi(
      `自带 ${pages.filter((p) => p.kind === "bundled").length} 个模板，社区模板从登记里来。搜索和标签都在这个页面里完成。`,
      `${pages.filter((p) => p.kind === "bundled").length} bundled templates, plus community templates from the registry. Search and tags run in this page.`,
    )}</p>
  </section>
  ${noteHtml}
  <div class="tools">
    <label class="sr" for="q">${bi("搜索模板", "Search templates")}</label>
    <input id="q" type="search" placeholder="搜索 / Search" autocomplete="off" />
    <div class="tag-row">${tagButtons}</div>
  </div>
  <div class="cards">${cardHtml}</div>
  <p id="empty" class="empty" hidden>${bi("没有匹配的模板。", "No templates match.")}</p>
  <footer class="colophon">
    <p>${bi("想把自己的流程放进来，给 registry/community.json 开一个 Pull Request。审核要能通过校验、没有密钥、许可证写清楚，并且模板里有「依据 / Sources」。", "To add your flow, open a pull request on registry/community.json. Review checks that it validates, has no secrets, names a clear license, and that the template has 依据 / Sources.")}</p>
  </footer>
</main>`;
  return shell({ title: "模板画廊 / Template gallery · Flowgit", depth: 0, body });
}

interface HomeCard {
  href: string;
  external: boolean;
  id: string;
  kind: PageModel["kind"];
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  languages: string[];
  tags: string[];
  stages?: { name: string; executor: string }[];
}

function templatePage(page: PageModel): string {
  const sources = page.sources.length
    ? `<ul>${page.sources.map((item) => `<li>${item}</li>`).join("")}</ul>`
    : `<p>${bi("这份模板还没有「依据 / Sources」一节。", "This template has no Sources section yet.")}</p>`;
  const meta = [
    page.author ? `<span>${bi("作者", "Author")} ${escapeHtml(page.author)}</span>` : "",
    page.license ? `<span>${bi("许可证", "License")} ${escapeHtml(page.license)}</span>` : "",
    page.languages.map((lang) => `<span class="pill">${escapeHtml(lang)}</span>`).join(""),
  ]
    .filter(Boolean)
    .join("");
  const source = page.sourceHref
    ? `<p class="source-link"><a href="${escapeHtml(page.sourceHref)}" rel="noreferrer">${bi("仓库里的这份模板", "This template in the repository")}</a></p>`
    : "";
  const body = `${header(2)}
<main class="template">
  <p class="kicker">${page.kind === "bundled" ? bi("自带模板", "Bundled template") : bi("社区模板", "Community template")} <span class="id">${escapeHtml(page.id)}</span></p>
  <h1>${bi(page.name.zh, page.name.en)}</h1>
  <p class="lede">${bi(page.description.zh, page.description.en)}</p>
  <p class="meta-row">${meta}</p>
  ${page.tags.length ? `<ul class="tags">${page.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>` : ""}
  <section>
    <h2>${bi("新建", "Create")}</h2>
    <div class="command">
      <code>${escapeHtml(page.initCommand)}</code>
      <button type="button" data-copy="${escapeHtml(page.initCommand)}">${bi("复制", "Copy")}</button>
    </div>
    ${source}
  </section>
  <section>
    <h2>${bi("阶段", "Stages")} <span class="quiet">${page.stages.length}</span></h2>
    <!-- Inline SVG from flowToMermaid. A CDN Mermaid script would make this static gallery depend on the network. -->
    <p class="graph-why">${bi("这张图是嵌在页面里的 SVG，按流程图数据画出来，不从 CDN 加载 Mermaid，离线也能看。", "This diagram is an SVG drawn into the page from the flow diagram. Mermaid is not loaded from a CDN, so the page works offline.")}</p>
    <div class="graph">${page.svg}</div>
    <p class="execs execs-legend">${execIcons(page.stages)}</p>
  </section>
  <section>
    <h2>README</h2>
    <article class="readme">${page.readmeHtml || `<p>${bi("这个模板没有 README。", "This template has no README.")}</p>`}</article>
  </section>
  <section id="sources">
    <h2>${bi("依据", "Sources")}</h2>
    ${sources}
  </section>
  <section>
    <h2>SKILL.md</h2>
    <p>${bi("下载给会读 Skill 的 AI 工具，它可以按阶段运行这个流程。", "Download it for an AI tool that reads skills. The tool can run this flow stage by stage.")}</p>
    <a class="btn" href="SKILL.md" download="SKILL.md">${bi("导出 SKILL.md", "Export SKILL.md")}</a>
  </section>
</main>`;
  return shell({ title: `${page.name.zh} / ${page.name.en} · Flowgit`, depth: 2, body });
}

export interface GalleryBuildResult {
  outDir: string;
  pages: string[];
  note?: string;
}

/** Write the static gallery. Invalid registry fails; an unreadable one still writes the bundled pages and one note. */
export async function buildGallery(options: { outDir: string; cwd?: string; registry?: string }): Promise<GalleryBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outDir = path.resolve(cwd, options.outDir);
  if (path.resolve(outDir) === path.resolve(cwd)) {
    throw new Error("输出目录不能是当前目录 / the output directory cannot be the current directory");
  }
  const source = options.registry ?? registryLocation(process.env, cwd);
  const loaded = await loadCommunityRegistry(source);
  if (!loaded.ok && loaded.kind === "invalid") {
    throw new Error([`社区模板登记不合法 / the community registry is invalid: ${loaded.from}`, ...loaded.errors].join("\n"));
  }
  const note = loaded.ok ? undefined : loaded.note;
  const entries = loaded.ok ? loaded.entries : [];
  const root = loaded.ok ? checkoutRoot(source) : undefined;
  const pages: PageModel[] = [];
  for (const id of bundledDirs()) {
    const page = pageFromDir(id, path.join(templatesDir, id), "bundled");
    if (page) pages.push(page);
  }
  const bundledIds = new Set(pages.map((page) => page.id));
  const cards: HomeCard[] = pages.map((page) => ({
    href: `templates/${page.id}/index.html`,
    external: false,
    id: page.id,
    kind: page.kind,
    name: page.name,
    description: page.description,
    languages: page.languages,
    tags: page.tags,
    stages: page.stages,
  }));
  for (const entry of entries) {
    if (bundledIds.has(entry.id)) continue;
    const href = communityWebUrl(entry);
    const dir = localCommunityDir(root, entry);
    const local = dir ? pageFromDir(entry.id, dir, "community", { license: entry.license, author: entry.author, sourceHref: href }) : undefined;
    if (local) {
      pages.push(local);
      cards.push({
        href: `templates/${local.id}/index.html`,
        external: false,
        id: local.id,
        kind: "community",
        name: { zh: entry.name.zh, en: entry.name.en },
        description: { zh: entry.description.zh, en: entry.description.en },
        languages: entry.language,
        tags: entry.tags,
        stages: local.stages,
      });
    } else {
      cards.push({
        href,
        external: true,
        id: entry.id,
        kind: "community",
        name: entry.name,
        description: entry.description,
        languages: entry.language,
        tags: entry.tags,
      });
    }
  }
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "assets", "gallery.css"), GALLERY_CSS);
  fs.writeFileSync(path.join(outDir, "assets", "gallery.js"), GALLERY_JS);
  fs.writeFileSync(path.join(outDir, "index.html"), homePage(pages, cards, note));
  const written: string[] = [];
  for (const page of pages) {
    const dir = path.join(outDir, "templates", page.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), templatePage(page));
    fs.writeFileSync(path.join(dir, "SKILL.md"), page.skill);
    written.push(page.id);
  }
  return { outDir, pages: written, ...(note ? { note } : {}) };
}

const GALLERY_CSS = `/*
 * Flowgit template gallery.
 * Swiss grid: heavy rules, sharp corners, big stage counts. Colors use the
 * same variable names as the board. This file is the gallery's own stylesheet.
 * Light and dark follow the system. No web fonts, no CDN.
 */
:root {
  color-scheme: light;
  --bg: #f3f4f6;
  --surface: #ffffff;
  --surface-2: #e8eaee;
  --ink: #0a0a0b;
  --muted: #5d6169;
  --rule: #0a0a0b;
  --hair: #c6c9d0;
  --accent: #2233ee;
  --accent-ink: #ffffff;
  --ok: #127a4a;
  --stale: #b25e00;
  --edited: #0b6e74;
  --error: #c22a1f;
  --never: var(--accent);
  --wait: #9a9ca3;
  --code-bg: #111318;
  --code-bg-2: #1b1f27;
  --code-ink: #e6e9ef;
  --code-muted: #9aa2b1;
  --card-radius: 0px;
  --btn-radius: 0px;
  --rule-w: 2px;
  --num-size: 48px;
  --num-weight: 900;
  --h1-size: clamp(40px, 7vw, 76px);
  --font-ui: "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-display: "Helvetica Neue", "Arial Black", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "SF Mono", "Source Code Pro", Menlo, Consolas, monospace;
  --num-font: var(--font-display);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0d1015;
    --surface: #141922;
    --surface-2: #1a2029;
    --ink: #e7ebf2;
    --muted: #8b94a5;
    --rule: #252c38;
    --hair: #252c38;
    --accent: #5b8cff;
    --accent-ink: #ffffff;
    --ok: #3ccf91;
    --stale: #ff8a4c;
    --edited: #4fd1d9;
    --error: #ff6b6b;
    --never: #f2b84b;
    --wait: #5f6879;
    --code-bg: #080a0e;
    --code-bg-2: #141922;
    --code-ink: #e6e9ef;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0d1015;
  --surface: #141922;
  --surface-2: #1a2029;
  --ink: #e7ebf2;
  --muted: #8b94a5;
  --rule: #252c38;
  --hair: #252c38;
  --accent: #5b8cff;
  --accent-ink: #ffffff;
  --ok: #3ccf91;
  --stale: #ff8a4c;
  --edited: #4fd1d9;
  --error: #ff6b6b;
  --never: #f2b84b;
  --wait: #5f6879;
  --code-bg: #080a0e;
  --code-bg-2: #141922;
  --code-ink: #e6e9ef;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html[lang="zh"] .en { display: none; }
html[lang="en"] .zh { display: none; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-ui);
  line-height: 1.45;
}
a { color: inherit; }
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
.top {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
  border-bottom: var(--rule-w) solid var(--ink);
}
.brand-block {
  display: block;
  min-width: 0;
  padding: 18px 22px 16px;
  text-decoration: none;
}
.brand {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.brand-name {
  margin: 4px 0 0;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: clamp(22px, 3vw, 32px);
  letter-spacing: -0.04em;
  line-height: 1;
}
.lang-switch {
  display: flex;
  margin-left: auto;
  border-left: var(--rule-w) solid var(--ink);
}
.lang-switch button {
  font: inherit;
  font-weight: 700;
  background: transparent;
  color: var(--ink);
  border: 0;
  border-left: var(--rule-w) solid var(--ink);
  min-width: 88px;
  min-height: 48px;
  padding: 0 16px;
  cursor: pointer;
}
.lang-switch button:first-child { border-left: 0; }
.lang-switch button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }
.lang-switch button:focus-visible, .tag-row button:focus-visible, .command button:focus-visible, .btn:focus-visible, #q:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.hero, .section, .template > section, .colophon { padding: 22px 22px 26px; border-bottom: var(--rule-w) solid var(--ink); }
h1 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: var(--h1-size);
  letter-spacing: -0.04em;
  line-height: 0.95;
}
.lede { margin: 12px 0 0; max-width: 68ch; font-size: 17px; }
.kicker {
  margin: 0 0 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.kicker .id { color: var(--ink); }
.banner {
  margin: 0;
  padding: 12px 22px;
  background: var(--surface-2);
  border-bottom: var(--rule-w) solid var(--ink);
  border-left: 6px solid var(--accent);
}
.tools { border-bottom: var(--rule-w) solid var(--ink); }
#q {
  width: 100%;
  border: 0;
  border-bottom: var(--rule-w) solid var(--ink);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 16px;
  padding: 14px 22px;
}
.tag-row { display: flex; flex-wrap: wrap; }
.tag-row button {
  font: inherit;
  background: transparent;
  color: var(--ink);
  border: 0;
  border-right: var(--rule-w) solid var(--ink);
  border-bottom: var(--rule-w) solid var(--ink);
  min-height: 44px;
  padding: 8px 14px;
  cursor: pointer;
}
.tag-row button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  border-left: var(--rule-w) solid var(--ink);
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 240px;
  padding: 16px 16px 14px;
  border-right: var(--rule-w) solid var(--ink);
  border-bottom: var(--rule-w) solid var(--ink);
  text-decoration: none;
  background: transparent;
}
.card:hover { background: var(--surface); }
.card h2 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 28px;
  letter-spacing: -0.03em;
  line-height: 1.02;
}
.one-line {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  overflow: hidden;
  margin: 0;
  color: var(--muted);
}
.card-meta { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px; margin-top: auto; }
.count { margin: 0; color: var(--muted); }
.num {
  font-family: var(--num-font);
  font-weight: var(--num-weight);
  font-size: var(--num-size);
  letter-spacing: -0.05em;
  line-height: 0.85;
  color: var(--ink);
}
.pills, .meta-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.pill {
  font-family: var(--font-mono);
  font-size: 12px;
  border: var(--rule-w) solid var(--ink);
  padding: 2px 6px;
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.tags li { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.execs { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0; }
.exec {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ink);
  color: var(--ink);
}
.exec svg { width: 18px; height: 18px; display: block; }
.empty { margin: 0; padding: 28px 22px; }
.colophon { color: var(--muted); max-width: 78ch; }
.template > h1 { margin: 0; padding: 4px 22px 10px; }
.template > p, .template > ul { padding: 0 22px; }
.template > .kicker { padding: 22px 22px 0; margin: 0; }
.template > .lede, .template > .meta-row, .template > .tags { padding: 0 22px 8px; }
.template > section h2 {
  margin: 0 0 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.quiet { color: var(--ink); }
.command {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 12px 14px;
}
.command code { font-family: var(--font-mono); font-size: 14px; }
.command button, .btn {
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  border: 2px solid var(--accent);
  border-radius: var(--btn-radius);
  background: var(--accent);
  color: var(--accent-ink);
  min-height: 44px;
  padding: 8px 14px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.command button.copied { background: var(--ok); border-color: var(--ok); }
.graph { overflow-x: auto; background: var(--surface); border: var(--rule-w) solid var(--ink); color: var(--ink); }
.graph-svg { display: block; width: 100%; min-width: 520px; height: auto; }
.graph-why { margin: 0 0 10px; color: var(--muted); max-width: 78ch; }
.readme { max-width: 78ch; }
.readme h1, .readme h2, .readme h3 { font-family: var(--font-display); letter-spacing: -0.03em; line-height: 1.15; }
.readme pre {
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 14px 16px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
}
.readme code { font-family: var(--font-mono); font-size: 0.92em; }
.readme table { border-collapse: collapse; width: 100%; font-size: 14px; }
.readme th, .readme td { border: 1px solid var(--hair); padding: 6px 8px; vertical-align: top; text-align: left; }
.readme a { color: var(--accent); }
.source-link a { color: var(--accent); }
@media (max-width: 720px) {
  .hero, .template > section, .colophon { padding: 16px; }
  .template > h1, .template > .kicker, .template > .lede, .template > .meta-row, .template > .tags { padding-left: 16px; padding-right: 16px; }
  .brand-block { padding: 14px 14px 12px; }
  .lang-switch button { min-width: 72px; padding: 0 10px; }
  .cards { grid-template-columns: 1fr; }
  h1 { font-size: clamp(32px, 12vw, 48px); }
  .card h2 { font-size: 24px; }
  .num { font-size: 40px; }
  .graph-svg { min-width: 440px; }
}
`;

const GALLERY_JS = `(function () {
  var params = new URLSearchParams(location.search);
  var theme = params.get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.setAttribute("data-theme", theme);
  var KEY = "flowgit-gallery-lang";
  function apply(lang) {
    var next = lang === "en" ? "en" : "zh";
    document.documentElement.lang = next;
    document.body.setAttribute("data-lang", next);
    var buttons = document.querySelectorAll("[data-lang-btn]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-lang-btn") === next ? "true" : "false");
    }
    try { localStorage.setItem(KEY, next); } catch (e) {}
  }
  var saved = "zh";
  try { saved = localStorage.getItem(KEY) || "zh"; } catch (e) {}
  apply(saved === "en" ? "en" : "zh");
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var langBtn = t.closest("[data-lang-btn]");
    if (langBtn) apply(langBtn.getAttribute("data-lang-btn"));
    var copy = t.closest("[data-copy]");
    if (copy) {
      var text = copy.getAttribute("data-copy") || "";
      var done = function () {
        copy.classList.add("copied");
        setTimeout(function () { copy.classList.remove("copied"); }, 1200);
      };
      var fallback = function () {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        ta.remove();
        done();
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    }
    var tag = t.closest("[data-tag]");
    if (tag && tag.hasAttribute("data-tag")) {
      var value = tag.getAttribute("data-tag") || "";
      var tags = document.querySelectorAll("[data-tag]");
      for (var j = 0; j < tags.length; j++) tags[j].setAttribute("aria-pressed", tags[j] === tag ? "true" : "false");
      document.body.setAttribute("data-filter-tag", value);
      filter();
    }
  });
  var q = document.getElementById("q");
  function filter() {
    var query = (q && q.value ? q.value : "").trim().toLowerCase();
    var tag = document.body.getAttribute("data-filter-tag") || "";
    var cards = document.querySelectorAll(".card");
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var tags = [];
      try { tags = JSON.parse(card.getAttribute("data-tags") || "[]"); } catch (e) { tags = []; }
      var hay = (card.getAttribute("data-search") || "").toLowerCase();
      var ok = (!tag || tags.indexOf(tag) !== -1) && (!query || hay.indexOf(query) !== -1);
      card.hidden = !ok;
      if (ok) shown += 1;
    }
    var empty = document.getElementById("empty");
    if (empty) empty.hidden = shown !== 0;
  }
  if (q) q.addEventListener("input", filter);
})();
`;
