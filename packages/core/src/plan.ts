import { host, path } from "./host/current.js";
import { DEFAULT_MODEL } from "./executors/llm.js";
import { mcpLaunchDetail } from "./mcp.js";
import { isRunnableExecutor } from "./executors/index.js";
import { topoOrder } from "./graph.js";
import { loadFlow } from "./load.js";
import { DEFAULT_PROVIDER, resolveModel } from "./providers.js";
import { loadFlowInputs, outputAbs, statusAll } from "./runs.js";
import { flowFileId, flowgitParams, renderInputTree, resolveSubflowFile, subflowEnterProblem, subflowStack } from "./subflow.js";
import type { LoadedFlow, Stage, StageState } from "./types.js";
import { outputRel, resolveConcurrency } from "./util.js";

/**
 * What `run all` would do with a stage:
 * skip (up to date), keep-edit (save the hand edit as a version, don't re-run),
 * run, wait (a person's stage with outputs missing: the run stops there),
 * cannot-run (a reserved executor: the run fails there), not-reached (after a stop).
 */
export type PlanAction = "skip" | "keep-edit" | "run" | "wait" | "cannot-run" | "not-reached";

export interface PlanStep {
  stage: Stage;
  state: StageState;
  action: PlanAction;
  /** What running it means: the model, command or agent, or what a person still has to provide. */
  detail?: string;
  /** This step calls a real model (an llm stage that runs, without canned replies). */
  callsModel: boolean;
  /**
   * Stages with the same number are started together, up to `concurrency`.
   * Set on steps the run would start (run, wait, cannot-run). Skip and keep-edit
   * are instant and have no wave.
   */
  together?: number;
  /** How many model calls this step would make. A sub-flow counts every llm stage inside it. Defaults to 1 when callsModel is set. */
  modelCalls?: number;
}

export interface PlanOptions {
  /** Same as `run --input`. */
  inputs?: Record<string, unknown>;
  /** Same as `run --model`. */
  model?: string;
  /** Same as `run all --force`: re-run stages that are up to date. */
  force?: boolean;
  /** Same as `run all --concurrency`. Unset uses the flow's `concurrency`, then 2. */
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
  /** @internal Absolute flow.json chain including the current flow. Set while planning a sub-flow. */
  flowStack?: string[];
}

/** At most how many model calls these steps make, counting every llm stage inside a sub-flow. */
export function planModelCalls(steps: PlanStep[]): number {
  return steps.reduce((n, step) => n + (step.modelCalls ?? (step.callsModel ? 1 : 0)), 0);
}

/** What a flowgit sub-flow would do, without running it. Other engines are not runnable. */
function describeWorkflow(loaded: LoadedFlow, stage: Stage, opts: PlanOptions): { detail?: string; callsModel: boolean; modelCalls?: number; action?: PlanAction } {
  const ex = stage.executor;
  if (ex.type !== "workflow" || ex.engine !== "flowgit") return { callsModel: false };
  const stack = subflowStack(loaded.file, opts.flowStack);
  const resolved = resolveSubflowFile(loaded.dir, ex.file);
  if ("error" in resolved) return { action: "cannot-run", detail: resolved.error, callsModel: false };
  const problem = subflowEnterProblem(stack, resolved.abs);
  if (problem) return { action: "cannot-run", detail: problem, callsModel: false };
  let sub: LoadedFlow;
  try {
    sub = loadFlow(path.dirname(resolved.abs));
  } catch (err) {
    return { action: "cannot-run", detail: (err as Error).message, callsModel: false };
  }
  let steps: PlanStep[];
  try {
    const parentInputs = loadFlowInputs(loaded.dir, loaded.flow, opts.inputs);
    const rendered = renderInputTree(flowgitParams(ex).inputs ?? {}, parentInputs) as Record<string, unknown>;
    steps = planRunAll(sub, { ...opts, inputs: rendered, flowStack: [...stack, flowFileId(resolved.abs)] });
  } catch (err) {
    return { action: "cannot-run", detail: (err as Error).message, callsModel: false };
  }
  const calls = planModelCalls(steps);
  const blocking = steps.find((step) => step.action === "wait" || step.action === "cannot-run");
  const file = `子流程 / sub-flow ${ex.file}`;
  if (blocking?.action === "cannot-run") return { action: "cannot-run", detail: blocking.detail ?? file, callsModel: false };
  if (blocking?.action === "wait") {
    return { action: "wait", detail: `${file}：${blocking.detail ?? ""}`.trim(), callsModel: calls > 0, modelCalls: calls };
  }
  return { detail: file, callsModel: calls > 0, modelCalls: calls };
}

function runDetail(loaded: LoadedFlow, stage: Stage, opts: PlanOptions, env: NodeJS.ProcessEnv): { detail?: string; callsModel: boolean; modelCalls?: number; action?: PlanAction } {
  const ex = stage.executor;
  switch (ex.type) {
    case "llm": {
      if (env.FLOWGIT_LLM_MOCK_DIR) return { detail: "固定回复 / canned reply", callsModel: false };
      const { provider, model } = resolveModel(opts.model ?? ex.model ?? env.FLOWGIT_MODEL ?? DEFAULT_MODEL, loaded.dir);
      return { detail: `模型 / model ${provider.id === DEFAULT_PROVIDER ? model : `${provider.id}/${model}`}`, callsModel: true, modelCalls: 1 };
    }
    case "script":
      return { detail: ex.run, callsModel: false };
    case "agent":
      return { detail: `agent ${ex.agent}`, callsModel: false };
    case "service":
      return { detail: `${ex.method ?? "POST"} ${ex.url}`, callsModel: false };
    case "mcp":
      return { detail: `MCP ${mcpLaunchDetail(loaded.flow.mcpServers?.[ex.server]) ?? ex.server} → ${ex.tool}`, callsModel: false };
    case "plugin":
      return { detail: `插件 / plugin ${ex.plugin}`, callsModel: false };
    case "image":
      if (env.FLOWGIT_IMAGE_MOCK_DIR) return { detail: "固定图片 / canned pictures", callsModel: false };
      return { detail: `生图 / image ${ex.model}`, callsModel: false };
    case "human":
      return { detail: "用已经放好的文件 / uses the files already in place", callsModel: false };
    case "workflow":
      return describeWorkflow(loaded, stage, opts);
    default:
      return { callsModel: false };
  }
}

/**
 * Dry run of `run all`: what it would do with each stage, in run order,
 * without running anything. Model calls are an upper bound: a stage that is
 * stale only because its upstream re-runs is skipped when that upstream's
 * output comes out the same.
 */
export function planRunAll(loaded: LoadedFlow, opts: PlanOptions = {}): PlanStep[] {
  const env = opts.env ?? host().env;
  const flowInputs = loadFlowInputs(loaded.dir, loaded.flow, opts.inputs);
  const state = new Map(statusAll(loaded, flowInputs).map((s) => [s.stage.id, s.state]));
  const steps: PlanStep[] = [];
  let stopped = false;
  for (const sid of topoOrder(loaded.flow)) {
    const stage = loaded.flow.stages.find((s) => s.id === sid)!;
    const st = state.get(sid)!;
    const step = (action: PlanAction, detail?: string, callsModel = false, modelCalls?: number) =>
      steps.push({ stage, state: st, action, detail, callsModel, ...(modelCalls ? { modelCalls } : {}) });
    if (stopped) step("not-reached");
    else if (!opts.force && st === "ok") step("skip");
    else if (!opts.force && st === "edited") step("keep-edit");
    else if (!isRunnableExecutor(stage.executor)) {
      const reserved =
        stage.executor.type === "workflow"
          ? `workflow 引擎 "${stage.executor.engine}" 还不能运行，目前只有 flowgit / workflow engine "${stage.executor.engine}" cannot run yet; only "flowgit" can`
          : `${stage.executor.type} 是预留的执行器，还不能运行 / ${stage.executor.type} is reserved and can't run yet`;
      step("cannot-run", reserved);
      stopped = true;
    } else if (stage.executor.type === "human") {
      const missing = stage.outputs.filter((o) => !host().exists(outputAbs(loaded.dir, o))).map((o) => outputRel(o));
      if (missing.length) {
        step("wait", `需要你放好 / needs ${missing.join(", ")}`);
        stopped = true;
      } else {
        step("run", runDetail(loaded, stage, opts, env).detail);
      }
    } else {
      const described = runDetail(loaded, stage, opts, env);
      if (described.action === "wait" || described.action === "cannot-run") {
        step(described.action, described.detail, described.callsModel, described.modelCalls);
        stopped = true;
      } else {
        step("run", described.detail, described.callsModel, described.modelCalls);
      }
    }
  }
  assignTogether(steps, resolveConcurrency(opts.concurrency ?? loaded.flow.concurrency));
  return steps;
}

/**
 * Number the steps a run would start. A wave takes up to `concurrency` stages
 * whose upstreams are already skipped, kept, or placed in an earlier wave.
 * A wait or a cannot-run ends the plan, same as `run all` stopping there.
 */
function assignTogether(steps: PlanStep[], concurrency: number): void {
  const order = steps.map((step) => step.stage.id);
  const byId = new Map(steps.map((step) => [step.stage.id, step]));
  const finished = new Set(steps.filter((step) => step.action === "skip" || step.action === "keep-edit").map((step) => step.stage.id));
  const pending = new Set(steps.filter((step) => step.action === "run" || step.action === "wait" || step.action === "cannot-run").map((step) => step.stage.id));
  let wave = 0;
  while (pending.size) {
    const ready: string[] = [];
    for (const id of order) {
      if (!pending.has(id)) continue;
      const deps = byId.get(id)!.stage.inputs ?? [];
      if (deps.every((dep) => finished.has(dep))) ready.push(id);
    }
    if (!ready.length) break;
    wave += 1;
    let blocking = false;
    for (const id of ready.slice(0, concurrency)) {
      const step = byId.get(id)!;
      step.together = wave;
      pending.delete(id);
      if (step.action === "run") finished.add(id);
      else blocking = true;
    }
    if (blocking) break;
  }
}
