import { audit, listAudit } from "./audit.js";
import { approveDevice, pollDevice, startDevice, verifyPage } from "./auth/device.js";
import { finishAuthorization, isProvider, OAUTH_COOKIE, type OAuthCookie, providerConfigured, safeNext, startAuthorization, stateMatches } from "./auth/oauth.js";
import {
  type Auth,
  authenticate,
  checkOrigin,
  clearCookie,
  cookie,
  createSession,
  endSession,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
} from "./auth/session.js";
import { InviteNeededError, signIn } from "./auth/users.js";
import type { Env, RateLimit } from "./env.js";
import { checkFiles, createFlow, deleteFlow, flowAccess, listFlows, renameFlow, requireSpace, room, roomRequest, templateFiles } from "./flows.js";
import { errorResponse, escapeHtml, HttpError, json, readJson, str, unauthorized } from "./http.js";
import { acceptInvite, createInvite, isAdmin, listInvites, revokeInvite } from "./invites.js";
import { listNotifications, markRead, subscribe, unsubscribe, vapidKeys } from "./notify/notify.js";
import { page } from "./page.js";
import { usageOf } from "./runs/usage.js";
import { deleteKey, listKeys, listKeyUses, putKey } from "./vault/vault.js";
import { MAX_FILE_BYTES, WORKSPACE_QUOTA_BYTES } from "./storage/flow-store.js";
import { createWorkspace, isRole, listMembers, listWorkspaces, removeMember, renameWorkspace, requireRole, setMemberRole } from "./workspaces.js";

export { FlowRoom } from "./rooms/room.js";
export { FlowRun } from "./runs/workflow.js";

type Handler = (ctx: Ctx) => Promise<Response>;
interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  auth: Auth | undefined;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** Signed-in only. */
  auth: boolean;
}

const routes: Route[] = [];

function on(method: string, path: string, handler: Handler, options: { auth?: boolean } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:([a-z]+)/g, (_m, key: string) => (keys.push(key), "([A-Za-z0-9_-]+)"))}$`);
  routes.push({ method, pattern, keys, handler, auth: options.auth ?? true });
}

async function limited(limiter: RateLimit | undefined, key: string): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "请求太频繁，请稍后再试 / too many requests, try again shortly");
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

function user(ctx: Ctx): Auth {
  if (!ctx.auth) throw unauthorized();
  return ctx.auth;
}

// ---- sign-in ----

on(
  "GET",
  "/api/auth/providers",
  async ({ env }) => json(200, { github: providerConfigured(env, "github"), google: providerConfigured(env, "google"), test: testLoginEnabled(env) }),
  { auth: false },
);

on(
  "GET",
  "/api/auth/:provider",
  async ({ request, env, url, params }) => {
    if (!isProvider(params.provider!)) throw new HttpError(404, "没有这种登录方式 / unknown sign-in provider");
    const provider = params.provider;
    const started = await startAuthorization(env, request, provider);
    const invite = url.searchParams.get("invite")?.trim().slice(0, 64) || undefined;
    const value: OAuthCookie = { provider, state: started.state, verifier: started.verifier, invite, next: safeNext(url.searchParams.get("next")) };
    return new Response(null, { status: 302, headers: { Location: started.url, "Set-Cookie": cookie(OAUTH_COOKIE, JSON.stringify(value), 600), "Cache-Control": "no-store" } });
  },
  { auth: false },
);

on(
  "GET",
  "/api/auth/:provider/callback",
  async ({ request, env, url, params }) => {
    const raw = readCookie(request, OAUTH_COOKIE);
    let saved: OAuthCookie | undefined;
    try {
      saved = raw ? (JSON.parse(raw) as OAuthCookie) : undefined;
    } catch {
      saved = undefined;
    }
    const clear = clearCookie(OAUTH_COOKIE);
    if (!saved || saved.provider !== params.provider || !isProvider(saved.provider) || !(await stateMatches(saved.state, url.searchParams.get("state")))) {
      return page("登录 / Sign in", `<p>登录过程过期或不完整，请重新登录。<br>The sign-in expired or was interrupted; please try again.</p>`, 400, { "Set-Cookie": clear });
    }
    const code = url.searchParams.get("code");
    if (!code) {
      return page("登录 / Sign in", `<p>没有登录（已取消）。<br>Sign-in was cancelled.</p><p><a class="button" href="${escapeHtml(saved.next)}">返回 / Back</a></p>`, 400, { "Set-Cookie": clear });
    }
    const identity = await finishAuthorization(env, request, saved.provider, code, saved.verifier);
    try {
      const result = await signIn(env, identity, saved.invite);
      const session = await createSession(env, result.user.id, "web", request.headers.get("User-Agent"));
      const headers = new Headers({ Location: saved.next, "Cache-Control": "no-store" });
      headers.append("Set-Cookie", clear);
      headers.append("Set-Cookie", sessionCookie(session.token));
      return new Response(null, { status: 302, headers });
    } catch (err) {
      if (err instanceof InviteNeededError) {
        return page(
          "需要邀请码 / Invite needed",
          `<p>Flowgit 云端还在邀请制测试，注册要邀请码。<br>Flowgit Cloud is in an invite-only beta; signing up needs an invite code.</p>
           <form method="get" action="/api/auth/${saved.provider}">
             <input type="hidden" name="next" value="${escapeHtml(saved.next)}">
             <p><input name="invite" placeholder="FG-XXXXX-XXXXX-XXXXX-XXXXX" required maxlength="64"></p>
             <p><button type="submit">用邀请码注册 / Sign up with the code</button></p>
           </form>`,
          403,
          { "Set-Cookie": clear },
        );
      }
      throw err;
    }
  },
  { auth: false },
);

on("POST", "/api/auth/logout", async (ctx) => {
  const auth = user(ctx);
  await endSession(ctx.env, auth.tokenHash);
  return json(200, { ok: true }, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
});

function testLoginEnabled(env: Env): boolean {
  return env.FLOWGIT_TEST_LOGIN === "1" && env.ENVIRONMENT === "local";
}

// Local emulator and tests only: sign in as anyone. Refuses everywhere else.
on(
  "POST",
  "/api/auth/test",
  async ({ request, env }) => {
    if (!testLoginEnabled(env)) throw new HttpError(404, "没有这个接口 / not found");
    const body = await readJson(request);
    const subject = str(body, "subject", 100);
    if (!subject) throw new HttpError(400, "缺少 subject / missing subject");
    const result = await signIn(env, { provider: "test", subject, login: subject, name: str(body, "name", 100) ?? subject }, str(body, "invite", 64));
    const session = await createSession(env, result.user.id, body.kind === "cli" ? "cli" : "web", request.headers.get("User-Agent"));
    return json(200, { user: result.user, token: session.token, joined: result.joined ?? null }, { "Set-Cookie": sessionCookie(session.token) });
  },
  { auth: false },
);

on(
  "POST",
  "/api/auth/device",
  async ({ request, env }) => {
    await limited(env.AUTH_LIMITER, `device:${clientIp(request)}`);
    return startDevice(request, env);
  },
  { auth: false },
);
on(
  "POST",
  "/api/auth/device/token",
  async ({ request, env }) => {
    await limited(env.AUTH_LIMITER, `poll:${clientIp(request)}`);
    return pollDevice(request, env, await readJson(request));
  },
  { auth: false },
);
on("GET", "/api/auth/device/verify", async ({ request, env, auth }) => verifyPage(request, env, auth), { auth: false });
on("POST", "/api/auth/device/verify", async (ctx) => {
  const form = await ctx.request.formData();
  return approveDevice(ctx.env, user(ctx), String(form.get("code") ?? ""));
});

// ---- account ----

on("GET", "/api/me", async (ctx) => {
  const auth = user(ctx);
  return json(200, { user: auth.user, admin: await isAdmin(ctx.env, auth.user.id), workspaces: await listWorkspaces(ctx.env, auth.user.id), via: auth.via });
});

// ---- workspaces and members ----

on("GET", "/api/workspaces", async (ctx) => json(200, { workspaces: await listWorkspaces(ctx.env, user(ctx).user.id) }));
on("POST", "/api/workspaces", async (ctx) => {
  const body = await readJson(ctx.request);
  const name = str(body, "name", 80);
  if (!name) throw new HttpError(400, "缺少工作区名字 / missing workspace name");
  return json(201, { workspace: await createWorkspace(ctx.env, user(ctx).user.id, name) });
});
on("GET", "/api/workspaces/:ws", async (ctx) => {
  const role = await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "viewer");
  const workspace = await ctx.env.DB.prepare("SELECT id, name, created_by, created_at FROM workspaces WHERE id = ?").bind(ctx.params.ws).first();
  const used = await ctx.env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM flows WHERE workspace_id = ?").bind(ctx.params.ws).first<{ n: number }>();
  return json(200, { workspace, role, storage: { used: used?.n ?? 0, quota: WORKSPACE_QUOTA_BYTES } });
});
on("PATCH", "/api/workspaces/:ws", async (ctx) => {
  const name = str(await readJson(ctx.request), "name", 80);
  if (!name) throw new HttpError(400, "缺少工作区名字 / missing workspace name");
  await renameWorkspace(ctx.env, user(ctx).user.id, ctx.params.ws!, name);
  return json(200, { ok: true });
});
on("GET", "/api/workspaces/:ws/members", async (ctx) => {
  await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "viewer");
  return json(200, { members: await listMembers(ctx.env, ctx.params.ws!) });
});
on("PATCH", "/api/workspaces/:ws/members/:member", async (ctx) => {
  const role = (await readJson(ctx.request)).role;
  if (!isRole(role)) throw new HttpError(400, "role 必须是 owner、editor 或 viewer / role must be owner, editor or viewer");
  await setMemberRole(ctx.env, user(ctx).user.id, ctx.params.ws!, ctx.params.member!, role);
  return json(200, { ok: true });
});
on("DELETE", "/api/workspaces/:ws/members/:member", async (ctx) => {
  await removeMember(ctx.env, user(ctx).user.id, ctx.params.ws!, ctx.params.member!);
  return json(200, { ok: true });
});
on("GET", "/api/workspaces/:ws/audit", async (ctx) => {
  await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "owner");
  const before = Number(ctx.url.searchParams.get("before")) || undefined;
  return json(200, { entries: await listAudit(ctx.env, ctx.params.ws!, before) });
});

// ---- invites ----

function inviteUrl(request: Request, code: string): string {
  return `${new URL(request.url).origin}/app/?invite=${encodeURIComponent(code)}`;
}

on("GET", "/api/workspaces/:ws/invites", async (ctx) => json(200, { invites: await listInvites(ctx.env, user(ctx).user.id, ctx.params.ws) }));
on("POST", "/api/workspaces/:ws/invites", async (ctx) => {
  const body = await readJson(ctx.request);
  const role = body.role ?? "editor";
  if (!isRole(role)) throw new HttpError(400, "role 必须是 owner、editor 或 viewer / role must be owner, editor or viewer");
  const invite = await createInvite(ctx.env, user(ctx).user.id, { workspaceId: ctx.params.ws, role, days: Number(body.days) || undefined });
  return json(201, { ...invite, url: inviteUrl(ctx.request, invite.code) });
});
// Sign-up codes, admins only.
on("GET", "/api/invites", async (ctx) => json(200, { invites: await listInvites(ctx.env, user(ctx).user.id) }));
on("POST", "/api/invites", async (ctx) => {
  const body = await readJson(ctx.request);
  const invite = await createInvite(ctx.env, user(ctx).user.id, { maxUses: Number(body.maxUses) || 1, days: Number(body.days) || undefined });
  return json(201, { ...invite, url: inviteUrl(ctx.request, invite.code) });
});
on("DELETE", "/api/invites/:invite", async (ctx) => {
  await revokeInvite(ctx.env, user(ctx).user.id, ctx.params.invite!);
  return json(200, { ok: true });
});
on("POST", "/api/invites/accept", async (ctx) => {
  const code = str(await readJson(ctx.request), "code", 64);
  if (!code) throw new HttpError(400, "缺少邀请码 / missing invite code");
  return json(200, await acceptInvite(ctx.env, user(ctx).user.id, code));
});

// ---- flows ----

on("GET", "/api/templates", async ({ env }) => {
  if (!env.ASSETS) return json(200, { templates: [] });
  const res = await env.ASSETS.fetch(new Request("https://assets/templates/index.json"));
  return json(200, { templates: res.ok ? await res.json() : [] });
});

on("GET", "/api/workspaces/:ws/flows", async (ctx) => {
  await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "viewer");
  return json(200, { flows: await listFlows(ctx.env, ctx.params.ws!) });
});
on("POST", "/api/workspaces/:ws/flows", async (ctx) => {
  const auth = user(ctx);
  await requireRole(ctx.env, ctx.params.ws!, auth.user.id, "editor");
  const body = await readJson(ctx.request, Math.ceil(MAX_FILE_BYTES * 1.4) + 4096);
  const template = str(body, "template", 60);
  if (template && body.files !== undefined) throw new HttpError(400, "template 和 files 只能给一个 / give template or files, not both");
  const { files, bytes } = checkFiles(template ? await templateFiles(ctx.env, template) : body.files);
  const name = str(body, "name", 120) || template || "flow";
  return json(201, { flow: await createFlow(ctx.env, auth.user.id, ctx.params.ws!, name, files, bytes) });
});
on("GET", "/api/flows/:flow", async (ctx) => {
  const { flow, role } = await flowAccess(ctx.env, ctx.params.flow!, user(ctx).user.id, "viewer");
  return json(200, { flow, role });
});
on("PATCH", "/api/flows/:flow", async (ctx) => {
  const name = str(await readJson(ctx.request), "name", 120);
  if (!name) throw new HttpError(400, "缺少流程名字 / missing flow name");
  await renameFlow(ctx.env, user(ctx).user.id, ctx.params.flow!, name);
  return json(200, { ok: true });
});
on("DELETE", "/api/flows/:flow", async (ctx) => {
  await deleteFlow(ctx.env, user(ctx).user.id, ctx.params.flow!);
  return json(200, { ok: true });
});

/** Forward to the flow's room after checking the role: reading needs viewer, changing needs editor. */
async function toRoom(ctx: Ctx, path: string, audited?: string): Promise<Response> {
  const auth = user(ctx);
  const method = ctx.request.method.toUpperCase();
  const reading = method === "GET" || method === "HEAD";
  const { flow } = await flowAccess(ctx.env, ctx.params.flow!, auth.user.id, reading ? "viewer" : "editor");
  if (!reading) {
    const declared = Number(ctx.request.headers.get("Content-Length") ?? "0");
    await requireSpace(ctx.env, flow.workspace_id, Number.isFinite(declared) ? declared : 0);
  }
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Length", "Upgrade", "If-None-Match"]) {
    const value = ctx.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const res = await room(ctx.env, flow.id).fetch(
    roomRequest(flow.id, auth.user.id, `${path}${ctx.url.search}`, { method, headers, body: reading ? undefined : ctx.request.body }),
  );
  if (!reading && res.ok && audited) {
    await audit(ctx.env, { userId: auth.user.id, workspaceId: flow.workspace_id, flowId: flow.id, action: audited, detail: { path: ctx.url.searchParams.get("path") ?? ctx.url.searchParams.get("stage") ?? null } });
  }
  return res;
}

on("GET", "/api/flows/:flow/files", (ctx) => toRoom(ctx, "/files"));
on("GET", "/api/flows/:flow/raw", (ctx) => toRoom(ctx, "/raw"));
on("PUT", "/api/flows/:flow/raw", (ctx) => toRoom(ctx, "/raw", "file.write"));
on("DELETE", "/api/flows/:flow/raw", (ctx) => toRoom(ctx, "/raw", "file.delete"));
on("GET", "/api/flows/:flow/events", async (ctx) => {
  // Browsers send Origin on WebSocket upgrades; refuse other sites (cross-site WebSocket hijacking).
  checkOrigin(ctx.request, ctx.auth, true);
  return toRoom(ctx, "/ws");
});

// The board's own API for one flow: /api/flows/<id>/board/<route> answers like the local board's /api/<route>.
const BOARD_AUDIT: Record<string, string> = {
  "PUT file": "file.write",
  "POST upload": "file.upload",
  "PUT inputs": "inputs.save",
  "POST restore": "stage.restore",
  "POST stage": "stage.add",
  "PUT stage": "stage.edit",
  "DELETE stage": "stage.remove",
  "PUT flow": "flow.edit",
  "POST run": "run.start",
  "POST trust": "flow.trust",
};
for (const method of ["GET", "PUT", "POST", "DELETE"]) {
  on(method, "/api/flows/:flow/board/:route", (ctx) => toRoom(ctx, `/board/${ctx.params.route}`, BOARD_AUDIT[`${method} ${ctx.params.route}`] ?? `board.${ctx.params.route}`));
}

// ---- cloud runs ----

on("GET", "/api/flows/:flow/runs", async (ctx) => {
  const { flow } = await flowAccess(ctx.env, ctx.params.flow!, user(ctx).user.id, "viewer");
  const before = Number(ctx.url.searchParams.get("before") ?? "") || Number.MAX_SAFE_INTEGER;
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, stage, model, state, waiting, error, tokens, user_id, created_at, updated_at, finished_at FROM runs WHERE flow_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(flow.id, before)
    .all<{ waiting: string | null }>();
  return json(200, { runs: results.map((row) => ({ ...row, waiting: row.waiting ? JSON.parse(row.waiting) : null })) });
});
on("POST", "/api/flows/:flow/runs", (ctx) => toRoom(ctx, "/board/run", "run.start"));
on("GET", "/api/flows/:flow/run", (ctx) => toRoom(ctx, "/run"));
on("GET", "/api/flows/:flow/runs/:run", async (ctx) => {
  const { flow } = await flowAccess(ctx.env, ctx.params.flow!, user(ctx).user.id, "viewer");
  const row = await ctx.env.DB.prepare("SELECT id, stage, model, state, waiting, error, tokens, user_id, created_at, updated_at, finished_at FROM runs WHERE id = ? AND flow_id = ?")
    .bind(ctx.params.run!, flow.id)
    .first<{ waiting: string | null }>();
  if (!row) throw new HttpError(404, "没有这个运行 / run not found");
  return json(200, { run: { ...row, waiting: row.waiting ? JSON.parse(row.waiting) : null } });
});
for (const action of ["continue", "cancel"]) {
  on("POST", `/api/flows/:flow/runs/:run/${action}`, async (ctx) => {
    const auth = user(ctx);
    const { flow } = await flowAccess(ctx.env, ctx.params.flow!, auth.user.id, "editor");
    const res = await room(ctx.env, flow.id).fetch(
      roomRequest(flow.id, auth.user.id, `/run/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: ctx.params.run }) }),
    );
    if (res.ok) await audit(ctx.env, { userId: auth.user.id, workspaceId: flow.workspace_id, flowId: flow.id, action: `run.${action}`, detail: { run: ctx.params.run } });
    return res;
  });
}

// ---- the key vault and usage ----

on("GET", "/api/workspaces/:ws/keys", async (ctx) => {
  await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "editor");
  return json(200, { keys: await listKeys(ctx.env, ctx.params.ws!) });
});
on("PUT", "/api/workspaces/:ws/keys/:name", async (ctx) => {
  const auth = user(ctx);
  await requireRole(ctx.env, ctx.params.ws!, auth.user.id, "owner");
  const body = await readJson(ctx.request, 16 * 1024);
  return json(200, { ok: true, key: await putKey(ctx.env, auth.user.id, ctx.params.ws!, ctx.params.name!, body.value) });
});
on("DELETE", "/api/workspaces/:ws/keys/:name", async (ctx) => {
  const auth = user(ctx);
  await requireRole(ctx.env, ctx.params.ws!, auth.user.id, "owner");
  await deleteKey(ctx.env, auth.user.id, ctx.params.ws!, ctx.params.name!);
  return json(200, { ok: true });
});
on("GET", "/api/workspaces/:ws/key-uses", async (ctx) => {
  await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "owner");
  const before = Number(ctx.url.searchParams.get("before") ?? "") || undefined;
  return json(200, { uses: await listKeyUses(ctx.env, ctx.params.ws!, before) });
});
on("GET", "/api/workspaces/:ws/usage", async (ctx) => {
  await requireRole(ctx.env, ctx.params.ws!, user(ctx).user.id, "viewer");
  return json(200, { usage: await usageOf(ctx.env, ctx.params.ws!) });
});

// ---- notifications ----

on("GET", "/api/notifications", async (ctx) => {
  const before = Number(ctx.url.searchParams.get("before") ?? "") || undefined;
  return json(200, await listNotifications(ctx.env, user(ctx).user.id, before));
});
on("POST", "/api/notifications/read", async (ctx) => {
  const body = await readJson(ctx.request, 64 * 1024);
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : undefined;
  await markRead(ctx.env, user(ctx).user.id, ids);
  return json(200, { ok: true });
});
on("GET", "/api/push/key", async ({ env }) => json(200, { publicKey: vapidKeys(env)?.publicKey ?? null }), { auth: false });
on("POST", "/api/push/subscriptions", async (ctx) => json(200, { ok: true, ...(await subscribe(ctx.env, user(ctx).user.id, await readJson(ctx.request, 16 * 1024))) }));
on("DELETE", "/api/push/subscriptions", async (ctx) => {
  await unsubscribe(ctx.env, user(ctx).user.id, (await readJson(ctx.request, 16 * 1024)).endpoint);
  return json(200, { ok: true });
});

// ---- the test console (static files in public/console/) ----

const CONSOLE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

async function consoleFile(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ASSETS) return json(404, { error: "没有这个页面 / not found" });
  if (url.pathname === "/api/console") return new Response(null, { status: 301, headers: { Location: "/api/console/" } });
  const name = url.pathname.slice("/api/console/".length) || "index.html";
  if (!/^[a-z]+\.(html|js|css)$/.test(name)) return json(404, { error: "没有这个页面 / not found" });
  const res = await env.ASSETS.fetch(new Request(new URL(`/console/${name}`, url), { headers: request.headers }));
  const headers = new Headers(res.headers);
  headers.set("Content-Security-Policy", CONSOLE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(res.body, { status: res.status, headers });
}

// ---- entry ----

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  try {
    const matching = routes.filter((route) => route.pattern.test(url.pathname));
    if (!matching.length) return json(404, { error: "没有这个接口 / not found" });
    const route = matching.find((item) => item.method === method);
    if (!route) return json(405, { error: "不支持这个方法 / method not allowed" });
    const values = route.pattern.exec(url.pathname)!.slice(1);
    const params = Object.fromEntries(route.keys.map((key, i) => [key, values[i]!]));
    const auth = await authenticate(request, env);
    if (route.auth && !auth) throw unauthorized();
    checkOrigin(request, auth);
    await limited(env.API_LIMITER, auth ? `user:${auth.user.id}` : `ip:${clientIp(request)}`);
    return await route.handler({ request, env, url, params, auth });
  } catch (err) {
    return errorResponse(err);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/console" || url.pathname.startsWith("/api/console/")) return consoleFile(request, env, url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handle(request, env);
    // Staging serves the web app next to the API; production's route only sends /api/* here.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json(404, { error: "没有这个页面 / not found" });
  },
} satisfies ExportedHandler<Env>;

