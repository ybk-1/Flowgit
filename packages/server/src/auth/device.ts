import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { escapeHtml, HttpError, json, newToken, randomBase32, sha256Hex } from "../http.js";
import { page } from "../page.js";
import { type Auth, createSession, CLI_SESSION_DAYS } from "./session.js";

/**
 * Sign-in for the CLI (`flowgit login`, #174), shaped like the OAuth 2.0 device authorization
 * grant (RFC 8628, https://www.rfc-editor.org/rfc/rfc8628): the CLI asks for a code, the person
 * opens the page and approves while signed in, and the CLI polls until it gets a bearer token.
 */
export const DEVICE_MINUTES = 10;
export const POLL_SECONDS = 5;
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"; // RFC 8628 6.1: no vowels, no digits

function newUserCode(): string {
  const raw = randomBase32(8, USER_CODE_ALPHABET);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function normalizeUserCode(code: string): string {
  const letters = code.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : "";
}

export async function startDevice(request: Request, env: Env): Promise<Response> {
  const deviceCode = newToken();
  const userCode = newUserCode();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO device_codes (device_hash, user_code, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(deviceCode), userCode, now, now + DEVICE_MINUTES * 60 * 1000)
    .run();
  const origin = new URL(request.url).origin;
  return json(200, {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${origin}/api/auth/device/verify`,
    verification_uri_complete: `${origin}/api/auth/device/verify?code=${userCode}`,
    expires_in: DEVICE_MINUTES * 60,
    interval: POLL_SECONDS,
  });
}

interface DeviceRow {
  device_hash: string;
  user_code: string;
  expires_at: number;
  user_id: string | null;
  approved_at: number | null;
  used_at: number | null;
}

/** The CLI polls this. Errors carry an RFC 8628 `code`. */
export async function pollDevice(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const deviceCode = typeof body.device_code === "string" ? body.device_code : "";
  if (!deviceCode) throw new HttpError(400, "缺少 device_code / missing device_code");
  const hash = await sha256Hex(deviceCode);
  const row = await env.DB.prepare("SELECT * FROM device_codes WHERE device_hash = ?").bind(hash).first<DeviceRow>();
  if (!row || row.used_at) throw new HttpError(400, "这个登录码无效 / unknown device code", { code: "invalid_grant" });
  if (row.expires_at <= Date.now()) throw new HttpError(400, "登录码过期了，请重新运行 flowgit login / the code expired; run flowgit login again", { code: "expired_token" });
  if (!row.user_id || !row.approved_at) {
    throw new HttpError(400, "还在等你在网页上确认 / waiting for you to approve in the browser", { code: "authorization_pending" });
  }
  // One token per code, even if two polls race.
  const claimed = await env.DB.prepare("UPDATE device_codes SET used_at = ? WHERE device_hash = ? AND used_at IS NULL").bind(Date.now(), hash).run();
  if (!claimed.meta.changes) throw new HttpError(400, "这个登录码已经用过了 / this code was already used", { code: "invalid_grant" });
  const { token, expiresAt } = await createSession(env, row.user_id, "cli", request.headers.get("User-Agent"));
  await audit(env, { userId: row.user_id, action: "auth.cli", detail: {} });
  return json(200, { token, token_type: "bearer", expires_at: expiresAt, expires_in: CLI_SESSION_DAYS * 24 * 60 * 60 });
}

/** The page the person opens. Signed out: sign-in links that come back here. */
export async function verifyPage(request: Request, env: Env, auth: Auth | undefined): Promise<Response> {
  const url = new URL(request.url);
  const code = normalizeUserCode(url.searchParams.get("code") ?? "");
  const back = `/api/auth/device/verify${code ? `?code=${code}` : ""}`;
  if (!auth) {
    const next = encodeURIComponent(back);
    return page(
      "登录命令行 / Sign in the CLI",
      `<p>先登录，再确认命令行的登录码。<br>Sign in first, then approve the code your command line shows.</p>
       <p><a class="button" href="/api/auth/github?next=${next}">用 GitHub 登录 / Sign in with GitHub</a>
          <a class="button" href="/api/auth/google?next=${next}">用 Google 登录 / Sign in with Google</a></p>`,
    );
  }
  return page(
    "登录命令行 / Sign in the CLI",
    `<p>${escapeHtml(auth.user.name)}，命令行显示的登录码和下面一样吗？一样才点确认。<br>Does your command line show the same code? Approve only if it does.</p>
     <form method="post" action="/api/auth/device/verify">
       <p><input name="code" value="${escapeHtml(code)}" placeholder="ABCD-EFGH" autocomplete="off" required maxlength="9"></p>
       <p><button type="submit">确认，让命令行登录 / Approve</button></p>
     </form>
     <p class="muted">没有运行 flowgit login 就关掉这页。<br>If you didn't run flowgit login, close this page.</p>`,
  );
}

export async function approveDevice(env: Env, auth: Auth, rawCode: string): Promise<Response> {
  const code = normalizeUserCode(rawCode);
  const row = code ? await env.DB.prepare("SELECT * FROM device_codes WHERE user_code = ?").bind(code).first<DeviceRow>() : null;
  if (!row || row.used_at || row.approved_at || row.expires_at <= Date.now()) {
    return page("登录命令行 / Sign in the CLI", `<p>登录码不对或已过期，请重新运行 flowgit login。<br>The code is wrong or expired; run flowgit login again.</p>`, 400);
  }
  await env.DB.prepare("UPDATE device_codes SET user_id = ?, approved_at = ? WHERE device_hash = ? AND approved_at IS NULL")
    .bind(auth.user.id, Date.now(), row.device_hash)
    .run();
  await audit(env, { userId: auth.user.id, action: "auth.device.approve", detail: {} });
  return page("登录命令行 / Sign in the CLI", `<p>好了，回到命令行吧。<br>Done. Go back to your command line.</p>`);
}
