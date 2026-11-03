import { editFlowMeta, EditError, type Executor, findFlowFile, type Flow, FLOW_FILE, FLOW_MD_FILE, flowMetaFromBody, isDirOutput, isTextType, loadFlow, outputRel, readFlowFile, resolveFlowInputs, type Stage, statusAll, validateFlow, writeFlowFile } from "@flowgit/core";

export interface BoardOutput {
  path: string;
  type: string;
  directory: boolean;
  /** File output that `isTextType` treats as text, so the board can edit it. */
  text: boolean;
}

export interface BoardStage {
  id: string;
  name: string;
  executor: string;
  state: string;
  runs: number;
  latest: { n: number; time: string; status: string } | null;
  /** The run the files on disk match, when known (StageStatus.current); after a restore it differs from latest. */
  current: number | null;
  /** Human stage instructions, when the executor has them. */
  instructions?: string;
  /** Upstream stage ids. The graph draws an edge from each of these. */
  inputs: string[];
  /** Executor fields the graph editor shows. Omitted when that executor has none. */
  prompt?: string;
  model?: string;
  run?: string;
  timeoutSec?: number;
  retries?: number;
  agent?: string;
  command?: string;
  args?: string[];
  outputs: BoardOutput[];
}

/** One flow input as GET /api/inputs returns it. `value` is resolveFlowInputs. */
export interface BoardInputField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  enum?: unknown[];
  default?: unknown;
  /** null when the input has no value yet. */
  value: unknown;
}

/** JSON body of GET /api/flow. `inputs` is exactly resolveFlowInputs. */
export interface FlowBoard {
  name: string;
  description?: string;
  /** Present when the flow file sets it. The run default is 2. */
  concurrency?: number;
  inputs: Record<string, unknown>;
  missingInputs: string[];
  stages: BoardStage[];
}

function stageFields(stage: Stage): Pick<BoardStage, "inputs" | "prompt" | "model" | "run" | "timeoutSec" | "retries" | "agent" | "command" | "args"> {
  const executor: Executor = stage.executor;
  const fields: Pick<BoardStage, "inputs" | "prompt" | "model" | "run" | "timeoutSec" | "retries" | "agent" | "command" | "args"> = {
    inputs: stage.inputs ?? [],
  };
  if (executor.type === "llm" || executor.type === "agent" || executor.type === "image") fields.prompt = executor.prompt;
  if ((executor.type === "llm" || executor.type === "image") && executor.model) fields.model = executor.model;
  if (executor.type === "script") fields.run = executor.run;
  if ("timeoutSec" in executor && executor.timeoutSec != null) fields.timeoutSec = executor.timeoutSec;
  if ((executor.type === "llm" || executor.type === "service") && executor.retries != null) fields.retries = executor.retries;
  if (executor.type === "agent") {
    fields.agent = executor.agent;
    if (executor.command) fields.command = executor.command;
    if (executor.args) fields.args = executor.args;
  }
  return fields;
}

export function flowBoard(dir: string): FlowBoard {
  const loaded = loadFlow(dir);
  const inputs = resolveFlowInputs(loaded.dir, loaded.flow);
  const missingInputs = Object.entries(loaded.flow.inputs ?? {})
    .filter(([key, def]) => def.required && (inputs[key] === undefined || inputs[key] === ""))
    .map(([key]) => key);
  return {
    name: loaded.flow.name,
    ...(loaded.flow.description ? { description: loaded.flow.description } : {}),
    ...(loaded.flow.concurrency != null ? { concurrency: loaded.flow.concurrency } : {}),
    inputs,
    missingInputs,
    stages: statusAll(loaded, inputs).map((status) => ({
      id: status.stage.id,
      name: status.stage.name,
      executor: status.stage.executor.type,
      state: status.state,
      runs: status.runs,
      latest: status.latest
        ? { n: status.latest.n, time: status.latest.finishedAt, status: status.latest.status }
        : null,
      current: status.current ?? null,
      ...(status.stage.executor.type === "human" && status.stage.executor.instructions
        ? { instructions: status.stage.executor.instructions }
        : {}),
      ...stageFields(status.stage),
      outputs: status.stage.outputs.map((output) => {
        const directory = isDirOutput(output);
        return {
          path: outputRel(output),
          type: output.type,
          directory,
          text: !directory && isTextType(output.type, output.path),
        };
      }),
    })),
  };
}

function failure(status: number, message: string): { status: number; body: Record<string, unknown> } {
  return { status, body: { error: message, issues: [{ path: "/", message }] } };
}

/**
 * PUT /api/flow: change the name, description, concurrency or input definitions.
 * Validates like `flowgit validate` and writes nothing when that fails.
 * Uses `readFlowFile` / `writeFlowFile`, so a `flow.md` file stays `flow.md`.
 * No Node APIs: the browser board can call it too. The HTTP server publishes the change.
 */
export function putFlow(dir: string, body: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
  let patch;
  try {
    patch = flowMetaFromBody(body);
  } catch (err) {
    return failure(400, err instanceof Error ? err.message : String(err));
  }
  let file: string;
  let flow: Flow;
  try {
    const found = findFlowFile(dir);
    if (!found) return failure(404, `没有 ${FLOW_FILE} 或 ${FLOW_MD_FILE} / No ${FLOW_FILE} or ${FLOW_MD_FILE}`);
    file = found;
    const data = readFlowFile(file);
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray((data as Flow).stages)) {
      return failure(400, "不是一个流程 / not a flow");
    }
    flow = data as Flow;
  } catch (err) {
    return failure(400, err instanceof Error ? err.message : String(err));
  }
  let next: Flow;
  try {
    next = editFlowMeta(flow, patch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(err instanceof EditError ? err.status : 400, message);
  }
  const errors = validateFlow(next, { dir }).filter((issue) => issue.level === "error");
  if (errors.length) {
    const listed = errors.map((issue) => ({ path: issue.path || "/", message: issue.message }));
    return { status: 400, body: { error: listed.map((issue) => `${issue.path}: ${issue.message}`).join("\n"), issues: listed } };
  }
  writeFlowFile(file, next);
  return { status: 200, body: { ok: true, name: next.name } };
}
