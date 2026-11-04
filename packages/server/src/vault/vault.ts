import { IMAGE_PRESETS, PROVIDER_PRESETS } from "@flowgit/core";
import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { HttpError, notFound } from "../http.js";

/**
 * The workspace key vault. Keys are write-only: the value is encrypted with AES-256-GCM
 * (https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt#aes-gcm) under the
 * master key in the VAULT_MASTER_KEY Worker secret, stored in D1, and only ever decrypted into a
 * cloud run's environment under its own name (the name a flow's `apiKeyEnv` points at). The API
 * shows the name and the last four characters, never the value. The workspace id and the name are
 * the additional data, so a ciphertext can't be moved to another workspace or name.
 *
 * Each key also names the hosts it may be sent to (by default the official host of the built-in
 * preset that reads it, e.g. api.deepseek.com for DEEPSEEK_API_KEY). A run's fetch refuses any
 * request that carries a key anywhere else (`guardKeys`), so a service stage's header, a
 * flowgit.local.json pointing a provider elsewhere, or any other route can't send a write-only
 * key to a server an editor controls. Command stages in the sandbox get no keys at all.
 */

/** Like an environment variable: DEEPSEEK_API_KEY. */
const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Names a key may not take: they change how a run behaves rather than authenticate it. */
const RESERVED = /^(FLOWGIT_|PATH$|HOME$|NODE_|HTTP_PROXY$|HTTPS_PROXY$|NO_PROXY$|ALL_PROXY$)/;
export const MAX_KEY_LENGTH = 8192;
export const MAX_KEY_HOSTS = 10;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Official hosts of the built-in presets, by the key they read. anthropic and openai have no
 * baseUrl in their presets: their SDKs' defaults are https://api.anthropic.com and
 * https://api.openai.com.
 */
export function defaultKeyHosts(): Record<string, string[]> {
  const hosts: Record<string, Set<string>> = {};
  const add = (name: string | undefined, url: string | undefined) => {
    if (!name || !url) return;
    (hosts[name] ??= new Set()).add(new URL(url).hostname);
  };
  for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
    add(preset.apiKeyEnv, preset.baseUrl ?? (id === "anthropic" ? "https://api.anthropic.com" : id === "openai" ? "https://api.openai.com" : undefined));
  }
  for (const preset of Object.values(IMAGE_PRESETS)) add(preset.apiKeyEnv, preset.baseUrl);
  return Object.fromEntries(Object.entries(hosts).map(([name, set]) => [name, [...set].sort()]));
}

/** The hosts a key may go to, from the request or the preset default. */
export function keyHosts(name: string, raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    const preset = defaultKeyHosts()[name];
    if (preset) return preset;
    throw new HttpError(400, `${name} 不是自带预设的 key，请用 hosts 写明它可以发到哪些域名，例如 ["api.example.com"] / ${name} is not a built-in preset's key; list the hostnames it may be sent to in hosts, e.g. ["api.example.com"]`);
  }
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_KEY_HOSTS) throw new HttpError(400, `hosts 要是 1 到 ${MAX_KEY_HOSTS} 个域名 / hosts must list 1 to ${MAX_KEY_HOSTS} hostnames`);
  const out = new Set<string>();
  for (const item of raw) {
    const host = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!HOSTNAME.test(host)) throw new HttpError(400, `不是域名 / not a hostname: ${String(item)}`);
    out.add(host);
  }
  return [...out].sort();
}
export const MAX_KEYS_PER_WORKSPACE = 50;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function keyNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string" || !NAME.test(name)) return "名字要像环境变量：大写字母、数字和下划线 / the name must look like an environment variable: A-Z, 0-9 and _";
  if (RESERVED.test(name)) return `这个名字留给 Flowgit 自己用 / this name is reserved: ${name}`;
  return undefined;
}

function b64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function unb64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

const masterKeys = new WeakMap<object, Promise<CryptoKey>>();

/** VAULT_MASTER_KEY is 32 random bytes in base64 (`openssl rand -base64 32`). */
async function masterKey(env: Env): Promise<CryptoKey> {
  const secret = env.VAULT_MASTER_KEY;
  if (!secret) throw new HttpError(503, "服务器还没设置 VAULT_MASTER_KEY，暂时不能保存 key / the server has no VAULT_MASTER_KEY yet, so keys can't be stored");
  let raw: Uint8Array;
  try {
    raw = unb64(secret.trim());
  } catch {
    throw new HttpError(503, "VAULT_MASTER_KEY 不是 base64 / VAULT_MASTER_KEY is not base64");
  }
  if (raw.length !== 32) throw new HttpError(503, "VAULT_MASTER_KEY 要是 32 字节 / VAULT_MASTER_KEY must be 32 bytes");
  const cacheKey = env as object;
  let key = masterKeys.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    masterKeys.set(cacheKey, key);
  }
  return key;
}

function additionalData(workspaceId: string, name: string): Uint8Array {
  return encoder.encode(`flowgit-vault-v1\n${workspaceId}\n${name}`);
}

/** What the API shows instead of the value. Short values show less. */
export function lastFour(value: string): string {
  return value.length >= 12 ? value.slice(-4) : value.length >= 8 ? value.slice(-2) : "";
}

export interface KeyInfo {
  name: string;
  last4: string;
  hosts: string[];
  created_by: string;
  created_at: number;
  updated_at: number;
  uses: number;
  last_used_at: number | null;
}

export async function listKeys(env: Env, workspaceId: string): Promise<KeyInfo[]> {
  const { results } = await env.DB.prepare(
    `SELECT k.name, k.last4, k.hosts, k.created_by, k.created_at, k.updated_at,
       (SELECT COUNT(*) FROM key_uses u WHERE u.workspace_id = k.workspace_id AND u.name = k.name) AS uses,
       (SELECT MAX(u.created_at) FROM key_uses u WHERE u.workspace_id = k.workspace_id AND u.name = k.name) AS last_used_at
     FROM vault_keys k WHERE k.workspace_id = ? ORDER BY k.name`,
  )
    .bind(workspaceId)
    .all<KeyInfo & { hosts: string }>();
  return results.map((row) => ({ ...row, hosts: JSON.parse(row.hosts || "[]") as string[] }));
}

/** Store (or replace) a key. Answers with what the API may show. */
export async function putKey(env: Env, userId: string, workspaceId: string, name: string, value: unknown, rawHosts?: unknown): Promise<{ name: string; last4: string; hosts: string[] }> {
  const problem = keyNameProblem(name);
  if (problem) throw new HttpError(400, problem);
  const hosts = keyHosts(name, rawHosts);
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "缺少 value / missing value");
  if (value.length > MAX_KEY_LENGTH) throw new HttpError(413, `key 最长 ${MAX_KEY_LENGTH} 个字符 / a key is at most ${MAX_KEY_LENGTH} characters`);
  if (/[\r\n\0]/.test(value)) throw new HttpError(400, "key 里不能有换行 / a key can't contain line breaks");
  const existing = await env.DB.prepare("SELECT name FROM vault_keys WHERE workspace_id = ? AND name = ?").bind(workspaceId, name).first();
  if (!existing) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM vault_keys WHERE workspace_id = ?").bind(workspaceId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_KEYS_PER_WORKSPACE) throw new HttpError(429, `每个工作区最多 ${MAX_KEYS_PER_WORKSPACE} 个 key / at most ${MAX_KEYS_PER_WORKSPACE} keys per workspace`);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(workspaceId, name) }, await masterKey(env), encoder.encode(value)),
  );
  const now = Date.now();
  const last4 = lastFour(value);
  await env.DB.prepare(
    `INSERT INTO vault_keys (workspace_id, name, ciphertext, iv, last4, hosts, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, last4 = excluded.last4, hosts = excluded.hosts, created_by = excluded.created_by, updated_at = excluded.updated_at`,
  )
    .bind(workspaceId, name, b64(sealed), b64(iv), last4, JSON.stringify(hosts), userId, now, now)
    .run();
  await audit(env, { userId, workspaceId, action: existing ? "key.replace" : "key.add", detail: { name, hosts } });
  return { name, last4, hosts };
}

export async function deleteKey(env: Env, userId: string, workspaceId: string, name: string): Promise<void> {
  const result = await env.DB.prepare("DELETE FROM vault_keys WHERE workspace_id = ? AND name = ?").bind(workspaceId, name).run();
  if (!result.meta.changes) throw notFound("这个 key / key");
  await audit(env, { userId, workspaceId, action: "key.delete", detail: { name } });
}

export interface OpenKey {
  value: string;
  hosts: string[];
}

/** Every key of the workspace, decrypted. Only for a run's environment; never answer with it. */
export async function decryptKeys(env: Env, workspaceId: string): Promise<Record<string, OpenKey>> {
  const { results } = await env.DB.prepare("SELECT name, ciphertext, iv, hosts FROM vault_keys WHERE workspace_id = ?")
    .bind(workspaceId)
    .all<{ name: string; ciphertext: string; iv: string; hosts: string }>();
  if (!results.length) return {};
  const key = await masterKey(env);
  const out: Record<string, OpenKey> = {};
  for (const row of results) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: additionalData(workspaceId, row.name) }, key, unb64(row.ciphertext));
      out[row.name] = { value: decoder.decode(plain), hosts: JSON.parse(row.hosts || "[]") as string[] };
    } catch {
      // A key sealed under another master key (or tampered with) is left out; the stage then
      // reports the missing variable by name.
    }
  }
  return out;
}

export async function recordKeyUses(
  env: Env,
  use: { workspaceId: string; names: string[]; flowId: string; runId: string; stage: string; tokens: number },
): Promise<void> {
  if (!use.names.length) return;
  const now = Date.now();
  await env.DB.batch(
    use.names.map((name) =>
      env.DB.prepare("INSERT INTO key_uses (workspace_id, name, flow_id, run_id, stage, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        use.workspaceId,
        name,
        use.flowId,
        use.runId,
        use.stage,
        use.tokens,
        now,
      ),
    ),
  );
}

export async function listKeyUses(env: Env, workspaceId: string, before?: number, limit = 100) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.flow_id, f.name AS flow_name, u.run_id, u.stage, u.tokens, u.created_at
     FROM key_uses u LEFT JOIN flows f ON f.id = u.flow_id
     WHERE u.workspace_id = ? AND u.created_at < ? ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
  )
    .bind(workspaceId, before ?? Number.MAX_SAFE_INTEGER, Math.min(Math.max(limit, 1), 500))
    .all();
  return results;
}

/** Where a request goes and what it carries, as text to look for keys in. */
async function requestTexts(input: RequestInfo | URL, init?: RequestInit): Promise<{ url: URL; texts: string[] }> {
  const request = input instanceof Request ? input : undefined;
  const url = new URL(request ? request.url : String(input));
  const texts = [url.href, decodeURIComponentSafe(url.href)];
  const headers = new Headers(init?.headers ?? request?.headers);
  headers.forEach((value) => texts.push(value));
  const body = init?.body;
  if (typeof body === "string") texts.push(body);
  else if (body instanceof Uint8Array || body instanceof ArrayBuffer) texts.push(decoder.decode(body));
  else if (body instanceof URLSearchParams) texts.push(body.toString(), decodeURIComponentSafe(body.toString()));
  else if (body !== undefined && body !== null) texts.push("\u0000opaque-body");
  return { url, texts };
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * A fetch for one run that lets a key out only to its own hosts, over https, and records which
 * keys went out (`take()` returns the names sent since the last call). A request whose body it
 * can't read (a stream) is refused when the run has any keys, since it could carry one.
 */
export function guardKeys(fetcher: typeof fetch, keys: Record<string, OpenKey>): { fetch: typeof fetch; take: () => string[] } {
  const sent = new Set<string>();
  const names = Object.keys(keys).filter((name) => keys[name]!.value.length >= 4);
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (names.length) {
      const { url, texts } = await requestTexts(input, init);
      if (texts.includes("\u0000opaque-body")) {
        throw new Error(`云端运行时不能发送读不出内容的请求体 / a cloud run can't send a request body it can't inspect: ${url.origin}`);
      }
      for (const name of names) {
        const { value, hosts } = keys[name]!;
        if (!texts.some((text) => text.includes(value))) continue;
        if (url.protocol !== "https:" || !hosts.includes(url.hostname)) {
          throw Object.assign(
            new Error(
              `key ${name} 只能发到 ${hosts.join(", ") || "（没有设置）"}，这个请求要发到 ${url.host}，已拦下。要发到这里，请工作区拥有者在 key 的 hosts 里加上它 / key ${name} may only go to ${hosts.join(", ") || "(none set)"}; this request was going to ${url.host} and was stopped. A workspace owner can add that host to the key's hosts`,
            ),
            { retryable: false },
          );
        }
        sent.add(name);
      }
    }
    return fetcher(input, init);
  }) as typeof fetch;
  return {
    fetch: guarded,
    take() {
      const out = [...sent].sort();
      sent.clear();
      return out;
    },
  };
}
