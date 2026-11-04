export class CloudHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CloudHttpError";
  }
}

export const LOGIN_AGAIN = "登录已失效，请重新运行 flowgit login / sign-in expired; run flowgit login again";

export interface CloudResult {
  status: number;
  bytes: Uint8Array;
  headers: Headers;
}

export interface CloudCall {
  origin: string;
  token?: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  json?: unknown;
  body?: Uint8Array;
  fetchImpl?: typeof fetch;
}

/** One request to the cloud origin. Redirects are refused so the token cannot leave this origin. */
export async function cloudCall(call: CloudCall): Promise<CloudResult> {
  if (!call.path.startsWith("/")) throw new Error("请求路径必须以 / 开头 / the request path must start with /");
  const url = new URL(call.path, call.origin);
  if (url.origin !== call.origin) throw new Error("请求不能离开云端地址 / the request must stay on the cloud origin");
  if (call.query) {
    for (const [key, value] of Object.entries(call.query)) url.searchParams.set(key, value);
  }
  const headers = new Headers();
  if (call.token) headers.set("Authorization", `Bearer ${call.token}`);
  let body: Uint8Array | undefined;
  if (call.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = new TextEncoder().encode(JSON.stringify(call.json));
  } else if (call.body) {
    headers.set("Content-Type", "application/octet-stream");
    body = call.body;
  }
  const fetchImpl = call.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { method: call.method, headers, body, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    throw new CloudHttpError(res.status, "云端把请求重定向了，已拒绝，避免令牌被带到别处 / the cloud redirected the request; refused, so the token is not sent elsewhere");
  }
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
}

export function responseJson(result: CloudResult): unknown {
  if (!result.bytes.length) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(result.bytes));
  } catch {
    return undefined;
  }
}

interface ErrorBody {
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export function errorBody(result: CloudResult): ErrorBody {
  const json = responseJson(result);
  return json && typeof json === "object" && !Array.isArray(json) ? (json as ErrorBody) : {};
}

/** Who a 409 `code: "locked"` response names, when it names anyone. */
export function lockedEditor(body: ErrorBody): string | undefined {
  const candidates = [body.editor, body.by, body.user, body.lockedBy, body.holder];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const rec = candidate as { name?: unknown; id?: unknown };
      const name = typeof rec.name === "string" ? rec.name : "";
      const id = typeof rec.id === "string" ? rec.id : "";
      if (name && id) return `${name} (${id})`;
      if (name) return name;
    }
  }
  return undefined;
}

/**
 * Turn a failed response into an error. 401 always tells the person to log in again.
 * 409 `locked` names the editor when the body has one, and is not a signal to retry.
 * 501 uses the server's bilingual text when it sent one.
 */
export function failure(result: CloudResult): CloudHttpError {
  const body = errorBody(result);
  if (result.status === 401) return new CloudHttpError(401, LOGIN_AGAIN, "unauthorized");
  if (result.status === 409 && body.code === "locked") {
    const who = lockedEditor(body);
    const server = typeof body.error === "string" ? body.error : "";
    const editor = who ? `\n编辑者 / editor: ${who}` : "";
    return new CloudHttpError(
      409,
      `有人正在编辑这个流程，已停止，没有重试 / someone is editing this flow; stopped without retrying${server ? `\n${server}` : ""}${editor}`,
      "locked",
    );
  }
  if (result.status === 501) {
    const message = typeof body.error === "string" && body.error.includes("/") ? body.error : "云端还不能运行 / the cloud cannot run this yet";
    return new CloudHttpError(501, message, typeof body.code === "string" ? body.code : "not_implemented");
  }
  const message = typeof body.error === "string" ? body.error : `请求失败 / request failed (${result.status})`;
  return new CloudHttpError(result.status, message, typeof body.code === "string" ? body.code : undefined);
}

export async function cloudJson<T>(call: CloudCall): Promise<T> {
  const result = await cloudCall(call);
  if (result.status < 200 || result.status >= 300) throw failure(result);
  return responseJson(result) as T;
}

export async function cloudBytes(call: CloudCall): Promise<Uint8Array> {
  const result = await cloudCall(call);
  if (result.status < 200 || result.status >= 300) throw failure(result);
  return result.bytes;
}
