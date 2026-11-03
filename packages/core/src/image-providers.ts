/**
 * Image providers. A flow only names "<provider>/<model>"; the endpoint is a
 * preset and the key is read from the environment variable `apiKeyEnv` names.
 * Every baseUrl comes from the vendor's official docs, linked on the preset.
 */

import { proxyHint } from "./proxy.js";
import type { Flow, Stage, ValidationIssue } from "./types.js";
import { isSafeRelative, outputRel } from "./util.js";

export type ImageApi = "openai" | "zhipu" | "volcengine" | "dashscope";

export interface ImagePreset {
  id: string;
  /** Which request shape this vendor uses. */
  api: ImageApi;
  baseUrl: string;
  apiKeyEnv: string;
  docs: string;
  /** Shown by `flowgit providers`. The flow names the real model. */
  exampleModel: string;
}

/** Shown when a stage omits `size`. Vendors that use `*` get that conversion later. */
export const DEFAULT_IMAGE_SIZE = "1024x1024";

/** Per picture, including DashScope polling. Image jobs often outlast a 60s HTTP call. */
export const DEFAULT_IMAGE_TIMEOUT_SEC = 180;

/** DashScope is polled on this interval until the task finishes or `timeoutSec` elapses. */
export const IMAGE_POLL_MS = 2000;

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/**
 * Built-in image presets. Users do not put endpoints or keys in the flow.
 */
export const IMAGE_PRESETS: Readonly<Record<string, Omit<ImagePreset, "id">>> = {
  // https://developers.openai.com/api/reference/resources/images/methods/generate/
  // POST https://api.openai.com/v1/images/generations (base URL https://api.openai.com/v1).
  // GPT image models return base64 in data[].b64_json. gpt-image-1 was shut down on 2026-10-23
  // (https://developers.openai.com/api/docs/models/gpt-image-1); the same endpoint takes a newer id.
  openai: {
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    docs: "https://developers.openai.com/api/reference/resources/images/methods/generate/",
    exampleModel: "gpt-image-1",
  },
  // https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90
  // POST https://open.bigmodel.cn/api/paas/v4/images/generations. data[].url is the picture.
  // The key is the same Zhipu API key the glm chat preset reads (GLM_API_KEY).
  zhipu: {
    api: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "GLM_API_KEY",
    docs: "https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90",
    exampleModel: "cogview-4",
  },
  // https://www.volcengine.com/docs/82379/1541523
  // POST https://ark.cn-beijing.volces.com/api/v3/images/generations
  // Authorization: Bearer $ARK_API_KEY. data[].url or data[].b64_json.
  volcengine: {
    api: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "ARK_API_KEY",
    docs: "https://www.volcengine.com/docs/82379/1541523",
    exampleModel: "doubao-seedream-5-0-pro-260628",
  },
  // https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference
  // Async: POST .../image-synthesis (wan2.5 and older) or .../image-generation/generation (wan2.6),
  // header X-DashScope-Async: enable, then GET .../tasks/{task_id}.
  // The page says the shared Beijing host https://dashscope.aliyuncs.com still works
  // ("现有域名仍可正常使用"); workspace hosts are optional.
  dashscope: {
    api: "dashscope",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    docs: "https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference",
    exampleModel: "wan2.6-t2i",
  },
};

export function imagePresetList(): ImagePreset[] {
  return Object.entries(IMAGE_PRESETS).map(([id, preset]) => ({ id, ...preset }));
}

export function imageKeyState(preset: Pick<ImagePreset, "apiKeyEnv">, env: NodeJS.ProcessEnv = process.env): "set" | "unset" {
  return env[preset.apiKeyEnv] ? "set" : "unset";
}

/** Replace `1024x1024` with the `1024*1024` DashScope documents. Other strings pass through. */
export function dashscopeSize(size: string): string {
  const match = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(size.trim());
  return match ? `${match[1]}*${match[2]}` : size.trim();
}

function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

/**
 * Tests set FLOWGIT_IMAGE_BASE_URL to a local fake server. It replaces the preset
 * baseUrl for that run. A username or password in the URL is rejected.
 */
export function imageBaseUrl(preset: ImagePreset, env: NodeJS.ProcessEnv): string {
  const raw = env.FLOWGIT_IMAGE_BASE_URL?.trim();
  if (!raw) return preset.baseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`FLOWGIT_IMAGE_BASE_URL 不是合法的 URL / FLOWGIT_IMAGE_BASE_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`FLOWGIT_IMAGE_BASE_URL 只允许 http 和 https / FLOWGIT_IMAGE_BASE_URL must be http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(`FLOWGIT_IMAGE_BASE_URL 不能带用户名或密码 / FLOWGIT_IMAGE_BASE_URL must not include a username or password`);
  }
  return raw.replace(/\/+$/, "");
}

export interface ResolvedImageModel {
  preset: ImagePreset;
  /** Model id as the vendor knows it, without the "<provider>/" prefix. */
  model: string;
  baseUrl: string;
}

/** "zhipu/cogview-4" → preset + model. Only the first "/" splits. */
export function resolveImageModel(spec: string, env: NodeJS.ProcessEnv = process.env): ResolvedImageModel {
  const text = spec.trim();
  const slash = text.indexOf("/");
  const id = slash < 0 ? "" : text.slice(0, slash);
  const model = slash < 0 ? "" : text.slice(slash + 1);
  if (!id || !model) {
    throw new Error(
      `生图模型要写成 <provider>/<model>，例如 zhipu/cogview-4 / an image model must look like <provider>/<model>, e.g. zhipu/cogview-4, got ${JSON.stringify(spec)}`,
    );
  }
  const found = Object.hasOwn(IMAGE_PRESETS, id) ? IMAGE_PRESETS[id] : undefined;
  if (!found) {
    const known = Object.keys(IMAGE_PRESETS).join(", ");
    throw new Error(
      `不认识的生图 provider "${id}"（来自模型 "${spec}"）。可用的有：${known}。\n` +
        `Unknown image provider "${id}" (from model "${spec}"). Known: ${known}.`,
    );
  }
  const preset: ImagePreset = { id, ...found };
  return { preset, model, baseUrl: imageBaseUrl(preset, env) };
}

export interface ImageRequest {
  preset: ImagePreset;
  model: string;
  prompt: string;
  size: string;
  baseUrl: string;
  timeoutSec: number;
  env: NodeJS.ProcessEnv;
}

function timeoutError(timeoutSec: number): Error {
  return new Error(`超时（${timeoutSec} 秒），已停止 / Timed out after ${timeoutSec}s and was stopped`);
}

function requireKey(preset: ImagePreset, env: NodeJS.ProcessEnv): string {
  const key = env[preset.apiKeyEnv];
  if (!key) {
    const v = preset.apiKeyEnv;
    throw new Error(
      `缺少密钥：生图 provider "${preset.id}" 的密钥从环境变量 ${v} 读取，请先设置它。PowerShell：$env:${v}="..."；macOS/Linux：export ${v}=...\n` +
        `Missing key: image provider "${preset.id}" reads its key from the environment variable ${v}. Set it first. PowerShell: $env:${v}="..."; macOS/Linux: export ${v}=...`,
    );
  }
  return key;
}

function mapFetchError(err: unknown, timeoutSec: number, url: string, env: NodeJS.ProcessEnv): Error {
  const error = err as Error;
  if (error.name === "TimeoutError" || error.name === "AbortError") return timeoutError(timeoutSec);
  const hint = proxyHint(env, url);
  const cause = (error as Error & { cause?: { message?: string } }).cause?.message;
  return new Error(`调用生图接口失败 / image API call failed: ${error.message}${cause ? ` (${cause})` : ""}${hint?.length ? `\n${hint.join("\n")}` : ""}`);
}

interface HttpResult {
  status: number;
  text: string;
}

async function callJson(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown; deadline: number; timeoutSec: number; env: NodeJS.ProcessEnv },
): Promise<HttpResult> {
  const left = init.deadline - Date.now();
  if (left <= 0) throw timeoutError(init.timeoutSec);
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
      signal: AbortSignal.timeout(left),
    });
  } catch (err) {
    throw mapFetchError(err, init.timeoutSec, url, init.env);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `生图接口要求跳转到另一个地址，为了不把密钥带过去，没有跟着跳 / the image API redirected; it was not followed so the key stays put`,
    );
  }
  return { status: response.status, text: await response.text() };
}

function preview(text: string, key: string): string {
  return text.replaceAll(key, "***").replace(/\s+/g, " ").trim().slice(0, 300);
}

function assertOk(res: HttpResult, preset: ImagePreset, key: string): unknown {
  if (res.status === 401) {
    throw new Error(
      `供应商返回 401。请检查环境变量 ${preset.apiKeyEnv}。 / The provider returned 401. Check the environment variable ${preset.apiKeyEnv}.`,
    );
  }
  let json: unknown;
  try {
    json = res.text ? (JSON.parse(res.text) as unknown) : undefined;
  } catch {
    json = undefined;
  }
  if (res.status < 200 || res.status >= 300) {
    const text = preview(res.text, key);
    throw new Error(`生图接口返回 ${res.status} / image API returned ${res.status}${text ? `: ${text}` : ""}`);
  }
  if (json === undefined) throw new Error(`生图接口返回的不是 JSON / image API response is not JSON`);
  return json;
}

function decodeBase64(value: string): Buffer {
  const cleaned = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
  const buf = Buffer.from(cleaned, "base64");
  if (!buf.length) throw new Error(`返回的图片是空的 / the image data is empty`);
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`图片超过 30 MB，已停止 / image is over 30 MB and was stopped`);
  return buf;
}

async function downloadUrl(url: string, deadline: number, timeoutSec: number, env: NodeJS.ProcessEnv): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`图片地址不是合法的 URL / image url is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`图片只从 http 或 https 下载，收到 ${parsed.protocol} / image downloads only use http or https, got ${parsed.protocol}`);
  }
  const left = deadline - Date.now();
  if (left <= 0) throw timeoutError(timeoutSec);
  let response: Response;
  try {
    // No Authorization header: the URL is often a signed link on another host.
    response = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(left) });
  } catch (err) {
    throw mapFetchError(err, timeoutSec, parsed.href, env);
  }
  if (!response.ok) throw new Error(`下载图片失败 ${response.status} / image download failed with ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 30 MB，已停止 / image is over 30 MB and was stopped`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (!buf.length) throw new Error(`下载到的图片是空的 / downloaded image is empty`);
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`图片超过 30 MB，已停止 / image is over 30 MB and was stopped`);
  return buf;
}

interface PictureRef {
  url?: string;
  b64?: string;
}

function firstPicture(json: unknown): PictureRef {
  if (!json || typeof json !== "object") throw new Error(`生图接口返回的不是 JSON 对象 / image API did not return a JSON object`);
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error(`生图接口没有返回图片 / image API returned no image`);
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { url?: unknown; b64_json?: unknown };
    const url = typeof rec.url === "string" && rec.url ? rec.url : undefined;
    const b64 = typeof rec.b64_json === "string" && rec.b64_json ? rec.b64_json : undefined;
    if (url || b64) return { url, b64 };
  }
  throw new Error(`生图接口没有返回图片地址或 base64 / image API returned no image url or base64`);
}

async function pictureFromRef(ref: PictureRef, deadline: number, timeoutSec: number, env: NodeJS.ProcessEnv): Promise<Buffer> {
  if (ref.b64) return decodeBase64(ref.b64);
  if (ref.url) return downloadUrl(ref.url, deadline, timeoutSec, env);
  throw new Error(`生图接口没有返回图片地址或 base64 / image API returned no image url or base64`);
}

interface TaskView {
  id?: string;
  status: string;
  urls: string[];
  error?: string;
}

function readTask(json: unknown): TaskView {
  if (!json || typeof json !== "object") return { status: "", urls: [] };
  const output = (json as { output?: unknown }).output;
  if (!output || typeof output !== "object") return { status: "", urls: [] };
  const record = output as Record<string, unknown>;
  const status = typeof record.task_status === "string" ? record.task_status.toUpperCase() : "";
  const id = typeof record.task_id === "string" ? record.task_id : undefined;
  const urls: string[] = [];
  if (Array.isArray(record.results)) {
    for (const item of record.results) {
      if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") urls.push((item as { url: string }).url);
    }
  }
  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      const content = choice && typeof choice === "object" ? (choice as { message?: { content?: unknown } }).message?.content : undefined;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as { image?: unknown }).image === "string") urls.push((part as { image: string }).image);
      }
    }
  }
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = typeof record.message === "string" ? record.message : undefined;
  const error = [code, message].filter(Boolean).join(": ") || undefined;
  return { id, status, urls, error };
}

function dashscopeBody(model: string, prompt: string, size: string): { path: string; body: Record<string, unknown> } {
  const parameters: Record<string, unknown> = { size: dashscopeSize(size), n: 1, prompt_extend: false };
  // wan2.6 uses the newer messages API. wan2.5 and older keep input.prompt.
  // https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference
  if (model.startsWith("wan2.6")) {
    return {
      path: "services/aigc/image-generation/generation",
      body: { model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] }, parameters },
    };
  }
  return {
    path: "services/aigc/text2image/image-synthesis",
    body: { model, input: { prompt }, parameters },
  };
}

async function waitRemaining(ms: number, deadline: number, timeoutSec: number): Promise<void> {
  const left = deadline - Date.now();
  if (left <= 0) throw timeoutError(timeoutSec);
  await new Promise((resolve) => setTimeout(resolve, Math.min(ms, left)));
  if (Date.now() >= deadline) throw timeoutError(timeoutSec);
}

async function generateDashScope(req: ImageRequest, key: string, deadline: number): Promise<Buffer> {
  const { path, body } = dashscopeBody(req.model, req.prompt, req.size);
  const headers = {
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
    "X-DashScope-Async": "enable",
  };
  const created = assertOk(
    await callJson(joinUrl(req.baseUrl, path), { method: "POST", headers, body, deadline, timeoutSec: req.timeoutSec, env: req.env }),
    req.preset,
    key,
  );
  let task = readTask(created);
  const taskId = task.id;
  if (!taskId) throw new Error(`生图接口没有返回 task_id / image API returned no task_id`);
  // First poll is immediate. Later polls wait IMAGE_POLL_MS, and the whole call stops at timeoutSec.
  while (task.status === "PENDING" || task.status === "RUNNING") {
    const polled = assertOk(
      await callJson(joinUrl(req.baseUrl, `tasks/${encodeURIComponent(taskId)}`), {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        deadline,
        timeoutSec: req.timeoutSec,
        env: req.env,
      }),
      req.preset,
      key,
    );
    const next = readTask(polled);
    task = { ...next, id: next.id ?? task.id };
    if (task.status === "PENDING" || task.status === "RUNNING") await waitRemaining(IMAGE_POLL_MS, deadline, req.timeoutSec);
  }
  if (task.status !== "SUCCEEDED") {
    const why = task.error || "没有说明原因";
    const whyEn = task.error || "no reason given";
    throw new Error(`生图任务 ${task.status || "失败"}：${why} / image task ${task.status || "failed"}: ${whyEn}`);
  }
  const url = task.urls[0];
  if (!url) throw new Error(`任务成功但没有图片地址 / task succeeded but returned no image url`);
  return downloadUrl(url, deadline, req.timeoutSec, req.env);
}

function volcengineBody(model: string, prompt: string, size: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt, size, response_format: "url" };
  // output_format is documented for Seedream 5.0. Older model ids on the same endpoint are not listed for it.
  if (/seedream-5/i.test(model) || /5-0/.test(model)) body.output_format = "png";
  return body;
}

/** One picture. The stage loops when it needs several. Keys are never written to a file or a log. */
export async function generateImage(req: ImageRequest): Promise<Buffer> {
  const key = requireKey(req.preset, req.env);
  const deadline = Date.now() + req.timeoutSec * 1000;
  if (req.preset.api === "dashscope") return generateDashScope(req, key, deadline);
  const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json" };
  let body: Record<string, unknown>;
  if (req.preset.api === "openai") {
    body = { model: req.model, prompt: req.prompt, n: 1, size: req.size, output_format: "png" };
  } else if (req.preset.api === "volcengine") {
    body = volcengineBody(req.model, req.prompt, req.size);
  } else {
    body = { model: req.model, prompt: req.prompt, size: req.size };
  }
  const json = assertOk(
    await callJson(joinUrl(req.baseUrl, "images/generations"), {
      method: "POST",
      headers,
      body,
      deadline,
      timeoutSec: req.timeoutSec,
      env: req.env,
    }),
    req.preset,
    key,
  );
  return pictureFromRef(firstPicture(json), deadline, req.timeoutSec, req.env);
}

/** Extra validation for an image stage, besides the prompt file check in load.ts. */
export function imageExecutorIssues(flow: Flow, stage: Stage, base: string): ValidationIssue[] {
  const ex = stage.executor;
  if (ex.type !== "image") return [];
  const issues: ValidationIssue[] = [];
  if (stage.outputs.length !== 1 || !stage.outputs[0]!.path.endsWith("/")) {
    issues.push({
      level: "error",
      path: `${base}/outputs`,
      message: `image 阶段只能有一个以 / 结尾的目录产物 / an image stage needs exactly one directory output whose path ends with / (stage "${stage.id}")`,
    });
  }
  const slash = ex.model.indexOf("/");
  const id = slash < 0 ? "" : ex.model.slice(0, slash);
  const model = slash < 0 ? "" : ex.model.slice(slash + 1);
  if (!id || !model) {
    issues.push({
      level: "error",
      path: `${base}/executor/model`,
      message: `生图模型要写成 <provider>/<model>，例如 zhipu/cogview-4 / an image model must look like <provider>/<model>, e.g. zhipu/cogview-4`,
    });
  } else if (!Object.hasOwn(IMAGE_PRESETS, id)) {
    const known = Object.keys(IMAGE_PRESETS).join(", ");
    issues.push({
      level: "error",
      path: `${base}/executor/model`,
      message: `不认识的生图 provider "${id}"。可用的有：${known} / unknown image provider "${id}". Known: ${known}`,
    });
  }
  if (ex.each && ex.n !== undefined && ex.n !== 1) {
    issues.push({
      level: "error",
      path: `${base}/executor/n`,
      message: `each 已经按数组逐张生成，n 只能是 1 或不写 / each generates one image per item, so n must be 1 or omitted`,
    });
  }
  if (ex.each) {
    const from = ex.each.from.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!isSafeRelative(from)) {
      issues.push({
        level: "error",
        path: `${base}/executor/each/from`,
        message: `each.from 必须是相对路径 / each.from must be a relative path: "${ex.each.from}"`,
      });
    } else {
      const upstream = new Set(
        (stage.inputs ?? []).flatMap((dep) => flow.stages.find((item) => item.id === dep)?.outputs.map((out) => outputRel(out)) ?? []),
      );
      if (!upstream.has(from)) {
        issues.push({
          level: "error",
          path: `${base}/executor/each/from`,
          message: `each.from 必须是上游阶段的产物路径 / each.from must be an upstream output path: "${ex.each.from}"`,
        });
      }
    }
    if (ex.each.path.split(".").some((part) => part === "" || part === "." || part === "..")) {
      issues.push({
        level: "error",
        path: `${base}/executor/each/path`,
        message: `each.path 要用点号分开的字段名，例如 shots / each.path must be dotted field names, e.g. shots`,
      });
    }
  }
  return issues;
}
