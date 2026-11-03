// Bringing flows into the web app and taking them out: a public GitHub repository (copied like
// `flowgit init <git url>`, with forkedFrom so commands stay behind the trust check), a zip
// (the app's own export, or any folder zipped up), and a zip of a flow to download.
import { createMemoryHost, findFlowFile, type Flow, flowFiles, type ForkedFrom, host, readFlowFile, setHost, writeFlowFile } from "@flowgit/core";
import { strFromU8, unzipSync, zipSync } from "fflate";

export type Files = Record<string, Uint8Array>;

/** Folders never imported or exported: build output, VCS data and the board's thumbnail cache. */
const NEVER = new Set([".git", "node_modules", ".flowgit"]);
/** Limits for a public repository: enough for a flow, small enough not to stall the page. */
const MAX_FILES = 400;
const MAX_BYTES = 50 * 1024 * 1024;

export interface GitHubSource {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}

/**
 * github.com/<owner>/<repo>[.git], optionally /tree/<ref>/<path>, optionally #path=<path> (the
 * CLI's and the community registry's form). A ref with "/" in it must use #path= and ?ref=.
 */
export function parseGitHubUrl(input: string): GitHubSource | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  const ok = (s: string) => /^[A-Za-z0-9_.-]+$/.test(s) && s !== "." && s !== "..";
  if (!ok(owner) || !ok(repo)) return undefined;
  const source: GitHubSource = { owner, repo };
  if (parts[2] === "tree" && parts[3]) {
    source.ref = decodeURIComponent(parts[3]);
    if (parts.length > 4) source.path = parts.slice(4).map(decodeURIComponent).join("/");
  } else if (parts.length > 2) {
    return undefined;
  }
  const ref = url.searchParams.get("ref");
  if (ref) source.ref = ref;
  const fragment = /^#path=(.+)$/.exec(url.hash);
  if (fragment) source.path = decodeURIComponent(fragment[1]!);
  if (source.path) {
    const segs = source.path.split("/").filter(Boolean);
    if (!segs.length || segs.some((s) => s === "." || s === "..")) return undefined;
    source.path = segs.join("/");
  }
  return source;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 404) throw new Error("找不到这个仓库、分支或路径（只支持公开仓库）/ Repository, branch or path not found (public repositories only)");
  if (res.status === 403 || res.status === 429) throw new Error("GitHub 暂时限制了请求次数，过一会儿再试 / GitHub is rate-limiting requests; try again later");
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status} / GitHub answered ${res.status}`);
  return res.json();
}

/** The flow's files from a public repository at one commit, and where they came from. */
export async function fetchGitHub(source: GitHubSource): Promise<{ files: Files; forked: ForkedFrom }> {
  const api = `https://api.github.com/repos/${source.owner}/${source.repo}`;
  const ref = source.ref ?? ((await getJson(api)) as { default_branch: string }).default_branch;
  const commit = ((await getJson(`${api}/commits/${encodeURIComponent(ref)}`)) as { sha: string }).sha;
  const tree = (await getJson(`${api}/git/trees/${commit}?recursive=1`)) as { tree: { path: string; type: string; size?: number }[]; truncated?: boolean };
  const prefix = source.path ? `${source.path}/` : "";
  const blobs = tree.tree.filter(
    (item) => item.type === "blob" && item.path.startsWith(prefix) && !item.path.slice(prefix.length).split("/").some((seg) => NEVER.has(seg) || seg === "runs"),
  );
  if (!blobs.length) throw new Error("这个位置没有文件 / Nothing at that location");
  if (blobs.length > MAX_FILES) throw new Error(`文件太多（${blobs.length} 个，最多 ${MAX_FILES}）；请指定流程所在的子目录 / Too many files (${blobs.length}, at most ${MAX_FILES}); point at the flow's subdirectory`);
  const total = blobs.reduce((sum, item) => sum + (item.size ?? 0), 0);
  if (total > MAX_BYTES) throw new Error("文件太大，请在电脑上用 flowgit init 复制 / Too large; copy it with flowgit init on a computer");
  const files: Files = {};
  const raw = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/`;
  await Promise.all(
    blobs.map(async (item) => {
      const res = await fetch(raw + item.path.split("/").map(encodeURIComponent).join("/"));
      if (!res.ok) throw new Error(`下载失败 / download failed: ${item.path}`);
      files[item.path.slice(prefix.length)] = new Uint8Array(await res.arrayBuffer());
    }),
  );
  const forked: ForkedFrom = { source: `https://github.com/${source.owner}/${source.repo}.git`, ...(source.ref ? { ref: source.ref } : {}), commit };
  return { files, forked };
}

/** The common top folder of every path, if they all share one (how most zips of a folder look). */
function stripTopFolder(files: Files): Files {
  const names = Object.keys(files);
  const top = names[0]?.split("/")[0];
  if (!top || names.some((n) => !n.includes("/") || n.split("/")[0] !== top)) return files;
  const out: Files = {};
  for (const [rel, data] of Object.entries(files)) out[rel.slice(top.length + 1)] = data;
  return out;
}

export function unzipFlow(zip: Uint8Array): Files {
  const out: Files = {};
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    if (name.endsWith("/")) continue;
    const segs = name.replace(/\\/g, "/").split("/").filter(Boolean);
    // Zip slip: no absolute paths, drive letters or "..".
    if (!segs.length || segs.some((s) => s === "." || s === ".." || s.includes(":")) || name.startsWith("/")) continue;
    if (segs.some((s) => NEVER.has(s) || s === "__MACOSX")) continue;
    out[segs.join("/")] = data;
  }
  return stripTopFolder(out);
}

export function zipFlow(files: Files): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, data] of Object.entries(files)) if (!rel.split("/").some((s) => NEVER.has(s))) entries[rel] = data;
  return zipSync(entries, { level: 6 });
}

export interface PreparedFlow {
  files: Files;
  flow: Flow;
}

/**
 * Check that the files are a flow and pick what to keep: for a repository, what `flowgit init`
 * copies (no outputs, runs or local inputs) plus forkedFrom; for a zip, everything.
 */
export function prepareFlow(files: Files, options: { forked?: ForkedFrom } = {}): PreparedFlow {
  const scratch = createMemoryHost({ files: Object.fromEntries(Object.entries(files).map(([rel, data]) => [`/src/${rel}`, data])) });
  // Synchronous from here to the end, so swapping the host can't leak into other work.
  const previous = host();
  setHost(scratch);
  try {
    const file = findFlowFile("/src");
    if (!file) throw new Error("这里没有 flow.json 或 flow.md / There is no flow.json or flow.md here");
    const flow = readFlowFile(file) as Flow;
    if (!flow || typeof flow !== "object" || !Array.isArray(flow.stages)) throw new Error("flow 文件不是一个流程 / The flow file is not a flow");
    let keep = Object.keys(files);
    if (options.forked) {
      keep = flowFiles({ dir: "/src", file, flow }, { withOutputs: false });
      flow.forkedFrom = options.forked;
      writeFlowFile(file, flow);
    }
    const out: Files = {};
    for (const rel of keep) out[rel] = scratch.readFile(`/src/${rel}`);
    return { files: out, flow };
  } finally {
    setHost(previous);
  }
}

/** A text preview of a zip entry, for tests. */
export function text(data: Uint8Array | undefined): string {
  return data ? strFromU8(data) : "";
}
