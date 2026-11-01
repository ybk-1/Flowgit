import { spawn } from "node:child_process";
import path from "node:path";
import type { ExecutorScript } from "../types.js";
import { findOnPath, outputRel, truncate } from "../util.js";
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
    const { code, output } = await new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn(ex.run, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "";
      const onData = (chunk: Buffer) => {
        const s = chunk.toString("utf8");
        buf += s;
        for (const line of s.split(/\r?\n/)) if (line.trim()) ctx.log(line);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("close", (c) => resolve({ code: c ?? 1, output: buf }));
    });
    if (code !== 0) {
      throw new Error(`命令失败，退出码 ${code} / Command exited with code ${code}: ${ex.run}\n${truncate(output, 2000)}`);
    }
    return { params: { run: ex.run, cwd: path.relative(loaded.dir, cwd) || ".", exitCode: code, output: truncate(output, LOG_CAP) } };
  },
};
