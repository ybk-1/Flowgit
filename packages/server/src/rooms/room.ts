import { DurableObject } from "cloudflare:workers";
import { findFlowFile, type MemoryChange, type MemoryHost, needsComputerError } from "@flowgit/core";
// The web app's in-page board API: the same routes, statuses and bodies as the local board.
import { BrowserBoard } from "../../../app/src/router.js";
import type { Env } from "../env.js";
import { errorResponse, HttpError, json, readBytes, readJson, SECURITY_HEADERS, sha256Hex } from "../http.js";
import { createMemoryHost, withFlowHost } from "../storage/context-host.js";
import {
  blobKey,
  cleanPath,
  deletePrefix,
  LARGE_BYTES,
  loadFlowFiles,
  makeStub,
  MAX_FILE_BYTES,
  MAX_FLOW_FILES,
  persistChange,
  prefixOf,
  readStub,
} from "../storage/flow-store.js";

/** Where the flow sits on the room's memory host. */
export const FLOW_DIR = "/flow";

/** Headers the Worker sets after it has checked who is asking. The room trusts only these. */
export const ROOM_FLOW = "X-Flowgit-Flow";
export const ROOM_USER = "X-Flowgit-User";

/** Board routes that wait for cloud runs (#170). */
const NOT_YET = new Set(["POST /api/run", "POST /api/trust"]);

/**
 * One room per flow (a Durable Object named by the flow id). It keeps the flow's files on a
 * memory host while people use it, answers the board's API with the web app's BrowserBoard,
 * writes every change back to R2 in order, and tells everyone who has the flow open over
 * WebSocket (`flow:changed`, like the local board's SSE). Runs (#170) and presence, locks and
 * comments (#173) are added here later.
 *
 * Durable Objects: https://developers.cloudflare.com/durable-objects/
 * WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */
export class FlowRoom extends DurableObject<Env> {
  private flowId?: string;
  private host?: MemoryHost;
  private loading?: Promise<MemoryHost>;
  private board?: BrowserBoard;
  /** Changes written to R2 in order, one at a time. */
  private queue: Promise<void> = Promise.resolve();
  private queueError?: unknown;
  /** Large files just written in memory; swapped for their stub once stored. */
  private stubs = new Map<string, Uint8Array>();
  private quiet = false;
  private dirty = false;

  async fetch(request: Request): Promise<Response> {
    const flowId = request.headers.get(ROOM_FLOW);
    if (!flowId) return json(400, { error: "缺少流程 / missing flow" });
    this.flowId = flowId;
    const url = new URL(request.url);
    try {
      if (url.pathname === "/ws") return this.openSocket(request);
      if (url.pathname === "/init" && request.method === "POST") return await this.init(request);
      if (url.pathname === "/destroy" && request.method === "POST") return await this.destroy();
      const host = await this.load();
      return await withFlowHost(host, () => this.route(request, url, host));
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async route(request: Request, url: URL, host: MemoryHost): Promise<Response> {
    const method = request.method.toUpperCase();
    let response: Response;
    if (url.pathname === "/files" && method === "GET") response = this.listFiles(host);
    else if (url.pathname === "/raw") response = await this.raw(request, url, host);
    else if (url.pathname.startsWith("/board/")) response = await this.boardRoute(request, url);
    else response = json(404, { error: "没有这个接口 / not found" });
    if (method !== "GET") await this.settle();
    return response;
  }

  /** The local board's API, unchanged: /board/<route> answers like /api/<route>. */
  private async boardRoute(request: Request, url: URL): Promise<Response> {
    const method = request.method.toUpperCase();
    const route = `/api/${url.pathname.slice("/board/".length)}`;
    if (NOT_YET.has(`${method} ${route}`)) {
      return json(501, { error: "云端运行还没上线，请先在电脑上运行（本机看板或 flowgit run）/ Cloud runs are not available yet; run on a computer for now (the local board or flowgit run)" });
    }
    if (!findFlowFile(FLOW_DIR)) return json(404, { error: "没有 flow.json 或 flow.md / no flow.json or flow.md" });
    const board = this.boardFor();
    const init: RequestInit = { method, headers: request.headers };
    if (method !== "GET" && method !== "HEAD") init.body = await readBytes(request, MAX_FILE_BYTES);
    const response = await board.fetch(`${route}${url.search}`, init);
    // A large file reads back as its stub; answer with the real bytes from R2.
    if (response.ok && (route === "/api/file" || route === "/api/thumb")) {
      const rel = cleanPath(url.searchParams.get("path"));
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      const ref = readStub(bytes);
      if (ref) return this.blobResponse(ref.sha256, response.headers.get("Content-Type") ?? "application/octet-stream", rel ?? "");
    }
    return response;
  }

  private boardFor(): BrowserBoard {
    if (!this.board) {
      this.board = new BrowserBoard({
        dir: FLOW_DIR,
        onChanged: () => {
          this.dirty = true;
        },
        settled: () => this.settle(),
      });
    }
    return this.board;
  }

  private listFiles(host: MemoryHost): Response {
    const files = host
      .files()
      .filter((abs) => abs.startsWith(`${FLOW_DIR}/`))
      .map((abs) => {
        const data = host.readFile(abs);
        const ref = readStub(data);
        const path = abs.slice(FLOW_DIR.length + 1);
        if (ref) return { path, size: ref.size, sha256: ref.sha256 };
        return { path, size: data.length, sha256: host.hash().update(data).digest() };
      });
    return json(200, { files });
  }

  /** Any file of the flow, by relative path (for the CLI's push, pull and clone). */
  private async raw(request: Request, url: URL, host: MemoryHost): Promise<Response> {
    const rel = cleanPath(url.searchParams.get("path"));
    if (!rel) throw new HttpError(400, "路径不合法 / invalid path");
    const abs = `${FLOW_DIR}/${rel}`;
    const method = request.method.toUpperCase();
    if (method === "GET") {
      if (!host.exists(abs) || !host.stat(abs).isFile()) throw new HttpError(404, `没有这个文件 / no such file: ${rel}`);
      const data = host.readFile(abs);
      const ref = readStub(data);
      if (ref) return this.blobResponse(ref.sha256, "application/octet-stream", rel);
      return new Response(data, { headers: { "Content-Type": "application/octet-stream", ...SECURITY_HEADERS, "Content-Disposition": "attachment" } });
    }
    if (method === "PUT") {
      const data = await readBytes(request, MAX_FILE_BYTES);
      if (!host.exists(abs) && this.fileCount(host) >= MAX_FLOW_FILES) throw tooManyFiles();
      if (host.exists(abs) && host.stat(abs).isDirectory()) throw new HttpError(409, `这是一个文件夹 / this is a folder: ${rel}`);
      host.mkdir(host.path.dirname(abs), { recursive: true });
      host.writeFile(abs, data);
      this.dirty = true;
      return json(200, { ok: true, path: rel, size: data.length, sha256: await sha256Hex(data) });
    }
    if (method === "DELETE") {
      if (!host.exists(abs)) throw new HttpError(404, `没有这个文件 / no such file: ${rel}`);
      host.rm(abs, { recursive: true });
      this.dirty = true;
      return json(200, { ok: true, path: rel });
    }
    throw new HttpError(405, "不支持这个方法 / method not allowed");
  }

  private fileCount(host: MemoryHost): number {
    return host.files().length;
  }

  private async blobResponse(sha: string, type: string, rel: string): Promise<Response> {
    const object = await this.env.FILES.get(blobKey(this.flowId!, sha));
    if (!object) throw new HttpError(404, `文件内容不见了 / the file's content is missing: ${rel}`);
    return new Response(object.body, {
      headers: { "Content-Type": type, "Content-Length": String(object.size), ETag: `"${sha}"`, ...SECURITY_HEADERS },
    });
  }

  /** A new flow's files, from the Worker (base64 by relative path). Refuses if the flow has files. */
  private async init(request: Request): Promise<Response> {
    const body = await readJson(request, Math.ceil(MAX_FILE_BYTES * 1.4) + 1024);
    const files = body.files as Record<string, string> | undefined;
    if (!files || typeof files !== "object") throw new HttpError(400, "缺少 files / missing files");
    const host = await this.load();
    if (host.files().some((abs) => abs.startsWith(`${FLOW_DIR}/`))) throw new HttpError(409, "这个流程已经有文件了 / this flow already has files");
    await withFlowHost(host, () => {
      for (const [rel, b64] of Object.entries(files)) {
        const abs = `${FLOW_DIR}/${rel}`;
        host.mkdir(host.path.dirname(abs), { recursive: true });
        host.writeFile(abs, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      }
    });
    this.dirty = true;
    await this.settle();
    return json(200, { ok: true, files: Object.keys(files).length, bytes: this.totalBytes(host) });
  }

  /** Delete every file of the flow in R2 and close open connections. */
  private async destroy(): Promise<Response> {
    await this.queue.catch(() => {});
    await deletePrefix(this.env.FILES, prefixOf(this.flowId!));
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4404, "flow deleted");
      } catch {
        // already closed
      }
    }
    this.host = undefined;
    this.loading = undefined;
    this.board = undefined;
    return json(200, { ok: true });
  }

  private openSocket(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json(426, { error: "需要 WebSocket / expected a WebSocket upgrade" });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [request.headers.get(ROOM_USER) ?? "anonymous"]);
    server.send(JSON.stringify({ id: 0, event: "hello", data: { flow: this.flowId } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Clients only ping for now; #173 adds presence, locks and comments.
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  /** Send an event to everyone who has the flow open, shaped like the local board's SSE frames. */
  broadcast(event: string, data: unknown): void {
    const frame = JSON.stringify({ id: Date.now(), event, data });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame);
      } catch {
        // closing
      }
    }
  }

  private load(): Promise<MemoryHost> {
    if (this.host) return Promise.resolve(this.host);
    if (!this.loading) {
      this.loading = (async () => {
        const { files, dirs } = await loadFlowFiles(this.env.FILES, this.flowId!);
        const host = createMemoryHost({
          cwd: FLOW_DIR,
          home: "/home",
          platform: "cloud",
          env: {},
          // Nothing in a room calls out or runs commands until cloud runs (#170) and the sandbox (#175).
          fetch: async () => Promise.reject(new Error("云端流程还不能联网 / cloud flows can't make requests yet")),
          exec: async () => Promise.reject(needsComputerError()),
          onChange: (change) => this.onChange(change),
        });
        this.quiet = true;
        host.mkdir(FLOW_DIR, { recursive: true });
        for (const dir of dirs) host.mkdir(`${FLOW_DIR}/${dir}`, { recursive: true });
        for (const [rel, data] of Object.entries(files)) {
          const abs = `${FLOW_DIR}/${rel}`;
          host.mkdir(host.path.dirname(abs), { recursive: true });
          host.writeFile(abs, data);
        }
        this.quiet = false;
        this.host = host;
        return host;
      })().catch((err) => {
        this.quiet = false;
        this.loading = undefined;
        throw err;
      });
    }
    return this.loading;
  }

  /** Queue a memory-host change for R2 (paths under FLOW_DIR only). */
  private onChange(change: MemoryChange): void {
    if (this.quiet || !change.path.startsWith(`${FLOW_DIR}/`)) return;
    const abs = change.path;
    const relChange: MemoryChange = { ...change, path: abs.slice(FLOW_DIR.length + 1) };
    this.dirty = true;
    this.queue = this.queue.then(async () => {
      try {
        const stub = await persistChange(this.env.FILES, this.flowId!, relChange);
        if (stub) this.stubs.set(abs, stub);
      } catch (err) {
        this.queueError = err;
      }
    });
  }

  /** Wait until every change is in R2, swap large files for stubs, and tell everyone. */
  private async settle(): Promise<void> {
    await this.queue;
    if (this.queueError) {
      const err = this.queueError;
      this.queueError = undefined;
      // Memory may now be ahead of R2: drop it so the next request reloads what is stored.
      this.host = undefined;
      this.loading = undefined;
      this.board = undefined;
      throw err;
    }
    if (this.host && this.stubs.size) {
      this.quiet = true;
      try {
        for (const [abs, stub] of this.stubs) if (this.host.exists(abs)) this.host.writeFile(abs, stub);
      } finally {
        this.quiet = false;
        this.stubs.clear();
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    if (this.host) {
      await this.env.DB.prepare("UPDATE flows SET updated_at = ?, bytes = ? WHERE id = ?").bind(Date.now(), this.totalBytes(this.host), this.flowId!).run();
    }
    this.broadcast("flow:changed", {});
  }

  private totalBytes(host: MemoryHost): number {
    let total = 0;
    for (const abs of host.files()) {
      const data = host.readFile(abs);
      total += readStub(data)?.size ?? data.length;
    }
    return total;
  }
}

function tooManyFiles(): HttpError {
  return new HttpError(413, `一个流程最多 ${MAX_FLOW_FILES} 个文件 / a flow can have at most ${MAX_FLOW_FILES} files`);
}

export { LARGE_BYTES, makeStub };
