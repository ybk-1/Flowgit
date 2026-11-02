import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  addStage,
  HumanInputNeededError,
  diffRuns,
  FLOW_FILE,
  FLOW_MD_FILE,
  findFlowFile,
  isDirOutput,
  isSafeRelative,
  isTextType,
  listFiles,
  listRuns,
  loadFlow,
  loadFlowInputs,
  MissingInputsError,
  outputRel,
  promptSkeleton,
  readFlowFile,
  removeStage,
  requireStage,
  resolveFlowInputs,
  restoreStage,
  runAll,
  runStage,
  saveFlowInputs,
  statusAll,
  UpstreamNotReadyError,
  validateFlow,
  writeFlowFile,
  type AddableStageType,
  type AddStageSpec,
  type AgentName,
  type Flow,
  type FlowInput,
  type Output,
  type RunEvent,
  type ValidationIssue,
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

/** What the bare address shows: no token, just where to find the link. */
const LOCKED_PAGE = `<!doctype html>
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
  /** File output that `isTextType` treats as text, so the board can edit it. */
  text: boolean;
}

export interface BoardStage {
  id: string;
  name: string;
  executor: string;
  state: string;
  runs: number;
  latest: { n: number; time: string; status: string } | null;
  /** Human stage instructions, when the executor has them. */
  instructions?: string;
  outputs: BoardOutput[];
}

/** One flow input as GET /api/inputs returns it. `value` is resolveFlowInputs. */
export interface BoardInputField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  enum?: unknown[];
  default?: unknown;
  /** null when the input has no value yet. */
  value: unknown;
}

/** JSON body of GET /api/flow. `inputs` is exactly resolveFlowInputs. */
export interface FlowBoard {
  name: string;
  inputs: Record<string, unknown>;
  missingInputs: string[];
  stages: BoardStage[];
}

export interface StartBoardOptions {
  /** Flow directory (the folder that contains flow.json or flow.md). */
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
  /** The board's address with `?token=`: the page only hands the token to a browser that opens this link. */
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
      ...(status.stage.executor.type === "human" && status.stage.executor.instructions
        ? { instructions: status.stage.executor.instructions }
        : {}),
      outputs: status.stage.outputs.map((output) => {
        const directory = isDirOutput(output);
        return {
          path: outputRel(output),
          type: output.type,
          directory,
          text: !directory && isTextType(output.type, output.path),
        };
      }),
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

interface SseFrame {
  id: number;
  event: string;
  data: string;
}

interface HandlerCtx {
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
}

const JSON_LIMIT = 1_000_000;

/** Same executors `flowgit stage add` can create. */
const ADDABLE_TYPES: readonly AddableStageType[] = ["human", "llm", "script", "agent"];
const AGENT_NAMES: readonly AgentName[] = ["claude-code", "codex", "cursor", "gemini", "custom"];

const STAGE_BUSY = "正在运行，结束后再改阶段 / a run is in progress; change stages when it finishes";

function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): void {
  if (!hostAllowed(req.headers.host, ctx.port)) {
    req.resume();
    sendJson(res, 403, { error: "Host 不被允许 / host not allowed" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

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
  if (req.method === "POST" && pathname === "/api/restore") {
    if (!authorized(req, res, ctx)) return;
    if (busy(req, res, ctx)) return;
    void postRestore(req, res, ctx).catch((err) => sendError(res, err));
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
    sendJson(res, 404, { error: "找不到 / not found" });
    return;
  }

  const asset = STATIC[pathname];
  if (!asset) {
    send(res, 404, "找不到 / not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  // The page carries the token, so it only goes to a browser that has the link with ?token=.
  // Anyone else who can reach 127.0.0.1 (another account on this machine, another program) gets no token.
  if (asset.file === "index.html" && !tokenMatches(url.searchParams.get("token") ?? undefined, ctx.token)) {
    const body = LOCKED_PAGE;
    if (req.method === "HEAD") {
      send(res, 401, "", { "Content-Type": "text/html; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) });
      return;
    }
    send(res, 401, body, { "Content-Type": "text/html; charset=utf-8" });
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function authorized(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): boolean {
  if (tokenMatches(headerString(req, "x-flowgit-token"), ctx.token)) return true;
  req.resume();
  sendJson(res, 401, { error: "未授权：缺少或错误的令牌 / unauthorized: missing or invalid token" });
  return false;
}

/** Outputs must not change under a running stage: a write would be lost or mistaken for the run's own. */
function busy(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, message?: string): boolean {
  if (!ctx.running) return false;
  req.resume();
  sendJson(res, 409, { error: message ?? "正在运行，结束后再保存 / a run is in progress; save again when it finishes" });
  return true;
}

function boardInputs(dir: string): { inputs: BoardInputField[] } {
  const loaded = loadFlow(dir);
  const values = resolveFlowInputs(loaded.dir, loaded.flow);
  const inputs = Object.entries(loaded.flow.inputs ?? {}).map(([name, def]) => inputField(name, def, values[name]));
  return { inputs };
}

function inputField(name: string, def: FlowInput, value: unknown): BoardInputField {
  const field: BoardInputField = {
    name,
    type: def.type,
    required: def.required === true,
    value: value === undefined ? null : value,
  };
  if (def.description) field.description = def.description;
  if (def.enum) field.enum = def.enum;
  if (def.default !== undefined) field.default = def.default;
  return field;
}

async function readJsonObject(req: http.IncomingMessage): Promise<Record<string, unknown>> {
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

async function putInputs(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  const loaded = loadFlow(ctx.dir);
  const defs = loaded.flow.inputs ?? {};
  const unknown = Object.keys(body).filter((key) => !Object.hasOwn(defs, key));
  if (unknown.length) {
    sendJson(res, 400, { error: `没有这个输入 / unknown input(s): ${unknown.join(", ")}` });
    return;
  }
  try {
    // Same checks as a run: required inputs are set, enum values are allowed.
    loadFlowInputs(loaded.dir, loaded.flow, body);
  } catch (err) {
    if (err instanceof MissingInputsError) {
      sendJson(res, 400, { error: `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}` });
      return;
    }
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  saveFlowInputs(loaded.dir, body);
  publishFlowChanged(ctx);
  sendJson(res, 200, { ok: true, inputs: resolveFlowInputs(loaded.dir, loaded.flow) });
}

function parseRunBody(body: Record<string, unknown>): { stage: string; model?: string } {
  if (typeof body.stage !== "string" || !body.stage.trim()) {
    throw new HttpError(400, "缺少阶段 / missing stage");
  }
  let model: string | undefined;
  if (body.model !== undefined && body.model !== null && body.model !== "") {
    if (typeof body.model !== "string") throw new HttpError(400, "model 必须是字符串 / model must be a string");
    const trimmed = body.model.trim();
    if (trimmed) model = trimmed;
  }
  return { stage: body.stage.trim(), model };
}

/** Positive run number from a query string. `v1` and `0` are rejected. */
function parseVersion(raw: string | null): number {
  if (raw === null || raw === "") throw new HttpError(400, "缺少版本 / missing version");
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new HttpError(400, `版本号必须是正整数，收到 "${raw}" / version must be a positive integer, got "${raw}"`);
  }
  return Number(raw);
}

function coreHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const missing = /没有这个阶段|Unknown stage|没有 v\d|has no run #/.test(message);
  return new HttpError(missing ? 404 : 400, message);
}

function serveRuns(res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  const stage = url.searchParams.get("stage")?.trim() ?? "";
  if (!stage) throw new HttpError(400, "缺少阶段 / missing stage");
  const loaded = loadFlow(ctx.dir);
  try {
    requireStage(loaded.flow, stage);
  } catch (err) {
    throw coreHttpError(err);
  }
  sendJson(res, 200, { runs: listRuns(loaded.dir, stage) });
}

/** `b` omitted, or empty, compares version `a` with the current files. */
function serveDiff(res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  const stage = url.searchParams.get("stage")?.trim() ?? "";
  if (!stage) throw new HttpError(400, "缺少阶段 / missing stage");
  const a = parseVersion(url.searchParams.get("a"));
  const rawB = url.searchParams.get("b");
  const b = rawB === null || rawB === "" ? undefined : parseVersion(rawB);
  const loaded = loadFlow(ctx.dir);
  try {
    sendJson(res, 200, diffRuns(loaded.dir, loaded.flow, stage, a, b));
  } catch (err) {
    throw coreHttpError(err);
  }
}

async function postRestore(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  if (typeof body.stage !== "string" || !body.stage.trim()) throw new HttpError(400, "缺少阶段 / missing stage");
  if (typeof body.n !== "number" || !Number.isInteger(body.n) || body.n < 1) {
    throw new HttpError(400, "版本号必须是正整数 / version must be a positive integer");
  }
  const loaded = loadFlow(ctx.dir);
  try {
    const { run, kept } = restoreStage(loaded, body.stage.trim(), body.n);
    publishFlowChanged(ctx);
    sendJson(res, 200, { ok: true, stage: run.stage, n: run.n, ...(kept ? { kept: kept.n } : {}) });
  } catch (err) {
    throw coreHttpError(err);
  }
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} 必须是字符串 / ${key} must be a string`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseOutputs(value: unknown): Output[] {
  if (!Array.isArray(value)) throw new HttpError(400, "outputs 必须是数组 / outputs must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `outputs[${index}] 必须是对象 / outputs[${index}] must be an object`);
    }
    const output = item as Record<string, unknown>;
    if (typeof output.path !== "string" || !output.path.trim()) {
      throw new HttpError(400, `outputs[${index}] 缺少 path / outputs[${index}] is missing path`);
    }
    if (typeof output.type !== "string" || !output.type.trim()) {
      throw new HttpError(400, `outputs[${index}] 缺少 type / outputs[${index}] is missing type`);
    }
    const next: Output = { type: output.type.trim(), path: output.path.trim() };
    if (output.id !== undefined) {
      if (typeof output.id !== "string" || !output.id.trim()) {
        throw new HttpError(400, `outputs[${index}].id 必须是字符串 / outputs[${index}].id must be a string`);
      }
      next.id = output.id.trim();
    }
    if (output.description !== undefined) {
      if (typeof output.description !== "string") {
        throw new HttpError(400, `outputs[${index}].description 必须是字符串 / outputs[${index}].description must be a string`);
      }
      next.description = output.description;
    }
    if (output.schema !== undefined) {
      if (typeof output.schema !== "string" || !output.schema.trim()) {
        throw new HttpError(400, `outputs[${index}].schema 必须是字符串 / outputs[${index}].schema must be a string`);
      }
      next.schema = output.schema.trim();
    }
    return next;
  });
}

/** Body is an `addStage` spec: id, type, and optional name, after, inputs, outputs, prompt, run, agent. */
function parseAddSpec(body: Record<string, unknown>): AddStageSpec {
  if (typeof body.id !== "string" || !body.id.trim()) throw new HttpError(400, "缺少阶段 id / missing stage id");
  if (typeof body.type !== "string" || !ADDABLE_TYPES.includes(body.type as AddableStageType)) {
    throw new HttpError(
      400,
      `type 只能是 human、llm、script、agent，收到 "${String(body.type)}" / type must be human, llm, script or agent, got "${String(body.type)}"`,
    );
  }
  const spec: AddStageSpec = { id: body.id.trim(), type: body.type as AddableStageType };
  const name = optionalString(body, "name");
  if (name) spec.name = name;
  const after = optionalString(body, "after");
  if (after) spec.after = after;
  if (body.inputs !== undefined) {
    if (!Array.isArray(body.inputs) || body.inputs.some((item) => typeof item !== "string" || !item.trim())) {
      throw new HttpError(400, "inputs 必须是阶段 id 的数组 / inputs must be an array of stage ids");
    }
    spec.inputs = body.inputs.map((item) => (item as string).trim());
  }
  if (body.outputs !== undefined) spec.outputs = parseOutputs(body.outputs);
  const prompt = optionalString(body, "prompt");
  if (prompt) spec.prompt = prompt;
  const run = optionalString(body, "run");
  if (run) spec.run = run;
  if (body.agent !== undefined && body.agent !== null && body.agent !== "") {
    if (typeof body.agent !== "string" || !AGENT_NAMES.includes(body.agent as AgentName)) {
      throw new HttpError(
        400,
        `agent 只能是 ${AGENT_NAMES.join("、")}，收到 "${String(body.agent)}" / agent must be one of ${AGENT_NAMES.join(", ")}, got "${String(body.agent)}"`,
      );
    }
    spec.agent = body.agent as AgentName;
  }
  return spec;
}

function readFlowSource(dir: string): { file: string; flow: Flow } {
  let file: string | undefined;
  let data: unknown;
  try {
    file = findFlowFile(dir);
    if (!file) throw new HttpError(404, `${dir} 里没有 ${FLOW_FILE} 或 ${FLOW_MD_FILE} / No ${FLOW_FILE} or ${FLOW_MD_FILE} in ${dir}`);
    data = readFlowFile(file);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray((data as Flow).stages)) {
    throw new HttpError(400, `${path.basename(file)} 不是一个流程 / ${path.basename(file)} is not a flow`);
  }
  return { file, flow: data as Flow };
}

function rejectIssues(res: http.ServerResponse, issues: ValidationIssue[]): void {
  const listed = issues.map((issue) => ({ path: issue.path || "/", message: issue.message }));
  sendJson(res, 400, {
    error: listed.map((issue) => `${issue.path}: ${issue.message}`).join("\n"),
    issues: listed,
  });
}

/**
 * Insert a stage the way `flowgit stage add` does: `addStage`, then `validateFlow`.
 * A missing default prompt for llm/agent is created after validation passes.
 * Nothing is written when validation fails. Runs and output files are never deleted.
 */
async function postStage(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const spec = parseAddSpec(await readJsonObject(req));
  const { file, flow } = readFlowSource(ctx.dir);
  let next: Flow;
  try {
    next = addStage(flow, spec);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message, issues: [{ path: "/", message }] });
    return;
  }
  const creating = !spec.prompt && (spec.type === "llm" || spec.type === "agent") ? `prompts/${spec.id}.md` : undefined;
  const promptAbs = creating ? path.join(ctx.dir, creating) : undefined;
  const willCreate = Boolean(creating && promptAbs && !fs.existsSync(promptAbs));
  const errors = validateFlow(next, { dir: ctx.dir }).filter((issue) => {
    if (issue.level !== "error") return false;
    return !(willCreate && creating && issue.path.endsWith("/executor/prompt") && issue.message.includes(creating));
  });
  if (errors.length) {
    rejectIssues(res, errors);
    return;
  }
  let created: string | undefined;
  try {
    if (willCreate && creating && promptAbs) {
      fs.mkdirSync(path.dirname(promptAbs), { recursive: true });
      const inputKey = Object.keys(flow.inputs ?? {})[0] ?? "name";
      fs.writeFileSync(promptAbs, promptSkeleton(spec.id, inputKey), { flag: "wx" });
      created = promptAbs;
    }
    writeFlowFile(file, next);
  } catch (err) {
    if (created) fs.rmSync(created, { force: true });
    throw err;
  }
  publishFlowChanged(ctx);
  sendJson(res, 200, { ok: true, id: spec.id, ...(created && creating ? { prompt: creating } : {}) });
}

/**
 * Remove a stage the way `flowgit stage rm` does. Dependents without `force=1` are a 409
 * that names them. Output files and `runs/` are left on disk.
 */
async function deleteStage(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): Promise<void> {
  req.resume();
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id) throw new HttpError(400, "缺少阶段 id / missing stage id");
  const force = url.searchParams.get("force") === "1";
  const { file, flow } = readFlowSource(ctx.dir);
  const dependents = flow.stages.filter((stage) => (stage.inputs ?? []).includes(id)).map((stage) => stage.id);
  let next: Flow;
  try {
    next = removeStage(flow, id, { force });
  } catch (err) {
    if (!force && dependents.length) {
      sendJson(res, 409, {
        error: `这些阶段还把 "${id}" 当作输入：${dependents.join(", ")} / These stages still use "${id}" as an input: ${dependents.join(", ")}`,
        dependents,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const missing = message.includes("没有阶段") || message.includes("No stage");
    throw new HttpError(missing ? 404 : 400, message);
  }
  const errors = validateFlow(next, { dir: ctx.dir }).filter((issue) => issue.level === "error");
  if (errors.length) {
    rejectIssues(res, errors);
    return;
  }
  writeFlowFile(file, next);
  publishFlowChanged(ctx);
  sendJson(res, 200, { ok: true, id });
}

async function postRun(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  const { stage, model } = parseRunBody(body);
  const loaded = loadFlow(ctx.dir);
  if (stage !== "all" && !loaded.flow.stages.some((item) => item.id === stage)) {
    sendJson(res, 404, { error: `没有这个阶段 / unknown stage: ${stage}` });
    return;
  }
  if (ctx.running) {
    sendJson(res, 409, { error: "已有运行在进行 / a run is already in progress" });
    return;
  }
  ctx.running = true;
  ctx.history = [];
  const options = {
    ...(model ? { model } : {}),
    onEvent: (event: RunEvent) => publishRunEvent(ctx, event),
  };
  try {
    try {
      if (stage === "all") await runAll(loaded, options);
      else await runStage(loaded, stage, options);
      const payload = { ok: true as const };
      publish(ctx, "run:end", payload);
      sendJson(res, 200, payload);
    } catch (err) {
      if (err instanceof HumanInputNeededError) {
        const payload = {
          ok: true as const,
          waiting: {
            stage: err.stage.id,
            name: err.stage.name,
            missing: err.missing,
            ...(err.instructions ? { instructions: err.instructions } : {}),
          },
        };
        publish(ctx, "run:end", payload);
        sendJson(res, 200, payload);
        return;
      }
      const failure = runFailure(err);
      publish(ctx, "run:end", { ok: false, error: failure.error });
      sendJson(res, failure.status, { error: failure.error });
    }
  } finally {
    ctx.running = false;
    publishFlowChanged(ctx);
  }
}

function runFailure(err: unknown): { status: number; error: string } {
  if (err instanceof MissingInputsError) {
    return { status: 400, error: `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}` };
  }
  if (err instanceof UpstreamNotReadyError) return { status: 400, error: err.message };
  if (err instanceof HttpError) return { status: err.status, error: err.message };
  return { status: 500, error: err instanceof Error ? err.message : String(err) };
}

function publishRunEvent(ctx: HandlerCtx, event: RunEvent): void {
  const stage = event.stage.id;
  const name = event.stage.name;
  switch (event.type) {
    case "stage:start":
      publish(ctx, event.type, { stage, name, executor: event.stage.executor.type });
      return;
    case "stage:skip":
      publish(ctx, event.type, { stage, name, reason: event.reason });
      return;
    case "stage:log":
      publish(ctx, event.type, { stage, line: event.line });
      return;
    case "stage:done":
      publish(ctx, event.type, { stage, name, n: event.n });
      return;
    case "stage:error":
      publish(ctx, event.type, { stage, name, error: event.error.message });
      return;
  }
}

function publish(ctx: HandlerCtx, event: string, data: unknown, remember = true): void {
  const frame: SseFrame = { id: ++ctx.nextEventId, event, data: JSON.stringify(data) };
  // `flow:changed` is a nudge to reload, not part of the run log a late client replays.
  if (remember) ctx.history.push(frame);
  const text = formatFrame(frame);
  for (const client of [...ctx.clients]) {
    if (!writeSse(client, text)) ctx.clients.delete(client);
  }
}

/** Filesystem events are merged so a save's temp file and rename become one update. */
const WATCH_DEBOUNCE_MS = 300;

function publishFlowChanged(ctx: HandlerCtx): void {
  publish(ctx, "flow:changed", {}, false);
}

function scheduleFlowChanged(ctx: HandlerCtx): void {
  if (!ctx.watching) return;
  if (ctx.changeTimer) clearTimeout(ctx.changeTimer);
  ctx.changeTimer = setTimeout(() => {
    ctx.changeTimer = undefined;
    if (!ctx.watching) return;
    publishFlowChanged(ctx);
  }, WATCH_DEBOUNCE_MS);
}

/**
 * Watch the flow directory. `recursive: true` is used where Node supports it
 * (Windows, macOS, Linux). If that is unavailable or fails (on Linux it can run out of
 * inotify watches), watch the flow directory and the parent of each stage output instead.
 * Never throws: a board that can't watch still works.
 */
function watchFlow(ctx: HandlerCtx): void {
  ctx.watching = true;
  try {
    ctx.watchers.push(listenDir(ctx, ctx.dir, true));
    return;
  } catch {
    // fall through to the narrower watch
  }
  const seen = new Set<string>();
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(ctx.dir);
  } catch {
    return;
  }
  for (const dir of [path.resolve(ctx.dir), ...outputParentDirs(ctx.dir)]) {
    let real: string;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (seen.has(real) || outside(rootReal, real)) continue;
    seen.add(real);
    try {
      ctx.watchers.push(listenDir(ctx, real, false));
    } catch {
      // A directory that cannot be watched is skipped; explicit pushes still run.
    }
  }
}

function listenDir(ctx: HandlerCtx, dir: string, recursive: boolean): fs.FSWatcher {
  const watcher = fs.watch(dir, { recursive }, (_event, filename) => {
    onFlowWatch(ctx, dir, filename);
  });
  watcher.on("error", () => {
    // Keep the board up. Saves, uploads, runs, restores and input writes still push.
  });
  return watcher;
}

function onFlowWatch(ctx: HandlerCtx, watchedDir: string, filename: string | Buffer | null): void {
  if (!ctx.watching || isIgnoredWatch(ctx.dir, watchedDir, filename)) return;
  scheduleFlowChanged(ctx);
}

/** Temp files, and anything under `runs/`, `node_modules/` or `.git/`. A nameless event is ignored so those trees cannot leak through. */
function isIgnoredWatch(flowDir: string, watchedDir: string, filename: string | Buffer | null): boolean {
  if (filename == null) return true;
  const raw = filename.toString();
  if (!raw) return true;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(watchedDir, raw);
  const rel = path.relative(path.resolve(flowDir), abs);
  if (rel === "" || rel === ".") return false;
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return true;
  return ignoredRelative(rel.split(path.sep).join("/"));
}

function ignoredRelative(rel: string): boolean {
  const parts = rel.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0) return false;
  const top = parts[0];
  if (top === "runs" || top === "node_modules" || top === ".git") return true;
  if (parts.some((part) => part === "node_modules" || part === ".git")) return true;
  const base = parts[parts.length - 1] ?? "";
  return base.startsWith(".flowgit-tmp-");
}

function outputParentDirs(dir: string): string[] {
  let flow: Flow;
  try {
    flow = loadFlow(dir).flow;
  } catch {
    return [];
  }
  const root = path.resolve(dir);
  const parents: string[] = [];
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      const rel = outputRel(output);
      if (pathProblem(rel)) continue;
      const parent = path.resolve(root, path.posix.dirname(rel));
      if (outside(root, parent)) continue;
      parents.push(parent);
    }
  }
  return parents;
}

async function stopWatching(ctx: HandlerCtx): Promise<void> {
  ctx.watching = false;
  if (ctx.changeTimer) {
    clearTimeout(ctx.changeTimer);
    ctx.changeTimer = undefined;
  }
  const watchers = ctx.watchers.splice(0, ctx.watchers.length);
  await Promise.all(
    watchers.map(async (watcher) => {
      try {
        await watcher.close();
      } catch {
        // already closed
      }
    }),
  );
}

function formatFrame(frame: SseFrame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${frame.data}\n\n`;
}

function writeSse(res: http.ServerResponse, text: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(text);
    return true;
  } catch {
    return false;
  }
}

/** Token is `?token=`, not the X-Flowgit-Token header. */
function serveEvents(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  if (!tokenMatches(url.searchParams.get("token") ?? undefined, ctx.token)) {
    sendJson(res, 401, { error: "未授权：缺少或错误的令牌 / unauthorized: missing or invalid token" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
    "X-Accel-Buffering": "no",
  });
  res.socket?.setNoDelay(true);
  const last = Number(headerString(req, "last-event-id") ?? "0");
  const after = Number.isFinite(last) ? last : 0;
  writeSse(res, ": connected\n\n");
  for (const frame of ctx.history) {
    if (frame.id > after) writeSse(res, formatFrame(frame));
  }
  ctx.clients.add(res);
  const drop = () => {
    ctx.clients.delete(res);
  };
  req.on("close", drop);
  res.on("error", drop);
}

/** `application/json` and `*+json`. Extension alone does not count. */
function isJsonMime(type: string): boolean {
  const value = type.toLowerCase();
  return value === "application/json" || value.endsWith("+json");
}

function invalidUploadName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || name === "." || name === "..") return true;
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) return true;
  if (/[\u0000-\u001f\u007f]/.test(name)) return true;
  if (path.basename(name) !== name) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  return false;
}

function declaredFileOutput(flow: Flow, rel: string): Output | undefined {
  const norm = normalizePosix(rel);
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      if (isDirOutput(output)) continue;
      if (outputRel(output) === norm) return output;
    }
  }
  return undefined;
}

function realRoot(dir: string): string | null {
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
function placeInside(rootReal: string, abs: string): string | null {
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

function resolveDeclaredFile(
  dir: string,
  rawPath: string | null,
): { ok: true; abs: string; rel: string; output: Output } | { ok: false; status: 400 | 403 } {
  if (rawPath === null || pathProblem(rawPath)) return { ok: false, status: 400 };
  const requested = normalizePosix(rawPath);
  if (!requested || pathProblem(requested)) return { ok: false, status: 400 };
  const root = realRoot(dir);
  if (!root) return { ok: false, status: 400 };
  const abs = placeInside(root, path.resolve(root, requested));
  if (!abs) return { ok: false, status: 400 };
  const output = declaredFileOutput(loadFlow(dir).flow, requested);
  if (!output) return { ok: false, status: 403 };
  return { ok: true, abs, rel: requested, output };
}

function humanDirOutput(dir: string, stageId: string): { ok: true; abs: string; rel: string } | { ok: false; status: 400 | 403 | 404 } {
  const loaded = loadFlow(dir);
  const stage = loaded.flow.stages.find((item) => item.id === stageId);
  if (!stage) return { ok: false, status: 404 };
  if (stage.executor.type !== "human") return { ok: false, status: 403 };
  const dirs = stage.outputs.filter((output) => isDirOutput(output));
  const dirOutput = dirs[0];
  if (dirs.length !== 1 || !dirOutput) return dirs.length === 0 ? { ok: false, status: 403 } : { ok: false, status: 400 };
  const rel = outputRel(dirOutput);
  if (pathProblem(rel)) return { ok: false, status: 400 };
  const root = realRoot(dir);
  if (!root) return { ok: false, status: 400 };
  const abs = placeInside(root, path.resolve(root, rel));
  if (!abs) return { ok: false, status: 400 };
  return { ok: true, abs, rel };
}

async function ensureDir(abs: string, rootReal: string): Promise<string> {
  if (!fs.existsSync(abs)) await fs.promises.mkdir(abs, { recursive: true });
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new HttpError(400, "打不开文件夹 / could not open the directory");
  }
  if (outside(rootReal, real) || !fs.statSync(real).isDirectory()) {
    throw new HttpError(403, "只能上传到人工阶段的文件夹产物 / uploads only go into a human stage's directory output");
  }
  return real;
}

function tempPath(dir: string): string {
  return path.join(dir, `.flowgit-tmp-${crypto.randomBytes(16).toString("hex")}`);
}

/** Stream the request to a new file. The caller renames it into place. */
async function streamToFile(req: http.IncomingMessage, tmp: string): Promise<void> {
  await pipeline(req, fs.createWriteStream(tmp, { flags: "wx" }));
  const fh = await fs.promises.open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Rename `tmp` over `dest`. A crash leaves the previous file or the temp file, never a half-written dest. */
async function replaceFile(tmp: string, dest: string): Promise<void> {
  try {
    await fs.promises.rename(tmp, dest);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;
  }
  const backup = `${tmp}.bak`;
  await fs.promises.rename(dest, backup);
  try {
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rename(backup, dest).catch(() => {});
    throw err;
  }
  await fs.promises.rm(backup, { force: true });
}

async function putFlowFile(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, rawPath: string | null): Promise<void> {
  const target = resolveDeclaredFile(ctx.dir, rawPath);
  if (!target.ok) {
    req.resume();
    const error =
      target.status === 400
        ? "路径不合法 / invalid path"
        : "只能修改阶段声明的产物文件 / only a stage's declared output file can be changed";
    sendJson(res, target.status, { error });
    return;
  }
  if (fs.existsSync(target.abs) && fs.statSync(target.abs).isDirectory()) {
    req.resume();
    sendJson(res, 403, { error: "只能修改阶段声明的产物文件 / only a stage's declared output file can be changed" });
    return;
  }
  await fs.promises.mkdir(path.dirname(target.abs), { recursive: true });
  const tmp = tempPath(path.dirname(target.abs));
  try {
    await streamToFile(req, tmp);
    if (isJsonMime(target.output.type)) {
      const text = await fs.promises.readFile(tmp, "utf8");
      try {
        JSON.parse(text);
      } catch {
        await fs.promises.rm(tmp, { force: true });
        sendJson(res, 400, { error: "JSON 不合法，没有保存 / invalid JSON, not saved" });
        return;
      }
    }
    await replaceFile(tmp, target.abs);
    publishFlowChanged(ctx);
    sendJson(res, 200, { ok: true, path: target.rel });
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

async function uploadFlowFile(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): Promise<void> {
  const rawName = url.searchParams.get("name");
  if (rawName === null || invalidUploadName(rawName)) {
    req.resume();
    sendJson(res, 400, { error: "文件名不合法 / invalid file name" });
    return;
  }
  const name = rawName;
  const stageId = url.searchParams.get("stage");
  if (!stageId) {
    req.resume();
    sendJson(res, 400, { error: "缺少阶段 / missing stage" });
    return;
  }
  const located = humanDirOutput(ctx.dir, stageId);
  if (!located.ok) {
    req.resume();
    const error =
      located.status === 404
        ? "找不到阶段 / stage not found"
        : located.status === 400
          ? "路径不合法 / invalid path"
          : "只能上传到人工阶段的文件夹产物 / uploads only go into a human stage's directory output";
    sendJson(res, located.status, { error });
    return;
  }
  const root = realRoot(ctx.dir);
  if (!root) {
    req.resume();
    sendJson(res, 400, { error: "路径不合法 / invalid path" });
    return;
  }
  let dirAbs: string;
  try {
    dirAbs = await ensureDir(located.abs, root);
  } catch (err) {
    req.resume();
    throw err;
  }
  const dest = path.join(dirAbs, name);
  if (path.basename(dest) !== name || outside(root, dest)) {
    req.resume();
    sendJson(res, 400, { error: "文件名不合法 / invalid file name" });
    return;
  }
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    req.resume();
    sendJson(res, 400, { error: "已有同名文件夹 / a directory with that name already exists" });
    return;
  }
  const tmp = tempPath(dirAbs);
  try {
    await streamToFile(req, tmp);
    await replaceFile(tmp, dest);
    publishFlowChanged(ctx);
    sendJson(res, 200, { ok: true, path: `${located.rel}/${name}` });
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
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

function sendError(res: http.ServerResponse, err: unknown): void {
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
