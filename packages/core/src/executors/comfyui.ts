/**
 * ComfyUI engine for a workflow stage. The stage's `file` is a workflow exported
 * as API format, submitted to a local ComfyUI server.
 *
 * Routes used here, and only these, from the official server route list
 * (POST /prompt, GET /history/{prompt_id}, GET /view, GET /system_stats):
 * https://docs.comfy.org/development/comfyui-server/comms_routes
 * How a client submits, polls history and downloads with GET /view:
 * https://docs.comfy.org/development/comfyui-server/api-examples
 * API-format JSON (File → Export Workflow (API), not the UI save):
 * https://docs.comfy.org/development/api-development/workflow-api-format
 * POST /prompt reads `prompt` and `client_id` in the official server:
 * https://github.com/Comfy-Org/ComfyUI/blob/master/server.py
 */
import { host, path } from "../host/current.js";
import type { HostEnv } from "../host/types.js";
import { needsComputerError } from "../host/memory.js";
import { errorStatus, isRetryableError, retryDelayMs, retryErrorLine, sleep, type RetryRecord } from "../retry.js";
import type { ComfyuiWorkflowParams, ExecutorWorkflow, Flow, Output, Stage, ValidationIssue } from "../types.js";
import { isDirOutput, isSafeRelative, isTextType, linkOutsideError, outputRel, readFlowText, staysInside } from "../util.js";
import { readEachField } from "./image.js";
import { renderTemplate } from "./llm.js";
import type { ExecContext, ExecResult } from "./types.js";

export const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
export const COMFYUI_URL_ENV = "FLOWGIT_COMFYUI_URL";
/** One workflow run, including the history poll and the downloads. */
export const DEFAULT_COMFYUI_TIMEOUT_SEC = 600;
/** doctor only: a dead server should not hold the command for the stage timeout. */
const PROBE_MS = 3_000;
/** How long to wait between history polls. The first poll happens immediately. */
const POLL_MS = 500;

const INPUT_KEY = /^([^.]+)\.inputs\.(.+)$/;

interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

interface ComfyFile {
  filename: string;
  subfolder: string;
  type: string;
}

interface HistoryEntry {
  outputs?: unknown;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

export function comfyuiParams(ex: ExecutorWorkflow): ComfyuiWorkflowParams {
  const raw = ex.params;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ComfyuiWorkflowParams;
}

/** The address as written: params.server, else FLOWGIT_COMFYUI_URL, else the local default. */
export function comfyuiServerText(params: ComfyuiWorkflowParams | undefined, env: HostEnv = {}): string {
  const fromParams = typeof params?.server === "string" ? params.server.trim() : "";
  const fromEnv = typeof env[COMFYUI_URL_ENV] === "string" ? env[COMFYUI_URL_ENV].trim() : "";
  return (fromParams || fromEnv || DEFAULT_COMFYUI_URL).replace(/\/+$/, "");
}

/** Parsed server URL. params.server wins over the environment variable. http and https only. */
export function comfyuiServer(params: ComfyuiWorkflowParams | undefined, env: HostEnv = {}): URL {
  const raw = comfyuiServerText(params, env);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ComfyUI 地址不是合法的 URL / ComfyUI server is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ComfyUI 只允许 http 和 https，收到 ${url.protocol} / ComfyUI server must be http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(`ComfyUI 地址不能带用户名或密码 / ComfyUI server must not include a username or password`);
  }
  return url;
}

export function reservedWorkflowMessage(engine: string): string {
  return `workflow 引擎 "${engine}" 还不能运行，目前只有 flowgit 和 comfyui / workflow engine "${engine}" cannot run yet; only "flowgit" and "comfyui" can`;
}

/** Why this JSON is not a ComfyUI API-format workflow, or undefined when it is. */
export function comfyuiWorkflowProblem(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return `工作流必须是 JSON 对象 / the workflow must be a JSON object`;
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.nodes)) {
    return `这是 ComfyUI 的界面存档，不是 API 格式。请用 File → Export Workflow (API) 重新导出 / this is a ComfyUI UI save, not API format. Export it again with File → Export Workflow (API)`;
  }
  const nodes = Object.entries(obj);
  if (!nodes.length) return `工作流里没有节点 / the workflow has no nodes`;
  for (const [id, node] of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return `节点 ${id} 不是对象 / node ${id} is not an object`;
    }
    const body = node as { class_type?: unknown; inputs?: unknown };
    if (typeof body.class_type !== "string" || !body.class_type) {
      return `节点 ${id} 没有 class_type。API 格式的每个节点都要有 class_type 和 inputs / node ${id} has no class_type. Each API-format node needs class_type and inputs`;
    }
    if (!body.inputs || typeof body.inputs !== "object" || Array.isArray(body.inputs)) {
      return `节点 ${id} 没有 inputs / node ${id} has no inputs`;
    }
  }
  return undefined;
}

function inputKeyProblem(spec: string): string | undefined {
  if (!INPUT_KEY.test(spec)) {
    return `键要写成 <节点>.inputs.<字段>，收到 "${spec}" / a key must look like <node>.inputs.<field>, got "${spec}"`;
  }
  return undefined;
}

/** Schema-level checks the JSON Schema cannot express (paths, the workflow file, each.from). */
export function comfyuiIssues(flow: Flow, stage: Stage, base: string, dir?: string): ValidationIssue[] {
  const ex = stage.executor as ExecutorWorkflow;
  const params = comfyuiParams(ex);
  const issues: ValidationIssue[] = [];
  if (stage.outputs.length !== 1) {
    issues.push({
      level: "error",
      path: `${base}/outputs`,
      message: `comfyui 阶段只能有一个产物（一个文件，或以 / 结尾的目录）/ a comfyui stage needs exactly one output (one file, or a directory whose path ends with /) (stage "${stage.id}")`,
    });
  }
  const fileAt = `${base}/executor/file`;
  if (!isSafeRelative(ex.file)) {
    issues.push({ level: "error", path: fileAt, message: `工作流路径必须留在流程目录内 / workflow path must stay inside the flow directory: "${ex.file}"` });
  } else if (dir) {
    const abs = path.join(dir, ex.file);
    if (!staysInside(dir, abs)) {
      issues.push({ level: "error", path: fileAt, message: linkOutsideError(ex.file).message });
    } else if (!host().exists(abs)) {
      issues.push({ level: "error", path: fileAt, message: `找不到工作流 / workflow file not found: ${ex.file}` });
    } else {
      let data: unknown;
      try {
        data = JSON.parse(host().readFile(abs, "utf8")) as unknown;
      } catch {
        issues.push({ level: "error", path: fileAt, message: `${ex.file} 不是合法的 JSON / ${ex.file} is not valid JSON` });
        data = undefined;
      }
      if (data !== undefined) {
        const problem = comfyuiWorkflowProblem(data);
        if (problem) issues.push({ level: "error", path: fileAt, message: problem });
      }
    }
  }
  if (params.server !== undefined) {
    try {
      comfyuiServer({ server: params.server }, {});
    } catch (err) {
      issues.push({ level: "error", path: `${base}/executor/params/server`, message: (err as Error).message });
    }
  }
  if (params.set && typeof params.set === "object" && !Array.isArray(params.set)) {
    for (const key of Object.keys(params.set)) {
      const problem = inputKeyProblem(key);
      if (problem) issues.push({ level: "error", path: `${base}/executor/params/set`, message: problem });
    }
  }
  if (params.each && typeof params.each === "object") {
    const target = inputKeyProblem(params.each.target);
    if (target) issues.push({ level: "error", path: `${base}/executor/params/each/target`, message: target });
    const from = params.each.from.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!isSafeRelative(from)) {
      issues.push({
        level: "error",
        path: `${base}/executor/params/each/from`,
        message: `each.from 必须是相对路径 / each.from must be a relative path: "${params.each.from}"`,
      });
    } else {
      const upstream = new Set(
        (stage.inputs ?? []).flatMap((dep) => flow.stages.find((item) => item.id === dep)?.outputs.map((out) => outputRel(out)) ?? []),
      );
      if (!upstream.has(from)) {
        issues.push({
          level: "error",
          path: `${base}/executor/params/each/from`,
          message: `each.from 必须是上游阶段的产物路径 / each.from must be an upstream output path: "${params.each.from}"`,
        });
      }
    }
    if (params.each.path.split(".").some((part) => part === "" || part === "." || part === "..")) {
      issues.push({
        level: "error",
        path: `${base}/executor/params/each/path`,
        message: `each.path 要用点号分开的字段名，例如 scenes / each.path must be dotted field names, e.g. scenes`,
      });
    }
  }
  return issues;
}

function endpoint(server: URL, route: string): URL {
  const base = server.href.endsWith("/") ? server.href : `${server.href}/`;
  return new URL(route, base);
}

/** GET /system_stats. True only when the server answers 2xx. A failure is not thrown. */
export async function comfyuiSystemStats(server: URL, timeoutMs = PROBE_MS): Promise<boolean> {
  try {
    const res = await host().fetch(endpoint(server, "system_stats"), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

function stageById(ctx: ExecContext, id: string): Stage {
  const stage = ctx.loaded.flow.stages.find((item) => item.id === id);
  if (!stage) throw new Error(`没有这个阶段 "${id}" / no stage "${id}"`);
  return stage;
}

function firstOutput(stage: Stage): Output {
  const output = stage.outputs[0];
  if (!output) throw new Error(`阶段 "${stage.id}" 没有产物 / stage "${stage.id}" has no output`);
  return output;
}

/** Same {{inputs.*}} and {{upstream.*}} placeholders as an MCP tool argument. */
function renderComfyString(template: string, ctx: ExecContext): string {
  const withInputs = renderTemplate(template, ctx.flowInputs);
  return withInputs
    .replace(/\{\{\s*upstream\.([A-Za-z0-9_-]+)\.content\s*\}\}/g, (_match, id: string) => {
      const output = firstOutput(stageById(ctx, id));
      if (isDirOutput(output)) {
        throw new Error(`{{upstream.${id}.content}} 不能读取文件夹 ${output.path} / {{upstream.${id}.content}} cannot read the directory ${output.path}`);
      }
      const rel = outputRel(output);
      const abs = path.join(ctx.loaded.dir, rel);
      if (!host().exists(abs)) throw new Error(`上游产物还不存在：${rel} / upstream output does not exist yet: ${rel}`);
      if (!isTextType(output.type, output.path)) {
        throw new Error(`{{upstream.${id}.content}} 只能读取文本，${rel} 不是文本 / {{upstream.${id}.content}} only reads text, and ${rel} is not text`);
      }
      return readFlowText(ctx.loaded.dir, rel);
    })
    .replace(/\{\{\s*upstream\.([A-Za-z0-9_-]+)\s*\}\}/g, (_match, id: string) => outputRel(firstOutput(stageById(ctx, id))));
}

function timeoutError(seconds: number): Error {
  return Object.assign(new Error(`超时（${seconds} 秒），已停止 / Timed out after ${seconds}s and was stopped`), { retryable: true });
}

function fail(message: string): Error {
  return Object.assign(new Error(message), { retryable: false });
}

function signalFor(deadline: number, timeoutSec: number): AbortSignal {
  const ms = deadline - Date.now();
  if (ms <= 0) throw timeoutError(timeoutSec);
  return AbortSignal.timeout(ms);
}

function messagesFrom(raw: unknown): string {
  if (!raw || typeof raw !== "object") return String(raw ?? "");
  const bag = raw as { errors?: unknown; message?: unknown };
  if (Array.isArray(bag.errors) && bag.errors.length) {
    return bag.errors
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const entry = item as { message?: unknown; details?: unknown };
          const message = typeof entry.message === "string" ? entry.message : "";
          const details = typeof entry.details === "string" && entry.details ? ` (${entry.details})` : "";
          return `${message}${details}`.trim() || JSON.stringify(item);
        }
        return JSON.stringify(item);
      })
      .join("; ");
  }
  if (typeof bag.message === "string" && bag.message) return bag.message;
  return JSON.stringify(raw);
}

function errorText(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const bag = error as { message?: unknown; details?: unknown; type?: unknown };
    const text = [bag.type, bag.message, bag.details].filter((item): item is string => typeof item === "string" && item.length > 0).join(": ");
    if (text) return text;
  }
  return "";
}

/** node_errors and the top-level error field, as one bilingual message. Empty node_errors is success. */
function nodeErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const bag = body as { node_errors?: unknown; error?: unknown };
  const nodes = bag.node_errors;
  if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
    const lines = Object.entries(nodes as Record<string, unknown>).map(
      ([id, raw]) => `ComfyUI 节点 ${id} 失败：${messagesFrom(raw)} / ComfyUI node ${id} failed: ${messagesFrom(raw)}`,
    );
    if (lines.length) return lines.join("\n");
  }
  const text = errorText(bag.error);
  if (text) return `ComfyUI 执行失败：${text} / ComfyUI execution failed: ${text}`;
  return undefined;
}

function executionFailure(entry: HistoryEntry): string | undefined {
  const status = entry.status;
  if (!status || status.status_str !== "error") return undefined;
  for (const message of status.messages ?? []) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue;
    const data = message[1] && typeof message[1] === "object" ? (message[1] as Record<string, unknown>) : {};
    const node = typeof data.node_id === "string" || typeof data.node_id === "number" ? String(data.node_id) : "";
    const text =
      typeof data.exception_message === "string" && data.exception_message
        ? data.exception_message
        : typeof data.exception_type === "string" && data.exception_type
          ? data.exception_type
          : "execution error";
    if (node) return `ComfyUI 节点 ${node} 失败：${text} / ComfyUI node ${node} failed: ${text}`;
    return `ComfyUI 执行失败：${text} / ComfyUI execution failed: ${text}`;
  }
  return `ComfyUI 执行失败 / ComfyUI execution failed`;
}

function finished(entry: HistoryEntry): boolean {
  const status = entry.status;
  if (status?.status_str === "success" || status?.status_str === "error" || status?.completed === true) return true;
  return !status && mediaOf(entry.outputs).length > 0;
}

function entryOf(body: unknown, id: string): HistoryEntry | undefined {
  if (!body || typeof body !== "object") return undefined;
  const bag = body as Record<string, unknown>;
  const found = bag[id];
  if (found && typeof found === "object") return found as HistoryEntry;
  if ("outputs" in bag || "status" in bag) return bag as HistoryEntry;
  return undefined;
}

function mediaOf(outputs: unknown): ComfyFile[] {
  if (!outputs || typeof outputs !== "object") return [];
  const files: ComfyFile[] = [];
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const bag = node as Record<string, unknown>;
    for (const key of ["images", "gifs", "videos"]) {
      const list = bag[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const file = item as { filename?: unknown; subfolder?: unknown; type?: unknown };
        if (typeof file.filename !== "string" || !file.filename || /[/\\]|\.\./.test(file.filename)) {
          throw fail(`ComfyUI 返回的文件名不合法 / ComfyUI returned an invalid filename`);
        }
        files.push({
          filename: file.filename,
          subfolder: typeof file.subfolder === "string" ? file.subfolder : "",
          type: typeof file.type === "string" && file.type ? file.type : "output",
        });
      }
    }
  }
  return files;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status >= 300 && res.status < 400) {
    throw fail(`ComfyUI 要求跳转，没有跟过去 / ComfyUI redirected and it was not followed`);
  }
  const text = await res.text();
  if (!res.ok) {
    let problem: string | undefined;
    if (text.trim()) {
      try {
        problem = nodeErrorMessage(JSON.parse(text) as unknown);
      } catch {
        problem = undefined;
      }
    }
    if (problem) throw Object.assign(new Error(problem), { retryable: false, status: res.status });
    const preview = text.trim().slice(0, 500);
    throw Object.assign(new Error(`ComfyUI 返回 ${res.status} / ComfyUI returned ${res.status}${preview ? `\n${preview}` : ""}`), {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw fail(`ComfyUI 返回的不是 JSON / ComfyUI response is not JSON`);
  }
}

async function request(url: URL, init: RequestInit, timeoutSec: number): Promise<unknown> {
  let res: Response;
  try {
    res = await host().fetch(url, init);
  } catch (err) {
    const error = err as Error;
    if (error.name === "TimeoutError" || error.name === "AbortError") throw timeoutError(timeoutSec);
    throw err;
  }
  return readBody(res);
}

function readWorkflow(dir: string, rel: string): Record<string, ComfyNode> {
  if (!isSafeRelative(rel)) throw fail(`工作流路径必须留在流程目录内 / workflow path must stay inside the flow directory: "${rel}"`);
  const abs = path.join(dir, rel);
  if (!staysInside(dir, abs)) throw linkOutsideError(rel);
  if (!host().exists(abs)) throw fail(`找不到工作流 / workflow file not found: ${rel}`);
  let data: unknown;
  try {
    data = JSON.parse(host().readFile(abs, "utf8")) as unknown;
  } catch {
    throw fail(`${rel} 不是合法的 JSON / ${rel} is not valid JSON`);
  }
  const problem = comfyuiWorkflowProblem(data);
  if (problem) throw fail(problem);
  return data as Record<string, ComfyNode>;
}

function applyInput(workflow: Record<string, ComfyNode>, spec: string, value: unknown): void {
  const problem = inputKeyProblem(spec);
  if (problem) throw fail(problem);
  const match = INPUT_KEY.exec(spec)!;
  const node = workflow[match[1]!];
  if (!node?.inputs || typeof node.inputs !== "object") {
    throw fail(`工作流里没有节点 ${match[1]} 的 inputs / the workflow has no inputs on node ${match[1]}`);
  }
  node.inputs[match[2]!] = value;
}

function fillWorkflow(base: Record<string, ComfyNode>, params: ComfyuiWorkflowParams, ctx: ExecContext, eachValue: string | undefined): Record<string, ComfyNode> {
  const workflow = structuredClone(base);
  for (const [key, value] of Object.entries(params.set ?? {})) {
    applyInput(workflow, key, typeof value === "string" ? renderComfyString(value, ctx) : value);
  }
  if (params.each && eachValue !== undefined) applyInput(workflow, params.each.target, eachValue);
  return workflow;
}

async function runOnce(
  server: URL,
  workflow: Record<string, ComfyNode>,
  timeoutSec: number,
  wait: (ms: number) => Promise<void>,
): Promise<{ promptId: string; files: { name: string; bytes: Uint8Array }[] }> {
  const deadline = Date.now() + timeoutSec * 1000;
  const clientId = globalThis.crypto?.randomUUID?.() ?? `flowgit-${Date.now().toString(36)}`;
  const queued = (await request(
    endpoint(server, "prompt"),
    {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: signalFor(deadline, timeoutSec),
    },
    timeoutSec,
  )) as { prompt_id?: unknown };
  const problem = nodeErrorMessage(queued);
  if (problem) throw fail(problem);
  const promptId = queued.prompt_id;
  if (typeof promptId !== "string" || !promptId) throw fail(`ComfyUI 没有返回 prompt_id / ComfyUI did not return a prompt_id`);

  let entry: HistoryEntry | undefined;
  for (;;) {
    const body = await request(
      endpoint(server, `history/${encodeURIComponent(promptId)}`),
      { method: "GET", redirect: "manual", signal: signalFor(deadline, timeoutSec) },
      timeoutSec,
    );
    const found = entryOf(body, promptId);
    if (found && finished(found)) {
      entry = found;
      break;
    }
    const pause = Math.min(POLL_MS, deadline - Date.now());
    if (pause <= 0) throw timeoutError(timeoutSec);
    await wait(pause);
  }
  const failed = executionFailure(entry);
  if (failed) throw fail(failed);
  const media = mediaOf(entry.outputs);
  if (!media.length) throw fail(`ComfyUI 没有产出文件 / ComfyUI produced no files`);
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const file of media) {
    const url = endpoint(server, "view");
    url.searchParams.set("filename", file.filename);
    url.searchParams.set("subfolder", file.subfolder);
    url.searchParams.set("type", file.type);
    files.push({ name: file.filename, bytes: await download(url, deadline, timeoutSec) });
  }
  return { promptId, files };
}

async function download(url: URL, deadline: number, timeoutSec: number): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await host().fetch(url, { method: "GET", redirect: "manual", signal: signalFor(deadline, timeoutSec) });
  } catch (err) {
    const error = err as Error;
    if (error.name === "TimeoutError" || error.name === "AbortError") throw timeoutError(timeoutSec);
    throw err;
  }
  if (res.status >= 300 && res.status < 400) throw fail(`ComfyUI 要求跳转，没有跟过去 / ComfyUI redirected and it was not followed`);
  if (!res.ok) {
    throw Object.assign(new Error(`ComfyUI 返回 ${res.status} / ComfyUI returned ${res.status}`), {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  return new Uint8Array(await res.arrayBuffer());
}

function extOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename);
  return (match?.[1] ?? "png").toLowerCase();
}

function writeFiles(ctx: ExecContext, files: { name: string; bytes: Uint8Array }[]): { file: string; bytes: number }[] {
  if (ctx.stage.outputs.length !== 1) {
    throw fail(`comfyui 阶段只能有一个产物 / a comfyui stage needs exactly one output ("${ctx.stage.id}" has ${ctx.stage.outputs.length})`);
  }
  if (!files.length) throw fail(`ComfyUI 没有产出文件 / ComfyUI produced no files`);
  const output = ctx.stage.outputs[0]!;
  if (isDirOutput(output)) {
    const rel = outputRel(output);
    const abs = path.join(ctx.loaded.dir, rel);
    if (host().exists(abs) && !staysInside(ctx.loaded.dir, abs)) throw linkOutsideError(rel);
    host().rm(abs, { recursive: true, force: true });
    host().mkdir(abs, { recursive: true });
    if (!staysInside(ctx.loaded.dir, abs)) throw linkOutsideError(rel);
    return files.map((file, index) => {
      const name = `${String(index + 1).padStart(3, "0")}.${extOf(file.name)}`;
      const dest = path.join(abs, name);
      if (!staysInside(abs, dest)) throw fail(`图片文件名不合法 / invalid picture name ${name}`);
      host().writeFile(dest, file.bytes);
      return { file: name, bytes: file.bytes.length };
    });
  }
  if (files.length !== 1) {
    throw fail(
      `这个阶段只有一个文件产物，但 ComfyUI 产出了 ${files.length} 个文件。改成以 / 结尾的目录，或让工作流只出一张 / this stage has one file output, but ComfyUI produced ${files.length} files. Use a directory output (path ending with /), or make the workflow produce one file`,
    );
  }
  const rel = outputRel(output);
  const abs = path.join(ctx.loaded.dir, rel);
  if (!staysInside(ctx.loaded.dir, abs)) throw linkOutsideError(rel);
  host().mkdir(path.dirname(abs), { recursive: true });
  host().writeFile(abs, files[0]!.bytes);
  return [{ file: path.basename(rel), bytes: files[0]!.bytes.length }];
}

/**
 * Run one ComfyUI workflow stage. Called from the workflow executor when engine is comfyui.
 * A browser host never calls the server: the page hands the stage to the local board.
 */
export async function runComfyui(ctx: ExecContext): Promise<ExecResult> {
  if (host().platform === "browser") throw needsComputerError("ComfyUI 阶段 / A ComfyUI stage");
  const ex = ctx.stage.executor as ExecutorWorkflow;
  const params = comfyuiParams(ex);
  const env = ctx.options.env ?? host().env;
  const server = comfyuiServer(params, env);
  const label = server.href.replace(/\/$/, "");
  const timeoutSec = params.timeoutSec ?? DEFAULT_COMFYUI_TIMEOUT_SEC;
  if (!Number.isInteger(timeoutSec) || timeoutSec < 1) {
    throw fail(`timeoutSec 必须是正整数 / timeoutSec must be a positive integer`);
  }
  const retries = Math.max(0, params.retries ?? 0);
  const base = readWorkflow(ctx.loaded.dir, ex.file);
  const eachValues = params.each
    ? readEachField(
        ctx.loaded.dir,
        params.each,
        `${params.each.path} 是空的，没有要运行的项 / ${params.each.path} is empty, so there is nothing to run`,
      )
    : [undefined];
  const wait = ctx.options.sleep ?? sleep;
  const random = ctx.options.random ?? Math.random;
  const retryLog: RetryRecord[] = [];
  const promptIds: string[] = [];
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const started = Date.now();
  ctx.log(`ComfyUI ${label}`);

  const stamp = (err: unknown): never => {
    if (retryLog.length) {
      const error = err as Error & { params?: Record<string, unknown> };
      error.params = { ...(error.params ?? {}), engine: "comfyui", server: label, file: ex.file, timeoutSec, retries: retryLog };
    }
    throw err;
  };

  for (let index = 0; index < eachValues.length; index++) {
    const workflow = fillWorkflow(base, params, ctx, eachValues[index]);
    ctx.log(`提交 ${index + 1}/${eachValues.length} / submitting ${index + 1}/${eachValues.length}`);
    let result!: { promptId: string; files: { name: string; bytes: Uint8Array }[] };
    for (let attempt = 0; ; attempt++) {
      try {
        result = await runOnce(server, workflow, timeoutSec, wait);
        break;
      } catch (err) {
        const error = err as Error & { retryable?: boolean; status?: number };
        let thrown: Error = error;
        if (error.retryable === undefined && error.status === undefined) {
          if (error.name === "TimeoutError" || error.name === "AbortError") thrown = timeoutError(timeoutSec);
          else {
            thrown = Object.assign(new Error(`调用 ComfyUI 失败 / ComfyUI call failed: ${error.message}`), {
              retryable: isRetryableError(error),
            });
          }
        }
        if (attempt >= retries || !isRetryableError(thrown)) stamp(thrown);
        const n = attempt + 1;
        const delayMs = retryDelayMs(n, random());
        const status = errorStatus(thrown);
        const rec: RetryRecord = { n, ...(status !== undefined ? { status } : {}), error: retryErrorLine(thrown), delayMs };
        retryLog.push(rec);
        ctx.log(`第 ${n}/${retries} 次重试，${delayMs} ms 后 / retry ${n}/${retries} in ${delayMs} ms: ${rec.error}`);
        await wait(delayMs);
      }
    }
    promptIds.push(result.promptId);
    saved.push(...result.files);
  }

  const images = writeFiles(ctx, saved);
  const rel = outputRel(ctx.stage.outputs[0]!);
  ctx.log(`已写入 / wrote ${images.length} 个文件到 / file(s) to ${rel}`);
  return {
    params: {
      engine: "comfyui",
      server: label,
      file: ex.file,
      timeoutSec,
      count: images.length,
      images,
      promptIds,
      ...(retryLog.length ? { retries: retryLog } : {}),
      durationMs: Date.now() - started,
    },
  };
}
