import fs from "node:fs";
import { DEFAULT_MODEL } from "./executors/llm.js";
import { isRunnableExecutor } from "./executors/index.js";
import { topoOrder } from "./graph.js";
import { DEFAULT_PROVIDER, resolveModel } from "./providers.js";
import { loadFlowInputs, outputAbs, statusAll } from "./runs.js";
import type { LoadedFlow, Stage, StageState } from "./types.js";
import { outputRel } from "./util.js";

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
}

export interface PlanOptions {
  /** Same as `run --input`. */
  inputs?: Record<string, unknown>;
  /** Same as `run --model`. */
  model?: string;
  /** Same as `run all --force`: re-run stages that are up to date. */
  force?: boolean;
  env?: NodeJS.ProcessEnv;
}

function runDetail(loaded: LoadedFlow, stage: Stage, opts: PlanOptions, env: NodeJS.ProcessEnv): { detail?: string; callsModel: boolean } {
  const ex = stage.executor;
  switch (ex.type) {
    case "llm": {
      if (env.FLOWGIT_LLM_MOCK_DIR) return { detail: "固定回复 / canned reply", callsModel: false };
      const { provider, model } = resolveModel(opts.model ?? ex.model ?? env.FLOWGIT_MODEL ?? DEFAULT_MODEL, loaded.dir);
      return { detail: `模型 / model ${provider.id === DEFAULT_PROVIDER ? model : `${provider.id}/${model}`}`, callsModel: true };
    }
    case "script":
      return { detail: ex.run, callsModel: false };
    case "agent":
      return { detail: `agent ${ex.agent}`, callsModel: false };
    case "service":
      return { detail: `${ex.method ?? "POST"} ${ex.url}`, callsModel: false };
    case "human":
      return { detail: "用已经放好的文件 / uses the files already in place", callsModel: false };
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
  const env = opts.env ?? process.env;
  const flowInputs = loadFlowInputs(loaded.dir, loaded.flow, opts.inputs);
  const state = new Map(statusAll(loaded, flowInputs).map((s) => [s.stage.id, s.state]));
  const steps: PlanStep[] = [];
  let stopped = false;
  for (const sid of topoOrder(loaded.flow)) {
    const stage = loaded.flow.stages.find((s) => s.id === sid)!;
    const st = state.get(sid)!;
    const step = (action: PlanAction, detail?: string, callsModel = false) => steps.push({ stage, state: st, action, detail, callsModel });
    if (stopped) step("not-reached");
    else if (!opts.force && st === "ok") step("skip");
    else if (!opts.force && st === "edited") step("keep-edit");
    else if (!isRunnableExecutor(stage.executor.type)) {
      step("cannot-run", `${stage.executor.type} 是预留的执行器，还不能运行 / ${stage.executor.type} is reserved and can't run yet`);
      stopped = true;
    } else if (stage.executor.type === "human") {
      const missing = stage.outputs.filter((o) => !fs.existsSync(outputAbs(loaded.dir, o))).map((o) => outputRel(o));
      if (missing.length) {
        step("wait", `需要你放好 / needs ${missing.join(", ")}`);
        stopped = true;
      } else {
        step("run", runDetail(loaded, stage, opts, env).detail);
      }
    } else {
      const { detail, callsModel } = runDetail(loaded, stage, opts, env);
      step("run", detail, callsModel);
    }
  }
  return steps;
}
