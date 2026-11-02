import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDirOutput,
  isSafeRelative,
  listFiles,
  loadFlow,
  outputRel,
  resolveFlowInputs,
  statusAll,
  type Flow,
  type Output,
} from "@flowgit/core";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const CSP = [
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

const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

const EXT_TYPE: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/plain; charset=utf-8",
};

export interface BoardOutput {
  path: string;
  type: string;
  directory: boolean;
}

export interface BoardStage {
  id: string;
  name: string;
  executor: string;
  state: string;
  runs: number;
  latest: { n: number; time: string; status: string } | null;
  outputs: BoardOutput[];
}

/** JSON body of GET /api/flow. `inputs` is exactly resolveFlowInputs. */
export interface FlowBoard {
  name: string;
  inputs: Record<string, unknown>;
  missingInputs: string[];
  stages: BoardStage[];
}

export interface StartBoardOptions {
  /** Flow directory (the folder that contains flow.json). */
  dir: string;
  /** TCP port. 0 picks a free port. Default 4747. */
  port?: number;
  /** Open a browser once listening. Default false; the CLI turns it on. */
  open?: boolean;
}

export interface BoardServer {
  port: number;
  /** Secret required in X-Flowgit-Token for every /api/* request. */
  token: string;
  url: string;
  close: () => Promise<void>;
}

export function flowBoard(dir: string): FlowBoard {
  const loaded = loadFlow(dir);
  const inputs = resolveFlowInputs(loaded.dir, loaded.flow);
  const missingInputs = Object.entries(loaded.flow.inputs ?? {})
    .filter(([key, def]) => def.required && (inputs[key] === undefined || inputs[key] === ""))
    .map(([key]) => key);
  return {
    name: loaded.flow.name,
    inputs,
    missingInputs,
    stages: statusAll(loaded, inputs).map((status) => ({
      id: status.stage.id,
      name: status.stage.name,
      executor: status.stage.executor.type,
      state: status.state,
      runs: status.runs,
      latest: status.latest
        ? { n: status.latest.n, time: status.latest.finishedAt, status: status.latest.status }
        : null,
      outputs: status.stage.outputs.map((output) => ({
        path: outputRel(output),
        type: output.type,
        directory: isDirOutput(output),
      })),
    })),
  };
}

/**
 * Open `url` in the desktop browser.
 * Windows `start`: https://learn.microsoft.com/windows-server/administration/windows-commands/start
 * macOS `open`: https://ss64.com/mac/open.html
 * Linux `xdg-open`: https://www.freedesktop.org/wiki/Software/xdg-utils/
 */
export function openBrowser(url: string): void {
  const child =
    process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {
    // No browser on PATH. The URL is already printed; keep the server up.
  });
  child.unref();
}

export function startBoard(options: StartBoardOptions): Promise<BoardServer> {
  const dir = path.resolve(options.dir);
  if (!fs.existsSync(path.join(publicDir, "index.html"))) {
    return Promise.reject(new Error(`找不到看板页面 / board files not found: ${publicDir}`));
  }
  const token = crypto.randomBytes(32).toString("hex");
  const bound = { port: options.port ?? 4747 };
  const server = http.createServer((req, res) => {
    try {
      handle(req, res, { dir, token, port: bound.port });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 500, { error: message });
      else res.end();
    }
  });

  const listenPort = options.port ?? 4747;
  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`端口 ${listenPort} 已被占用 / port ${listenPort} is already in use`));
        return;
      }
      reject(err);
    });
    // 127.0.0.1 only: the board is a local view of this machine's files.
    server.listen(listenPort, "127.0.0.1", () => {
      const addr = server.address();
      bound.port = typeof addr === "object" && addr ? addr.port : listenPort;
      const url = `http://127.0.0.1:${bound.port}/`;
      if (options.open) openBrowser(url);
      resolve({
        port: bound.port,
        token,
        url,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            // Drop keep-alive sockets so close() resolves without waiting out the idle timeout.
            server.closeAllConnections();
          }),
      });
    });
  });
}

interface HandlerCtx {
  dir: string;
  token: string;
  port: number;
}

function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): void {
  if (!hostAllowed(req.headers.host, ctx.port)) {
    sendJson(res, 403, { error: "Host 不被允许 / host not allowed" });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "只支持 GET / only GET is supported" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (pathname === "/favicon.ico") {
    send(res, 204, "", {});
    return;
  }

  if (pathname.startsWith("/api/")) {
    if (!tokenMatches(headerString(req, "x-flowgit-token"), ctx.token)) {
      sendJson(res, 401, { error: "未授权：缺少或错误的令牌 / unauthorized: missing or invalid token" });
      return;
    }
    if (pathname === "/api/flow") {
      sendJson(res, 200, flowBoard(ctx.dir));
      return;
    }
    if (pathname === "/api/file") {
      serveFlowFile(req, res, ctx, url.searchParams.get("path"));
      return;
    }
    sendJson(res, 404, { error: "找不到 / not found" });
    return;
  }

  const asset = STATIC[pathname];
  if (!asset) {
    send(res, 404, "找不到 / not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const file = path.join(publicDir, asset.file);
  let body: Buffer | string = fs.readFileSync(file);
  if (asset.file === "index.html") {
    body = body.toString("utf8").replaceAll("__FLOWGIT_TOKEN__", ctx.token);
  }
  if (req.method === "HEAD") {
    send(res, 200, "", { "Content-Type": asset.type, "Content-Length": String(Buffer.byteLength(body)) });
    return;
  }
  send(res, 200, body, { "Content-Type": asset.type });
}

function serveFlowFile(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, rawPath: string | null): void {
  const located = locateFile(ctx.dir, rawPath);
  if (!located.ok) {
    const error = located.status === 400 ? "路径不合法 / invalid path" : "找不到文件 / not found";
    sendJson(res, located.status, { error });
    return;
  }
  if (located.stat.isDirectory()) {
    sendJson(res, 200, { files: listFiles(located.abs) }, { "X-Flowgit-Kind": "directory" });
    return;
  }
  const type = mediaType(located.rel, declaredType(located.flow, located.rel));
  sendStream(req, res, located.abs, located.stat.size, type);
}

interface LocatedFile {
  ok: true;
  flow: Flow;
  abs: string;
  rel: string;
  stat: fs.Stats;
}

function locateFile(dir: string, rawPath: string | null): LocatedFile | { ok: false; status: 400 | 404 } {
  if (rawPath === null || pathProblem(rawPath)) return { ok: false, status: 400 };
  const requested = normalizePosix(rawPath);
  if (!requested || pathProblem(requested)) return { ok: false, status: 400 };
  const flow = loadFlow(dir).flow;
  if (!isAllowed(flow, requested)) return { ok: false, status: 404 };

  const root = path.resolve(dir);
  const abs = path.resolve(root, requested);
  if (outside(root, abs)) return { ok: false, status: 400 };
  if (!fs.existsSync(abs)) return { ok: false, status: 404 };

  let rootReal: string;
  let real: string;
  try {
    rootReal = fs.realpathSync(root);
    real = fs.realpathSync(abs);
  } catch {
    return { ok: false, status: 404 };
  }
  if (outside(rootReal, real)) return { ok: false, status: 404 };
  const rel = path.relative(rootReal, real).split(path.sep).join("/");
  // A symlink may point at another file inside the flow. Only follow it when
  // the target is itself a declared output or a run snapshot.
  if (!isAllowed(flow, rel)) return { ok: false, status: 404 };
  return { ok: true, flow, abs: real, rel, stat: fs.statSync(real) };
}

/** `..`, an empty path, or an absolute path (POSIX or `C:\...`, on any OS). */
function pathProblem(rel: string): boolean {
  if (!rel || rel.includes("\0")) return true;
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:/.test(rel)) return true;
  return !isSafeRelative(rel);
}

function normalizePosix(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function outside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/** Stage outputs (including files inside a directory output) and runs/<stage>/<n>/outputs/. */
function isAllowed(flow: Flow, rel: string): boolean {
  const norm = normalizePosix(rel);
  if (!norm || norm.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      if (matchesOutput(output, norm)) return true;
    }
  }
  const snap = /^runs\/([^/]+)\/(\d+)\/outputs(?:\/(.*))?$/.exec(norm);
  if (!snap) return false;
  if (!flow.stages.some((stage) => stage.id === snap[1])) return false;
  const rest = snap[3];
  if (rest === undefined) return true;
  return rest.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function matchesOutput(output: Output, norm: string): boolean {
  const base = outputRel(output);
  if (norm === base) return true;
  return isDirOutput(output) && norm.startsWith(`${base}/`);
}

function declaredType(flow: Flow, rel: string): string | undefined {
  const norm = normalizePosix(rel);
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      if (outputRel(output) === norm) return output.type;
    }
  }
  const snap = /^runs\/([^/]+)\/\d+\/outputs\/(.+)$/.exec(norm);
  if (!snap) return undefined;
  const stage = flow.stages.find((item) => item.id === snap[1]);
  if (!stage) return undefined;
  for (const output of stage.outputs) {
    if (outputRel(output) === snap[2]) return output.type;
  }
  return undefined;
}

function mediaType(rel: string, declared?: string): string {
  if (declared) {
    const value = declared.toLowerCase();
    if (value === "application/json" || value.endsWith("+json")) return "application/json; charset=utf-8";
    // Never serve an output as a page: HTML (and anything else markup-like) comes back as plain text.
    if (value.startsWith("text/html") || value.includes("xml")) return "text/plain; charset=utf-8";
    if (value.startsWith("text/")) return value.includes("charset") ? value : `${value}; charset=utf-8`;
    if (value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/")) return value;
  }
  return EXT_TYPE[path.posix.extname(rel).toLowerCase()] ?? "application/octet-stream";
}

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

function headerString(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const got = Buffer.from(provided);
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string | number>): void {
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

function sendJson(res: http.ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", ...extra });
}

function sendStream(req: http.IncomingMessage, res: http.ServerResponse, abs: string, size: number, type: string): void {
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

function pipeFile(abs: string, res: http.ServerResponse, range?: { start: number; end: number }): void {
  const stream = fs.createReadStream(abs, range);
  stream.on("error", () => {
    res.destroy();
  });
  res.on("close", () => {
    if (!res.writableEnded) stream.destroy();
  });
  stream.pipe(res);
}
