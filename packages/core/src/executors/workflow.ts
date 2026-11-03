import { posixPath } from "../host/posix-path.js";
import { host, path } from "../host/current.js";
import { loadFlow } from "../load.js";
import {
  flowFileId,
  flowgitParams,
  normRel,
  renderInputTree,
  resolveSubflowFile,
  subflowEnterProblem,
  subflowStack,
} from "../subflow.js";
import type { ExecutorWorkflow } from "../types.js";
import { copyPath, isSafeRelative, outputRel } from "../util.js";
import { TokenBudgetError } from "../budget.js";
import { HumanInputNeededError, type ExecContext, type ExecResult, type RunOptions, type StageExecutor } from "./types.js";

const posix = posixPath();

const LOG_PREFIX = (id: string) => `[子流程 / sub-flow ${id}]`;

function inside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function bubbleWait(err: HumanInputNeededError, ctx: ExecContext, subDir: string): HumanInputNeededError {
  const subflowStage = err.subflowStage ?? { id: err.stage.id, name: err.stage.name };
  const base = path.relative(ctx.loaded.dir, subDir).split(path.sep).join("/");
  const missing = err.missing.map((rel) => (base ? posix.join(base, rel) : rel));
  return new HumanInputNeededError(ctx.stage, missing, err.instructions, subflowStage);
}

function copyOutputs(ctx: ExecContext, subDir: string, copy: Record<string, string>): void {
  const wanted = new Map(ctx.stage.outputs.map((out) => [normRel(outputRel(out)), out]));
  for (const [fromRel, toRel] of Object.entries(copy)) {
    if (!isSafeRelative(fromRel) || !isSafeRelative(toRel) || !normRel(fromRel) || normRel(fromRel) === ".") {
      throw new Error(`copy 的路径必须留在流程目录内 / copy paths must stay inside the flow directory: "${fromRel}" -> "${toRel}"`);
    }
    const output = wanted.get(normRel(toRel));
    if (!output) {
      throw new Error(`copy 的目标不是这个阶段的产物 / copy destination is not an output of this stage: "${toRel}"`);
    }
    const src = path.resolve(subDir, fromRel);
    const dst = path.join(ctx.loaded.dir, outputRel(output));
    if (!inside(subDir, src) || !inside(ctx.loaded.dir, dst)) {
      throw new Error(`copy 的路径必须留在流程目录内 / copy paths must stay inside the flow directory: "${fromRel}" -> "${toRel}"`);
    }
    if (!host().exists(src)) {
      throw new Error(`子流程没有这个产物 ${fromRel} / sub-flow did not produce ${fromRel}`);
    }
    host().rm(dst, { recursive: true, force: true });
    copyPath(src, dst);
    ctx.log(`已复制 / copied ${fromRel} -> ${outputRel(output)}`);
  }
  const covered = new Set(Object.values(copy).map(normRel));
  const missing = ctx.stage.outputs.map((out) => outputRel(out)).filter((rel) => !covered.has(normRel(rel)));
  if (missing.length) {
    throw new Error(`copy 没有覆盖产物 ${missing.join(", ")} / copy does not cover output(s): ${missing.join(", ")}`);
  }
}

export const workflowExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const ex = ctx.stage.executor as ExecutorWorkflow;
    if (ex.engine !== "flowgit") {
      throw new Error(
        `执行器 workflow 的引擎 "${ex.engine}" 还不能运行，目前只有 flowgit / workflow engine "${ex.engine}" cannot run yet; only "flowgit" can`,
      );
    }
    const resolved = resolveSubflowFile(ctx.loaded.dir, ex.file);
    if ("error" in resolved) throw new Error(resolved.error);
    const stack = subflowStack(ctx.loaded.file, ctx.options.flowStack);
    const problem = subflowEnterProblem(stack, resolved.abs);
    if (problem) throw new Error(problem);
    if (!host().exists(resolved.abs)) {
      throw new Error(`找不到子流程 / sub-flow file not found: ${ex.file}`);
    }
    const sub = loadFlow(path.dirname(resolved.abs));
    const params = flowgitParams(ex);
    const rendered = renderInputTree(params.inputs ?? {}, ctx.flowInputs) as Record<string, unknown>;
    const prefix = LOG_PREFIX(ctx.stage.id);
    let failedStageId: string | undefined;
    const options: RunOptions = {
      inputs: rendered,
      llm: ctx.options.llm,
      env: ctx.options.env,
      model: ctx.options.model,
      force: ctx.options.force,
      caller: ctx.options.caller,
      concurrency: ctx.options.concurrency,
      maxTokens: ctx.options.maxTokens,
      tokenLedger: ctx.options.tokenLedger,
      sleep: ctx.options.sleep,
      random: ctx.options.random,
      flowStack: [...stack, flowFileId(resolved.abs)],
      onEvent: (event) => {
        if (event.type === "stage:log") ctx.log(`${prefix} ${event.line}`);
        else if (event.type === "stage:start") ctx.log(`${prefix} 开始 / start ${event.stage.id}`);
        else if (event.type === "stage:skip") ctx.log(`${prefix} 跳过 / skip ${event.stage.id}: ${event.reason}`);
        else if (event.type === "stage:done") ctx.log(`${prefix} 完成 / done ${event.stage.id}`);
        else if (event.type === "stage:error") failedStageId = event.stage.id;
      },
    };
    const { runAll } = await import("../run.js");
    try {
      await runAll(sub, options);
    } catch (err) {
      if (err instanceof TokenBudgetError) throw err;
      if (err instanceof HumanInputNeededError) throw bubbleWait(err, ctx, sub.dir);
      const error = err as Error;
      if (error.message.includes("sub-flow stage") || error.message.includes("子流程的阶段")) throw error;
      const id = failedStageId ?? (error as { stage?: { id?: string } }).stage?.id;
      if (id) throw new Error(`子流程的阶段 "${id}" 失败 / sub-flow stage "${id}" failed: ${error.message}`);
      throw new Error(`子流程 ${ctx.stage.id} 失败 / sub-flow "${ctx.stage.id}" failed: ${error.message}`);
    }
    copyOutputs(ctx, sub.dir, params.copy ?? {});
    return { params: { engine: "flowgit", file: ex.file } };
  },
};
