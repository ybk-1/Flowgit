import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROVIDER, flowKeyEndpoint, flowKeyEndpointNote, missingKeyMessage, providerKeyState, resolveModel, type ResolvedProvider } from "../providers.js";
import { proxyHint } from "../proxy.js";
import type { ExecutorLlm, Flow, Stage } from "../types.js";
import { schemaFailure, schemaProblems, schemaTexts } from "../schema-check.js";
import { linkOutsideError, outputRel, readFlowText, truncate, wantsJson } from "../util.js";
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

// Kept here too, where they used to live.
export { ignoredProxyVar, proxyHint } from "../proxy.js";

/** Turn an SDK error into a bilingual one that says which provider failed and what to check. */
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
  } else if (e?.status === 402) {
    // DeepSeek and others answer 402 when the account has no balance left.
    lines.push("账户余额不足，到供应商的控制台充值后再试 / Insufficient balance: top up in the provider's console and try again");
  } else if (e?.status === 429) {
    lines.push(
      "请求太频繁，或者额度、用量上限用完了。已经自动重试过，稍后再试，或到供应商的控制台检查额度 / Rate-limited or out of quota. The request was already retried; try again later, or check your limits in the provider's console",
    );
  } else if (e?.status !== undefined && e.status >= 500) {
    lines.push("供应商那边暂时出错（已经自动重试过），稍后再试 / The provider returned a server error (already retried); try again later");
  } else if (e?.status === undefined && /connect|fetch failed|ECONNREFUSED|ENOTFOUND|timed out/i.test(`${e?.name} ${msg}`)) {
    lines.push("连不上这个地址，检查 baseUrl 和网络 / Could not reach it; check the baseUrl and your network");
    const hint = proxyHint(process.env, p.baseUrl);
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
    messages: [...(req.history ?? []), { role: "user", content: req.prompt }],
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
    messages: [{ role: "system", content: req.system }, ...(req.history ?? []), { role: "user", content: req.prompt }],
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

/**
 * Input and output token counts from either protocol's usage object
 * (Anthropic: input_tokens/output_tokens; OpenAI: prompt_tokens/completion_tokens).
 * Anthropic reports cached prompt tokens separately, so they are added to the input.
 */
export function usageTokens(usage: Record<string, unknown> | undefined): { input: number; output: number } | undefined {
  if (!usage) return undefined;
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  const has = (k: string) => typeof usage[k] === "number";
  if (has("input_tokens") || has("output_tokens")) {
    return { input: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"), output: n("output_tokens") };
  }
  if (has("prompt_tokens") || has("completion_tokens")) return { input: n("prompt_tokens"), output: n("completion_tokens") };
  return undefined;
}

/** Add two usage objects key by key (works for Anthropic and OpenAI shapes). */
export function sumUsage(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === "number") out[k] = (typeof out[k] === "number" ? (out[k] as number) : 0) + v;
    else if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Real call: pick the protocol of the request's provider. */
export const providerComplete: LlmComplete = (req) =>
  req.provider.protocol === "openai" ? openaiComplete(req) : anthropicComplete(req);

/**
 * Canned replies for tests and offline demos: FLOWGIT_LLM_MOCK_DIR/<stageId>.(md|txt|json)
 * is returned verbatim instead of calling a model.
 */
export function mockCompleteFromDir(mockDir: string): LlmComplete {
  return async (req) => {
    if (req.repair) {
      const repair = path.join(mockDir, `${req.stageId}.repair.json`);
      if (!fs.existsSync(repair)) {
        throw new Error(
          `FLOWGIT_LLM_MOCK_DIR 里没有阶段 "${req.stageId}" 的修复回复 / FLOWGIT_LLM_MOCK_DIR has no repair reply for stage "${req.stageId}" (expected ${req.stageId}.repair.json in ${mockDir})`,
        );
      }
      return { text: fs.readFileSync(repair, "utf8"), model: `mock:${path.basename(repair)}` };
    }
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
    const template = readFlowText(loaded.dir, ex.prompt);
    const outside = ctx.inputs.find((a) => a.outside);
    if (outside) throw linkOutsideError(outputRel(outside.output));
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
    const localEndpoint = flowKeyEndpoint(provider, loaded.dir);
    if (localEndpoint) ctx.log(`注意 / note: ${flowKeyEndpointNote(provider, localEndpoint)}`);
    if (req.effort && !provider.claudeApi) {
      ctx.log(`effort 只对 Anthropic 官方接口有效，这次不发送 / effort only applies to Anthropic's own API; not sent to ${provider.id}`);
    }
    const started = Date.now();
    const res = await resolveLlm(ctx.options)(req);
    const ms = Date.now() - started;
    if (res.model !== req.model) ctx.log(`实际由 ${res.model} 回复 / served by ${res.model}`);
    let repair: LlmResponse | undefined;
    // A reply that can't be used was still paid for: keep its usage on the error run.
    const unusable = (err: unknown, label: string, text: string): Error => {
      logUsage();
      return Object.assign(new Error(`${(err as Error).message}\n--- ${label} ---\n${truncate(text, 2000)}`), { params: params() });
    };
    let content = res.text;
    if (json) {
      try {
        content = extractJson(res.text);
      } catch (err) {
        throw unusable(err, "模型回复 / model reply", res.text);
      }
    }
    const abs = path.join(loaded.dir, outputRel(output));
    const write = (text: string) => {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`);
    };
    write(content);
    ctx.log(`已写入 / wrote ${outputRel(output)} (${content.length} chars, ${ms} ms)`);
    if (output.schema) {
      const problems = schemaProblems(loaded.dir, stage);
      if (problems.length) {
        ctx.log(`产物不符合 schema，自动再试一次 / output failed the schema, retrying once`);
        // The repair continues the same conversation: the model sees its instructions and its whole
        // reply, so it fixes only what failed instead of rewriting a truncated copy (or switching language).
        const repairPrompt = [
          "你上一次的回复不符合 JSON Schema。按下面的校验错误改好，输出改好后的完整 JSON，不要解释。内容和语言保持不变，只改不符合的地方。",
          "Your previous reply did not match the JSON Schema. Fix the validation errors below and reply with the complete corrected JSON only, no explanation. Keep the content and the language as they were; change only what fails.",
          "",
          "校验错误 / validation errors:",
          problems.slice(0, 5).map((p) => `${p.file} ${p.path}: ${p.message}`).join("\n"),
          "",
          "JSON Schema:",
          truncate(schemaTexts(loaded.dir, stage).join("\n\n"), 8000),
        ].join("\n");
        repair = await resolveLlm(ctx.options)({
          ...req,
          repair: true,
          history: [
            { role: "user", content: req.prompt },
            { role: "assistant", content: res.text },
          ],
          prompt: repairPrompt,
        });
        let repaired = repair.text;
        try {
          repaired = json ? extractJson(repair.text) : repair.text;
        } catch (err) {
          throw unusable(err, "修复回复 / repair reply", repair.text);
        }
        write(repaired);
        const again = schemaProblems(loaded.dir, stage);
        if (again.length) {
          // Both calls were paid for: keep their usage on the error run too.
          logUsage();
          throw Object.assign(schemaFailure(again), { params: params() });
        }
        ctx.log(`已按 schema 修好 / repaired to match the schema`);
      }
    }
    logUsage();
    return { params: params() };
    function logUsage(): void {
      const tokens = usageTokens(res.usage);
      if (tokens) ctx.log(`用量 / usage: ${tokens.input} 输入 input + ${tokens.output} 输出 output tokens`);
      const repairTokens = usageTokens(repair?.usage);
      if (repairTokens) ctx.log(`修复用量 / repair usage: ${repairTokens.input} 输入 input + ${repairTokens.output} 输出 output tokens`);
    }
    function params(): Record<string, unknown> {
      return {
        provider: provider.id,
        protocol: provider.protocol,
        model: repair?.model ?? res.model,
        requestedModel: req.model,
        // effort is only sent to Anthropic's own API, so only record it there
        ...(provider.claudeApi && req.effort ? { effort: req.effort } : {}),
        maxTokens: req.maxTokens,
        promptChars: req.prompt.length,
        stopReason: repair?.stopReason ?? res.stopReason,
        // Both calls count toward usage, so log and run-all totals include the repair.
        usage: repair ? sumUsage(res.usage, repair.usage) : res.usage,
        ...(repair ? { repairUsage: repair.usage ?? null } : {}),
        llmCalls: repair ? [res.usage ?? null, repair.usage ?? null] : [res.usage ?? null],
        durationMs: ms,
      };
    }
  },
};
