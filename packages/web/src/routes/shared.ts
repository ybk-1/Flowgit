import { type GeneratePreview, isSafeRelative } from "@flowgit/core";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export interface SseFrame {
  id: number;
  event: string;
  data: string;
}

export interface HandlerCtx {
  dir: string;
  token: string;
  port: number;
  /** True while runStage/runAll from this server has not finished. */
  running: boolean;
  nextEventId: number;
  /** Events from the current or most recent run, so a late SSE client can catch up. */
  history: SseFrame[];
  clients: Set<http.ServerResponse>;
  /** `fs.watch` handles for the flow directory. `close()` shuts them. */
  watchers: fs.FSWatcher[];
  /** True while those watchers should emit `flow:changed`. */
  watching: boolean;
  /** Debounce timer for filesystem events. Cleared by `close()`. */
  changeTimer?: ReturnType<typeof setTimeout>;
  /** Origins allowed to call /api/* from a web page (still with the token): the web app. */
  origins: Set<string>;
  /** The last preview from POST /api/generate, written only after the board confirms it. */
  pendingGenerate?: { id: string; dir: string; preview: GeneratePreview };
}

export const JSON_LIMIT = 1_000_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function authorized(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): boolean {
  if (tokenMatches(headerString(req, "x-flowgit-token"), ctx.token)) return true;
  req.resume();
  sendJson(res, 401, { error: "未授权：缺少或错误的令牌 / unauthorized: missing or invalid token" });
  return false;
}

/** Outputs must not change under a running stage: a write would be lost or mistaken for the run's own. */
export function busy(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, message?: string): boolean {
  if (!ctx.running) return false;
  req.resume();
  sendJson(res, 409, { error: message ?? "正在运行，结束后再保存 / a run is in progress; save again when it finishes" });
  return true;
}

export async function readJsonObject(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > JSON_LIMIT) {
      req.destroy();
      throw new HttpError(400, "请求太大 / request too large");
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new HttpError(400, "请求是空的 / empty request body");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求不是合法的 JSON / request body is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "请求必须是 JSON 对象 / request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function coreHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const missing = /没有这个阶段|Unknown stage|没有 v\d|has no run #/.test(message);
  return new HttpError(missing ? 404 : 400, message);
}

export function realRoot(dir: string): string | null {
  try {
    return fs.realpathSync(path.resolve(dir));
  } catch {
    return null;
  }
}

/**
 * Absolute path for `abs` that stays inside `rootReal`.
 * The leaf is not realpath'd, so replacing a symlink does not follow it.
 */
export function placeInside(rootReal: string, abs: string): string | null {
  if (outside(rootReal, abs)) return null;
  const base = path.basename(abs);
  let cursor = path.dirname(abs);
  const missing: string[] = [];
  while (!fs.existsSync(cursor)) {
    missing.push(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  let realParent: string;
  try {
    realParent = fs.realpathSync(cursor);
  } catch {
    return null;
  }
  if (outside(rootReal, realParent)) return null;
  const finalParent = missing.reduceRight((dir, name) => path.join(dir, name), realParent);
  const final = path.join(finalParent, base);
  if (outside(rootReal, final) || path.basename(final) !== base) return null;
  return final;
}

/** `..`, an empty path, or an absolute path (POSIX or `C:\...`, on any OS). */
export function pathProblem(rel: string): boolean {
  if (!rel || rel.includes("\0")) return true;
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:/.test(rel)) return true;
  return !isSafeRelative(rel);
}

export function normalizePosix(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function outside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

export function headerString(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const got = Buffer.from(provided);
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

export function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string | number>): void {
  const payload = typeof body === "string" ? Buffer.from(body) : body;
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
    "Cache-Control": "no-store",
    "Content-Length": payload.length,
    ...headers,
  });
  res.end(payload);
}

export function sendJson(res: http.ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", ...extra });
}

export function sendError(res: http.ServerResponse, err: unknown): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  try {
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  } catch {
    res.destroy();
  }
}

export function sendStream(req: http.IncomingMessage, res: http.ServerResponse, abs: string, size: number, type: string): void {
  const common = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
    "Cache-Control": "no-store",
    "X-Flowgit-Kind": "file",
    "Accept-Ranges": "bytes",
    "Content-Type": type,
  };
  const range = headerString(req, "range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { ...common, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start >= size || end >= size || start > end) {
      res.writeHead(416, { ...common, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...common, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeFile(abs, res, { start, end });
    return;
  }
  res.writeHead(200, { ...common, "Content-Length": size });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  pipeFile(abs, res);
}

export function pipeFile(abs: string, res: http.ServerResponse, range?: { start: number; end: number }): void {
  const stream = fs.createReadStream(abs, range);
  stream.on("error", () => {
    res.destroy();
  });
  res.on("close", () => {
    if (!res.writableEnded) stream.destroy();
  });
  stream.pipe(res);
}
