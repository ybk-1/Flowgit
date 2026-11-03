import { serveEvents, stopWatching, watchFlow } from "./routes/events.js";
import { putFlowFile, serveFlowFile, uploadFlowFile } from "./routes/files.js";
import { flowBoard } from "./routes/flow.js";
import { postGenerate } from "./routes/generate.js";
import { flowGraph } from "./routes/graph.js";
import { boardInputs, putInputs } from "./routes/inputs.js";
import { servePlan } from "./routes/plan.js";
import { postRun } from "./routes/run.js";
import { postRestore, serveDiff, serveRuns } from "./routes/runs.js";
import { authorized, busy, type HandlerCtx, headerString, hostAllowed, send, sendError, sendJson, tokenMatches } from "./routes/shared.js";
import { deleteStage, postStage } from "./routes/stage.js";
import { serveThumb } from "./routes/thumb.js";
import { postTrust } from "./routes/trust.js";
import { serveUsage } from "./routes/usage.js";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type { BoardInputField, BoardStage, FlowBoard } from "./routes/flow.js";
export { flowBoard } from "./routes/flow.js";
export { flowGraph } from "./routes/graph.js";

export const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** i18next's browser build (https://www.i18next.com), served to the board as /vendor/i18next.js. */
export const i18nextFile = path.join(
  path.dirname(createRequire(import.meta.url).resolve("i18next/package.json")),
  "dist",
  "umd",
  "i18next.min.js",
);

/** What the bare address shows: no token, just where to find the link. */
export const LOCKED_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flowgit 看板 / Board</title>
<link rel="stylesheet" href="/style.css" />
</head>
<body>
<main>
<h1>Flowgit 看板 / Board</h1>
<p>请打开 <code>flowgit board</code> 在命令行里显示的链接，它的结尾是 <code>?token=…</code>。看板每次启动都会换一个新链接。</p>
<p>Open the link that <code>flowgit board</code> printed in your terminal; it ends with <code>?token=…</code>. The link changes every time the board starts.</p>
</main>
</body>
</html>
`;

/** Board files: names under public/, or an absolute path for a file from a dependency. */
const BOARD_TYPE: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** A file under public/, or the i18next build. ".js" is served as JavaScript. */
function boardAsset(pathname: string): { abs: string; type: string; index: boolean } | null {
  if (pathname === "/vendor/i18next.js") return { abs: i18nextFile, type: "text/javascript; charset=utf-8", index: false };
  const index = pathname === "/" || pathname === "/index.html";
  if (index) return { abs: path.join(publicDir, "index.html"), type: "text/html; charset=utf-8", index: true };
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) return null;
  const abs = path.resolve(publicDir, ...parts);
  const rootDir = path.resolve(publicDir);
  if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const type = BOARD_TYPE[path.extname(abs).toLowerCase()];
  if (!type) return null;
  return { abs, type, index: false };
}

export interface StartBoardOptions {
  /** Flow directory (the folder that contains flow.json or flow.md). */
  dir: string;
  /** TCP port. 0 picks a free port. Default 4747. */
  port?: number;
  /** Open a browser once listening. Default false; the CLI turns it on. */
  open?: boolean;
  /**
   * Web pages that may call /api/* from another origin (still with the token), so the web app can
   * hand it a stage that needs a computer. Default: the web app at https://flowgit.dev only.
   */
  allowOrigins?: string[];
}

/** The web app's origin: the only page that may call the local board's API by default. */
export const WEB_APP_ORIGIN = "https://flowgit.dev";

/** `value` as an origin ("https://host[:port]"), or an error. */
export function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`不是一个网址 / not a URL: ${value}`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== value.replace(/\/+$/, "")) {
    throw new Error(`只能写来源，例如 https://flowgit.dev / give only an origin, such as https://flowgit.dev: ${value}`);
  }
  return url.origin;
}

export interface BoardServer {
  port: number;
  /** Secret required in X-Flowgit-Token for every /api/* request. */
  token: string;
  /** The board's address with `?token=`: the page only hands the token to a browser that opens this link. */
  url: string;
  close: () => Promise<void>;
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
  let origins: Set<string>;
  try {
    origins = new Set((options.allowOrigins ?? [WEB_APP_ORIGIN]).map(parseOrigin));
  } catch (err) {
    return Promise.reject(err);
  }
  const token = crypto.randomBytes(32).toString("hex");
  const bound = { port: options.port ?? 4747 };
  const ctx: HandlerCtx = {
    dir,
    token,
    port: bound.port,
    running: false,
    nextEventId: 0,
    history: [],
    clients: new Set(),
    watchers: [],
    watching: false,
    origins,
  };
  const server = http.createServer((req, res) => {
    try {
      handle(req, res, ctx);
    } catch (err) {
      sendError(res, err);
    }
  });
  // A stage run can take longer than Node's default request timeout (5 minutes).
  server.requestTimeout = 0;

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
      ctx.port = bound.port;
      // Best effort: without a watcher the board still pushes after its own saves, uploads, runs and restores.
      watchFlow(ctx);
      const url = `http://127.0.0.1:${bound.port}/?token=${token}`;
      if (options.open) openBrowser(url);
      resolve({
        port: bound.port,
        token,
        url,
        close: async () => {
          await stopWatching(ctx);
          await new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            // Drop keep-alive sockets so close() resolves without waiting out the idle timeout.
            server.closeAllConnections();
          });
        },
      });
    });
  });
}

/**
 * Let an allowed page (the web app) call /api/* from its own origin. The token is still required on
 * every request; this only lets the browser show the answer to that page. Returns true when the
 * request was a preflight and has been answered.
 * CORS: https://developer.mozilla.org/docs/Web/HTTP/CORS
 * Private Network Access preflight: https://wicg.github.io/private-network-access/#headers
 */
function crossOrigin(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): boolean {
  const origin = headerString(req, "origin");
  if (!origin || !ctx.origins.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method !== "OPTIONS") return false;
  req.resume();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
    "Access-Control-Allow-Headers": "X-Flowgit-Token, Content-Type",
    "Access-Control-Max-Age": "600",
  };
  if (headerString(req, "access-control-request-private-network") === "true") headers["Access-Control-Allow-Private-Network"] = "true";
  send(res, 204, "", headers);
  return true;
}

export const STAGE_BUSY = "正在运行，结束后再改阶段 / a run is in progress; change stages when it finishes";

export function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): void {
  if (!hostAllowed(req.headers.host, ctx.port)) {
    req.resume();
    sendJson(res, 403, { error: "Host 不被允许 / host not allowed" });
    return;
  }
  // A path like "//" is protocol-relative and throws. Answer 400 instead of letting it become a 500.
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    req.resume();
    send(res, 400, "请求路径不合法 / invalid request path", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (pathname.startsWith("/api/") && pathname !== "/api/events" && crossOrigin(req, res, ctx)) return;

  if (pathname === "/api/events") {
    if (req.method !== "GET") {
      req.resume();
      sendJson(res, 405, { error: "不支持这个方法 / method not allowed" });
      return;
    }
    // EventSource cannot set headers, so this one route takes the token from the query string.
    serveEvents(req, res, ctx, url);
    return;
  }
  if (req.method === "PUT" && pathname === "/api/file") {
    if (!authorized(req, res, ctx)) return;
    if (busy(req, res, ctx)) return;
    void putFlowFile(req, res, ctx, url.searchParams.get("path")).catch((err) => sendError(res, err));
    return;
  }
  if (req.method === "POST" && pathname === "/api/upload") {
    if (!authorized(req, res, ctx)) return;
    if (busy(req, res, ctx)) return;
    void uploadFlowFile(req, res, ctx, url).catch((err) => sendError(res, err));
    return;
  }
  if (req.method === "POST" && pathname === "/api/run") {
    if (!authorized(req, res, ctx)) return;
    void postRun(req, res, ctx).catch((err) => sendError(res, err));
    return;
  }
  if (req.method === "POST" && pathname === "/api/trust") {
    if (!authorized(req, res, ctx)) return;
    void postTrust(req, res, ctx).catch((err) => sendError(res, err));
    return;
  }
  if (req.method === "POST" && pathname === "/api/restore") {
    if (!authorized(req, res, ctx)) return;
    if (busy(req, res, ctx)) return;
    void postRestore(req, res, ctx).catch((err) => sendError(res, err));
    return;
  }
  if (req.method === "POST" && pathname === "/api/generate") {
    if (!authorized(req, res, ctx)) return;
    if (busy(req, res, ctx, "正在运行，结束后再生成 / a run is in progress; generate again when it finishes")) return;
    void postGenerate(req, res, ctx).catch((err) => sendError(res, err));
    return;
  }
  if (pathname === "/api/stage") {
    if (!authorized(req, res, ctx)) return;
    if (req.method === "POST") {
      if (busy(req, res, ctx, STAGE_BUSY)) return;
      void postStage(req, res, ctx).catch((err) => sendError(res, err));
      return;
    }
    if (req.method === "DELETE") {
      if (busy(req, res, ctx, STAGE_BUSY)) return;
      void deleteStage(req, res, ctx, url).catch((err) => sendError(res, err));
      return;
    }
    req.resume();
    sendJson(res, 405, { error: "不支持这个方法 / method not allowed" });
    return;
  }
  if (req.method === "PUT" && pathname === "/api/inputs") {
    if (!authorized(req, res, ctx)) return;
    void putInputs(req, res, ctx).catch((err) => sendError(res, err));
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.resume();
    sendJson(res, 405, { error: "不支持这个方法 / method not allowed" });
    return;
  }

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
    if (pathname === "/api/graph") {
      sendJson(res, 200, flowGraph(ctx.dir));
      return;
    }
    if (pathname === "/api/plan") {
      servePlan(res, ctx, url);
      return;
    }
    if (pathname === "/api/usage") {
      serveUsage(res, ctx);
      return;
    }
    if (pathname === "/api/file") {
      serveFlowFile(req, res, ctx, url.searchParams.get("path"));
      return;
    }
    if (pathname === "/api/inputs") {
      sendJson(res, 200, boardInputs(ctx.dir));
      return;
    }
    if (pathname === "/api/runs") {
      serveRuns(res, ctx, url);
      return;
    }
    if (pathname === "/api/diff") {
      serveDiff(res, ctx, url);
      return;
    }
    if (pathname === "/api/thumb") {
      void serveThumb(req, res, ctx, url).catch((err) => sendError(res, err));
      return;
    }
    sendJson(res, 404, { error: "找不到 / not found" });
    return;
  }

  const asset = boardAsset(pathname);
  if (!asset) {
    send(res, 404, "找不到 / not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  // The page carries the token, so it only goes to a browser that has the link with ?token=.
  // Anyone else who can reach 127.0.0.1 (another account on this machine, another program) gets no token.
  if (asset.index && !tokenMatches(url.searchParams.get("token") ?? undefined, ctx.token)) {
    const body = LOCKED_PAGE;
    if (req.method === "HEAD") {
      send(res, 401, "", { "Content-Type": "text/html; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) });
      return;
    }
    send(res, 401, body, { "Content-Type": "text/html; charset=utf-8" });
    return;
  }
  const file = asset.abs;
  let body: Buffer | string = fs.readFileSync(file);
  if (asset.index) {
    body = body.toString("utf8").replaceAll("__FLOWGIT_TOKEN__", ctx.token);
  }
  if (req.method === "HEAD") {
    send(res, 200, "", { "Content-Type": asset.type, "Content-Length": String(Buffer.byteLength(body)) });
    return;
  }
  send(res, 200, body, { "Content-Type": asset.type });
}
