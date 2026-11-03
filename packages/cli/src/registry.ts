import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This repository on GitHub. The gallery points a bundled template's relative README links here. */
export const REPO_WEB_URL = "https://github.com/cgold9820-dotcom/Flowgit";

/** Raw registry on the default branch, used when this checkout has no registry file. */
export const DEFAULT_COMMUNITY_REGISTRY_URL =
  "https://raw.githubusercontent.com/cgold9820-dotcom/Flowgit/main/registry/community.json";

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

/** `registry/community.json` in this checkout, walking up from `start`. */
export function findRepoRegistry(start = process.cwd()): string | undefined {
  let dir = path.resolve(start);
  for (let i = 0; i < 16; i++) {
    const candidate = path.join(dir, "registry", "community.json");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Where to read the registry. `FLOWGIT_REGISTRY` wins. Otherwise the checkout's
 * `registry/community.json` when we are inside the repo, otherwise the raw URL.
 */
export function registryLocation(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const override = env.FLOWGIT_REGISTRY?.trim();
  if (override) return override;
  return findRepoRegistry(cwd) ?? DEFAULT_COMMUNITY_REGISTRY_URL;
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

async function readRegistryText(source: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  const file = source.startsWith("file:") ? fileURLToPath(source) : source;
  return fs.readFileSync(file, "utf8");
}

/** Read and check the registry. A missing file or a failed request is `unreadable`; bad JSON or a bad entry is `invalid`. */
export async function loadCommunityRegistry(source = registryLocation()): Promise<CommunityLoad> {
  const from = publicRegistrySource(source);
  let text: string;
  try {
    text = await readRegistryText(source);
  } catch {
    return { ok: false, kind: "unreadable", from, note: COMMUNITY_LIST_NOTE, errors: [] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (err) {
    return {
      ok: false,
      kind: "invalid",
      from,
      note: COMMUNITY_LIST_NOTE,
      errors: [`不是合法的 JSON / is not valid JSON: ${(err as Error).message}`],
    };
  }
  const result = validateCommunityRegistry(data);
  if (!result.ok) return { ok: false, kind: "invalid", from, note: COMMUNITY_LIST_NOTE, errors: result.errors };
  return { ok: true, entries: result.entries, from };
}
