import { DurableObject } from "cloudflare:workers";
import {
  callMcpTool,
  findFlowFile,
  mcpInstructions,
  mcpTools,
  type Host,
  HumanInputNeededError,
  loadFlow,
  loadFlowInputs,
  type MemoryChange,
  type MemoryHost,
  needsComputerError,
  outputAbs,
  recordManualEdit,
  type RunEvent,
  runStage,
  type Stage,
  TokenBudgetError,
  TrustNeededError,
  trustState,
  usageTokens,
} from "@flowgit/core";
// The web app's in-page board API: the same routes, statuses and bodies as the local board.
import { BrowserBoard } from "../../../app/src/router.js";
import type { Env } from "../env.js";
import { audit } from "../audit.js";
import { errorResponse, HttpError, json, newId, readBytes, readJson, SECURITY_HEADERS, sha256Hex } from "../http.js";
import { notify } from "../notify/notify.js";
import { cloudMcpBackend } from "../mcp/backend.js";
import { decideNext } from "../runs/next.js";
import { sandboxExec } from "../runs/sandbox.js";
import { addUsage, requireQuota, usageOf } from "../runs/usage.js";
import { CONTINUE_EVENT, type StepAnswer } from "../runs/workflow.js";
import { decryptKeys, guardKeys, type OpenKey, recordKeyUses } from "../vault/vault.js";
import { handleComments } from "./comments.js";
import { assertWritable, type Collab } from "./locks.js";
import { onLiveLeave, onLiveMessage } from "./presence.js";
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

/** Where core keeps confirmations of copied flows on the room's host (restored from D1). */
const TRUST_FILE = "/home/.flowgit/trusted.json";

/** Test hook: replaces fetch for requests a run makes (model APIs, service stages). */
export const runTransport: { fetch?: typeof fetch } = {};

/** What a person or a computer has to do before the run goes on. */
export interface Waiting {
  stage: string;
  name: string;
  kind: "human" | "computer";
  missing?: string[];
  instructions?: string;
}

/** The run that holds the room's run lock, kept in the room's storage so it survives a restart. */
export interface ActiveRun {
  id: string;
  /** "all" or a stage id. */
  stage: string;
  model?: string;
  userId: string;
  workspaceId: string;
  /** ISO time; stages that ran since belong to this run. */
  startedAt: string;
  state: "running" | "waiting";
  waiting?: Waiting;
  tokens: number;
  /** Flow inputs given with the run (MCP's run_flow); the saved inputs fill in the rest. */
  inputs?: Record<string, unknown>;
  /** Who asked, recorded in run.json and the runs table (`via: "mcp"`). */
  caller?: RunCaller;
}

export interface RunCaller {
  via: "mcp";
  client?: string;
}

/** What a run start asks for: the board's POST /api/run body, or an MCP tool call. */
export interface RunAsk {
  stage: string;
  model?: string;
  detach: boolean;
  userId: string;
  inputs?: Record<string, unknown>;
  caller?: RunCaller;
}

type FinalState = "done" | "failed" | "budget" | "cancelled" | "expired";
export type StopAnswer = { status: number; body: Record<string, unknown> };

/**
 * One room per flow (a Durable Object named by the flow id). It keeps the flow's files on a
 * memory host while people use it, answers the board's API with the web app's BrowserBoard,
 * writes every change back to R2 in order, and tells everyone who has the flow open over
 * WebSocket (`flow:changed`, like the local board's SSE). It also holds the run lock: one cloud
 * run per flow (runs/workflow.ts drives it one stage per step), whose log streams to the same
 * sockets. Presence, locks and comments (#173) live in presence.ts, locks.ts and comments.ts;
 * this file only dispatches to them.
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
  /** The current run's events, replayed to a socket that opens late (like the local board's SSE). */
  private runFrames: string[] = [];
  private frameId = 0;
  /** Answers for POST /api/run requests waiting for their run to stop (finish or wait). */
  private stopWaiters = new Map<string, Array<(answer: StopAnswer) => void>>();
  /** One step at a time. */
  private stepping?: Promise<unknown>;
  private announced = new Set<string>();

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
      if (url.pathname.startsWith("/run")) return await withFlowHost(host, () => this.runRoute(request, url, host));
      if (url.pathname === "/mcp" && request.method === "POST") return await withFlowHost(host, () => this.mcpRoute(request));
      return await withFlowHost(host, () => this.route(request, url, host));
    } catch (err) {
      return errorResponse(err);
    }
  }

  private async route(request: Request, url: URL, host: MemoryHost): Promise<Response> {
    const method = request.method.toUpperCase();
    const writer = request.headers.get(ROOM_USER) ?? "";
    // Comments are not flow files. Writing one broadcasts from the room; the text stays in D1.
    if (url.pathname === "/comments" || url.pathname.startsWith("/comments/")) return handleComments(this.collab(writer), request, url);
    // Someone else holding the stage (or the whole flow) answers 409 code "locked", distinct from a run's 409.
    if (method !== "GET" && method !== "HEAD") await assertWritable(this.collab(writer), request, url);
    let response: Response;
    if (url.pathname === "/files" && method === "GET") response = this.listFiles(host);
    else if (url.pathname === "/raw") response = await this.raw(request, url, host);
    else if (url.pathname.startsWith("/board/")) response = await this.boardRoute(request, url);
    else response = json(404, { error: "没有这个接口 / not found" });
    if (method !== "GET") {
      await this.settle();
      await this.maybeResume();
    }
    return response;
  }

  /** The local board's API, unchanged: /board/<route> answers like /api/<route>. */
  private async boardRoute(request: Request, url: URL): Promise<Response> {
    const method = request.method.toUpperCase();
    const route = `/api/${url.pathname.slice("/board/".length)}`;
    if (!findFlowFile(FLOW_DIR)) return json(404, { error: "没有 flow.json 或 flow.md / no flow.json or flow.md" });
    if (method === "POST" && route === "/api/run") return this.startRun(request);
    const board = this.boardFor();
    const init: RequestInit = { method, headers: request.headers };
    if (method !== "GET" && method !== "HEAD") init.body = await readBytes(request, MAX_FILE_BYTES);
    const response = await board.fetch(`${route}${url.search}`, init);
    if (method === "POST" && route === "/api/trust" && response.ok) await this.saveTrust(request, init.body as Uint8Array);
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
      if (this.stepping) throw new HttpError(409, "正在运行，结束后再保存 / a run is in progress; save again when it finishes");
      const data = await readBytes(request, MAX_FILE_BYTES);
      if (!host.exists(abs) && this.fileCount(host) >= MAX_FLOW_FILES) throw tooManyFiles();
      if (host.exists(abs) && host.stat(abs).isDirectory()) throw new HttpError(409, `这是一个文件夹 / this is a folder: ${rel}`);
      host.mkdir(host.path.dirname(abs), { recursive: true });
      host.writeFile(abs, data);
      this.dirty = true;
      return json(200, { ok: true, path: rel, size: data.length, sha256: await sha256Hex(data) });
    }
    if (method === "DELETE") {
      if (this.stepping) throw new HttpError(409, "正在运行，结束后再删 / a run is in progress; delete when it finishes");
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
    const active = await this.activeRun();
    if (active) {
      await this.ctx.storage.delete("run");
      try {
        await (await this.env.RUNS.get(active.id)).terminate();
      } catch {
        // already over
      }
      this.answerStop(active.id, { status: 410, body: { error: "流程已删除 / the flow was deleted" } });
    }
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
    // A late client gets the current run's log so far.
    for (const frame of this.runFrames) server.send(frame);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // A raw ping still answers pong. Other frames are presence, locks and heartbeats; a bad one
    // gets an error frame and the socket stays open.
    if (message === "ping") {
      ws.send("pong");
      return;
    }
    try {
      await onLiveMessage(this.collab(), ws, message);
    } catch (err) {
      console.error("live message", err instanceof Error ? err.message : err);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
    // The lock lived on this socket. Tell everyone it is gone.
    try {
      await onLiveLeave(this.collab(), ws);
    } catch (err) {
      console.error("live leave", err instanceof Error ? err.message : err);
    }
  }

  /** Adapts the room to presence, locks and comments. Those modules do the work. */
  private collab(userId = ""): Collab {
    return {
      env: this.env,
      flowId: this.flowId ?? "",
      userId,
      sockets: () => this.ctx.getWebSockets(),
      tags: (ws) => this.ctx.getTags(ws),
      send: (ws, event, data) => {
        try {
          ws.send(JSON.stringify({ id: ++this.frameId, event, data }));
        } catch {
          // closing
        }
      },
      broadcast: (event, data) => this.broadcast(event, data),
      stages: () => {
        try {
          if (!findFlowFile(FLOW_DIR)) return [];
          return loadFlow(FLOW_DIR).flow.stages;
        } catch {
          return [];
        }
      },
    };
  }

  /** Send an event to everyone who has the flow open, shaped like the local board's SSE frames. */
  broadcast(event: string, data: unknown, remember = false): void {
    const frame = JSON.stringify({ id: ++this.frameId, event, data });
    if (remember) this.runFrames.push(frame);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame);
      } catch {
        // closing
      }
    }
  }

  // ---- remote MCP (the Worker checked the token, the grant and the role) ----

  /**
   * `{ op: "info" }` → the flow's name, server instructions and tools;
   * `{ op: "call", name, args, client }` → `{ result, runId, tokens }`, where `result` is the
   * tools/call result and `tokens` what the call's run used.
   */
  private async mcpRoute(request: Request): Promise<Response> {
    const body = await readJson(request, MAX_FILE_BYTES + 64 * 1024);
    if (!findFlowFile(FLOW_DIR)) return json(404, { error: "没有 flow.json 或 flow.md / no flow.json or flow.md" });
    const loaded = loadFlow(FLOW_DIR);
    if (body.op === "info") {
      return json(200, { name: loaded.flow.name, instructions: mcpInstructions(loaded, "in Flowgit Cloud"), tools: mcpTools(loaded) });
    }
    if (body.op !== "call" || typeof body.name !== "string") throw new HttpError(400, "不认识的 MCP 请求 / unknown MCP request");
    const userId = request.headers.get(ROOM_USER)!;
    const client = typeof body.client === "string" && body.client ? body.client.slice(0, 200) : undefined;
    const caller: RunCaller = client ? { via: "mcp", client } : { via: "mcp" };
    const before = await this.activeRun();
    let run: { id?: string; tokens?: number } | undefined;
    const backend = cloudMcpBackend({
      load: () => loadFlow(FLOW_DIR),
      active: this.stepping && before ? { ...before, state: "running" } : before,
      begin: async (stage, inputs) => {
        const answer = await this.beginRun({ stage, detach: false, userId, inputs, caller });
        run = (answer.body as { run?: { id?: string; tokens?: number } }).run;
        return answer;
      },
    });
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
    let result;
    try {
      result = await callMcpTool(backend, body.name, args);
    } finally {
      await this.settle();
    }
    const tokens = run?.id ? Math.max(0, (run.tokens ?? 0) - (before?.id === run.id ? before.tokens : 0)) : 0;
    return json(200, { result, runId: run?.id ?? null, tokens });
  }

  // ---- cloud runs ----

  private activeRun(): Promise<ActiveRun | undefined> {
    return this.ctx.storage.get<ActiveRun>("run");
  }

  private async saveRun(run: ActiveRun): Promise<void> {
    await this.ctx.storage.put("run", run);
  }

  /** Internal routes: /run (the current run), and the Workflow's /run/step and /run/finish. */
  private async runRoute(request: Request, url: URL, _host: MemoryHost): Promise<Response> {
    const method = request.method.toUpperCase();
    if (url.pathname === "/run" && method === "GET") {
      const active = await this.activeRun();
      return json(200, { run: active ? runSummary(active) : null });
    }
    if (method !== "POST") return json(405, { error: "不支持这个方法 / method not allowed" });
    const body = await readJson(request, 64 * 1024);
    const runId = typeof body.runId === "string" ? body.runId : "";
    switch (url.pathname) {
      case "/run/step":
        return json(200, await this.step(runId));
      case "/run/finish": {
        const active = await this.activeRun();
        if (!active || active.id !== runId) return json(200, { state: "gone" });
        const state = (["failed", "cancelled", "expired"].includes(String(body.state)) ? body.state : "failed") as FinalState;
        await this.finish(active, state, typeof body.error === "string" ? body.error : undefined);
        return json(200, { state });
      }
      case "/run/continue": {
        const active = await this.activeRun();
        if (!active || (runId && active.id !== runId)) throw new HttpError(404, "没有这个运行 / run not found");
        await this.continueRun(active);
        return json(200, { ok: true, run: runSummary((await this.activeRun()) ?? active) });
      }
      case "/run/cancel": {
        const active = await this.activeRun();
        if (!active || (runId && active.id !== runId)) throw new HttpError(404, "没有这个运行 / run not found");
        await this.cancelRun(active, request.headers.get(ROOM_USER) ?? active.userId);
        return json(200, { ok: true });
      }
    }
    return json(404, { error: "没有这个接口 / not found" });
  }

  /**
   * The board's POST /api/run, in the cloud: take the run lock, start a Workflows instance, and
   * answer like the local board once the run stops (done, waiting or failed). `"detach": true`
   * answers at once with 202 and the run. While a run waits for a person or a computer, the same
   * request continues it.
   */
  private async startRun(request: Request): Promise<Response> {
    const body = await readJson(request, 64 * 1024);
    if (typeof body.stage !== "string" || !body.stage.trim()) throw new HttpError(400, "缺少阶段 / missing stage");
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 200) : undefined;
    const answer = await this.beginRun({ stage: body.stage.trim(), model, detach: body.detach === true, userId: request.headers.get(ROOM_USER)! });
    return json(answer.status, answer.body);
  }

  /** Start a run (or continue the one waiting at this stage) and answer once it stops, or at once with 202 when detached. */
  private async beginRun(ask: RunAsk): Promise<StopAnswer> {
    const { stage, model, detach, userId } = ask;
    const loaded = loadFlow(FLOW_DIR);
    if (stage !== "all" && !loaded.flow.stages.some((item) => item.id === stage)) return { status: 404, body: { error: `没有这个阶段 / unknown stage: ${stage}` } };
    const active = await this.activeRun();
    if (active) {
      const same = stage === "all" || stage === active.stage || stage === active.waiting?.stage;
      if (active.state === "waiting" && same) {
        const stopped = detach ? undefined : this.whenStopped(active.id);
        await this.continueRun(active);
        if (!stopped) return { status: 202, body: { ok: true, run: runSummary((await this.activeRun()) ?? active) } };
        return await stopped;
      }
      return { status: 409, body: { error: "已有运行在进行 / a run is already in progress", run: runSummary(active) } };
    }
    const trust = trustState(loaded);
    if (trust.needed) {
      return {
        status: 409,
        body: {
          error: new TrustNeededError(loaded, trust).message,
          trust: { reason: trust.reason, source: trust.source ?? null, fingerprint: trust.fingerprint, actions: trust.actions },
        },
      };
    }
    const flowRow = await this.env.DB.prepare("SELECT workspace_id FROM flows WHERE id = ?").bind(this.flowId!).first<{ workspace_id: string }>();
    if (!flowRow) throw new HttpError(404, "没有这个流程 / flow not found");
    await requireQuota(this.env, flowRow.workspace_id);
    const now = Date.now();
    const run: ActiveRun = {
      id: newId("run"),
      stage,
      ...(model ? { model } : {}),
      userId,
      workspaceId: flowRow.workspace_id,
      startedAt: new Date(now).toISOString(),
      state: "running",
      tokens: 0,
      ...(ask.inputs && Object.keys(ask.inputs).length ? { inputs: ask.inputs } : {}),
      ...(ask.caller ? { caller: ask.caller } : {}),
    };
    await this.saveRun(run);
    await this.env.DB.prepare(
      "INSERT INTO runs (id, flow_id, workspace_id, user_id, stage, model, state, created_at, updated_at, via, client) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)",
    )
      .bind(run.id, this.flowId!, run.workspaceId, userId, stage, model ?? null, now, now, ask.caller?.via ?? null, ask.caller?.client ?? null)
      .run();
    await addUsage(this.env, run.workspaceId, { runs: 1 });
    this.runFrames = [];
    this.announced.clear();
    this.broadcast("run:start", { run: runSummary(run) }, true);
    const stopped = detach ? undefined : this.whenStopped(run.id);
    try {
      await this.env.RUNS.create({ id: run.id, params: { flowId: this.flowId!, runId: run.id, userId } });
    } catch (err) {
      await this.finish(run, "failed", `没能开始运行 / could not start the run: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    if (!stopped) return { status: 202, body: { ok: true, run: runSummary(run) } };
    return await stopped;
  }

  private whenStopped(runId: string): Promise<StopAnswer> {
    return new Promise((resolve) => {
      const list = this.stopWaiters.get(runId) ?? [];
      list.push(resolve);
      this.stopWaiters.set(runId, list);
    });
  }

  private answerStop(runId: string, answer: StopAnswer): void {
    const list = this.stopWaiters.get(runId);
    this.stopWaiters.delete(runId);
    for (const resolve of list ?? []) resolve(answer);
  }

  /** One Workflows step: do the next stage of the run. */
  private async step(runId: string): Promise<StepAnswer> {
    // A retried step can arrive while the first attempt is still going; take turns.
    while (this.stepping) await this.stepping.catch(() => {});
    const work = this.stepOnce(runId);
    this.stepping = work;
    try {
      return await work;
    } finally {
      this.stepping = undefined;
    }
  }

  private async stepOnce(runId: string): Promise<StepAnswer> {
    let active = await this.activeRun();
    if (!active || active.id !== runId) return { state: "gone" };
    if (active.state !== "running" || active.waiting) {
      active = { ...active, state: "running" };
      delete active.waiting;
      await this.saveRun(active);
      await this.updateRunRow(active, "running");
    }
    const host = this.host!;
    const board = this.boardFor();
    const keys = await decryptKeys(this.env, active.workspaceId);
    const base: Record<string, string> = {};
    // Canned replies for the local emulator and the tests only.
    if (this.env.ENVIRONMENT === "local" && this.env.FLOWGIT_TEST_LLM_MOCK_DIR) base.FLOWGIT_LLM_MOCK_DIR = `${FLOW_DIR}/${this.env.FLOWGIT_TEST_LLM_MOCK_DIR}`;
    const fetcher = runTransport.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const guard = guardKeys(fetcher, keys);
    const runHost = this.runHost(host, base, keys, guard.fetch);
    board.running = true;
    let answer: StepAnswer;
    try {
      answer = await withFlowHost(runHost, () => this.advance(active!, guard.take));
    } finally {
      board.running = false;
      // Every file the stage wrote is in R2 before the Workflow takes the next step.
      await this.settle();
    }
    return answer;
  }

  /**
   * The room's host for a run step: the run's environment (its keys, under their own names), a
   * fetch that lets each key out only to its own hosts, and the sandbox for commands. Commands
   * get no keys: the sandbox's environment has every vault name taken out.
   */
  private runHost(host: MemoryHost, base: Record<string, string>, keys: Record<string, OpenKey>, guarded: typeof fetch): Host {
    const env: Record<string, string> = { ...base };
    for (const [name, key] of Object.entries(keys)) env[name] = key.value;
    const sandbox = this.env.SANDBOX;
    const run = sandbox
      ? sandboxExec(sandbox, host, FLOW_DIR, {
          flowId: this.flowId!,
          blobOf: (data) => readStub(data),
          stubFor: (ref) => makeStub(ref),
          withheld: Object.keys(keys),
        })
      : undefined;
    return {
      ...host,
      env,
      fetch: (input, init) => guarded(input as RequestInfo, init),
      exec: run ?? (async () => Promise.reject(needsComputerError())),
    } as Host;
  }

  private async advance(active: ActiveRun, takeKeys: () => string[]): Promise<StepAnswer> {
    const loaded = loadFlow(FLOW_DIR);
    const next = decideNext(loaded, { stage: active.stage, model: active.model, inputs: active.inputs, since: active.startedAt, sandbox: Boolean(this.env.SANDBOX) });
    takeKeys();
    for (const stage of next.skipped) {
      if (this.announced.has(stage.id)) continue;
      this.announced.add(stage.id);
      this.broadcast("stage:skip", { stage: stage.id, name: stage.name, reason: "已是最新 / up to date" }, true);
    }
    switch (next.kind) {
      case "done":
        await this.finish(active, "done");
        return { state: "done" };
      case "fail":
        this.broadcast("stage:error", { stage: next.stage.id, name: next.stage.name, error: next.error }, true);
        await this.finish(active, "failed", next.error);
        return { state: "failed", error: next.error };
      case "keep": {
        const kept = recordManualEdit(loaded, next.stage.id, loadFlowInputs(loaded.dir, loaded.flow, active.inputs));
        this.dirty = true;
        this.broadcast("stage:skip", { stage: next.stage.id, name: next.stage.name, reason: `保留了你的手动修改，存为 v${kept.n} / kept your manual edit as v${kept.n}` }, true);
        return { state: "next" };
      }
      case "computer":
        await this.wait(active, {
          stage: next.stage.id,
          name: next.stage.name,
          kind: "computer",
          instructions: "这个阶段要在电脑上运行：用桌面应用或本机看板（flowgit board）运行它，然后继续 / This stage runs on a computer: run it with the desktop app or the local board (flowgit board), then continue",
        });
        return { state: "waiting", kind: "computer", stage: next.stage.id };
      case "run":
        return await this.runOne(active, loaded, next.stage, next.callsModel, takeKeys);
    }
  }

  private async runOne(active: ActiveRun, loaded: ReturnType<typeof loadFlow>, stage: Stage, callsModel: boolean, takeKeys: () => string[]): Promise<StepAnswer> {
    if (callsModel) {
      const usage = await usageOf(this.env, active.workspaceId);
      if (usage.tokens >= usage.tokenQuota) {
        await this.finish(active, "budget", `这个月的 token 用完了（${usage.tokens} / ${usage.tokenQuota}）/ this month's tokens are used up (${usage.tokens} of ${usage.tokenQuota})`);
        return { state: "budget" };
      }
    }
    const onEvent = (event: RunEvent) => this.publishRunEvent(event);
    let params: Record<string, unknown> | undefined;
    try {
      const record = await runStage(loaded, stage.id, {
        ...(active.model ? { model: active.model } : {}),
        ...(active.inputs ? { inputs: active.inputs } : {}),
        ...(active.caller ? { caller: active.caller } : {}),
        onEvent,
      });
      params = record.params;
      this.dirty = true;
      return { state: "next" };
    } catch (err) {
      params = (err as { params?: Record<string, unknown> }).params;
      this.dirty = true;
      if (err instanceof HumanInputNeededError) {
        await this.wait(active, {
          stage: err.stage.id,
          name: err.stage.name,
          kind: "human",
          missing: err.missing,
          ...(err.instructions ? { instructions: err.instructions } : {}),
        });
        return { state: "waiting", kind: "human", stage: err.stage.id };
      }
      if (err instanceof TokenBudgetError) {
        await this.finish(active, "budget", err.message);
        return { state: "budget" };
      }
      const message = err instanceof Error ? err.message : String(err);
      // runStage already sent stage:error for a failed attempt; say it for errors before one.
      if (!(err as { record?: unknown }).record) this.broadcast("stage:error", { stage: stage.id, name: stage.name, error: message }, true);
      await this.finish(active, "failed", message);
      return { state: "failed", error: message };
    } finally {
      const tokens = usageTokens(params?.usage as Record<string, unknown> | undefined);
      const used = tokens ? tokens.input + tokens.output : 0;
      const latest = await this.activeRun();
      if (latest?.id === active.id && used) await this.saveRun({ ...latest, tokens: latest.tokens + used });
      if (used) await addUsage(this.env, active.workspaceId, { tokens: used });
      await recordKeyUses(this.env, { workspaceId: active.workspaceId, names: takeKeys(), flowId: this.flowId!, runId: active.id, stage: stage.id, tokens: used });
    }
  }

  /** The same events as the local board's SSE, over the room's sockets. */
  private publishRunEvent(event: RunEvent): void {
    const stage = event.stage.id;
    const name = event.stage.name;
    switch (event.type) {
      case "stage:start":
        // Ran in this run: not "up to date" news on the next step.
        this.announced.add(stage);
        this.broadcast(event.type, { stage, name, executor: event.stage.executor.type }, true);
        return;
      case "stage:skip":
        this.broadcast(event.type, { stage, name, reason: event.reason }, true);
        return;
      case "stage:log":
        this.broadcast(event.type, { stage, line: event.line }, true);
        return;
      case "stage:done":
        this.broadcast(event.type, { stage, name, n: event.n }, true);
        return;
      case "stage:error":
        this.broadcast(event.type, { stage, name, error: event.error.message }, true);
        return;
    }
  }

  private async wait(active: ActiveRun, waiting: Waiting): Promise<void> {
    const latest = (await this.activeRun()) ?? active;
    const run: ActiveRun = { ...latest, state: "waiting", waiting };
    await this.saveRun(run);
    await this.updateRunRow(run, "waiting");
    const payload = { ok: true as const, waiting: waitingPayload(waiting), run: runSummary(run) };
    this.broadcast("run:end", payload, true);
    this.answerStop(run.id, { status: 200, body: payload });
    const flowName = await this.flowName();
    await notify(this.env, {
      userId: run.userId,
      workspaceId: run.workspaceId,
      flowId: this.flowId!,
      runId: run.id,
      kind: waiting.kind === "human" ? "run.waiting" : "run.computer",
      title: waiting.kind === "human" ? `「${flowName}」在等你 / "${flowName}" is waiting for you` : `「${flowName}」要在电脑上运行一步 / "${flowName}" needs a computer`,
      body: waiting.kind === "human" ? `${waiting.name}：${(waiting.missing ?? []).join(", ")}` : waiting.name,
      url: `/app/?flow=${this.flowId}`,
    });
  }

  /** A run waiting for a person or a computer goes on. */
  private async continueRun(active: ActiveRun): Promise<void> {
    if (active.state !== "waiting") throw new HttpError(409, "这个运行没有在等 / this run is not waiting", { run: runSummary(active) });
    const run: ActiveRun = { ...active, state: "running" };
    await this.saveRun(run);
    try {
      await (await this.env.RUNS.get(active.id)).sendEvent({ type: CONTINUE_EVENT, payload: {} });
    } catch (err) {
      await this.saveRun(active);
      throw err;
    }
    this.broadcast("run:continue", { run: runSummary(run) }, true);
  }

  /** After a write: a run waiting for this upload goes on by itself once every output is there. */
  private async maybeResume(): Promise<void> {
    const active = await this.activeRun();
    if (active?.state !== "waiting" || active.waiting?.kind !== "human" || !this.host) return;
    let ready = false;
    try {
      const loaded = loadFlow(FLOW_DIR);
      const stage = loaded.flow.stages.find((item) => item.id === active.waiting!.stage);
      ready = Boolean(stage?.executor.type === "human" && stage.outputs.every((output) => this.host!.exists(outputAbs(loaded.dir, output))));
    } catch {
      return;
    }
    if (ready) await this.continueRun(active);
  }

  private async cancelRun(active: ActiveRun, by: string): Promise<void> {
    await this.finish(active, "cancelled", undefined, by);
    try {
      const instance = await this.env.RUNS.get(active.id);
      if (active.state === "waiting") await instance.sendEvent({ type: CONTINUE_EVENT, payload: { cancel: true } });
      else await instance.terminate();
    } catch {
      // already over
    }
  }

  /** Release the lock and record how the run ended. */
  private async finish(active: ActiveRun, state: FinalState, error?: string, by?: string): Promise<void> {
    const latest = (await this.activeRun()) ?? active;
    if (latest.id !== active.id) return;
    await this.ctx.storage.delete("run");
    const now = Date.now();
    await this.env.DB.prepare("UPDATE runs SET state = ?, waiting = NULL, error = ?, tokens = ?, updated_at = ?, finished_at = ? WHERE id = ?")
      .bind(state, error?.slice(0, 4000) ?? null, latest.tokens, now, now, latest.id)
      .run();
    let body: Record<string, unknown>;
    let status = 200;
    if (state === "done") body = { ok: true };
    else if (state === "budget") body = { ok: true, budget: error ?? "" };
    else {
      status = state === "failed" ? 500 : 409;
      body = { ok: false, error: error ?? (state === "cancelled" ? "运行已取消 / the run was cancelled" : "没人继续，运行已结束 / nobody continued, so the run ended") };
    }
    const summary = runSummary({ ...latest, state: "running" }, state);
    this.broadcast("run:end", { ...body, run: summary }, true);
    this.answerStop(latest.id, { status, body: status === 200 ? { ...body, run: summary } : { error: body.error, run: summary } });
    if (state === "cancelled") {
      await audit(this.env, { userId: by ?? latest.userId, workspaceId: latest.workspaceId, flowId: this.flowId!, action: "run.cancel", detail: { run: latest.id } });
      return;
    }
    if (state === "done" || state === "failed" || state === "budget") {
      const flowName = await this.flowName();
      await notify(this.env, {
        userId: latest.userId,
        workspaceId: latest.workspaceId,
        flowId: this.flowId!,
        runId: latest.id,
        kind: state === "done" ? "run.done" : "run.failed",
        title: state === "done" ? `「${flowName}」运行完了 / "${flowName}" finished` : `「${flowName}」没跑完 / "${flowName}" stopped`,
        body: (error ?? (latest.stage === "all" ? "全部阶段 / all stages" : latest.stage)).slice(0, 300),
        url: `/app/?flow=${this.flowId}`,
      });
    }
  }

  private async updateRunRow(run: ActiveRun, state: "running" | "waiting"): Promise<void> {
    await this.env.DB.prepare("UPDATE runs SET state = ?, waiting = ?, tokens = ?, updated_at = ? WHERE id = ?")
      .bind(state, run.waiting ? JSON.stringify(run.waiting) : null, run.tokens, Date.now(), run.id)
      .run();
  }

  private async flowName(): Promise<string> {
    const row = await this.env.DB.prepare("SELECT name FROM flows WHERE id = ?").bind(this.flowId!).first<{ name: string }>();
    return row?.name ?? this.flowId!;
  }

  /** Confirmations of a copied flow live in D1; core reads them from the host's trusted.json. */
  private async restoreTrust(host: MemoryHost): Promise<void> {
    const row = await this.env.DB.prepare("SELECT fingerprint, created_at FROM trust WHERE flow_id = ?").bind(this.flowId!).first<{ fingerprint: string; created_at: number }>();
    if (!row) return;
    host.mkdir(host.path.dirname(TRUST_FILE), { recursive: true });
    host.writeFile(TRUST_FILE, JSON.stringify({ version: 1, flows: { [FLOW_DIR]: { fingerprint: row.fingerprint, trustedAt: new Date(row.created_at).toISOString() } } }));
  }

  private async saveTrust(request: Request, body: Uint8Array): Promise<void> {
    const fingerprint = (JSON.parse(new TextDecoder().decode(body)) as { fingerprint: string }).fingerprint;
    const userId = request.headers.get(ROOM_USER)!;
    await this.env.DB.prepare(
      "INSERT INTO trust (flow_id, fingerprint, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (flow_id) DO UPDATE SET fingerprint = excluded.fingerprint, user_id = excluded.user_id, created_at = excluded.created_at",
    )
      .bind(this.flowId!, fingerprint, userId, Date.now())
      .run();
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
        await this.restoreTrust(host);
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

/** What the API shows about a run. */
export function runSummary(run: ActiveRun, state: string = run.state) {
  return {
    id: run.id,
    stage: run.stage,
    model: run.model ?? null,
    state,
    waiting: state === "waiting" && run.waiting ? waitingPayload(run.waiting) : null,
    tokens: run.tokens,
    startedAt: run.startedAt,
    userId: run.userId,
  };
}

/** The local board's `waiting` shape, plus `kind` (and `computer` for a handoff). */
function waitingPayload(waiting: Waiting) {
  return {
    stage: waiting.stage,
    name: waiting.name,
    kind: waiting.kind,
    missing: waiting.missing ?? [],
    ...(waiting.instructions ? { instructions: waiting.instructions } : {}),
    ...(waiting.kind === "computer" ? { computer: true } : {}),
  };
}

function tooManyFiles(): HttpError {
  return new HttpError(413, `一个流程最多 ${MAX_FLOW_FILES} 个文件 / a flow can have at most ${MAX_FLOW_FILES} files`);
}

export { LARGE_BYTES, makeStub };
