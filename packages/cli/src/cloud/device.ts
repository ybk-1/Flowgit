import { cloudCall, errorBody, type CloudCall, type CloudResult } from "./http.js";

/**
 * Device authorization grant, shaped like RFC 8628.
 * https://www.rfc-editor.org/rfc/rfc8628
 * The device_code is never printed. On HTTP 429 the poll interval grows by 5 seconds
 * (RFC 8628 `slow_down`), and by more when Retry-After asks for it.
 */

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceToken {
  token: string;
  token_type: string;
  expires_at: number;
  expires_in: number;
}

const PENDING = new Set(["authorization_pending"]);
const SLOW = new Set(["slow_down"]);
const DEAD = new Set(["expired_token", "invalid_grant"]);

function codeOf(result: CloudResult): string | undefined {
  const code = errorBody(result).code;
  return typeof code === "string" ? code : undefined;
}

function messageOf(result: CloudResult, fallback: string): string {
  const error = errorBody(result).error;
  return typeof error === "string" && error ? error : fallback;
}

function retryAfterSeconds(result: CloudResult): number {
  const raw = result.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export async function startDevice(origin: string, fetchImpl?: typeof fetch): Promise<DeviceStart> {
  const result = await cloudCall({ origin, method: "POST", path: "/api/auth/device", json: {}, fetchImpl });
  if (result.status !== 200) {
    throw new Error(messageOf(result, "申请登录码失败 / could not start device sign-in"));
  }
  const body = JSON.parse(new TextDecoder().decode(result.bytes)) as Partial<DeviceStart>;
  if (!body.device_code || !body.user_code || !body.verification_uri_complete) {
    throw new Error("登录码的响应不完整 / the device sign-in response is incomplete");
  }
  return {
    device_code: body.device_code,
    user_code: body.user_code,
    verification_uri: body.verification_uri ?? "",
    verification_uri_complete: body.verification_uri_complete,
    expires_in: typeof body.expires_in === "number" ? body.expires_in : 600,
    interval: typeof body.interval === "number" ? body.interval : 5,
  };
}

/**
 * Poll until the person approves, the code dies, or it expires.
 * `sleep` is injected so tests do not wait on a real clock.
 */
export async function pollDeviceToken(args: {
  origin: string;
  deviceCode: string;
  intervalSec: number;
  expiresInSec: number;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
}): Promise<DeviceToken> {
  const now = args.now ?? Date.now;
  const deadline = now() + Math.max(1, args.expiresInSec) * 1000;
  let interval = Math.max(1, args.intervalSec);
  while (now() <= deadline) {
    await args.sleep(interval * 1000);
    const call: CloudCall = {
      origin: args.origin,
      method: "POST",
      path: "/api/auth/device/token",
      json: { device_code: args.deviceCode },
      fetchImpl: args.fetchImpl,
    };
    const result = await cloudCall(call);
    if (result.status === 200) {
      const body = JSON.parse(new TextDecoder().decode(result.bytes)) as Partial<DeviceToken>;
      if (typeof body.token !== "string" || body.token.length === 0 || String(body.token_type).toLowerCase() !== "bearer") {
        throw new Error("登录响应不对 / unexpected sign-in response");
      }
      const expiresAt = typeof body.expires_at === "number" ? body.expires_at : now() + (body.expires_in ?? 0) * 1000;
      return { token: body.token, token_type: "bearer", expires_at: expiresAt, expires_in: body.expires_in ?? 0 };
    }
    if (result.status === 429 || SLOW.has(codeOf(result) ?? "")) {
      interval += 5;
      interval = Math.max(interval, retryAfterSeconds(result));
      continue;
    }
    const code = codeOf(result);
    if (code && PENDING.has(code)) continue;
    if (code && DEAD.has(code)) throw new Error(messageOf(result, "登录失败，请重新运行 flowgit login / sign-in failed; run flowgit login again"));
    throw new Error(messageOf(result, `登录失败 / sign-in failed (${result.status})`));
  }
  throw new Error("登录码过期了，请重新运行 flowgit login / the code expired; run flowgit login again");
}
