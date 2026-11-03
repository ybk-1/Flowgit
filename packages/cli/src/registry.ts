import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This repository on GitHub. The gallery points a bundled template's relative README links here. */
export const REPO_WEB_URL = "https://github.com/cgold9820-dotcom/Flowgit";

/**
 * Published registry. `templates --all` tries this before the checkout.
 * A checkout that still has the old single file, or `FLOWGIT_REGISTRY` pointing
 * at one, is read by `loadCommunityRegistry` too.
 */
export const PUBLISHED_REGISTRY_URL = "https://flowgit.dev/registry.json";

/** @deprecated Use `PUBLISHED_REGISTRY_URL`. Kept so older imports still resolve. */
export const DEFAULT_COMMUNITY_REGISTRY_URL = PUBLISHED_REGISTRY_URL;

/** One line, bilingual. Printed when `templates --all` cannot use the registry. */
export const COMMUNITY_LIST_NOTE =
  "社区模板列表暂时读不到，下面只列出自带模板。 / The community list could not be read; only bundled templates are listed.";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_RE = /^(https?:\/\/|ssh:\/\/|git@|file:\/\/)\S+$/;

export interface BilingualText {
  zh: string;
  en: string;
}

export interface CommunityEntry {
  id: string;
  name: BilingualText;
  description: BilingualText;
  git: string;
  ref?: string;
  author: string;
  tags: string[];
  language: ("zh" | "en")[];
  license: string;
}

export type RegistryIssues =
  | { ok: true; entries: CommunityEntry[] }
  | { ok: false; errors: string[] };

export type CommunityLoad =
  | { ok: true; entries: CommunityEntry[]; from: string }
  | { ok: false; kind: "unreadable" | "invalid"; from: string; note: string; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** `#path=<subdir>` on a Git URL. Anything else is left on the URL for git to reject. */
export function splitGitFragment(source: string): { url: string; path?: string } {
  const hash = source.indexOf("#");
  if (hash < 0) return { url: source };
  const frag = source.slice(hash + 1);
  if (!frag.startsWith("path=")) return { url: source };
  let sub = frag.slice("path=".length);
  const amp = sub.indexOf("&");
  if (amp >= 0) sub = sub.slice(0, amp);
  try {
    sub = decodeURIComponent(sub);
  } catch {
    // keep the raw text; the path check below reports it
  }
  return { url: source.slice(0, hash), path: sub };
}

/** A `#path=` value that stays inside the repository: relative, no empty or `..` segments. */
export function gitFragmentProblem(git: string): string | undefined {
  const hash = git.indexOf("#");
  const url = hash < 0 ? git : git.slice(0, hash);
  if (!GIT_RE.test(url)) return "要是 Git 地址 / must be a Git URL";
  if (hash < 0) return undefined;
  const { path: sub } = splitGitFragment(git);
  if (sub === undefined) return "片段只能是 #path=子目录 / the only fragment allowed is #path=<subdir>";
  if (!sub || path.isAbsolute(sub) || sub.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..")) {
    return "#path= 必须是仓库里的相对路径 / #path= must be a relative path inside the repo";
  }
  return undefined;
}

function checkText(value: unknown, at: string, errors: string[]): BilingualText | undefined {
  if (!isRecord(value)) {
    errors.push(`${at}: 要是 { zh, en } / must be { zh, en }`);
    return undefined;
  }
  const extra = Object.keys(value).filter((k) => k !== "zh" && k !== "en");
  if (extra.length) errors.push(`${at}: 多余的字段 / unknown fields: ${extra.join(", ")}`);
  if (!nonEmpty(value.zh)) errors.push(`${at}/zh: 要是非空字符串 / must be a non-empty string`);
  if (!nonEmpty(value.en)) errors.push(`${at}/en: 要是非空字符串 / must be a non-empty string`);
  if (!nonEmpty(value.zh) || !nonEmpty(value.en)) return undefined;
  return { zh: value.zh.trim(), en: value.en.trim() };
}

/** Check a community registry document. `community.schema.json` describes the same rules. */
export function validateCommunityRegistry(data: unknown): RegistryIssues {
  const errors: string[] = [];
  if (!Array.isArray(data)) {
    return { ok: false, errors: ["根要是数组 / the root must be an array"] };
  }
  const entries: CommunityEntry[] = [];
  const seen = new Set<string>();
  data.forEach((item, index) => {
    const at = `/${index}`;
    if (!isRecord(item)) {
      errors.push(`${at}: 要是对象 / must be an object`);
      return;
    }
    const allowed = new Set(["id", "name", "description", "git", "ref", "author", "tags", "language", "license"]);
    const extra = Object.keys(item).filter((k) => !allowed.has(k));
    if (extra.length) errors.push(`${at}: 多余的字段 / unknown fields: ${extra.join(", ")}`);
    if (!nonEmpty(item.id) || !ID_RE.test(item.id.trim())) {
      errors.push(`${at}/id: 只能是小写字母、数字和连字符 / must be lowercase letters, digits and hyphens`);
    } else if (seen.has(item.id.trim())) {
      errors.push(`${at}/id: 重复了 / duplicated: ${item.id.trim()}`);
    } else {
      seen.add(item.id.trim());
    }
    const name = checkText(item.name, `${at}/name`, errors);
    const description = checkText(item.description, `${at}/description`, errors);
    let git = "";
    if (!nonEmpty(item.git)) errors.push(`${at}/git: 要是非空字符串 / must be a non-empty string`);
    else {
      git = item.git.trim();
      const problem = gitFragmentProblem(git);
      if (problem) errors.push(`${at}/git: ${problem}`);
    }
    let ref: string | undefined;
    if (item.ref !== undefined) {
      if (!nonEmpty(item.ref)) errors.push(`${at}/ref: 要是非空字符串 / must be a non-empty string`);
      else ref = item.ref.trim();
    }
    if (!nonEmpty(item.author)) errors.push(`${at}/author: 要是非空字符串 / must be a non-empty string`);
    let tags: string[] = [];
    if (!Array.isArray(item.tags)) errors.push(`${at}/tags: 要是字符串数组 / must be an array of strings`);
    else {
      tags = [];
      item.tags.forEach((tag, i) => {
        if (!nonEmpty(tag)) errors.push(`${at}/tags/${i}: 要是非空字符串 / must be a non-empty string`);
        else tags.push(tag.trim());
      });
    }
    let language: ("zh" | "en")[] = [];
    let languageOk = false;
    if (!Array.isArray(item.language) || item.language.length === 0) {
      errors.push(`${at}/language: 至少要有 zh 或 en / must list zh, en, or both`);
    } else {
      const langs: ("zh" | "en")[] = [];
      item.language.forEach((lang, i) => {
        if (lang !== "zh" && lang !== "en") errors.push(`${at}/language/${i}: 只能是 zh 或 en / must be zh or en`);
        else langs.push(lang);
      });
      if (new Set(langs).size !== langs.length) errors.push(`${at}/language: 不要重复 / must be unique`);
      else if (langs.length === item.language.length) languageOk = true;
      language = langs;
    }
    if (!nonEmpty(item.license)) errors.push(`${at}/license: 要是非空字符串 / must be a non-empty string`);
    if (
      nonEmpty(item.id) &&
      ID_RE.test(item.id.trim()) &&
      name &&
      description &&
      git &&
      !gitFragmentProblem(git) &&
      nonEmpty(item.author) &&
      Array.isArray(item.tags) &&
      tags.length === item.tags.length &&
      languageOk &&
      nonEmpty(item.license) &&
      extra.length === 0 &&
      (item.ref === undefined || ref)
    ) {
      const entry: CommunityEntry = {
        id: item.id.trim(),
        name,
        description,
        git,
        author: item.author.trim(),
        tags,
        language,
        license: item.license.trim(),
      };
      if (ref) entry.ref = ref;
      entries.push(entry);
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, entries };
}

/**
 * `registry/community/` (one JSON file per entry) in this checkout, or the old
 * `registry/community.json` when the directory is not there. Walks up from `start`.
 */
export function findRepoRegistry(start = process.cwd()): string | undefined {
  let dir = path.resolve(start);
  for (let i = 0; i < 16; i++) {
    const folder = path.join(dir, "registry", "community");
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory() && fs.readdirSync(folder).some((name) => name.endsWith(".json"))) {
      return folder;
    }
    const file = path.join(dir, "registry", "community.json");
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Where a local build reads the registry. `FLOWGIT_REGISTRY` wins. Otherwise the
 * checkout's `registry/community/` (or the old single file), otherwise the published URL.
 * `templates --all` does not use this: it tries the published URL first.
 */
export function registryLocation(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const override = env.FLOWGIT_REGISTRY?.trim();
  if (override) return override;
  return findRepoRegistry(cwd) ?? PUBLISHED_REGISTRY_URL;
}

/** Drop userinfo so a registry URL in an error cannot repeat a token. */
export function publicRegistrySource(source: string): string {
  if (!/^https?:\/\//i.test(source)) return source;
  try {
    const u = new URL(source);
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return source;
  }
}

export interface RegistryReadOptions {
  fetch?: typeof fetch;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Timeout for an http(s) source. The automatic published-URL probe uses 4s. */
  timeoutMs?: number;
}

async function readRegistryText(source: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetchImpl(source, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  const file = source.startsWith("file:") ? fileURLToPath(source) : source;
  return fs.readFileSync(file, "utf8");
}

function parseRegistryJson(text: string, label: string): { data?: unknown; error?: string } {
  try {
    return { data: JSON.parse(text) as unknown };
  } catch (err) {
    return { error: `${label}: 不是合法的 JSON / is not valid JSON: ${(err as Error).message}` };
  }
}

/** An old array file, or one entry object. A per-entry file's name must match `id`. */
function documentsFromParsed(data: unknown, label: string): { items: unknown[]; errors: string[] } {
  if (Array.isArray(data)) return { items: data, errors: [] };
  if (isRecord(data)) {
    const errors: string[] = [];
    const base = path.basename(label, ".json");
    if (base !== "community" && typeof data.id === "string" && data.id !== base) {
      errors.push(`${label}: 文件名要和 id 一样 / the file name must match id (${base} ≠ ${data.id})`);
    }
    return { items: [data], errors };
  }
  return { items: [], errors: [] };
}

function loadParsedRegistry(items: unknown[], extraErrors: string[], from: string): CommunityLoad {
  const result = validateCommunityRegistry(items);
  const errors = [...extraErrors, ...(result.ok ? [] : result.errors)];
  if (errors.length || !result.ok) return { ok: false, kind: "invalid", from, note: COMMUNITY_LIST_NOTE, errors };
  return { ok: true, entries: result.entries, from };
}

/** Read one registry source: a URL, a directory of entry files, or one JSON file (array or a single entry). */
export async function readCommunitySource(source: string, opts: RegistryReadOptions = {}): Promise<CommunityLoad> {
  const from = publicRegistrySource(source);
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  if (!/^https?:\/\//i.test(source)) {
    const file = source.startsWith("file:") ? fileURLToPath(source) : source;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      const names = fs.readdirSync(file).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b));
      const items: unknown[] = [];
      const errors: string[] = [];
      for (const name of names) {
        let text: string;
        try {
          text = fs.readFileSync(path.join(file, name), "utf8");
        } catch {
          return { ok: false, kind: "unreadable", from, note: COMMUNITY_LIST_NOTE, errors: [] };
        }
        const parsed = parseRegistryJson(text, name);
        if (parsed.error) errors.push(parsed.error);
        else {
          const doc = documentsFromParsed(parsed.data, name);
          errors.push(...doc.errors);
          items.push(...doc.items);
        }
      }
      if (errors.length) return { ok: false, kind: "invalid", from, note: COMMUNITY_LIST_NOTE, errors };
      return loadParsedRegistry(items, [], from);
    }
  }
  let text: string;
  try {
    text = await readRegistryText(source, fetchImpl, timeoutMs);
  } catch {
    return { ok: false, kind: "unreadable", from, note: COMMUNITY_LIST_NOTE, errors: [] };
  }
  const parsed = parseRegistryJson(text, from);
  if (parsed.error) return { ok: false, kind: "invalid", from, note: COMMUNITY_LIST_NOTE, errors: [parsed.error] };
  const doc = documentsFromParsed(parsed.data, source);
  return loadParsedRegistry(doc.items, doc.errors, from);
}

/**
 * Read the registry. With no source: `FLOWGIT_REGISTRY` if set, otherwise
 * https://flowgit.dev/registry.json, and if that cannot be read, the checkout
 * directory (or the old single file). A source that answers but is invalid is
 * not replaced by the checkout. An explicit source is read as given.
 */
export async function loadCommunityRegistry(source?: string, opts: RegistryReadOptions = {}): Promise<CommunityLoad> {
  if (source) return readCommunitySource(source, opts);
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const override = env.FLOWGIT_REGISTRY?.trim();
  if (override) return readCommunitySource(override, opts);
  const remote = await readCommunitySource(PUBLISHED_REGISTRY_URL, { ...opts, timeoutMs: opts.timeoutMs ?? 4000 });
  if (remote.ok || remote.kind === "invalid") return remote;
  const local = findRepoRegistry(cwd);
  if (local) return readCommunitySource(local, opts);
  return remote;
}
