import type { AgentName, Executor, Flow, Output, Stage } from "./types.js";

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
