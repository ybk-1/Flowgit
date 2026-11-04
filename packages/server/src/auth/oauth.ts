import type { Env } from "../env.js";
import { HttpError, newToken, sha256Hex } from "../http.js";
import type { Identity } from "./users.js";

/**
 * Sign-in with GitHub and Google: the OAuth 2.0 authorization code flow with PKCE, written with
 * plain fetch. (Arctic, the library planned for this, was deprecated in July 2026 and now ships
 * only copy-paste examples of these same requests: https://github.com/pilcrowonpaper/arctic.)
 *
 * GitHub OAuth Apps:
 *   https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 *   (PKCE with S256 is supported; the user is read from https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
 * Google OpenID Connect:
 *   https://developers.google.com/identity/openid-connect/openid-connect
 *   The ID token comes straight from Google's token endpoint over TLS, so its signature need not be
 *   checked (OpenID Connect Core 3.1.3.7: https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation);
 *   iss, aud and exp still are.
 */
export type Provider = "github" | "google";
export const PROVIDERS: Provider[] = ["github", "google"];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as string[]).includes(value);
}

export function callbackUrl(request: Request, provider: Provider): string {
  return `${new URL(request.url).origin}/api/auth/${provider}/callback`;
}

function credentials(env: Env, provider: Provider): { id: string; secret: string } {
  const id = provider === "github" ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const secret = provider === "github" ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    const name = provider === "github" ? "GitHub" : "Google";
    throw new HttpError(503, `还没有设置 ${name} 登录 / ${name} sign-in is not set up yet`);
  }
  return { id, secret };
}

export function providerConfigured(env: Env, provider: Provider): boolean {
  return provider === "github" ? Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) : Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 S256 code challenge. */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export interface AuthorizationStart {
  url: string;
  state: string;
  verifier: string;
}

export async function startAuthorization(env: Env, request: Request, provider: Provider): Promise<AuthorizationStart> {
  const { id } = credentials(env, provider);
  const state = newToken();
  const verifier = newToken();
  const challenge = await codeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: callbackUrl(request, provider),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (provider === "github") {
    // No scope: only the public profile (id, login, name, avatar).
    params.set("allow_signup", "true");
    return { url: `https://github.com/login/oauth/authorize?${params}`, state, verifier };
  }
  params.set("response_type", "code");
  params.set("scope", "openid email profile");
  params.set("prompt", "select_account");
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state, verifier };
}

/** Swap the code for the person's identity at the provider. */
export async function finishAuthorization(env: Env, request: Request, provider: Provider, code: string, verifier: string): Promise<Identity> {
  const { id, secret } = credentials(env, provider);
  const redirect = callbackUrl(request, provider);
  if (provider === "github") {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, code, redirect_uri: redirect, code_verifier: verifier }),
    });
    const token = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!res.ok || !token.access_token) throw signInFailed("GitHub", token.error);
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "flowgit-cloud", "X-GitHub-Api-Version": "2022-11-28" },
    });
    const user = (await userRes.json().catch(() => ({}))) as { id?: number; login?: string; name?: string | null; avatar_url?: string };
    if (!userRes.ok || typeof user.id !== "number") throw signInFailed("GitHub");
    return { provider, subject: String(user.id), login: user.login ?? null, name: user.name || user.login || "GitHub user", avatarUrl: user.avatar_url ?? null };
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect }),
  });
  const token = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !token.id_token) throw signInFailed("Google", token.error);
  const claims = decodeJwtPayload(token.id_token);
  const issuers = ["https://accounts.google.com", "accounts.google.com"];
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!issuers.includes(String(claims.iss)) || !audience.includes(id) || typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() || typeof claims.sub !== "string") {
    throw signInFailed("Google", "invalid id_token");
  }
  const email = typeof claims.email === "string" && claims.email_verified === true ? claims.email : null;
  return {
    provider,
    subject: claims.sub,
    login: email,
    name: typeof claims.name === "string" && claims.name ? claims.name : (email ?? "Google user"),
    email,
    avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
  };
}

function signInFailed(name: string, reason?: string): HttpError {
  return new HttpError(502, `${name} 登录没有成功${reason ? `（${reason}）` : ""} / ${name} sign-in failed${reason ? ` (${reason})` : ""}`);
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw signInFailed("Google", "malformed id_token");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return JSON.parse(text) as Record<string, unknown>;
}

/** Cookie that carries state, PKCE verifier, invite and where to go next across the redirect. */
export const OAUTH_COOKIE = "__Host-flowgit_oauth";

export interface OAuthCookie {
  provider: Provider;
  state: string;
  verifier: string;
  invite?: string;
  next: string;
}

/** Only paths on this site, never "//host" or a full URL. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.length > 500) return "/app/";
  return raw;
}

export async function stateMatches(expected: string, got: string | null): Promise<boolean> {
  if (!got) return false;
  // Compare digests so the comparison takes the same time whatever the input.
  return (await sha256Hex(expected)) === (await sha256Hex(got));
}
