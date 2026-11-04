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
 */

/** Like an environment variable: DEEPSEEK_API_KEY. */
const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Names a key may not take: they change how a run behaves rather than authenticate it. */
const RESERVED = /^(FLOWGIT_|PATH$|HOME$|NODE_|HTTP_PROXY$|HTTPS_PROXY$|NO_PROXY$|ALL_PROXY$)/;
export const MAX_KEY_LENGTH = 8192;
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
  created_by: string;
  created_at: number;
  updated_at: number;
  uses: number;
  last_used_at: number | null;
}

export async function listKeys(env: Env, workspaceId: string): Promise<KeyInfo[]> {
  const { results } = await env.DB.prepare(
    `SELECT k.name, k.last4, k.created_by, k.created_at, k.updated_at,
       (SELECT COUNT(*) FROM key_uses u WHERE u.workspace_id = k.workspace_id AND u.name = k.name) AS uses,
       (SELECT MAX(u.created_at) FROM key_uses u WHERE u.workspace_id = k.workspace_id AND u.name = k.name) AS last_used_at
     FROM vault_keys k WHERE k.workspace_id = ? ORDER BY k.name`,
  )
    .bind(workspaceId)
    .all<KeyInfo>();
  return results;
}

/** Store (or replace) a key. Answers with what the API may show. */
export async function putKey(env: Env, userId: string, workspaceId: string, name: string, value: unknown): Promise<{ name: string; last4: string }> {
  const problem = keyNameProblem(name);
  if (problem) throw new HttpError(400, problem);
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
    `INSERT INTO vault_keys (workspace_id, name, ciphertext, iv, last4, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, last4 = excluded.last4, created_by = excluded.created_by, updated_at = excluded.updated_at`,
  )
    .bind(workspaceId, name, b64(sealed), b64(iv), last4, userId, now, now)
    .run();
  await audit(env, { userId, workspaceId, action: existing ? "key.replace" : "key.add", detail: { name } });
  return { name, last4 };
}

export async function deleteKey(env: Env, userId: string, workspaceId: string, name: string): Promise<void> {
  const result = await env.DB.prepare("DELETE FROM vault_keys WHERE workspace_id = ? AND name = ?").bind(workspaceId, name).run();
  if (!result.meta.changes) throw notFound("这个 key / key");
  await audit(env, { userId, workspaceId, action: "key.delete", detail: { name } });
}

/** Every key of the workspace, decrypted. Only for a run's environment; never answer with it. */
export async function decryptKeys(env: Env, workspaceId: string): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT name, ciphertext, iv FROM vault_keys WHERE workspace_id = ?")
    .bind(workspaceId)
    .all<{ name: string; ciphertext: string; iv: string }>();
  if (!results.length) return {};
  const key = await masterKey(env);
  const out: Record<string, string> = {};
  for (const row of results) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: additionalData(workspaceId, row.name) }, key, unb64(row.ciphertext));
      out[row.name] = decoder.decode(plain);
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

/**
 * An environment for one run: the decrypted keys, plus a record of which ones a stage read.
 * `take()` returns the names read since the last call.
 */
export function watchedEnv(base: Record<string, string>, keys: Record<string, string>): { env: Record<string, string>; take: () => string[] } {
  const read = new Set<string>();
  const values = { ...base, ...keys };
  const env = new Proxy(values, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && Object.hasOwn(keys, prop)) read.add(prop);
      return Reflect.get(target, prop, receiver);
    },
    // Writes from a run stay in this run.
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
  });
  return {
    env,
    take() {
      const names = [...read].sort();
      read.clear();
      return names;
    },
  };
}
