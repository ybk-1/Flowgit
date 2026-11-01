import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROVIDER, missingKeyMessage, providerKeyState, resolveModel, type ResolvedProvider } from "../providers.js";
import type { ExecutorLlm, Flow, Stage } from "../types.js";
import { outputRel, truncate, wantsJson } from "../util.js";
import type { ExecContext, ExecResult, InputArtifact, LlmComplete, LlmRequest, LlmResponse, StageExecutor } from "./types.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_MAX_TOKENS = 16_000;

/** Replace {{inputs.key}} with flow input values. Unknown keys become empty strings. */
export function renderTemplate(template: string, flowInputs: Record<string, unknown>): string {
  return template.replace(/\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = flowInputs[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function describeArtifact(a: InputArtifact): string {
  const head = `## 输入 / Input: ${a.stageName} (${outputRel(a.output)}, ${a.output.type})`;
  if (!a.exists) return `${head}\n\n(missing)`;
  if (a.isDir) {
    const files = a.files ?? [];
    const list = files.length ? files.map((f) => `- ${f}`).join("\n") : "(empty directory)";
    return `${head}\n\n${list}`;
  }
  if (a.text !== undefined) return `${head}\n\n${a.text}`;
  return `${head}\n\n(binary file, ${a.absPath})`;
}

/** The user message: rendered prompt file + every upstream artifact. */
export function buildPrompt(template: string, ctx: Pick<ExecContext, "inputs" | "flowInputs">): string {
  const parts = [renderTemplate(template, ctx.flowInputs).trim()];
  for (const a of ctx.inputs) parts.push(describeArtifact(a));
  return parts.join("\n\n---\n\n");
}

export function defaultSystem(flow: Flow, stage: Stage, json: boolean): string {
  const lines = [
    `You are executing stage "${stage.name}" (id: ${stage.id}) of the flow "${flow.name}".`,
    stage.description ? `Stage description: ${stage.description}` : "",
    `Respond with the artifact content only: no preamble, no explanation after it.`,
    json ? `The artifact is JSON. Respond with a single valid JSON document and nothing else.` : "",
    flow.language && flow.language !== "en" ? `Write in the flow's language (${flow.language}) unless the prompt says otherwise.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Pull a JSON document out of a model reply (handles ``` fences and surrounding prose). */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    // fall through: find the outermost bracket pair
  }
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("模型回复里没有 JSON / Model reply contains no JSON");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("模型回复里没有完整的 JSON / Model reply contains no complete JSON document");
  return JSON.stringify(JSON.parse(candidate.slice(start, end + 1)), null, 2);
}

/** Key for a provider, from the env var named by apiKeyEnv. Providers that need no key get a placeholder. */
export function providerKey(p: ResolvedProvider, env: NodeJS.ProcessEnv = process.env): string {
  if (!p.apiKeyEnv) return "flowgit-no-key";
  const key = env[p.apiKeyEnv];
  if (!key) throw new Error(missingKeyMessage(p));
  return key;
}

/** True for the default provider when it should keep reading ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN through the SDK, as before. */
function usesSdkCredentials(p: ResolvedProvider): boolean {
  return p.id === DEFAULT_PROVIDER && p.apiKeyEnv === "ANTHROPIC_API_KEY";
}

/** Turn an SDK error into a bilingual one that says which provider failed and what to check. */
/**
 * Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set, so behind a
 * proxy (or a VPN that only exports proxy variables) requests fail to connect.
 */
export function proxyHint(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const proxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].find((k) => env[k]);
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return undefined;
  return [
    `检测到 ${proxy}，但 Node 默认不走代理。设置 NODE_USE_ENV_PROXY=1 后重试（PowerShell：$env:NODE_USE_ENV_PROXY="1"；macOS/Linux：export NODE_USE_ENV_PROXY=1）。还是不行就升级到最新的 Node 22 或 24。`,
    `${proxy} is set, but Node ignores proxies by default. Set NODE_USE_ENV_PROXY=1 and try again (PowerShell: $env:NODE_USE_ENV_PROXY="1"; macOS/Linux: export NODE_USE_ENV_PROXY=1). If it still fails, update to the latest Node 22 or 24.`,
  ];
}

function requestError(err: unknown, p: ResolvedProvider): Error {
  const e = err as Error & { status?: number };
  const msg = e?.message ?? String(err);
  const lines = [`请求 ${p.id}（${p.baseUrl}）失败 / Request to ${p.id} (${p.baseUrl}) failed: ${msg}`];
  const authProblem = e?.status === 401 || e?.status === 403 || /authentication method|missing credentials/i.test(msg);
  if (authProblem) {
    if (usesSdkCredentials(p) && providerKeyState(p) === "unset") {
      lines.push(
        "没有找到 Claude API 凭据。请设置 ANTHROPIC_API_KEY，或用 FLOWGIT_LLM_MOCK_DIR=demo-replies 先试跑示例回复。",
        "No Claude credentials: set ANTHROPIC_API_KEY, or try the canned replies with FLOWGIT_LLM_MOCK_DIR=demo-replies.",
      );
    } else if (p.apiKeyEnv) {
      lines.push(`密钥被拒绝了，检查 ${p.apiKeyEnv} 是否正确 / The key was rejected; check ${p.apiKeyEnv}`);
    }
  } else if (e?.status === 404) {
    lines.push("检查模型名和 baseUrl 是否正确 / Check the model name and the baseUrl");
  } else if (e?.status === undefined && /connect|fetch failed|ECONNREFUSED|ENOTFOUND|timed out/i.test(`${e?.name} ${msg}`)) {
    lines.push("连不上这个地址，检查 baseUrl 和网络 / Could not reach it; check the baseUrl and your network");
    const hint = proxyHint();
    if (hint) lines.push(...hint);
  }
  return new Error(lines.join("\n"));
}

/**
 * Anthropic Messages request body. Claude-only parameters (server-side fallback,
 * effort) are sent only to Anthropic's own API; compatible third-party
 * endpoints get a plain messages request.
 */
export function anthropicBody(req: LlmRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
  };
  if (req.provider.claudeApi) {
    body.betas = ["server-side-fallback-2026-07-01"];
    body.fallbacks = "default";
    if (req.effort) body.output_config = { effort: req.effort };
  }
  return body;
}

/** OpenAI Chat Completions request body (streaming). */
export function openaiBody(req: LlmRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ],
    // OpenAI's own API replaced max_tokens with max_completion_tokens; compatible servers still use max_tokens.
    [req.provider.openaiApi ? "max_completion_tokens" : "max_tokens"]: req.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
}

function declined(detail?: string): Error {
  return new Error(`模型拒绝了这个请求 / Model declined the request${detail ? ` (${detail})` : ""}`);
}

function hitMaxTokens(req: LlmRequest): Error {
  return new Error(`模型输出超过了 maxTokens (${req.maxTokens})，请调大 executor.maxTokens / Model output hit maxTokens (${req.maxTokens}); raise executor.maxTokens`);
}

/** The parts of a Messages API reply Flowgit reads. */
interface AnthropicReply {
  content: { type: string; text?: string }[];
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage: unknown;
}

/** Anthropic Messages protocol: Anthropic's own API, or any compatible endpoint (GLM, ...). */
export const anthropicComplete: LlmComplete = async (req: LlmRequest): Promise<LlmResponse> => {
  const p = req.provider;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  let client: InstanceType<typeof Anthropic>;
  if (usesSdkCredentials(p)) {
    client = new Anthropic({ baseURL: p.baseUrl });
  } else {
    // An explicit key keeps the SDK from reading ANTHROPIC_API_KEY, so a Claude key never reaches another vendor.
    const key = providerKey(p);
    client = new Anthropic({ baseURL: p.baseUrl, apiKey: key, ...(p.claudeApi ? {} : { defaultHeaders: { "x-api-key": key } }) });
  }
  type Params = Parameters<typeof client.beta.messages.stream>[0];
  let msg: AnthropicReply;
  try {
    const body = anthropicBody(req) as unknown as Params;
    const stream = p.claudeApi ? client.beta.messages.stream(body) : client.messages.stream(body as never);
    msg = (await stream.finalMessage()) as unknown as AnthropicReply;
  } catch (err) {
    throw requestError(err, p);
  }
  if (msg.stop_reason === "refusal") {
    const details = msg.stop_details;
    throw declined(details ? `${details.category ?? "refusal"}: ${details.explanation ?? ""}` : undefined);
  }
  if (msg.stop_reason === "max_tokens") throw hitMaxTokens(req);
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  return {
    text,
    model: msg.model,
    stopReason: msg.stop_reason ?? undefined,
    usage: msg.usage as unknown as Record<string, unknown>,
  };
};

/** OpenAI Chat Completions protocol: OpenAI, OpenRouter, DeepSeek, Kimi, Qwen, Ollama, ... */
export const openaiComplete: LlmComplete = async (req: LlmRequest): Promise<LlmResponse> => {
  const p = req.provider;
  const key = providerKey(p);
  const { default: OpenAI } = await import("openai");
  // Explicit values keep the SDK from reading OPENAI_* variables meant for OpenAI itself.
  const client = new OpenAI({ apiKey: key, baseURL: p.baseUrl, ...(p.openaiApi ? {} : { organization: null, project: null }) });
  let text = "";
  let refusal = "";
  let model = req.model;
  let finish: string | undefined;
  let usage: Record<string, unknown> | undefined;
  try {
    const body = openaiBody(req) as unknown as Parameters<typeof client.chat.completions.create>[0] & { stream: true };
    const stream = await client.chat.completions.create(body);
    for await (const chunk of stream) {
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage as unknown as Record<string, unknown>;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) text += choice.delta.content;
      if (choice.delta?.refusal) refusal += choice.delta.refusal;
      if (choice.finish_reason) finish = choice.finish_reason;
      // Some compatible servers report usage on the last choice instead of the chunk.
      const choiceUsage = (choice as { usage?: Record<string, unknown> }).usage;
      if (choiceUsage && !usage) usage = choiceUsage;
    }
  } catch (err) {
    throw requestError(err, p);
  }
  if (finish === "content_filter" || (refusal && !text)) throw declined(refusal || finish);
  if (finish === "length") throw hitMaxTokens(req);
  return { text, model, stopReason: finish, usage };
};

/** Real call: pick the protocol of the request's provider. */
export const providerComplete: LlmComplete = (req) =>
  req.provider.protocol === "openai" ? openaiComplete(req) : anthropicComplete(req);

/**
 * Canned replies for tests and offline demos: FLOWGIT_LLM_MOCK_DIR/<stageId>.(md|txt|json)
 * is returned verbatim instead of calling a model.
 */
export function mockCompleteFromDir(mockDir: string): LlmComplete {
  return async (req) => {
    for (const ext of ["md", "txt", "json"]) {
      const file = path.join(mockDir, `${req.stageId}.${ext}`);
      if (fs.existsSync(file)) {
        return { text: fs.readFileSync(file, "utf8"), model: `mock:${path.basename(file)}` };
      }
    }
    throw new Error(`FLOWGIT_LLM_MOCK_DIR 里没有阶段 "${req.stageId}" 的回复 / FLOWGIT_LLM_MOCK_DIR has no reply for stage "${req.stageId}" (expected ${req.stageId}.md|txt|json in ${mockDir})`);
  };
}

export function resolveLlm(options: { llm?: LlmComplete }): LlmComplete {
  if (options.llm) return options.llm;
  const mockDir = process.env.FLOWGIT_LLM_MOCK_DIR;
  if (mockDir) return mockCompleteFromDir(path.resolve(mockDir));
  return providerComplete;
}

export const llmExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const { stage, loaded } = ctx;
    const ex = stage.executor as ExecutorLlm;
    const output = stage.outputs[0];
    const promptFile = path.join(loaded.dir, ex.prompt);
    const template = fs.readFileSync(promptFile, "utf8");
    const json = wantsJson(output.type, output.path);
    const spec = ctx.options.model ?? ex.model ?? process.env.FLOWGIT_MODEL ?? DEFAULT_MODEL;
    const { provider, model } = resolveModel(spec, loaded.dir);
    const req: LlmRequest = {
      stageId: stage.id,
      provider,
      model,
      system: ex.system ?? defaultSystem(loaded.flow, stage, json),
      prompt: buildPrompt(template, ctx),
      maxTokens: ex.maxTokens ?? DEFAULT_MAX_TOKENS,
      effort: ex.effort,
    };
    const label = provider.id === DEFAULT_PROVIDER ? model : `${provider.id}/${model}`;
    ctx.log(`调用 / calling ${label} (${provider.protocol}, prompt ${req.prompt.length} chars)`);
    if (req.effort && !provider.claudeApi) {
      ctx.log(`effort 只对 Anthropic 官方接口有效，这次不发送 / effort only applies to Anthropic's own API; not sent to ${provider.id}`);
    }
    const started = Date.now();
    const res = await resolveLlm(ctx.options)(req);
    const ms = Date.now() - started;
    if (res.model !== req.model) ctx.log(`实际由 ${res.model} 回复 / served by ${res.model}`);
    let content = res.text;
    if (json) {
      try {
        content = extractJson(res.text);
      } catch (err) {
        throw new Error(`${(err as Error).message}\n--- 模型回复 / model reply ---\n${truncate(res.text, 2000)}`);
      }
    }
    const abs = path.join(loaded.dir, outputRel(output));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content.endsWith("\n") ? content : `${content}\n`);
    ctx.log(`已写入 / wrote ${outputRel(output)} (${content.length} chars, ${ms} ms)`);
    return {
      params: {
        provider: provider.id,
        protocol: provider.protocol,
        model: res.model,
        requestedModel: req.model,
        // effort is only sent to Anthropic's own API, so only record it there
        ...(provider.claudeApi && req.effort ? { effort: req.effort } : {}),
        maxTokens: req.maxTokens,
        promptChars: req.prompt.length,
        stopReason: res.stopReason,
        usage: res.usage,
        durationMs: ms,
      },
    };
  },
};
