import {
  addStage,
  editStage as applyStageEdit,
  EditError,
  stagePatchFromBody,
  diffRuns,
  findFlowFile,
  flowLog,
  type Flow,
  type FlowInput,
  host,
  HumanInputNeededError,
  isDirOutput,
  isEditablePrompt,
  listFiles,
  listRuns,
  loadFlow,
  loadFlowInputs,
  MissingInputsError,
  outputRel,
  planModelCalls,
  planRunAll,
  promptSkeleton,
  readFlowFile,
  removeStage,
  requireStage,
  resolveFlowInputs,
  restoreStage,
  runAll,
  type RunEvent,
  runStage,
  saveFlowInputs,
  TokenBudgetError,
  TrustChangedError,
  trustFlow,
  TrustNeededError,
  trustState,
  type TrustState,
  UpstreamNotReadyError,
  validateFlow,
  type ValidationIssue,
  writeFlowFile,
  type AddStageSpec,
  type Output,
  type Stage,
} from "@flowgit/core";
// The same view models the local board serves; these two modules only use core.
import { flowBoard, putFlow } from "../../web/src/routes/flow.js";
import { flowGraph } from "../../web/src/routes/graph.js";
import { EventHub } from "./events.js";
import { needsComputer } from "./handoff.js";

/**
 * The local board's HTTP API, answered inside the page. The board's api.js sends every request
 * here (globalThis.flowgitTransport), so the board modules run unchanged. Bodies and statuses
 * follow packages/web/src/routes; core does the work on the current host.
 *
 * Cloud flows do not construct BrowserBoard. They rewrite `/api/<route>` with `cloudBoardRequest`
 * and leave this class's routes as they are.
 */

/** A board URL (`/api/flow`, `/api/file?path=…`) addressed at one cloud flow or a public share. */
export function cloudBoardRequest(url: string, target: { flowId: string | null; share: string | null }): string {
  const path = url.startsWith("/api/") ? url.slice("/api/".length) : url.replace(/^\//, "");
  if (target.share) return `/api/share/${encodeURIComponent(target.share)}/board/${path}`;
  if (!target.flowId) throw new Error("缺少云端流程 / missing cloud flow");
  return `/api/flows/${encodeURIComponent(target.flowId)}/board/${path}`;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function coreError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const missing = /没有这个阶段|Unknown stage|没有 v\d|has no run #|没有阶段|No stage/.test(message);
  return new HttpError(missing ? 404 : 400, message);
}

async function jsonBody(init?: RequestInit): Promise<Record<string, unknown>> {
  const text = typeof init?.body === "string" ? init.body : init?.body ? await new Response(init.body as BodyInit).text() : "";
  if (!text.trim()) throw new HttpError(400, "请求是空的 / empty request body");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求不是合法的 JSON / request body is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "请求必须是 JSON 对象 / request body must be a JSON object");
  return value as Record<string, unknown>;
}

async function bytesBody(init?: RequestInit): Promise<Uint8Array> {
  if (!init?.body) return new Uint8Array();
  return new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
}

/** Posix path without "." parts; null when it climbs out or is absolute. */
function cleanRel(raw: string | null): string | null {
  if (raw === null || raw.includes("\0") || raw.includes("\\")) return null;
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (!parts.length || raw.startsWith("/") || parts.includes("..") || /^[A-Za-z]:/.test(raw)) return null;
  return parts.join("/");
}

function matchesOutput(output: Output, rel: string): boolean {
  const base = outputRel(output);
  return rel === base || (isDirOutput(output) && rel.startsWith(`${base}/`));
}

/** Stage outputs (with files inside directory outputs), prompt files, and runs/<stage>/<n>/outputs/. */
function isAllowed(flow: Flow, rel: string): boolean {
  if (isEditablePrompt(flow, rel)) return true;
  if (flow.stages.some((stage) => stage.outputs.some((output) => matchesOutput(output, rel)))) return true;
  const snap = /^runs\/([^/]+)\/(\d+)\/outputs(?:\/.*)?$/.exec(rel);
  return Boolean(snap && flow.stages.some((stage) => stage.id === snap[1]));
}

function declaredType(flow: Flow, rel: string): string | undefined {
  const snap = /^runs\/([^/]+)\/\d+\/outputs\/(.+)$/.exec(rel);
  const stages = snap ? flow.stages.filter((stage) => stage.id === snap[1]) : flow.stages;
  const target = snap ? snap[2] : rel;
  for (const stage of stages) for (const output of stage.outputs) if (outputRel(output) === target) return output.type;
  return undefined;
}

function mediaType(rel: string, declared?: string): string {
  if (declared) {
    const value = declared.toLowerCase();
    if (value === "application/json" || value.endsWith("+json")) return "application/json; charset=utf-8";
    if (value.startsWith("text/html") || value.includes("xml")) return "text/plain; charset=utf-8";
    if (value.startsWith("text/")) return value.includes("charset") ? value : `${value}; charset=utf-8`;
    if (value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/")) return value;
  }
  return EXT_TYPE[host().path.extname(rel).toLowerCase()] ?? "application/octet-stream";
}

function isJsonMime(type: string): boolean {
  const value = type.toLowerCase();
  return value === "application/json" || value.endsWith("+json");
}

function inputField(name: string, def: FlowInput, value: unknown) {
  return {
    name,
    type: def.type,
    required: def.required === true,
    value: value === undefined ? null : value,
    ...(def.description ? { description: def.description } : {}),
    ...(def.enum ? { enum: def.enum } : {}),
    ...(def.default !== undefined ? { default: def.default } : {}),
  };
}

function trustPayload(state: TrustState) {
  return { reason: state.reason, source: state.source ?? null, fingerprint: state.fingerprint, actions: state.actions };
}

function positiveInt(raw: string | null): number {
  if (raw === null || raw === "") throw new HttpError(400, "缺少版本 / missing version");
  if (!/^[1-9]\d*$/.test(raw)) throw new HttpError(400, `版本号必须是正整数，收到 "${raw}" / version must be a positive integer, got "${raw}"`);
  return Number(raw);
}

function rejectIssues(issues: ValidationIssue[]): Response {
  const listed = issues.map((issue) => ({ path: issue.path || "/", message: issue.message }));
  return json(400, { error: listed.map((issue) => `${issue.path}: ${issue.message}`).join("\n"), issues: listed });
}

function readFlowSource(dir: string): { file: string; flow: Flow } {
  const file = findFlowFile(dir);
  if (!file) throw new HttpError(404, "没有 flow.json 或 flow.md / no flow.json or flow.md");
  const data = readFlowFile(file) as Flow;
  if (!data || typeof data !== "object" || !Array.isArray(data.stages)) throw new HttpError(400, "不是一个流程 / not a flow");
  return { file, flow: data };
}

export interface BrowserBoardOptions {
  /** Absolute flow directory on the current host. */
  dir: string;
  /** Called after anything changes the flow's files (saves, runs, restores). */
  onChanged?: () => void;
  /** Resolves once changed files are in lasting storage; awaited before a change is answered. */
  settled?: () => Promise<void>;
  /**
   * Where a stage that needs a computer runs (the local board), or undefined to answer with the
   * "run this on a computer" error. Called after `settled`, so the files it reads are saved.
   */
  remote?: () => RemoteRunner | undefined;
}

/** Runs one stage elsewhere and answers like POST /api/run. */
export interface RemoteRunner {
  run(stage: string, model?: string): Promise<{ status: number; body: Record<string, unknown> }>;
}

export class BrowserBoard {
  readonly hub = new EventHub();
  running = false;

  constructor(private readonly options: BrowserBoardOptions) {}

  get dir(): string {
    return this.options.dir;
  }

  /** The board's api.js calls this instead of fetch. */
  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, "http://flowgit.local");
    const method = (init.method ?? "GET").toUpperCase();
    try {
      const response = await this.route(method, url, init);
      // Answer a change only once it is stored, so a reload right after can't lose it.
      if (method !== "GET") await this.flush();
      return response;
    } catch (err) {
      const error = coreError(err);
      return json(error.status, { error: error.message });
    }
  }

  private async flush(): Promise<void> {
    await this.options.settled?.();
  }

  events(url: string) {
    return this.hub.open(url);
  }

  /** Tell open boards to reload, like the local board's file watcher. */
  changed(): void {
    this.hub.publish("flow:changed", {}, false);
    this.options.onChanged?.();
  }

  private busy(): Response | null {
    return this.running ? json(409, { error: "正在运行，结束后再保存 / a run is in progress; save again when it finishes" }) : null;
  }

  /** Same wording as the local board's stage routes. */
  private editBusy(): Response | null {
    return this.running ? json(409, { error: "正在运行，结束后再改阶段 / a run is in progress; change stages when it finishes" }) : null;
  }

  private async route(method: string, url: URL, init: RequestInit): Promise<Response> {
    const dir = this.dir;
    const q = url.searchParams;
    const key = `${method} ${url.pathname}`;
    switch (key) {
      case "GET /api/flow":
        return json(200, flowBoard(dir));
      case "GET /api/graph":
        return json(200, flowGraph(dir));
      case "GET /api/usage": {
        const { stages, total } = flowLog(loadFlow(dir));
        return json(200, { stages, total });
      }
      case "GET /api/plan":
        return this.plan(q.get("model")?.trim() || undefined);
      case "GET /api/inputs": {
        const loaded = loadFlow(dir);
        const values = resolveFlowInputs(loaded.dir, loaded.flow);
        return json(200, { inputs: Object.entries(loaded.flow.inputs ?? {}).map(([name, def]) => inputField(name, def, values[name])) });
      }
      case "PUT /api/inputs":
        return this.putInputs(await jsonBody(init));
      case "GET /api/file":
        return this.getFile(q.get("path"));
      case "PUT /api/file":
        return this.busy() ?? this.putFile(q.get("path"), await bytesBody(init));
      case "POST /api/upload":
        return this.busy() ?? this.upload(q.get("stage"), q.get("name"), await bytesBody(init));
      case "GET /api/thumb":
        return this.thumb(q.get("stage"), q.get("output"));
      case "GET /api/runs": {
        const stage = q.get("stage")?.trim() ?? "";
        if (!stage) throw new HttpError(400, "缺少阶段 / missing stage");
        const loaded = loadFlow(dir);
        requireStage(loaded.flow, stage);
        return json(200, { runs: listRuns(loaded.dir, stage) });
      }
      case "GET /api/diff": {
        const stage = q.get("stage")?.trim() ?? "";
        if (!stage) throw new HttpError(400, "缺少阶段 / missing stage");
        const a = positiveInt(q.get("a"));
        const rawB = q.get("b");
        const b = rawB === null || rawB === "" ? undefined : positiveInt(rawB);
        const loaded = loadFlow(dir);
        return json(200, diffRuns(loaded.dir, loaded.flow, stage, a, b));
      }
      case "POST /api/restore":
        return this.busy() ?? this.restore(await jsonBody(init));
      case "POST /api/run":
        return this.run(await jsonBody(init));
      case "POST /api/trust":
        return this.trust(await jsonBody(init));
      case "POST /api/stage":
        return this.busy() ?? this.addStage(await jsonBody(init));
      case "PUT /api/stage":
        return this.editBusy() ?? this.editStage(await jsonBody(init));
      case "DELETE /api/stage":
        return this.busy() ?? this.removeStage(q.get("id")?.trim() ?? "", q.get("force") === "1");
      case "PUT /api/flow":
        return this.editBusy() ?? this.editFlow(await jsonBody(init));
      default:
        return json(404, { error: "没有这个接口 / not found" });
    }
  }

  private plan(model: string | undefined): Response {
    const loaded = loadFlow(this.dir);
    try {
      const steps = planRunAll(loaded, model ? { model } : {});
      return json(200, {
        steps: steps.map((step) => ({ id: step.stage.id, name: step.stage.name, action: step.action, detail: step.detail ?? null, callsModel: step.callsModel, together: step.together ?? null })),
        concurrency: loaded.flow.concurrency ?? 2,
        modelCalls: planModelCalls(steps),
      });
    } catch (err) {
      if (err instanceof MissingInputsError) throw new HttpError(400, `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}`);
      throw err;
    }
  }

  private putInputs(body: Record<string, unknown>): Response {
    const loaded = loadFlow(this.dir);
    const defs = loaded.flow.inputs ?? {};
    const unknown = Object.keys(body).filter((key) => !Object.hasOwn(defs, key));
    if (unknown.length) return json(400, { error: `没有这个输入 / unknown input(s): ${unknown.join(", ")}` });
    try {
      loadFlowInputs(loaded.dir, loaded.flow, body);
    } catch (err) {
      if (err instanceof MissingInputsError) return json(400, { error: `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}` });
      return json(400, { error: err instanceof Error ? err.message : String(err) });
    }
    saveFlowInputs(loaded.dir, body);
    this.changed();
    return json(200, { ok: true, inputs: resolveFlowInputs(loaded.dir, loaded.flow) });
  }

  private getFile(raw: string | null): Response {
    const rel = cleanRel(raw);
    if (!rel) return json(400, { error: "路径不合法 / invalid path" });
    const flow = loadFlow(this.dir).flow;
    const abs = host().path.join(this.dir, rel);
    if (!isAllowed(flow, rel) || !host().exists(abs)) return json(404, { error: "找不到文件 / not found" });
    if (host().stat(abs).isDirectory()) return json(200, { files: listFiles(abs) }, { "X-Flowgit-Kind": "directory" });
    const bytes = host().readFile(abs);
    return new Response(bytes as unknown as BodyInit, { status: 200, headers: { "Content-Type": mediaType(rel, declaredType(flow, rel)) } });
  }

  private putFile(raw: string | null, bytes: Uint8Array): Response {
    const rel = cleanRel(raw);
    if (!rel) return json(400, { error: "路径不合法 / invalid path" });
    const flow = loadFlow(this.dir).flow;
    if (isEditablePrompt(flow, rel)) {
      const abs = host().path.join(this.dir, rel);
      if (host().exists(abs) && host().stat(abs).isDirectory()) return json(400, { error: "路径是文件夹 / path is a directory" });
      host().mkdir(host().path.dirname(abs), { recursive: true });
      host().writeFile(abs, bytes);
      this.changed();
      return json(200, { ok: true, path: rel });
    }
    const output = flow.stages.flatMap((stage) => stage.outputs).find((item) => !isDirOutput(item) && outputRel(item) === rel);
    const abs = host().path.join(this.dir, rel);
    if (!output || (host().exists(abs) && host().stat(abs).isDirectory())) {
      return json(403, { error: "只能修改阶段声明的产物文件 / only a stage's declared output file can be changed" });
    }
    if (isJsonMime(output.type)) {
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json(400, { error: "JSON 不合法，没有保存 / invalid JSON, not saved" });
      }
    }
    host().mkdir(host().path.dirname(abs), { recursive: true });
    host().writeFile(abs, bytes);
    this.changed();
    return json(200, { ok: true, path: rel });
  }

  private upload(stageId: string | null, name: string | null, bytes: Uint8Array): Response {
    if (!name || name.length > 255 || name === "." || name === ".." || /[/\\\0\u0000-\u001f\u007f]/.test(name) || name.includes("..") || /^[A-Za-z]:/.test(name)) {
      return json(400, { error: "文件名不合法 / invalid file name" });
    }
    if (!stageId) return json(400, { error: "缺少阶段 / missing stage" });
    const stage = loadFlow(this.dir).flow.stages.find((item) => item.id === stageId);
    if (!stage) return json(404, { error: "找不到阶段 / stage not found" });
    const dirs = stage.outputs.filter((output) => isDirOutput(output));
    if (stage.executor.type !== "human" || dirs.length !== 1) {
      return json(403, { error: "只能上传到人工阶段的文件夹产物 / uploads only go into a human stage's directory output" });
    }
    const rel = outputRel(dirs[0]!);
    const dirAbs = host().path.join(this.dir, rel);
    host().mkdir(dirAbs, { recursive: true });
    const dest = host().path.join(dirAbs, name);
    if (host().exists(dest) && host().stat(dest).isDirectory()) return json(400, { error: "已有同名文件夹 / a directory with that name already exists" });
    host().writeFile(dest, bytes);
    this.changed();
    return json(200, { ok: true, path: `${rel}/${name}` });
  }

  private thumb(stageId: string | null, outputParam: string | null): Response {
    if (!stageId || !outputParam) return json(400, { error: "缺少参数 / missing stage or output" });
    if (!/^\d+$/.test(outputParam)) return json(400, { error: "产物序号不合法 / invalid output index" });
    const flow = loadFlow(this.dir).flow;
    const stage = flow.stages.find((item) => item.id === stageId);
    if (!stage) return json(404, { error: "找不到阶段 / stage not found" });
    const output = stage.outputs[Number(outputParam)];
    if (!output) return json(404, { error: "找不到产物 / output not found" });
    const rel = outputRel(output);
    const ext = host().path.extname(rel).toLowerCase();
    // Images only: a browser has no ffmpeg for video frames or audio durations.
    if (isDirOutput(output) || !(IMAGE_EXT.has(ext) || output.type.toLowerCase().startsWith("image/"))) return new Response(null, { status: 204 });
    const abs = host().path.join(this.dir, rel);
    if (!host().exists(abs)) return json(404, { error: "找不到文件 / not found" });
    if (host().stat(abs).isDirectory()) return new Response(null, { status: 204 });
    return new Response(host().readFile(abs) as unknown as BodyInit, { status: 200, headers: { "Content-Type": mediaType(rel, output.type) } });
  }

  private restore(body: Record<string, unknown>): Response {
    if (typeof body.stage !== "string" || !body.stage.trim()) throw new HttpError(400, "缺少阶段 / missing stage");
    if (typeof body.n !== "number" || !Number.isInteger(body.n) || body.n < 1) throw new HttpError(400, "版本号必须是正整数 / version must be a positive integer");
    const { run, kept } = restoreStage(loadFlow(this.dir), body.stage.trim(), body.n);
    this.changed();
    return json(200, { ok: true, stage: run.stage, n: run.n, ...(kept ? { kept: kept.n } : {}) });
  }

  private async run(body: Record<string, unknown>): Promise<Response> {
    if (typeof body.stage !== "string" || !body.stage.trim()) throw new HttpError(400, "缺少阶段 / missing stage");
    const stage = body.stage.trim();
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const loaded = loadFlow(this.dir);
    if (stage !== "all" && !loaded.flow.stages.some((item) => item.id === stage)) return json(404, { error: `没有这个阶段 / unknown stage: ${stage}` });
    if (this.running) return json(409, { error: "已有运行在进行 / a run is already in progress" });
    const trust = trustState(loaded);
    if (trust.needed) return json(409, { error: new TrustNeededError(loaded, trust).message, trust: trustPayload(trust) });
    const target = stage === "all" ? undefined : loaded.flow.stages.find((item) => item.id === stage);
    const remote = target && needsComputer(target.executor) ? this.options.remote?.() : undefined;
    if (target && remote) return this.runRemote(remote, target, model);
    this.running = true;
    this.hub.history = [];
    const options = { ...(model ? { model } : {}), onEvent: (event: RunEvent) => this.publishRunEvent(event) };
    try {
      try {
        if (stage === "all") await runAll(loaded, options);
        else await runStage(loaded, stage, options);
        await this.flush();
        this.hub.publish("run:end", { ok: true });
        return json(200, { ok: true });
      } catch (err) {
        if (err instanceof TokenBudgetError) {
          const payload = { ok: true as const, budget: err.message };
          await this.flush();
          this.hub.publish("run:end", payload);
          return json(200, payload);
        }
        if (err instanceof HumanInputNeededError) {
          const payload = {
            ok: true as const,
            waiting: { stage: err.stage.id, name: err.stage.name, missing: err.missing, ...(err.instructions ? { instructions: err.instructions } : {}) },
          };
          await this.flush();
          this.hub.publish("run:end", payload);
          return json(200, payload);
        }
        const status = err instanceof MissingInputsError || err instanceof UpstreamNotReadyError ? 400 : err instanceof HttpError ? err.status : 500;
        const error =
          err instanceof MissingInputsError ? `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}` : err instanceof Error ? err.message : String(err);
        await this.flush();
        this.hub.publish("run:end", { ok: false, error });
        return json(status, { error });
      }
    } finally {
      this.running = false;
      this.changed();
    }
  }

  /** Hand one stage to the local board; its files come back through the folder both of them use. */
  private async runRemote(remote: RemoteRunner, stage: Stage, model: string | undefined): Promise<Response> {
    this.running = true;
    this.hub.history = [];
    const name = stage.name;
    this.hub.publish("stage:start", { stage: stage.id, name, executor: stage.executor.type });
    this.hub.publish("stage:log", { stage: stage.id, line: "交给电脑上的本机看板运行 / handed to the local board on this computer" });
    try {
      await this.flush();
      let answer: { status: number; body: Record<string, unknown> };
      try {
        answer = await remote.run(stage.id, model);
      } catch (err) {
        answer = { status: 502, body: { error: err instanceof Error ? err.message : String(err) } };
      }
      const { status, body } = answer;
      if (status === 200 && body.ok === true) {
        if (body.waiting || body.budget) this.hub.publish("run:end", body);
        else {
          this.hub.publish("stage:log", { stage: stage.id, line: "本机看板运行完了 / the local board finished" });
          this.hub.publish("run:end", { ok: true });
        }
        return json(200, body);
      }
      let error = typeof body.error === "string" ? body.error : `本机看板出错 / the local board failed (${status})`;
      // The local board keeps its own confirmations for copied flows.
      if (body.trust) error = `${error}\n请在本机看板上确认这个流程后再试 / Confirm this flow on the local board, then try again`;
      this.hub.publish("stage:error", { stage: stage.id, name, error });
      this.hub.publish("run:end", { ok: false, error });
      return json(status === 200 ? 500 : status, { error });
    } finally {
      this.running = false;
      this.changed();
    }
  }

  private publishRunEvent(event: RunEvent): void {
    const stage = event.stage.id;
    const name = event.stage.name;
    switch (event.type) {
      case "stage:start":
        this.hub.publish(event.type, { stage, name, executor: event.stage.executor.type });
        return;
      case "stage:skip":
        this.hub.publish(event.type, { stage, name, reason: event.reason });
        return;
      case "stage:log":
        this.hub.publish(event.type, { stage, line: event.line });
        return;
      case "stage:done":
        this.hub.publish(event.type, { stage, name, n: event.n });
        return;
      case "stage:error":
        this.hub.publish(event.type, { stage, name, error: event.error.message });
        return;
    }
  }

  private trust(body: Record<string, unknown>): Response {
    if (typeof body.fingerprint !== "string" || !body.fingerprint) throw new HttpError(400, "缺少 fingerprint / missing fingerprint");
    try {
      const state = trustFlow(loadFlow(this.dir), body.fingerprint);
      return json(200, { ok: true, reason: state.reason });
    } catch (err) {
      if (err instanceof TrustChangedError) return json(409, { error: err.message, trust: trustPayload(err.state) });
      throw err;
    }
  }

  private addStage(body: Record<string, unknown>): Response {
    if (typeof body.id !== "string" || !body.id.trim()) throw new HttpError(400, "缺少阶段 id / missing stage id");
    const spec = { ...body, id: body.id.trim() } as unknown as AddStageSpec;
    const { file, flow } = readFlowSource(this.dir);
    let next: Flow;
    try {
      next = addStage(flow, spec);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(400, { error: message, issues: [{ path: "/", message }] });
    }
    const creating = !spec.prompt && (spec.type === "llm" || spec.type === "agent") ? `prompts/${spec.id}.md` : undefined;
    const promptAbs = creating ? host().path.join(this.dir, creating) : undefined;
    const willCreate = Boolean(promptAbs && !host().exists(promptAbs));
    const errors = validateFlow(next, { dir: this.dir }).filter(
      (issue) => issue.level === "error" && !(willCreate && creating && issue.path.endsWith("/executor/prompt") && issue.message.includes(creating)),
    );
    if (errors.length) return rejectIssues(errors);
    if (willCreate && promptAbs) {
      host().mkdir(host().path.dirname(promptAbs), { recursive: true });
      host().writeFile(promptAbs, promptSkeleton(spec.id, Object.keys(flow.inputs ?? {})[0] ?? "name"));
    }
    writeFlowFile(file, next);
    this.changed();
    return json(200, { ok: true, id: spec.id, ...(willCreate && creating ? { prompt: creating } : {}) });
  }

  private removeStage(id: string, force: boolean): Response {
    if (!id) throw new HttpError(400, "缺少阶段 id / missing stage id");
    const { file, flow } = readFlowSource(this.dir);
    const dependents = flow.stages.filter((stage) => (stage.inputs ?? []).includes(id)).map((stage) => stage.id);
    let next: Flow;
    try {
      next = removeStage(flow, id, { force });
    } catch (err) {
      if (!force && dependents.length) {
        return json(409, {
          error: `这些阶段还把 "${id}" 当作输入：${dependents.join(", ")} / These stages still use "${id}" as an input: ${dependents.join(", ")}`,
          dependents,
        });
      }
      throw err;
    }
    const errors = validateFlow(next, { dir: this.dir }).filter((issue) => issue.level === "error");
    if (errors.length) return rejectIssues(errors);
    writeFlowFile(file, next);
    this.changed();
    return json(200, { ok: true, id });
  }

  private editStage(body: Record<string, unknown>): Response {
    let id: string;
    let patch;
    try {
      ({ id, patch } = stagePatchFromBody(body));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(err instanceof EditError ? err.status : 400, { error: message, issues: [{ path: "/", message }] });
    }
    const { file, flow } = readFlowSource(this.dir);
    let next: Flow;
    try {
      next = applyStageEdit(flow, id, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(err instanceof EditError ? err.status : 400, { error: message, issues: [{ path: "/", message }] });
    }
    const errors = validateFlow(next, { dir: this.dir }).filter((issue) => issue.level === "error");
    if (errors.length) return rejectIssues(errors);
    writeFlowFile(file, next);
    this.changed();
    return json(200, { ok: true, id });
  }

  private editFlow(body: Record<string, unknown>): Response {
    const result = putFlow(this.dir, body);
    if (result.status === 200) this.changed();
    return json(result.status, result.body);
  }
}
