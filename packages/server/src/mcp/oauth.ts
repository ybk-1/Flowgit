import { audit } from "../audit.js";
import { authenticate, checkOrigin } from "../auth/session.js";
import { providerConfigured } from "../auth/oauth.js";
import type { Env } from "../env.js";
import { flowAccess } from "../flows.js";
import { escapeHtml, HttpError, newId, newToken, readText, sameString, SECURITY_HEADERS, sha256Hex } from "../http.js";
import { page } from "../page.js";

/**
 * OAuth for MCP clients, as the MCP spec asks
 * (https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):
 * - Protected Resource Metadata for each flow's MCP URL (RFC 9728),
 * - Authorization Server Metadata (RFC 8414),
 * - Dynamic Client Registration (RFC 7591), so Claude, Cursor and others register themselves,
 * - the authorization code flow with PKCE S256 only (OAuth 2.1 draft, RFC 7636),
 * - resource indicators (RFC 8707): a token works for one flow's MCP URL and nothing else,
 * - refresh tokens replaced on every use, and revocation (RFC 7009).
 * Flowgit's own sign-in (GitHub, Google) stays as it is: the consent page just needs a session.
 * Codes and tokens are random 256-bit values stored only as SHA-256.
 */

export const ACCESS_SECONDS = 60 * 60;
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;
export const CODE_SECONDS = 10 * 60;
export const SCOPE = "flow";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

/** JSON for MCP clients: CORS for browser-based clients (bearer tokens only, no cookies). */
export function corsJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }), ...SECURITY_HEADERS, ...CORS, ...headers },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** An OAuth error answer (RFC 6749 §5.2). */
function oauthError(status: number, error: string, description: string): Response {
  return corsJson(status, { error, error_description: description });
}

export function originOf(request: Request): string {
  return new URL(request.url).origin;
}

export function mcpUrl(origin: string, flowId: string): string {
  return `${origin}/api/mcp/${flowId}`;
}

export function resourceMetadataUrl(origin: string, flowId: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp/${flowId}`;
}

/** RFC 9728: what protects a flow's MCP URL. `flowId` undefined is the root document. */
export function protectedResource(origin: string, flowId?: string): Response {
  return corsJson(200, {
    resource: flowId ? mcpUrl(origin, flowId) : `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Flowgit",
  });
}

/** RFC 8414. */
export function authorizationServer(origin: string): Response {
  return corsJson(200, {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  });
}

/** The flow a `resource` value names, null for "any flow" (the person picks), or undefined when it isn't ours. */
export function resourceFlow(origin: string, resource: string | null): string | null | undefined {
  if (!resource) return null;
  const trimmed = resource.replace(/\/+$/, "");
  if (trimmed === origin || trimmed === `${origin}/api/mcp`) return null;
  const prefix = `${origin}/api/mcp/`;
  if (!trimmed.startsWith(prefix)) return undefined;
  const id = trimmed.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : undefined;
}

export async function mcpEnabled(env: Env, flowId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 AS on_ FROM mcp_flows WHERE flow_id = ?").bind(flowId).first());
}

// ---- registration ----

/** https, a loopback http address, or an app's own scheme (cursor://...); never script-like schemes. */
export function allowedRedirect(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "https") return true;
  if (scheme === "http") return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !["javascript", "data", "vbscript", "file", "blob", "about", "ws", "wss", "ftp"].includes(scheme);
}

interface ClientRow {
  id: string;
  secret_hash: string | null;
  name: string;
  redirect_uris: string;
  auth_method: string;
}

export async function register(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readText(request, 64 * 1024)) as Record<string, unknown>;
  } catch {
    return oauthError(400, "invalid_client_metadata", "请求不是合法的 JSON / request body is not valid JSON");
  }
  if (!body || typeof body !== "object") return oauthError(400, "invalid_client_metadata", "请求必须是 JSON 对象 / request body must be a JSON object");
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(allowedRedirect)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris 必须是 https、本机 http 或应用自己的地址 / redirect_uris must be https, loopback http or an app's own scheme");
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
    return oauthError(400, "invalid_client_metadata", "不支持这种 token_endpoint_auth_method / unsupported token_endpoint_auth_method");
  }
  const grants = body.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || grants.some((g) => g !== "authorization_code" && g !== "refresh_token"))) {
    return oauthError(400, "invalid_client_metadata", "只支持 authorization_code 和 refresh_token / only authorization_code and refresh_token are supported");
  }
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "MCP client";
  const id = newId("mcpc");
  const secret = method === "none" ? undefined : newToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO mcp_clients (id, secret_hash, name, redirect_uris, auth_method, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, secret ? await sha256Hex(secret) : null, name, JSON.stringify(uris), method, now)
    .run();
  return corsJson(201, {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}

async function clientById(env: Env, id: string | null | undefined): Promise<ClientRow | null> {
  if (!id || id.length > 64) return null;
  return env.DB.prepare("SELECT id, secret_hash, name, redirect_uris, auth_method FROM mcp_clients WHERE id = ?").bind(id).first<ClientRow>();
}

// ---- authorization ----

interface RequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  flow_id: string | null;
  created_at: number;
}

function redirectWith(uri: string, params: Record<string, string | null | undefined>): Response {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString(), ...SECURITY_HEADERS } });
}

function problemPage(message: string, status = 400): Response {
  return page("授权 / Authorize", `<p>${message}</p>`, status);
}

/** GET /api/oauth/authorize: check the request, keep it, then show sign-in or consent for it. */
export async function authorizeGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const kept = url.searchParams.get("request");
  if (kept) return consent(request, env, kept);
  const p = url.searchParams;
  const client = await clientById(env, p.get("client_id"));
  if (!client) return problemPage("不认识这个应用（client_id）。请在应用里重新连接。<br>Unknown client_id. Connect again from the app.");
  const registered = JSON.parse(client.redirect_uris) as string[];
  const given = p.get("redirect_uri");
  const redirect = given ?? (registered.length === 1 ? registered[0]! : undefined);
  if (!redirect || !registered.includes(redirect)) return problemPage("redirect_uri 和注册的不一致。<br>redirect_uri does not match the registered one.");
  const state = p.get("state");
  const fail = (error: string, description: string) => redirectWith(redirect, { error, error_description: description, state, iss: originOf(request) });
  if (p.get("response_type") !== "code") return fail("unsupported_response_type", "only response_type=code is supported");
  const challenge = p.get("code_challenge");
  if (!challenge || p.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const flowId = resourceFlow(originOf(request), p.get("resource"));
  if (flowId === undefined) return fail("invalid_target", "resource must be a Flowgit MCP URL");
  const id = newId("mcr");
  await env.DB.prepare("DELETE FROM mcp_requests WHERE created_at < ?").bind(Date.now() - CODE_SECONDS * 1000).run();
  await env.DB.prepare("INSERT INTO mcp_requests (id, client_id, redirect_uri, code_challenge, state, flow_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, client.id, redirect, challenge, state?.slice(0, 1000) ?? null, flowId, Date.now())
    .run();
  return new Response(null, { status: 302, headers: { Location: `/api/oauth/authorize?request=${id}`, ...SECURITY_HEADERS } });
}

async function keptRequest(env: Env, id: string): Promise<RequestRow | null> {
  const row = await env.DB.prepare("SELECT * FROM mcp_requests WHERE id = ?").bind(id.slice(0, 64)).first<RequestRow>();
  if (!row || row.created_at < Date.now() - CODE_SECONDS * 1000) return null;
  return row;
}

/** Flows this person may hand to an MCP client: editor or owner, MCP turned on. */
async function choosableFlows(env: Env, userId: string, only: string | null): Promise<{ id: string; name: string; workspace: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.name, w.name AS workspace FROM flows f
       JOIN mcp_flows m ON m.flow_id = f.id
       JOIN members mb ON mb.workspace_id = f.workspace_id AND mb.user_id = ?
       JOIN workspaces w ON w.id = f.workspace_id
     WHERE mb.role IN ('owner', 'editor') ${only ? "AND f.id = ?" : ""}
     ORDER BY f.updated_at DESC LIMIT 200`,
  )
    .bind(...(only ? [userId, only] : [userId]))
    .all<{ id: string; name: string; workspace: string }>();
  return results;
}

async function consent(request: Request, env: Env, id: string): Promise<Response> {
  const row = await keptRequest(env, id);
  if (!row) return problemPage("这个授权请求过期了，请在应用里重新连接。<br>This request expired; connect again from the app.");
  const client = await clientById(env, row.client_id);
  if (!client) return problemPage("不认识这个应用。<br>Unknown client.");
  const auth = await authenticate(request, env);
  const here = `/api/oauth/authorize?request=${row.id}`;
  if (!auth) {
    const links = (["github", "google"] as const)
      .filter((provider) => providerConfigured(env, provider))
      .map((provider) => `<a class="button" href="/api/auth/${provider}?next=${encodeURIComponent(here)}">${provider === "github" ? "用 GitHub 登录 / Sign in with GitHub" : "用 Google 登录 / Sign in with Google"}</a>`)
      .join("");
    return page(
      "登录 Flowgit / Sign in to Flowgit",
      `<p><strong>${escapeHtml(client.name)}</strong> 想用你的 Flowgit 流程。先登录。<br><strong>${escapeHtml(client.name)}</strong> wants to use your Flowgit flows. Sign in first.</p><p>${links}</p>`,
    );
  }
  const flows = await choosableFlows(env, auth.user.id, row.flow_id);
  if (!flows.length) {
    return problemPage(
      row.flow_id
        ? "这个流程没有打开 MCP，或者你不是它的编辑者。流程的所有者可以在流程设置里打开。<br>This flow's MCP URL is off, or you can't edit it. The flow's owner can turn it on."
        : "你还没有打开了 MCP 的流程。先在流程设置里打开。<br>None of your flows has its MCP URL turned on yet.",
      403,
    );
  }
  const choice =
    flows.length === 1
      ? `<input type="hidden" name="flow" value="${escapeHtml(flows[0]!.id)}"><p>流程 / Flow: <strong>${escapeHtml(flows[0]!.name)}</strong> <span class="muted">(${escapeHtml(flows[0]!.workspace)})</span></p>`
      : `<p><label>流程 / Flow<br><select name="flow">${flows.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)} (${escapeHtml(f.workspace)})</option>`).join("")}</select></label></p>`;
  let redirectHost = row.redirect_uri;
  try {
    const u = new URL(row.redirect_uri);
    redirectHost = u.host || u.protocol;
  } catch {
    // shown as is
  }
  return page(
    "允许访问？/ Allow access?",
    `<p><strong>${escapeHtml(client.name)}</strong> 想以 <strong>${escapeHtml(auth.user.name)}</strong> 的身份运行这个流程、读它的产物。运行会用掉工作区的用量，在流程的 MCP 设置里随时可以撤销。<br>
     <strong>${escapeHtml(client.name)}</strong> wants to run this flow and read its outputs as <strong>${escapeHtml(auth.user.name)}</strong>. Runs count toward the workspace's usage; you can revoke this any time in the flow's MCP settings.</p>
     <form method="post" action="/api/oauth/authorize">
       <input type="hidden" name="request" value="${escapeHtml(row.id)}">
       ${choice}
       <p class="muted">之后会回到 / You'll go back to: ${escapeHtml(redirectHost)}</p>
       <p><button type="submit" name="decision" value="allow">允许 / Allow</button><button type="submit" name="decision" value="deny">拒绝 / Deny</button></p>
     </form>`,
  );
}

/** POST /api/oauth/authorize: the person's answer on the consent page. */
export async function authorizePost(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth) return problemPage("请先登录。<br>Sign in first.", 401);
  // A cookie form post must come from this site.
  checkOrigin(request, auth);
  const form = new URLSearchParams(await readText(request, 16 * 1024));
  const row = await keptRequest(env, form.get("request") ?? "");
  if (!row) return problemPage("这个授权请求过期了，请在应用里重新连接。<br>This request expired; connect again from the app.");
  // One answer per request.
  await env.DB.prepare("DELETE FROM mcp_requests WHERE id = ?").bind(row.id).run();
  const iss = originOf(request);
  if (form.get("decision") !== "allow") return redirectWith(row.redirect_uri, { error: "access_denied", error_description: "the person said no", state: row.state, iss });
  const flowId = form.get("flow") ?? "";
  if (row.flow_id && row.flow_id !== flowId) return problemPage("流程和请求的不一致。<br>The flow does not match the request.");
  const flows = await choosableFlows(env, auth.user.id, flowId);
  if (!flows.length) return problemPage("不能把这个流程交给应用。<br>This flow can't be handed to an app.", 403);
  const { flow } = await flowAccess(env, flowId, auth.user.id, "editor");
  const code = newToken();
  await env.DB.prepare("INSERT INTO mcp_codes (code_hash, client_id, user_id, flow_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(code), row.client_id, auth.user.id, flowId, row.redirect_uri, row.code_challenge, Date.now() + CODE_SECONDS * 1000)
    .run();
  await audit(env, { userId: auth.user.id, workspaceId: flow.workspace_id, flowId, action: "mcp.authorize", detail: { client: row.client_id } });
  return redirectWith(row.redirect_uri, { code, state: row.state, iss });
}

// ---- tokens ----

async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await readText(request, 16 * 1024);
  const type = request.headers.get("Content-Type") ?? "";
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(body).filter(([, v]) => typeof v === "string") as [string, string][]);
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

/** The calling client: client_secret_basic, client_secret_post, or a public client with only client_id. */
async function tokenClient(request: Request, env: Env, form: URLSearchParams): Promise<ClientRow | Response> {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const header = request.headers.get("Authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const [rawId, rawSecret] = atob(header.slice(6).trim()).split(":");
      id = decodeURIComponent(rawId ?? "");
      secret = decodeURIComponent(rawSecret ?? "");
    } catch {
      return oauthError(401, "invalid_client", "malformed Basic credentials");
    }
  }
  const client = await clientById(env, id);
  if (!client) return oauthError(401, "invalid_client", "unknown client");
  if (client.auth_method !== "none") {
    if (!secret || !client.secret_hash || !sameString(await sha256Hex(secret), client.secret_hash)) return oauthError(401, "invalid_client", "wrong client secret");
  }
  return client;
}

async function issueTokens(env: Env, grantId: string): Promise<Response> {
  const access = newToken();
  const refresh = newToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mcp_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, 'access', ?)").bind(await sha256Hex(access), grantId, now + ACCESS_SECONDS * 1000),
    env.DB.prepare("INSERT INTO mcp_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, 'refresh', ?)").bind(await sha256Hex(refresh), grantId, now + REFRESH_SECONDS * 1000),
    env.DB.prepare("DELETE FROM mcp_tokens WHERE grant_id = ? AND expires_at < ?").bind(grantId, now),
  ]);
  return corsJson(200, { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE }, { Pragma: "no-cache" });
}

async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const encoded = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return sameString(encoded, challenge);
}

/** POST /api/oauth/token. */
export async function token(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const client = await tokenClient(request, env, form);
  if (client instanceof Response) return client;
  const grantType = form.get("grant_type");
  const now = Date.now();
  if (grantType === "authorization_code") {
    const codeHash = await sha256Hex(form.get("code") ?? "");
    const row = await env.DB.prepare("SELECT * FROM mcp_codes WHERE code_hash = ?").bind(codeHash).first<{
      client_id: string;
      user_id: string;
      flow_id: string;
      redirect_uri: string;
      code_challenge: string;
      expires_at: number;
    }>();
    // Single use, whatever happens next.
    if (row) await env.DB.prepare("DELETE FROM mcp_codes WHERE code_hash = ?").bind(codeHash).run();
    if (!row || row.expires_at < now || row.client_id !== client.id) return oauthError(400, "invalid_grant", "the code is unknown, used or expired");
    const redirect = form.get("redirect_uri");
    if (redirect !== null && redirect !== row.redirect_uri) return oauthError(400, "invalid_grant", "redirect_uri does not match");
    if (!(await pkceMatches(form.get("code_verifier") ?? "", row.code_challenge))) return oauthError(400, "invalid_grant", "PKCE code_verifier does not match");
    const resource = form.get("resource");
    if (resource !== null && resourceFlow(originOf(request), resource) !== row.flow_id && resourceFlow(originOf(request), resource) !== null) {
      return oauthError(400, "invalid_target", "resource does not match the authorized flow");
    }
    if (!(await mcpEnabled(env, row.flow_id))) return oauthError(400, "invalid_grant", "the flow's MCP URL was turned off");
    const grantId = newId("mcg");
    await env.DB.prepare("INSERT INTO mcp_grants (id, flow_id, user_id, client_id, created_at) VALUES (?, ?, ?, ?, ?)").bind(grantId, row.flow_id, row.user_id, client.id, now).run();
    return issueTokens(env, grantId);
  }
  if (grantType === "refresh_token") {
    const refreshHash = await sha256Hex(form.get("refresh_token") ?? "");
    const row = await env.DB.prepare(
      "SELECT t.grant_id, t.expires_at, g.client_id, g.revoked_at FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id WHERE t.token_hash = ? AND t.kind = 'refresh'",
    )
      .bind(refreshHash)
      .first<{ grant_id: string; expires_at: number; client_id: string; revoked_at: number | null }>();
    if (!row || row.expires_at < now || row.revoked_at || row.client_id !== client.id) return oauthError(400, "invalid_grant", "the refresh token is unknown, used, revoked or expired");
    // Replaced on every use (OAuth 2.1 for public clients).
    await env.DB.prepare("DELETE FROM mcp_tokens WHERE token_hash = ?").bind(refreshHash).run();
    return issueTokens(env, row.grant_id);
  }
  return oauthError(400, "unsupported_grant_type", "use authorization_code or refresh_token");
}

/** End a grant at once: every token of it stops working on the next request. */
export async function revokeGrant(env: Env, grantId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE mcp_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), grantId),
    env.DB.prepare("DELETE FROM mcp_tokens WHERE grant_id = ?").bind(grantId),
  ]);
}

/** POST /api/oauth/revoke (RFC 7009): revoking either token ends the whole grant. Always 200. */
export async function revoke(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const client = await tokenClient(request, env, form);
  if (client instanceof Response) return client;
  const row = await env.DB.prepare("SELECT t.grant_id, g.client_id FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id WHERE t.token_hash = ?")
    .bind(await sha256Hex(form.get("token") ?? ""))
    .first<{ grant_id: string; client_id: string }>();
  if (row && row.client_id === client.id) await revokeGrant(env, row.grant_id);
  return corsJson(200, {});
}

export interface McpCaller {
  grantId: string;
  userId: string;
  flowId: string;
  client: string;
}

/** The grant behind an MCP request's bearer token, or a 401 that points at the resource metadata. */
export async function mcpCaller(request: Request, env: Env, flowId: string): Promise<McpCaller | Response> {
  const challenge = (error?: string) =>
    corsJson(
      401,
      { error: error ? "访问令牌无效或已撤销 / the access token is invalid or revoked" : "需要授权 / authorization required" },
      { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(originOf(request), flowId)}"${error ? `, error="${error}"` : ""}, scope="${SCOPE}"` },
    );
  const header = request.headers.get("Authorization");
  const match = header ? /^Bearer\s+(\S{1,200})$/i.exec(header) : null;
  if (!match) return challenge();
  const row = await env.DB.prepare(
    `SELECT g.id AS grant_id, g.user_id, g.flow_id, g.revoked_at, t.expires_at, c.name AS client
       FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id JOIN mcp_clients c ON c.id = g.client_id
     WHERE t.token_hash = ? AND t.kind = 'access'`,
  )
    .bind(await sha256Hex(match[1]!))
    .first<{ grant_id: string; user_id: string; flow_id: string; revoked_at: number | null; expires_at: number; client: string }>();
  if (!row || row.revoked_at || row.expires_at < Date.now() || row.flow_id !== flowId) return challenge("invalid_token");
  if (!(await mcpEnabled(env, flowId))) return challenge("invalid_token");
  try {
    await flowAccess(env, flowId, row.user_id, "editor");
  } catch (err) {
    if (err instanceof HttpError) return challenge("invalid_token");
    throw err;
  }
  await env.DB.prepare("UPDATE mcp_grants SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.grant_id).run();
  return { grantId: row.grant_id, userId: row.user_id, flowId, client: row.client };
}
