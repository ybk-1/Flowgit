// Shared module: files, hashing and env go through the Host. No node: imports.

import { extractJson, DEFAULT_MODEL, providerComplete } from "./executors/llm.js";
import type { LlmComplete, LlmRequest } from "./executors/types.js";
import { host, path } from "./host/current.js";
import { FLOW_FILE, FLOW_MD_FILE, findFlowFile, readFlowFile, renderFlowText, validateFlow, writeFlowFile } from "./load.js";
import { planModelCalls, planRunAll, type PlanStep } from "./plan.js";
import { resolveModel } from "./providers.js";
import type { Flow, LoadedFlow, ValidationIssue } from "./types.js";
import { isSafeRelative } from "./util.js";

/** Printed on a generated script or agent stage: it runs a command on this computer. */
export const RUNS_ON_COMPUTER = "会在你的电脑上运行命令 / runs commands on your computer";

const PLAN_STAGE = "generate-plan";
const FLOW_STAGE = "generate-flow";
const MAX_REPAIRS = 3;
const MAX_DESCRIPTION = 8_000;
const SYSTEM = "You generate Flowgit flow files. Reply with one JSON object and nothing else. No Markdown fence and no commentary.";

const STAGE_ID = /^[a-z][a-z0-9_-]*$/;
const FLOW_ID = /^[a-z][a-z0-9-]{0,63}$/;
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INPUT_TYPES = new Set(["string", "text", "number", "boolean", "file"]);
const AGENTS = new Set(["claude-code", "codex", "cursor", "gemini", "custom"]);

export interface GenerateFile {
  /** Path relative to the flow directory. */
  path: string;
  text: string;
}

export interface GeneratePlanStep {
  id: string;
  name: string;
  executor: string;
  action: string;
  detail?: string;
  /** Script and agent stages run a command on this computer. */
  runsCommands: boolean;
}

export interface GeneratePreview {
  flow: Flow;
  /** Prompt path → text, for llm and agent stages. */
  prompts: Record<string, string>;
  files: GenerateFile[];
  plan: GeneratePlanStep[];
  runsCommands: boolean;
  modelCalls: number;
  /** `flow.json` or `flow.md`. */
  flowFile: string;
}

export type GenerateResult = ({ ok: true; written: boolean } & GeneratePreview) | { ok: false; errors: string[] };

export interface GenerateOptions {
  /** Directory the flow is written into. Created when `write` is set. */
  dir: string;
  /** `<provider>/<model>`. Default is the llm stage default, or `FLOWGIT_MODEL`. */
  model?: string;
  /** Language of the flow and its prompts. Omit to let the description decide. */
  language?: "zh" | "en";
  /** Write `flow.md` instead of `flow.json`. */
  md?: boolean;
  /** Model call. Tests pass one; otherwise `FLOWGIT_LLM_MOCK_DIR` or the real provider is used. */
  llm?: LlmComplete;
  /** Write the files. When omitted or false, nothing is written. */
  write?: boolean;
}

interface Allows {
  script: boolean;
  agent: boolean;
}

interface PlanInput {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
}

interface PlanStage {
  id: string;
  name: string;
  description?: string;
  executor: "human" | "llm" | "script" | "agent";
  dependsOn: string[];
  outputs: { type: string; path: string }[];
  instructions?: string;
  run?: string;
  agent?: string;
}

interface StagePlan {
  name: string;
  description?: string;
  id?: string;
  language?: string;
  inputs: PlanInput[];
  stages: PlanStage[];
}

type Doc = { flow: Record<string, unknown>; prompts: Record<string, string> };

/**
 * True when the description explicitly asks for a script or an agent.
 * A screenplay (视频脚本, "video script") does not count: that is a document, not a command.
 */
export function descriptionAllows(description: string): Allows {
  const script =
    /用脚本|脚本阶段|脚本检查|写(?:一)?个脚本来|写脚本来|运行命令|跑命令|在电脑上运行|命令行/.test(description) ||
    /\bscript\s+stage\b/i.test(description) ||
    /\brun(?:s|ning)?\s+(?:a\s+|the\s+)?(?:script|commands?)\b/i.test(description) ||
    /\bscript\s+(?:that\s+|to\s+)?(?:check|checks|run|runs|execute|executes)\b/i.test(description) ||
    /\bshell(?:\s+script)?\b/i.test(description) ||
    /\bnode\s+\S+\.(?:mjs|cjs|js)\b/i.test(description);
  const agent = /\bagent\b/i.test(description) || /智能体/.test(description);
  return { script, agent };
}

/** Where `packages/core/prompts/<name>` is, next to this file's source or its compiled output. */
export function generatePromptFile(name: string): string {
  return path.join(path.dirname(modulePath()), "..", "prompts", name);
}

/**
 * Canned replies for `flowgit new`: `generate-plan.json`, `generate-flow.json`,
 * then `generate-repair-1.json` and so on. A missing file throws a bilingual error.
 */
export function generateMockComplete(mockDir: string): LlmComplete {
  let repairs = 0;
  const root = path.resolve(mockDir);
  return async (req) => {
    const name = req.repair ? `generate-repair-${++repairs}.json` : req.stageId === PLAN_STAGE ? "generate-plan.json" : "generate-flow.json";
    const file = path.join(root, name);
    if (!host().exists(file)) {
      throw new Error(`FLOWGIT_LLM_MOCK_DIR 里没有 ${name} / FLOWGIT_LLM_MOCK_DIR has no ${name} (looked in ${root})`);
    }
    return { text: host().readFile(file, "utf8"), model: `mock:${name}` };
  };
}

/**
 * Turn one sentence into a flow. Round one is a stage plan, round two is `flow.json`
 * (or `flow.md`) plus a prompt file per llm stage. Validation errors go back to the
 * model at most three times. Nothing is written unless `opts.write` is set, and a
 * failed repair writes nothing.
 */
export async function generateFlow(description: string, opts: GenerateOptions): Promise<GenerateResult> {
  try {
    return await generateFlowInner(description, opts);
  } catch (err) {
    return { ok: false, errors: errorLines(err) };
  }
}

/**
 * Write a preview into `dir`. Refuses when a flow file or one of the prompt files is already
 * there, and deletes anything it wrote if the result does not validate.
 */
export function writeGeneratedFlow(dir: string, preview: Pick<GeneratePreview, "flow" | "prompts" | "flowFile">): GenerateFile[] {
  const root = path.resolve(dir);
  const existing = existingFlow(root);
  if (existing) {
    throw new Error(`${existing} 已存在，没有覆盖 / already exists; nothing was overwritten`);
  }
  const flowName = preview.flowFile === FLOW_MD_FILE ? FLOW_MD_FILE : FLOW_FILE;
  const prompts = referencedPrompts(preview.flow, preview.prompts);
  const targets: { abs: string; text: string; flow?: boolean }[] = [];
  for (const [rel, text] of Object.entries(prompts)) {
    const abs = inside(root, rel);
    // A file already in the folder is the person's own: never overwrite it (and never delete it on a failed write).
    if (host().exists(abs)) throw new Error(`${rel} 已存在，没有覆盖 / ${rel} already exists; nothing was overwritten`);
    targets.push({ abs, text });
  }
  const flowAbs = path.join(root, flowName);
  targets.push({ abs: flowAbs, text: renderFlowText(preview.flow, flowName), flow: true });
  host().mkdir(root, { recursive: true });
  const created: string[] = [];
  try {
    for (const target of targets) {
      host().mkdir(path.dirname(target.abs), { recursive: true });
      if (target.flow) writeFlowFile(target.abs, preview.flow);
      else host().writeFile(target.abs, target.text);
      created.push(target.abs);
    }
    const issues = validateFlow(readFlowFile(flowAbs), { dir: root }).filter((issue) => issue.level === "error");
    if (issues.length) throw new Error(issues.map(formatIssue).join("\n"));
  } catch (err) {
    for (const abs of created.reverse()) host().rm(abs, { force: true });
    throw err;
  }
  return renderedFiles(preview.flow, prompts, flowName);
}

async function generateFlowInner(description: string, opts: GenerateOptions): Promise<GenerateResult> {
  const text = description.trim();
  if (!text) return fail(["请用一句话描述这个流程 / describe the flow in one sentence"]);
  if (text.length > MAX_DESCRIPTION) {
    return fail([`描述太长了（最多 ${MAX_DESCRIPTION} 个字符）/ the description is too long (${MAX_DESCRIPTION} characters at most)`]);
  }
  if (opts.language && opts.language !== "zh" && opts.language !== "en") {
    return fail([`语言只能是 zh 或 en，收到 "${opts.language}" / language must be zh or en, got "${opts.language}"`]);
  }
  const dir = path.resolve(opts.dir);
  if (opts.write) {
    const existing = existingFlow(dir);
    if (existing) return fail([`${existing} 已存在，没有覆盖 / already exists; nothing was overwritten`]);
  }
  const allows = descriptionAllows(text);
  const llm = resolveGenerateLlm(opts.llm);
  const modelSpec = opts.model?.trim() || host().env.FLOWGIT_MODEL || DEFAULT_MODEL;
  const languageLine = opts.language ?? "match the description";
  const executors = executorList(allows);

  const planReply = await complete(llm, {
    dir,
    modelSpec,
    stageId: PLAN_STAGE,
    prompt: fill(loadPrompt("generate-plan.md"), { description: text, language: languageLine, executors }),
  });
  const parsedPlan = parsePlan(planReply.text, allows);
  if (!parsedPlan.ok) return fail(parsedPlan.errors);

  const flowPrompt = fill(loadPrompt("generate-flow.md"), {
    description: text,
    language: languageLine,
    executors,
    plan: JSON.stringify(parsedPlan.plan, null, 2),
  });
  const repairTemplate = loadPrompt("generate-repair.md");
  let history: { role: "user" | "assistant"; content: string }[] = [];
  let prompt = flowPrompt;
  let repair = false;
  let repairs = 0;
  let doc: Doc | undefined;
  let errors: string[] = [];
  for (;;) {
    const reply = await complete(llm, { dir, modelSpec, stageId: FLOW_STAGE, prompt, repair, history: history.length ? history : undefined });
    history = [...history, { role: "user", content: prompt }, { role: "assistant", content: reply.text }];
    const interpreted = interpret(reply.text, allows, opts.language ?? (/\p{Script=Han}/u.test(text) ? "zh" : "en"), opts.language);
    if (interpreted.doc) {
      doc = interpreted.doc;
      break;
    }
    errors = interpreted.errors;
    if (repairs >= MAX_REPAIRS) return fail(errors);
    repairs += 1;
    repair = true;
    prompt = fill(repairTemplate, { errors: errors.join("\n") });
  }

  const flow = doc.flow as unknown as Flow;
  const prompts = referencedPrompts(flow, doc.prompts);
  const flowFile = opts.md ? FLOW_MD_FILE : FLOW_FILE;
  const preview = previewOf(dir, flow, prompts, flowFile, opts.model);
  if (!opts.write) return { ok: true, written: false, ...preview };
  writeGeneratedFlow(dir, preview);
  return { ok: true, written: true, ...preview };
}

function fail(errors: string[]): GenerateResult {
  return { ok: false, errors };
}

function resolveGenerateLlm(explicit: LlmComplete | undefined): LlmComplete {
  if (explicit) return explicit;
  const mockDir = host().env.FLOWGIT_LLM_MOCK_DIR;
  if (mockDir) return generateMockComplete(mockDir);
  return providerComplete;
}

async function complete(
  llm: LlmComplete,
  spec: { dir: string; modelSpec: string; stageId: string; prompt: string; repair?: boolean; history?: LlmRequest["history"] },
): Promise<{ text: string }> {
  const { provider, model } = resolveModel(spec.modelSpec, spec.dir);
  return llm({
    stageId: spec.stageId,
    provider,
    model,
    system: SYSTEM,
    prompt: spec.prompt,
    maxTokens: 16_000,
    ...(spec.repair ? { repair: true } : {}),
    ...(spec.history ? { history: spec.history } : {}),
  });
}

function interpret(
  text: string,
  allows: Allows,
  skeletonLanguage: string,
  forceLanguage: "zh" | "en" | undefined,
): { errors: string[]; doc?: Doc } {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch (err) {
    return { errors: [`回复不是 JSON / the reply is not JSON: ${(err as Error).message}`] };
  }
  const doc = normalizeDocument(value, allows, skeletonLanguage);
  if ("error" in doc) return { errors: [doc.error] };
  if (forceLanguage) doc.flow.language = forceLanguage;
  const errors = flowErrors(doc.flow, doc.prompts);
  if (errors.length) return { errors };
  return { doc, errors: [] };
}

function previewOf(dir: string, flow: Flow, prompts: Record<string, string>, flowFile: string, model: string | undefined): GeneratePreview {
  const loaded: LoadedFlow = { dir, file: path.join(dir, flowFile), flow };
  const steps = planRunAll(loaded, { model, inputs: planPlaceholders(flow) });
  const plan = steps.map(presentStep);
  return {
    flow,
    prompts,
    files: renderedFiles(flow, prompts, flowFile),
    plan,
    runsCommands: plan.some((step) => step.runsCommands),
    modelCalls: planModelCalls(steps),
    flowFile,
  };
}

function presentStep(step: PlanStep): GeneratePlanStep {
  const type = step.stage.executor.type;
  const runsCommands = type === "script" || type === "agent";
  const command = type === "script" ? step.stage.executor.run : type === "agent" ? `agent ${step.stage.executor.agent}` : undefined;
  const bits: string[] = [];
  if (step.detail) bits.push(step.detail);
  else if (command) bits.push(command);
  if (runsCommands) bits.push(RUNS_ON_COMPUTER);
  return {
    id: step.stage.id,
    name: step.stage.name,
    executor: type,
    action: step.action,
    ...(bits.length ? { detail: bits.join(" — ") } : {}),
    runsCommands,
  };
}

function planPlaceholders(flow: Flow): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(flow.inputs ?? {})) {
    if (def.required !== true) continue;
    if (def.default !== undefined && def.default !== "") continue;
    if (Array.isArray(def.enum) && def.enum.length > 0) inputs[key] = def.enum[0];
    else if (def.type === "number") inputs[key] = 1;
    else if (def.type === "boolean") inputs[key] = false;
    else if (def.type === "file") inputs[key] = `${key}.txt`;
    else inputs[key] = key;
  }
  return inputs;
}

function flowErrors(flow: Record<string, unknown>, prompts: Record<string, string>): string[] {
  const lines = validateFlow(flow).filter((issue) => issue.level === "error").map(formatIssue);
  if (lines.length) return lines;
  const stages = Array.isArray(flow.stages) ? flow.stages : [];
  stages.forEach((stage, index) => {
    if (!isRecord(stage) || !isRecord(stage.executor)) return;
    const ex = stage.executor;
    if (ex.type === "llm" || ex.type === "agent") {
      const prompt = typeof ex.prompt === "string" ? ex.prompt : "";
      if (!prompt || !isSafeRelative(prompt) || prompt === FLOW_FILE || prompt === FLOW_MD_FILE || prompt === "runs" || prompt.startsWith("runs/")) {
        lines.push(`/stages/${index}/executor/prompt: 提示词路径必须是流程目录里的相对路径 / prompt path must be a relative path inside the flow directory`);
      } else if (!prompts[prompt]?.trim()) {
        lines.push(`/stages/${index}/executor/prompt: 找不到提示词文件 / prompt file not found: ${prompt}`);
      }
    }
    if (ex.type === "script" && (typeof ex.run !== "string" || !ex.run.trim())) {
      lines.push(`/stages/${index}/executor/run: 脚本阶段要有命令 / a script stage needs a command`);
    }
  });
  return lines;
}

function formatIssue(issue: ValidationIssue): string {
  const message = issue.message.includes(" / ") ? issue.message : `不符合规范 / does not match the spec: ${issue.message}`;
  return issue.path ? `${issue.path}: ${message}` : message;
}

function normalizeDocument(data: unknown, allows: Allows, language: string): Doc | { error: string } {
  if (!isRecord(data)) return { error: "回复要是一个 JSON 对象 / the reply must be a JSON object" };
  const body = isRecord(data.flow) ? data.flow : data;
  if (!isRecord(body)) return { error: "回复要是一个 JSON 对象 / the reply must be a JSON object" };
  const prompts = normalizePrompts(data.prompts);
  const stagesIn = Array.isArray(body.stages) ? body.stages : [];
  const stages = stagesIn.map((raw) => (isRecord(raw) ? normalizeStage(raw, allows, prompts, language) : raw));
  const flow: Record<string, unknown> = { format: "flowgit", version: "0.1", stages };
  if (typeof body.name === "string") flow.name = body.name;
  if (typeof body.description === "string") flow.description = body.description;
  if (typeof body.language === "string" && body.language.trim()) flow.language = body.language.trim();
  if (typeof body.id === "string" && FLOW_ID.test(body.id)) flow.id = body.id;
  if (typeof body.license === "string" && body.license.trim()) flow.license = body.license.trim();
  if (Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === "string")) flow.tags = body.tags;
  if (isRecord(body.author) && typeof body.author.name === "string" && body.author.name.trim()) {
    const author: Record<string, unknown> = { name: body.author.name.trim() };
    if (typeof body.author.url === "string" && body.author.url.trim()) author.url = body.author.url.trim();
    flow.author = author;
  }
  const inputs = normalizeInputs(body.inputs);
  if (inputs) flow.inputs = inputs;
  return { flow, prompts };
}

function normalizeStage(raw: Record<string, unknown>, allows: Allows, prompts: Record<string, string>, language: string): Record<string, unknown> {
  const id = typeof raw.id === "string" ? raw.id : "";
  const source = isRecord(raw.executor) ? raw.executor : typeof raw.executor === "string" ? { type: raw.executor } : {};
  const declared = typeof source.type === "string" ? source.type : "";
  const allowed = declared === "human" || declared === "llm" || (declared === "script" && allows.script) || (declared === "agent" && allows.agent);
  const stage: Record<string, unknown> = {};
  if (typeof raw.id === "string") stage.id = raw.id;
  if (typeof raw.name === "string") stage.name = raw.name;
  if (typeof raw.description === "string") stage.description = raw.description;
  const deps = stringList(raw.inputs ?? raw.dependsOn);
  if (deps?.length) stage.inputs = deps;
  if (!allowed) {
    const prompt = `prompts/${id || "stage"}.md`;
    if (!prompts[prompt]?.trim()) prompts[prompt] = defaultPrompt(raw, language);
    const outputs = normalizeOutputs(raw.outputs);
    const one = outputs?.length === 1 && !String(outputs[0]?.path ?? "").endsWith("/") ? outputs : [{ type: "text/markdown", path: `${id || "stage"}.md` }];
    stage.outputs = one;
    stage.executor = { type: "llm", prompt };
    return stage;
  }
  const outputs = normalizeOutputs(raw.outputs);
  if (outputs) stage.outputs = outputs;
  stage.executor = normalizeExecutor(source, raw, id);
  return stage;
}

function normalizeExecutor(source: Record<string, unknown>, raw: Record<string, unknown>, id: string): Record<string, unknown> {
  const type = source.type;
  if (type === "human") {
    const instructions = str(source.instructions) ?? str(raw.instructions);
    return instructions ? { type: "human", instructions } : { type: "human" };
  }
  if (type === "script") {
    return { type: "script", run: (str(source.run) ?? str(raw.run) ?? "").trim() };
  }
  if (type === "agent") {
    const named = str(source.agent) ?? str(raw.agent) ?? "";
    let agent = AGENTS.has(named) ? named : "claude-code";
    const command = str(source.command);
    if (agent === "custom" && !command) agent = "claude-code";
    const prompt = str(source.prompt) || `prompts/${id || "stage"}.md`;
    const executor: Record<string, unknown> = { type: "agent", agent, prompt };
    if (agent === "custom" && command) executor.command = command;
    return executor;
  }
  return { type: "llm", prompt: str(source.prompt) || `prompts/${id || "stage"}.md` };
}

function normalizeOutputs(raw: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const outputs: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.path !== "string" || !item.path.trim()) continue;
    const output: Record<string, unknown> = {
      type: typeof item.type === "string" && item.type.trim() ? item.type : "text/markdown",
      path: item.path.replace(/\\/g, "/"),
    };
    if (typeof item.description === "string") output.description = item.description;
    outputs.push(output);
  }
  return outputs.length ? outputs : undefined;
}

function normalizeInputs(raw: unknown): Record<string, unknown> | undefined {
  const source: [string, Record<string, unknown>][] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item) && typeof item.name === "string") source.push([item.name, item]);
    }
  } else if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (key !== "__proto__" && isRecord(value)) source.push([key, value]);
    }
  }
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of source) {
    if (!INPUT_NAME.test(key)) continue;
    const def: Record<string, unknown> = { type: value.type };
    if (typeof value.description === "string") def.description = value.description;
    if (typeof value.required === "boolean") def.required = value.required;
    if (value.default !== undefined) def.default = value.default;
    if (Array.isArray(value.enum) && value.enum.length > 0) def.enum = value.enum;
    inputs[key] = def;
  }
  return Object.keys(inputs).length ? inputs : undefined;
}

function normalizePrompts(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const prompts: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const rel = key.replace(/\\/g, "/").replace(/^\.\//, "");
    prompts[rel] = value;
  }
  return prompts;
}

function referencedPrompts(flow: Flow, prompts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stage of flow.stages) {
    const ex = stage.executor;
    if ((ex.type === "llm" || ex.type === "agent") && prompts[ex.prompt] !== undefined) out[ex.prompt] = withNewline(prompts[ex.prompt]!);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function renderedFiles(flow: Flow, prompts: Record<string, string>, flowName: string): GenerateFile[] {
  const files: GenerateFile[] = [{ path: flowName, text: renderFlowText(flow, flowName) }];
  for (const [rel, text] of Object.entries(prompts)) files.push({ path: rel, text });
  return files;
}

function defaultPrompt(raw: Record<string, unknown>, language: string): string {
  const name = str(raw.name) || str(raw.id) || "stage";
  const description = str(raw.description) || name;
  if (language === "en") return `# ${name}\n\nWrite the output for this step.\n\n${description}\n`;
  return `# ${name}\n\n写出这一步的产物。\n\n${description}\n`;
}

function parsePlan(text: string, allows: Allows): { ok: true; plan: StagePlan } | { ok: false; errors: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch (err) {
    return { ok: false, errors: [`阶段计划不是 JSON / the stage plan is not JSON: ${(err as Error).message}`] };
  }
  if (!isRecord(value)) return { ok: false, errors: ["阶段计划要是一个 JSON 对象 / the stage plan must be a JSON object"] };
  const errors: string[] = [];
  if (typeof value.name !== "string" || !value.name.trim()) errors.push("计划缺少 name / the plan is missing name");
  const stagesIn = Array.isArray(value.stages) ? value.stages : undefined;
  if (!stagesIn?.length) errors.push("计划至少要有一个阶段 / the plan needs at least one stage");
  if (stagesIn && stagesIn.length > 12) errors.push("计划最多 12 个阶段 / a plan has at most 12 stages");
  const stages: PlanStage[] = [];
  const ids = new Set<string>();
  (stagesIn ?? []).forEach((raw, index) => {
    const at = `stages[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${at}: 阶段要是一个对象 / a stage must be an object`);
      return;
    }
    const id = str(raw.id) ?? "";
    if (!STAGE_ID.test(id)) errors.push(`${at}.id: 阶段 id 要是小写字母开头 / a stage id must start with a lowercase letter: "${id}"`);
    else if (ids.has(id)) errors.push(`${at}.id: 阶段 id 重复 / duplicate stage id "${id}"`);
    ids.add(id);
    const name = str(raw.name) ?? "";
    if (!name.trim()) errors.push(`${at}.name: 阶段要有名字 / a stage needs a name`);
    const executor = planExecutor(raw);
    if (!executor) errors.push(`${at}.executor: 执行器只能是 human、llm、script、agent / executor must be human, llm, script or agent`);
    const outputs = planOutputs(raw.outputs);
    if (!outputs?.length) errors.push(`${at}.outputs: 阶段至少要有一个产物 / a stage needs at least one output`);
    else {
      outputs.forEach((output, n) => {
        if (!isSafeRelative(output.path) || output.path === FLOW_FILE || output.path === FLOW_MD_FILE || output.path === "runs" || output.path.startsWith("runs/")) {
          errors.push(`${at}.outputs[${n}]: 产物路径必须在流程目录内 / output path must stay inside the flow directory: "${output.path}"`);
        }
      });
    }
    const dependsOn = stringList(raw.dependsOn ?? raw.inputs) ?? [];
    if (executor && outputs) {
      stages.push({
        id,
        name,
        ...(str(raw.description) ? { description: str(raw.description) } : {}),
        executor,
        dependsOn,
        outputs,
        ...(str(raw.instructions) ? { instructions: str(raw.instructions) } : {}),
        ...(str(raw.run) ? { run: str(raw.run) } : {}),
        ...(str(raw.agent) ? { agent: str(raw.agent) } : {}),
      });
    }
  });
  for (const stage of stages) {
    for (const dep of stage.dependsOn) {
      if (dep === stage.id) errors.push(`阶段不能依赖自己 / stage "${stage.id}" cannot depend on itself`);
      else if (!ids.has(dep)) errors.push(`没有这个阶段 / unknown stage "${dep}"`);
    }
  }
  const loop = findCycle(stages);
  if (loop.length) errors.push(`阶段之间形成了环 / stages form a cycle: ${loop.join(" -> ")}`);
  const inputs = planInputs(value.inputs, errors);
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    plan: {
      name: (value.name as string).trim(),
      ...(str(value.description) ? { description: str(value.description) } : {}),
      ...(typeof value.id === "string" && FLOW_ID.test(value.id) ? { id: value.id } : {}),
      ...(str(value.language) ? { language: str(value.language) } : {}),
      inputs,
      stages: stages.map((stage) => constrainStage(stage, allows)),
    },
  };
}

function constrainStage(stage: PlanStage, allows: Allows): PlanStage {
  if (stage.executor === "script" && !allows.script) return { ...stage, executor: "llm", outputs: oneOutput(stage), run: undefined, agent: undefined };
  if (stage.executor === "agent" && !allows.agent) return { ...stage, executor: "llm", outputs: oneOutput(stage), run: undefined, agent: undefined };
  if (stage.executor === "llm" && stage.outputs.length !== 1) return { ...stage, outputs: oneOutput(stage) };
  return stage;
}

function oneOutput(stage: PlanStage): { type: string; path: string }[] {
  const first = stage.outputs.find((output) => !output.path.endsWith("/"));
  return [first ?? { type: "text/markdown", path: `${stage.id}.md` }];
}

function planExecutor(raw: Record<string, unknown>): PlanStage["executor"] | undefined {
  const value = isRecord(raw.executor) ? raw.executor.type : raw.executor;
  if (value === "human" || value === "llm" || value === "script" || value === "agent") return value;
  return undefined;
}

function planOutputs(raw: unknown): { type: string; path: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const outputs: { type: string; path: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.path !== "string" || !item.path.trim()) continue;
    outputs.push({
      type: typeof item.type === "string" && item.type.trim() ? item.type : "text/markdown",
      path: item.path.replace(/\\/g, "/"),
    });
  }
  return outputs.length ? outputs : undefined;
}

function planInputs(raw: unknown, errors: string[]): PlanInput[] {
  if (raw === undefined) return [];
  const items = Array.isArray(raw) ? raw : isRecord(raw) ? Object.entries(raw).map(([name, value]) => ({ ...(isRecord(value) ? value : {}), name })) : undefined;
  if (!items) {
    errors.push("inputs 要是数组或对象 / inputs must be an array or an object");
    return [];
  }
  const inputs: PlanInput[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.name !== "string" || !INPUT_NAME.test(item.name)) {
      errors.push("流程输入的名字要是字母开头 / a flow input name must start with a letter");
      continue;
    }
    if (typeof item.type !== "string" || !INPUT_TYPES.has(item.type)) {
      errors.push(`流程输入 "${item.name}" 的 type 不认识 / flow input "${item.name}" has an unknown type`);
      continue;
    }
    inputs.push({
      name: item.name,
      type: item.type,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(typeof item.required === "boolean" ? { required: item.required } : {}),
      ...(item.default !== undefined ? { default: item.default } : {}),
      ...(Array.isArray(item.enum) && item.enum.length ? { enum: item.enum } : {}),
    });
  }
  return inputs;
}

function findCycle(stages: PlanStage[]): string[] {
  const deps = new Map(stages.map((stage) => [stage.id, stage.dependsOn]));
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const state = color.get(id) ?? 0;
    if (state === 1) return [...stack.slice(stack.indexOf(id)), id];
    if (state === 2 || !deps.has(id)) return undefined;
    color.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      const found = visit(dep);
      if (found?.length) return found;
    }
    stack.pop();
    color.set(id, 2);
    return undefined;
  };
  for (const stage of stages) {
    const found = visit(stage.id);
    if (found?.length) return found;
  }
  return [];
}

function executorList(allows: Allows): string {
  const types = ["human", "llm"];
  if (allows.script) types.push("script");
  if (allows.agent) types.push("agent");
  return types.join(", ");
}

function existingFlow(dir: string): string | undefined {
  return findFlowFile(dir);
}

function inside(dir: string, rel: string): string {
  if (!isSafeRelative(rel) || rel === FLOW_FILE || rel === FLOW_MD_FILE || rel === "runs" || rel.startsWith("runs/")) {
    throw new Error(`不能写入这个路径 / cannot write this path: ${rel}`);
  }
  const abs = path.resolve(dir, rel);
  const back = path.relative(path.resolve(dir), abs);
  if (back === ".." || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    throw new Error(`路径超出流程目录 / path escapes the flow directory: ${rel}`);
  }
  return abs;
}

function renderedNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function withNewline(text: string): string {
  return renderedNewline(text);
}

function loadPrompt(name: string): string {
  const file = generatePromptFile(name);
  if (!host().exists(file)) throw new Error(`找不到生成提示词 ${name} / generate prompt not found: ${name}`);
  return host().readFile(file, "utf8");
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (all, key: string) => (Object.hasOwn(vars, key) ? vars[key]! : all));
}

function modulePath(): string {
  const url = new URL(import.meta.url);
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
  return pathname;
}

function stringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) if (typeof item === "string" && item && !out.includes(item)) out.push(item);
  return out;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorLines(err: unknown): string[] {
  const message = err instanceof Error ? err.message : String(err);
  const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines : ["生成失败 / could not generate the flow"];
}
