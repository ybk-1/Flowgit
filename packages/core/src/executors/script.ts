import path from "node:path";
import type { ExecutorScript } from "../types.js";
import { findOnPath, outputRel, truncate } from "../util.js";
import { runCommand } from "./command.js";
import type { ExecContext, ExecResult, StageExecutor } from "./types.js";

const LOG_CAP = 20_000;

/**
 * Runs a shell command in the flow directory. The command learns about the
 * stage through FLOWGIT_* environment variables and must write the declared
 * outputs itself.
 */
export const scriptExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const { stage, loaded } = ctx;
    const ex = stage.executor as ExecutorScript;
    const cwd = ex.cwd ? path.resolve(loaded.dir, ex.cwd) : loaded.dir;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(ctx.options.env ?? {}),
      ...(ex.env ?? {}),
      FLOWGIT_PROJECT_DIR: loaded.dir,
      FLOWGIT_STAGE: stage.id,
      FLOWGIT_STAGE_NAME: stage.name,
      FLOWGIT_INPUTS: JSON.stringify(
        ctx.inputs.map((i) => ({ stage: i.stage, path: outputRel(i.output), type: i.output.type })),
      ),
      FLOWGIT_OUTPUTS: JSON.stringify(stage.outputs.map((o) => ({ path: outputRel(o), type: o.type }))),
      FLOWGIT_FLOW_INPUTS: JSON.stringify(ctx.flowInputs),
    };
    const missing = (ex.requires ?? []).filter((program) => !findOnPath(program, env));
    if (missing.length) {
      throw new Error(
        `找不到 ${missing.join(", ")}：这个阶段需要它，请先安装再重跑 / ${missing.join(", ")} not found on PATH: this stage needs it; install it and run the stage again`,
      );
    }
    ctx.log(`$ ${ex.run}`);
    const { code, output } = await runCommand({
      command: ex.run,
      cwd,
      env,
      timeoutSec: ex.timeoutSec,
      onLine: (line) => ctx.log(line),
    });
    if (code !== 0) {
      throw new Error(`命令失败，退出码 ${code} / Command exited with code ${code}: ${ex.run}\n${truncate(output, 2000)}`);
    }
    return { params: { run: ex.run, cwd: path.relative(loaded.dir, cwd) || ".", exitCode: code, output: truncate(output, LOG_CAP) } };
  },
};
