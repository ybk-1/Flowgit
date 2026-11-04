import type { Env } from "../env.js";
import { HttpError, newToken, sha256Hex, unauthorized } from "../http.js";

/**
 * Sessions. The browser gets an HttpOnly, Secure, SameSite=Lax cookie with the `__Host-` prefix
 * (https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes); the CLI gets the
 * same kind of token from the device code flow and sends it as `Authorization: Bearer`.
 * Only the SHA-256 of a token is stored.
 */
export const SESSION_COOKIE = "__Host-flowgit_session";
export const WEB_SESSION_DAYS = 30;
export const CLI_SESSION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

export interface User {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  created_at: number;
}

export interface Auth {
  user: User;
  /** "cookie" requests must also pass the origin check when they change something. */
  via: "cookie" | "bearer";
  tokenHash: string;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

export function cookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env: Env, userId: string, kind: "web" | "cli", userAgent: string | null): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + (kind === "web" ? WEB_SESSION_DAYS : CLI_SESSION_DAYS) * DAY;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, kind, now, expiresAt, userAgent?.slice(0, 200) ?? null)
    .run();
  return { token, expiresAt };
}

export function sessionCookie(token: string): string {
  return cookie(SESSION_COOKIE, token, WEB_SESSION_DAYS * 24 * 60 * 60);
}

/** The signed-in user, or undefined. A bearer token wins over the cookie. */
export async function authenticate(request: Request, env: Env): Promise<Auth | undefined> {
  const header = request.headers.get("Authorization");
  let token: string | undefined;
  let via: Auth["via"] = "cookie";
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new HttpError(401, "Authorization 头的格式不对 / malformed Authorization header");
    token = match[1];
    via = "bearer";
  } else token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 200) return undefined;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.id, u.name, u.email, u.avatar_url, u.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  )
    .bind(tokenHash)
    .first<User & { expires_at: number }>();
  if (!row) return undefined;
  if (row.expires_at <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return undefined;
  }
  const { expires_at: _expires, ...user } = row;
  return { user, via, tokenHash };
}

export async function requireAuth(request: Request, env: Env): Promise<Auth> {
  const auth = await authenticate(request, env);
  if (!auth) throw unauthorized();
  return auth;
}

export async function endSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie requests that change something must come from this site: the Origin header (sent by
 * every current browser on non-GET requests) has to be this Worker's own origin. Bearer requests
 * carry no ambient credentials, so they skip this. Also used for WebSocket upgrades (GET), where
 * browsers always send Origin.
 */
export function checkOrigin(request: Request, auth: Auth | undefined, force = false): void {
  if (!auth || auth.via !== "cookie") return;
  if (!force && SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("Origin");
  const own = new URL(request.url).origin;
  if (origin !== own) throw new HttpError(403, "请求来自别的网站，已拒绝 / request from another site refused");
}
