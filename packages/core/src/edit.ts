import { findCycle } from "./graph.js";
import type {
  AgentName,
  Executor,
  ExecutorAgent,
  ExecutorImage,
  ExecutorLlm,
  ExecutorMcp,
  ExecutorPlugin,
  ExecutorScript,
  ExecutorService,
  ExecutorType,
  Flow,
  FlowInput,
  FlowInputType,
  Output,
  Stage,
} from "./types.js";

/** Executors that `stage add` can create. */
export type AddableStageType = "human" | "llm" | "script" | "agent";

export interface AddStageSpec {
  id: string;
  type: AddableStageType;
  name?: string;
  /** Insert after this stage. Omit to append. */
  after?: string;
  /** Upstream stage ids. Omit to use the stage just before the insertion point. */
  inputs?: string[];
  outputs?: Output[];
  /** Prompt file for llm and agent. Defaults to prompts/<id>.md. */
  prompt?: string;
  /** Shell command for a script stage. Required for type "script". */
  run?: string;
  /** Agent CLI name. Defaults to "claude-code", which can write files without extra flags (Cursor only proposes changes unless you add --force). */
  agent?: AgentName;
}

const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

function duplicate(id: string): Error {
  return new Error(`已经有阶段 "${id}" / Stage "${id}" already exists`);
}

function defaultOutputs(spec: AddStageSpec): Output[] {
  if (spec.type === "script") {
    throw new Error(`script 阶段必须用 --output 指定产物 / A script stage needs --output`);
  }
  if (spec.type === "agent") return [{ type: "dir", path: `${spec.id}/` }];
  return [{ type: "text/markdown", path: `${spec.id}.md` }];
}

function executorOf(spec: AddStageSpec, outputs: Output[]): Executor {
  if (spec.type === "human") {
    const files = outputs.map((o) => o.path).join(", ");
    return {
      type: "human",
      instructions: `把这一步的结果写进 ${files}。 / Write this stage's result to ${files}.`,
    };
  }
  if (spec.type === "llm") {
    return { type: "llm", prompt: spec.prompt ?? `prompts/${spec.id}.md` };
  }
  if (spec.type === "script") {
    if (!spec.run?.trim()) throw new Error(`script 阶段必须用 --run 指定命令 / A script stage needs --run`);
    return { type: "script", run: spec.run };
  }
  return { type: "agent", agent: spec.agent ?? "claude-code", prompt: spec.prompt ?? `prompts/${spec.id}.md` };
}

/**
 * A new flow with one stage inserted. Does not read or write files.
 * The returned flow keeps the original key order; the input flow is not changed.
 */
export function addStage(flow: Flow, spec: AddStageSpec): Flow {
  if (!ID_PATTERN.test(spec.id)) {
    throw new Error(
      `阶段 id 必须是小写字母开头，后面可以是小写字母、数字、_ 或 -，收到 "${spec.id}" / Stage id must start with a lowercase letter and then use lowercase letters, digits, "_" or "-", got "${spec.id}"`,
    );
  }
  if (flow.stages.some((s) => s.id === spec.id)) throw duplicate(spec.id);
  let index = flow.stages.length;
  if (spec.after !== undefined) {
    const at = flow.stages.findIndex((s) => s.id === spec.after);
    if (at < 0) throw new Error(`没有阶段 "${spec.after}"，不能插在它后面 / No stage "${spec.after}" to insert after`);
    index = at + 1;
  }
  const inputs = spec.inputs ?? (index > 0 ? [flow.stages[index - 1]!.id] : undefined);
  const outputs = spec.outputs?.length ? spec.outputs : defaultOutputs(spec);
  const stage: Stage = {
    id: spec.id,
    name: spec.name?.trim() || spec.id,
    ...(inputs && inputs.length ? { inputs: [...inputs] } : {}),
    executor: executorOf(spec, outputs),
    outputs,
  };
  const stages = [...flow.stages.slice(0, index), stage, ...flow.stages.slice(index)];
  return { ...flow, stages };
}

/**
 * A new flow with the stage removed. Does not read or write files, and does not
 * touch runs or any output files. Without force, a stage that others use as an
 * input is refused. With force, those references are dropped.
 */
export function removeStage(flow: Flow, id: string, opts: { force?: boolean } = {}): Flow {
  if (!flow.stages.some((s) => s.id === id)) throw new Error(`没有阶段 "${id}" / No stage "${id}"`);
  const dependents = flow.stages.filter((s) => (s.inputs ?? []).includes(id));
  if (dependents.length && !opts.force) {
    const list = dependents.map((s) => s.id).join(", ");
    throw new Error(
      `这些阶段还把 "${id}" 当作输入：${list}。确认后加 --force，会一并去掉这些引用 / These stages still use "${id}" as an input: ${list}. Pass --force to drop those references too`,
    );
  }
  const stages = flow.stages
    .filter((s) => s.id !== id)
    .map((s) => {
      if (!(s.inputs ?? []).includes(id)) return s;
      const inputs = s.inputs!.filter((dep) => dep !== id);
      const next: Stage = { ...s };
      if (inputs.length) next.inputs = inputs;
      else delete next.inputs;
      return next;
    });
  return { ...flow, stages };
}

const AGENT_NAMES: readonly AgentName[] = ["claude-code", "codex", "cursor", "gemini", "custom"];
const EXECUTOR_TYPES = new Set<ExecutorType>(["human", "llm", "script", "agent", "workflow", "service", "mcp", "plugin", "image"]);
const ADDABLE_EXECUTORS = new Set<ExecutorType>(["human", "llm", "script", "agent"]);
const INPUT_TYPES = new Set<FlowInputType>(["string", "text", "number", "boolean", "file"]);
const INPUT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STAGE_BODY_KEYS = new Set([
  "id",
  "type",
  "name",
  "after",
  "inputs",
  "outputs",
  "prompt",
  "run",
  "agent",
  "model",
  "timeoutSec",
  "retries",
  "command",
  "args",
  "instructions",
]);
const FLOW_BODY_KEYS = new Set(["name", "description", "inputs", "concurrency"]);
const INPUT_DEF_KEYS = new Set(["type", "description", "default", "required", "enum"]);

/** A rejected edit. `status` is 404 when the stage id does not exist, otherwise 400. */
export class EditError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "EditError";
  }
}

/**
 * Fields a board can change on one stage. Same names as `addStage`, plus the
 * executor settings the graph form edits. Omitted fields stay as they are.
 * `inputs` is the dependency list (this stage runs after those ids).
 */
export interface StagePatch {
  name?: string;
  /** Replace upstream ids. `[]` clears them. */
  inputs?: string[];
  /** Move this stage to sit just after another in the file. Does not add a dependency. */
  after?: string;
  outputs?: Output[];
  type?: ExecutorType;
  prompt?: string;
  run?: string;
  agent?: AgentName;
  /** `null` clears the field. */
  model?: string | null;
  timeoutSec?: number | null;
  retries?: number | null;
  command?: string | null;
  args?: string[] | null;
  instructions?: string | null;
}

/** Only the flow's name, description, concurrency and input definitions. */
export interface FlowMetaPatch {
  name?: string;
  /** `null` or `""` removes the description. */
  description?: string | null;
  /** Replaces the input definitions. `{}` removes them. */
  inputs?: Record<string, FlowInput>;
  /** `null` removes it (the run then uses the default of 2). */
  concurrency?: number | null;
}

function cleanRel(rel: string): string | undefined {
  if (!rel || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return undefined;
  const parts = rel.replace(/^\.\//, "").split("/");
  if (parts.some((part) => part === "" || part === "..")) return undefined;
  const clean = parts.filter((part) => part !== ".").join("/");
  return clean || undefined;
}

function executorPrompt(executor: Executor): string | undefined {
  if (executor.type === "llm" || executor.type === "agent" || executor.type === "image") return executor.prompt;
  return undefined;
}

/**
 * A prompt file the board may read and write: one a stage already names, or
 * `prompts/<file>.md` (the place `stage add` puts a new prompt).
 */
export function isEditablePrompt(flow: Flow, rel: string): boolean {
  const norm = cleanRel(rel);
  if (!norm) return false;
  for (const stage of flow.stages) {
    const prompt = executorPrompt(stage.executor);
    if (prompt && cleanRel(prompt) === norm) return true;
  }
  return /^prompts\/[A-Za-z0-9._-]+\.md$/.test(norm);
}

function optionalText(value: unknown, key: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new EditError(`${key} 必须是字符串 / ${key} must be a string`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function nullableInt(value: unknown, key: string, min: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new EditError(`${key} 必须是不小于 ${min} 的整数 / ${key} must be an integer of at least ${min}`);
  }
  return value;
}

function parseOutputList(value: unknown): Output[] {
  if (!Array.isArray(value) || value.length === 0) throw new EditError("至少要有一个产物 / a stage needs at least one output");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new EditError(`outputs[${index}] 必须是对象 / outputs[${index}] must be an object`);
    }
    const output = item as Record<string, unknown>;
    if (typeof output.path !== "string" || !output.path.trim()) {
      throw new EditError(`outputs[${index}] 缺少 path / outputs[${index}] is missing path`);
    }
    if (typeof output.type !== "string" || !output.type.trim()) {
      throw new EditError(`outputs[${index}] 缺少 type / outputs[${index}] is missing type`);
    }
    const next: Output = { type: output.type.trim(), path: output.path.trim() };
    if (output.id !== undefined) {
      if (typeof output.id !== "string" || !output.id.trim()) {
        throw new EditError(`outputs[${index}].id 必须是字符串 / outputs[${index}].id must be a string`);
      }
      next.id = output.id.trim();
    }
    if (output.description !== undefined) {
      if (typeof output.description !== "string") {
        throw new EditError(`outputs[${index}].description 必须是字符串 / outputs[${index}].description must be a string`);
      }
      if (output.description) next.description = output.description;
    }
    if (output.schema !== undefined) {
      if (typeof output.schema !== "string" || !output.schema.trim()) {
        throw new EditError(`outputs[${index}].schema 必须是字符串 / outputs[${index}].schema must be a string`);
      }
      next.schema = output.schema.trim();
    }
    return next;
  });
}

/** The JSON body of PUT /api/stage. Same fields as POST /api/stage, plus model, timeout, retries and agent command. */
export function stagePatchFromBody(body: Record<string, unknown>): { id: string; patch: StagePatch } {
  for (const key of Object.keys(body)) {
    if (!STAGE_BODY_KEYS.has(key)) throw new EditError(`不认识的字段 "${key}" / unknown field "${key}"`);
  }
  if (typeof body.id !== "string" || !body.id.trim()) throw new EditError("缺少阶段 id / missing stage id");
  const patch: StagePatch = {};
  if (body.type !== undefined) {
    if (typeof body.type !== "string" || !EXECUTOR_TYPES.has(body.type as ExecutorType)) {
      throw new EditError(
        `type 只能是 human、llm、script、agent、workflow、service、mcp、plugin、image，收到 "${String(body.type)}" / type must be one of those, got "${String(body.type)}"`,
      );
    }
    patch.type = body.type as ExecutorType;
  }
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new EditError("名称必须是非空字符串 / name must be a non-empty string");
    patch.name = body.name.trim();
  }
  if (body.after !== undefined && body.after !== null && body.after !== "") {
    if (typeof body.after !== "string") throw new EditError("after 必须是字符串 / after must be a string");
    patch.after = body.after.trim();
  }
  if (body.inputs !== undefined) {
    if (!Array.isArray(body.inputs) || body.inputs.some((item) => typeof item !== "string" || !item.trim())) {
      throw new EditError("inputs 必须是阶段 id 的数组 / inputs must be an array of stage ids");
    }
    patch.inputs = body.inputs.map((item) => (item as string).trim());
  }
  if (body.outputs !== undefined) patch.outputs = parseOutputList(body.outputs);
  const prompt = optionalText(body.prompt, "prompt");
  if (prompt) patch.prompt = prompt;
  const run = optionalText(body.run, "run");
  if (run) patch.run = run;
  if (body.agent !== undefined && body.agent !== null && body.agent !== "") {
    if (typeof body.agent !== "string" || !AGENT_NAMES.includes(body.agent as AgentName)) {
      throw new EditError(
        `agent 只能是 ${AGENT_NAMES.join("、")}，收到 "${String(body.agent)}" / agent must be one of ${AGENT_NAMES.join(", ")}, got "${String(body.agent)}"`,
      );
    }
    patch.agent = body.agent as AgentName;
  }
  if (body.model !== undefined) {
    if (body.model === null || body.model === "") patch.model = null;
    else if (typeof body.model !== "string") throw new EditError("model 必须是字符串 / model must be a string");
    else patch.model = body.model.trim();
  }
  const timeoutSec = nullableInt(body.timeoutSec, "timeoutSec", 1);
  if (timeoutSec !== undefined) patch.timeoutSec = timeoutSec;
  const retries = nullableInt(body.retries, "retries", 0);
  if (retries !== undefined) patch.retries = retries;
  if (body.command !== undefined) {
    if (body.command === null || body.command === "") patch.command = null;
    else if (typeof body.command !== "string") throw new EditError("command 必须是字符串 / command must be a string");
    else patch.command = body.command.trim();
  }
  if (body.args !== undefined) {
    if (body.args === null) patch.args = null;
    else if (!Array.isArray(body.args) || body.args.some((item) => typeof item !== "string")) {
      throw new EditError("args 必须是字符串数组 / args must be an array of strings");
    } else patch.args = body.args as string[];
  }
  if (body.instructions !== undefined) {
    if (body.instructions === null) patch.instructions = null;
    else if (typeof body.instructions !== "string") throw new EditError("instructions 必须是字符串 / instructions must be a string");
    else patch.instructions = body.instructions;
  }
  return { id: body.id.trim(), patch };
}

function sameList(a: unknown[] | undefined, value: unknown): boolean {
  return (a ?? []).some((item) => Object.is(item, value));
}

function normalizeInput(key: string, value: unknown): FlowInput {
  if (!INPUT_KEY.test(key)) {
    throw new EditError(
      `输入名字 "${key}" 只能是字母、数字和下划线 / input name "${key}" can only use letters, digits and "_"`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EditError(`输入 "${key}" 必须是对象 / input "${key}" must be an object`);
  }
  const raw = value as Record<string, unknown>;
  for (const field of Object.keys(raw)) {
    if (!INPUT_DEF_KEYS.has(field)) throw new EditError(`输入 "${key}" 有不认识的字段 "${field}" / input "${key}" has unknown field "${field}"`);
  }
  if (typeof raw.type !== "string" || !INPUT_TYPES.has(raw.type as FlowInputType)) {
    throw new EditError(`输入 "${key}" 的 type 不合法 / input "${key}" has an invalid type`);
  }
  const type = raw.type as FlowInputType;
  const next: FlowInput = { type };
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new EditError(`输入 "${key}" 的说明必须是字符串 / input "${key}" description must be a string`);
    if (raw.description.trim()) next.description = raw.description;
  }
  if (raw.required !== undefined) {
    if (typeof raw.required !== "boolean") throw new EditError(`输入 "${key}" 的 required 必须是布尔值 / input "${key}" required must be a boolean`);
    if (raw.required) next.required = true;
  }
  if (raw.enum !== undefined) {
    if (!Array.isArray(raw.enum) || raw.enum.length === 0) {
      throw new EditError(`输入 "${key}" 的 enum 必须是非空数组 / input "${key}" enum must be a non-empty array`);
    }
    const bad = raw.enum.some((item) => {
      if (type === "number") return typeof item !== "number";
      if (type === "boolean") return typeof item !== "boolean";
      return typeof item !== "string";
    });
    if (bad) throw new EditError(`输入 "${key}" 的 enum 和 type 不一致 / input "${key}" enum does not match its type`);
    next.enum = raw.enum.slice();
  }
  if (raw.default !== undefined) {
    const ok =
      (type === "number" && typeof raw.default === "number") ||
      (type === "boolean" && typeof raw.default === "boolean") ||
      ((type === "string" || type === "text" || type === "file") && typeof raw.default === "string");
    if (!ok) throw new EditError(`输入 "${key}" 的默认值和 type 不一致 / input "${key}" default does not match its type`);
    if (next.enum && !sameList(next.enum, raw.default)) {
      throw new EditError(`输入 "${key}" 的默认值不在 enum 里 / input "${key}" default is not in its enum`);
    }
    next.default = raw.default;
  }
  return next;
}

function normalizeInputs(value: unknown): Record<string, FlowInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EditError("inputs 必须是对象 / inputs must be an object");
  const inputs: Record<string, FlowInput> = {};
  for (const [key, def] of Object.entries(value)) inputs[key] = normalizeInput(key, def);
  return inputs;
}

/** The JSON body of PUT /api/flow. Only name, description, concurrency and input definitions. */
export function flowMetaFromBody(body: Record<string, unknown>): FlowMetaPatch {
  for (const key of Object.keys(body)) {
    if (!FLOW_BODY_KEYS.has(key)) throw new EditError(`不认识的字段 "${key}" / unknown field "${key}"`);
  }
  const patch: FlowMetaPatch = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new EditError("流程名字不能是空的 / the flow name cannot be empty");
    patch.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description === null) patch.description = null;
    else if (typeof body.description !== "string") throw new EditError("说明必须是字符串 / description must be a string");
    else patch.description = body.description;
  }
  if (body.concurrency !== undefined) {
    if (body.concurrency === null || body.concurrency === "") patch.concurrency = null;
    else patch.concurrency = nullableInt(body.concurrency, "concurrency", 1) as number;
  }
  if (body.inputs !== undefined) patch.inputs = normalizeInputs(body.inputs);
  return patch;
}

function promptOf(stage: Stage, patch: StagePatch): string {
  return patch.prompt || executorPrompt(stage.executor) || `prompts/${stage.id}.md`;
}

function buildExecutor(stage: Stage, patch: StagePatch, type: ExecutorType): Executor {
  if (!ADDABLE_EXECUTORS.has(type)) {
    throw new EditError(`不能把执行器改成 "${type}" / cannot change the executor to "${type}"`);
  }
  const old = stage.executor;
  if (type === "human") {
    const instructions = patch.instructions === null ? undefined : (patch.instructions ?? (old.type === "human" ? old.instructions : undefined));
    return instructions ? { type: "human", instructions } : { type: "human" };
  }
  if (type === "llm") {
    const next: ExecutorLlm = {
      type: "llm",
      prompt: promptOf(stage, patch),
      ...(old.type === "llm" && old.system ? { system: old.system } : {}),
      ...(old.type === "llm" && old.effort ? { effort: old.effort } : {}),
      ...(old.type === "llm" && old.maxTokens ? { maxTokens: old.maxTokens } : {}),
      ...(old.type === "llm" && old.model ? { model: old.model } : {}),
      ...(old.type === "llm" && old.retries != null ? { retries: old.retries } : {}),
    };
    if (patch.model === null) delete next.model;
    else if (typeof patch.model === "string") next.model = patch.model;
    if (patch.retries === null) delete next.retries;
    else if (typeof patch.retries === "number") next.retries = patch.retries;
    return next;
  }
  if (type === "script") {
    const run = patch.run ?? (old.type === "script" ? old.run : undefined);
    if (!run) throw new EditError("script 阶段必须有命令 / a script stage needs a command");
    const next: ExecutorScript = {
      type: "script",
      run,
      ...(old.type === "script" && old.requires ? { requires: old.requires } : {}),
      ...(old.type === "script" && old.cwd ? { cwd: old.cwd } : {}),
      ...(old.type === "script" && old.env ? { env: old.env } : {}),
      ...(old.type === "script" && old.timeoutSec != null ? { timeoutSec: old.timeoutSec } : {}),
    };
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    return next;
  }
  const agent = patch.agent ?? (old.type === "agent" ? old.agent : "claude-code");
  const next: ExecutorAgent = { type: "agent", agent, prompt: promptOf(stage, patch) };
  if (agent === "custom") {
    const command = patch.command === null ? undefined : (patch.command ?? (old.type === "agent" ? old.command : undefined));
    if (!command) throw new EditError("custom 智能体必须有命令 / a custom agent needs a command");
    next.command = command;
  }
  if (patch.args) next.args = patch.args;
  else if (patch.args !== null && old.type === "agent" && old.args) next.args = old.args;
  if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
  else if (patch.timeoutSec !== null && old.type === "agent" && old.timeoutSec != null) next.timeoutSec = old.timeoutSec;
  return next;
}

function patchSame(stage: Stage, patch: StagePatch): Executor {
  const executor = stage.executor;
  if (executor.type === "human") {
    const next = { ...executor };
    if (patch.instructions === null) delete next.instructions;
    else if (patch.instructions !== undefined) next.instructions = patch.instructions;
    return next;
  }
  if (executor.type === "llm") {
    const next: ExecutorLlm = { ...executor };
    if (patch.prompt) next.prompt = patch.prompt;
    if (patch.model === null) delete next.model;
    else if (typeof patch.model === "string") next.model = patch.model;
    if (patch.retries === null) delete next.retries;
    else if (typeof patch.retries === "number") next.retries = patch.retries;
    return next;
  }
  if (executor.type === "script") {
    const next: ExecutorScript = { ...executor };
    if (patch.run) next.run = patch.run;
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    return next;
  }
  if (executor.type === "agent") {
    const agent = patch.agent ?? executor.agent;
    const next: ExecutorAgent = { ...executor, agent };
    if (patch.prompt) next.prompt = patch.prompt;
    if (agent === "custom") {
      const command = patch.command === null ? undefined : (patch.command ?? executor.command);
      if (!command) throw new EditError("custom 智能体必须有命令 / a custom agent needs a command");
      next.command = command;
    } else delete next.command;
    if (patch.args === null) delete next.args;
    else if (patch.args) next.args = patch.args;
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    return next;
  }
  if (executor.type === "service") {
    const next: ExecutorService = { ...executor };
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    if (patch.retries === null) delete next.retries;
    else if (typeof patch.retries === "number") next.retries = patch.retries;
    return next;
  }
  if (executor.type === "image") {
    const next: ExecutorImage = { ...executor };
    if (patch.prompt) next.prompt = patch.prompt;
    if (typeof patch.model === "string" && patch.model) next.model = patch.model;
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    return next;
  }
  if (executor.type === "mcp") {
    const next: ExecutorMcp = { ...executor };
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    return next;
  }
  if (executor.type === "plugin") {
    const next: ExecutorPlugin = { ...executor };
    if (patch.timeoutSec === null) delete next.timeoutSec;
    else if (typeof patch.timeoutSec === "number") next.timeoutSec = patch.timeoutSec;
    return next;
  }
  if (executor.type === "workflow") return { ...executor };
  return executor;
}

function stageRecord(stage: Stage, patch: StagePatch): Stage {
  const type = patch.type ?? stage.executor.type;
  if (patch.type && patch.type !== stage.executor.type) {
    if (!ADDABLE_EXECUTORS.has(patch.type)) throw new EditError(`不能把执行器改成 "${patch.type}" / cannot change the executor to "${patch.type}"`);
  }
  const executor = !patch.type || patch.type === stage.executor.type ? patchSame(stage, patch) : buildExecutor(stage, patch, type);
  const inputs = patch.inputs !== undefined ? uniqueIds(patch.inputs) : stage.inputs;
  const next: Stage = {
    id: stage.id,
    name: patch.name ?? stage.name,
    ...(stage.description !== undefined ? { description: stage.description } : {}),
    ...(inputs && inputs.length ? { inputs: [...inputs] } : {}),
    executor,
    outputs: patch.outputs ? patch.outputs.map((output) => ({ ...output })) : stage.outputs.map((output) => ({ ...output })),
  };
  return next;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function moveAfter(stages: Stage[], id: string, after: string): Stage[] {
  if (after === id) return stages;
  if (!stages.some((stage) => stage.id === after)) {
    throw new EditError(`没有阶段 "${after}"，不能排在它后面 / No stage "${after}" to place this after`);
  }
  const current = stages.find((stage) => stage.id === id);
  const rest = stages.filter((stage) => stage.id !== id);
  const at = rest.findIndex((stage) => stage.id === after);
  rest.splice(at + 1, 0, current!);
  return rest;
}

function cycleMessage(upstream: string, downstream: string, stuck: string[]): string {
  const ring = stuck.join(" → ");
  return `不能把 "${downstream}" 接到 "${upstream}" 后面：会形成环（${ring}） / Cannot place "${downstream}" after "${upstream}": that would cycle (${ring})`;
}

/**
 * A new flow with one stage's name, dependencies, outputs or executor changed.
 * Does not read or write files. A dependency that would cycle is refused, and
 * the message names the stages. The input flow is not changed.
 */
export function editStage(flow: Flow, id: string, patch: StagePatch): Flow {
  const index = flow.stages.findIndex((stage) => stage.id === id);
  if (index < 0) throw new EditError(`没有阶段 "${id}" / No stage "${id}"`, 404);
  const current = flow.stages[index]!;
  if (patch.inputs) {
    for (const upstream of patch.inputs) {
      if (!flow.stages.some((stage) => stage.id === upstream)) {
        throw new EditError(`没有阶段 "${upstream}"，不能把它当作上游 / No stage "${upstream}" to use as an upstream`);
      }
    }
  }
  if (patch.timeoutSec != null && (!Number.isInteger(patch.timeoutSec) || patch.timeoutSec < 1)) {
    throw new EditError("timeoutSec 必须是不小于 1 的整数 / timeoutSec must be an integer of at least 1");
  }
  if (patch.retries != null && (!Number.isInteger(patch.retries) || patch.retries < 0)) {
    throw new EditError("retries 必须是不小于 0 的整数 / retries must be an integer of at least 0");
  }
  const edited = stageRecord(current, patch);
  let stages = flow.stages.map((stage, at) => (at === index ? edited : stage));
  if (patch.after !== undefined) stages = moveAfter(stages, id, patch.after);
  const next: Flow = { ...flow, stages };
  const stuck = findCycle(next);
  if (stuck.length) {
    const added = (patch.inputs ?? []).find((upstream) => !(current.inputs ?? []).includes(upstream)) ?? id;
    throw new EditError(cycleMessage(added, id, stuck));
  }
  return next;
}

/**
 * A new flow with only its name, description, concurrency or input definitions
 * changed. Stages are left as they are. The input flow is not changed.
 */
export function editFlowMeta(flow: Flow, patch: FlowMetaPatch): Flow {
  const next: Flow = { ...flow, stages: flow.stages };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new EditError("流程名字不能是空的 / the flow name cannot be empty");
    next.name = name;
  }
  if (patch.description !== undefined) {
    if (patch.description === null || !patch.description.trim()) delete next.description;
    else next.description = patch.description;
  }
  if (patch.concurrency !== undefined) {
    if (patch.concurrency === null) delete next.concurrency;
    else if (!Number.isInteger(patch.concurrency) || patch.concurrency < 1) {
      throw new EditError("concurrency 必须是大于 0 的整数 / concurrency must be an integer greater than 0");
    } else next.concurrency = patch.concurrency;
  }
  if (patch.inputs !== undefined) {
    const inputs = normalizeInputs(patch.inputs);
    if (Object.keys(inputs).length) next.inputs = inputs;
    else delete next.inputs;
  }
  return next;
}

/** Bilingual skeleton for a new llm or agent prompt. `inputKey` is one flow input name. */
export function promptSkeleton(stageId: string, inputKey: string): string {
  return [
    `# ${stageId}`,
    "",
    "说明这一步要写什么，以及写成什么样。 / Say what this step should write, and in what shape.",
    "",
    `流程输入示例 / Flow input example: {{inputs.${inputKey}}}`,
    "",
    "只输出产物本身，不要加解释。上游产物会附在这条提示词后面。 / Reply with the artifact only, no explanation. Upstream artifacts are appended after this prompt.",
    "",
  ].join("\n");
}
