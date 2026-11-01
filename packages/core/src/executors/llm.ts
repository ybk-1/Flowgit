import fs from "node:fs";
import path from "node:path";
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

/** Real call through the Anthropic SDK. Reads credentials from the environment. */
export const anthropicComplete: LlmComplete = async (req: LlmRequest): Promise<LlmResponse> => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  let client: InstanceType<typeof Anthropic>;
  try {
    client = new Anthropic();
  } catch (err) {
    throw new Error(
      `${(err as Error).message}\n` +
        "没有找到 Claude API 凭据。请设置 ANTHROPIC_API_KEY，或用 FLOWGIT_LLM_MOCK_DIR=demo-replies 先试跑示例回复。\n" +
        "No Claude credentials: set ANTHROPIC_API_KEY, or try the canned replies with FLOWGIT_LLM_MOCK_DIR=demo-replies.",
    );
  }
  const stream = client.beta.messages.stream({
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") {
    const details = msg.stop_details;
    throw new Error(`模型拒绝了这个请求 / Model declined the request${details ? ` (${details.category ?? "refusal"}: ${details.explanation ?? ""})` : ""}`);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error(`模型输出超过了 maxTokens (${req.maxTokens})，请调大 executor.maxTokens / Model output hit maxTokens (${req.maxTokens}); raise executor.maxTokens`);
  }
  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    model: msg.model,
    stopReason: msg.stop_reason ?? undefined,
    usage: msg.usage as unknown as Record<string, unknown>,
  };
};

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
  return anthropicComplete;
}

export const llmExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const { stage, loaded } = ctx;
    const ex = stage.executor as ExecutorLlm;
    const output = stage.outputs[0];
    const promptFile = path.join(loaded.dir, ex.prompt);
    const template = fs.readFileSync(promptFile, "utf8");
    const json = wantsJson(output.type, output.path);
    const req: LlmRequest = {
      stageId: stage.id,
      model: ctx.options.model ?? ex.model ?? process.env.FLOWGIT_MODEL ?? DEFAULT_MODEL,
      system: ex.system ?? defaultSystem(loaded.flow, stage, json),
      prompt: buildPrompt(template, ctx),
      maxTokens: ex.maxTokens ?? DEFAULT_MAX_TOKENS,
      effort: ex.effort,
    };
    ctx.log(`调用 / calling ${req.model} (prompt ${req.prompt.length} chars)`);
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
        model: res.model,
        requestedModel: req.model,
        effort: req.effort,
        maxTokens: req.maxTokens,
        promptChars: req.prompt.length,
        stopReason: res.stopReason,
        usage: res.usage,
        durationMs: ms,
      },
    };
  },
};
