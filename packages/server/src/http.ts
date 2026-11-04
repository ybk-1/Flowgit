/** An error answered as `{ "error": "<中文> / <English>" }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json(err.status, { error: err.message, ...err.extra });
  console.error(err);
  return json(500, { error: "服务器出错了 / internal error" });
}

export const unauthorized = () => new HttpError(401, "请先登录 / sign in first");
export const forbidden = () => new HttpError(403, "没有权限 / not allowed");
export const notFound = (what = "这个东西 / this") => {
  const [zh, en] = what.split(" / ");
  return new HttpError(404, `没有${zh} / ${en ?? zh} not found`);
};

/** The request body as a JSON object; 400 otherwise. Bodies over `limit` bytes are refused. */
export async function readJson(request: Request, limit = 1024 * 1024): Promise<Record<string, unknown>> {
  const text = await readText(request, limit);
  if (!text.trim()) throw new HttpError(400, "请求是空的 / empty request body");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求不是合法的 JSON / request body is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "请求必须是 JSON 对象 / request body must be a JSON object");
  return value as Record<string, unknown>;
}

export async function readText(request: Request, limit: number): Promise<string> {
  return new TextDecoder().decode(await readBytes(request, limit));
}

/** The body, refusing more than `limit` bytes (checked while reading, not only from Content-Length). */
export async function readBytes(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > limit) throw tooLarge(limit);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export function tooLarge(limit: number): HttpError {
  const mb = Math.round(limit / 1024 / 1024);
  return new HttpError(413, `文件太大，上限 ${mb} MB / too large, the limit is ${mb} MB`);
}

export function str(body: Record<string, unknown>, key: string, max = 200): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} 必须是字符串 / ${key} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${key} 太长（最多 ${max} 个字符）/ ${key} is too long (at most ${max} characters)`);
  return trimmed;
}

/** Random id: `prefix_` and 16 characters of base32 (80 bits). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBase32(16)}`;
}

const BASE32 = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1

export function randomBase32(length: number, alphabet = BASE32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/** A secret token: 32 random bytes, base64url. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const data = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
