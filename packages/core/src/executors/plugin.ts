import fs from "node:fs";
import path from "node:path";
import { loadFlowgitPlugin, resolveFlowPlugin, type PluginContext, type PluginOutput, type PluginStage, type PluginUpstream } from "../plugins.js";
import type { ExecutorPlugin, Output, Stage } from "../types.js";
import { isDirOutput, isSafeRelative, linkOutsideError, outputRel, staysInside } from "../util.js";
import type { ExecContext, ExecResult, InputArtifact, StageExecutor } from "./types.js";

function timeoutMessage(seconds: number): string {
  return `超时（${seconds} 秒），已停止 / Timed out after ${seconds}s and was stopped`;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("超时（");
}

function normRel(rel: string): string {
  return path.posix.normalize(rel.replace(/\\/g, "/")).replace(/^\.\//, "").replace(/\/+$/, "");
}

function stageView(stage: Stage): PluginStage {
  const outputs: PluginOutput[] = stage.outputs.map((out) => ({
    type: out.type,
    path: out.path,
    ...(out.description ? { description: out.description } : {}),
  }));
  return {
    id: stage.id,
    name: stage.name,
    ...(stage.description ? { description: stage.description } : {}),
    ...(stage.inputs ? { inputs: [...stage.inputs] } : {}),
    outputs,
  };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function outputAllowed(outputs: Output[], rel: string): boolean {
  return outputs.some((out) => {
    const declared = outputRel(out);
    if (isDirOutput(out)) return rel === declared || rel.startsWith(`${declared}/`);
    return rel === declared;
  });
}

/** Refuse a write that escapes the flow directory, including through a symlink. */
function assertWriteInside(flowDir: string, abs: string): void {
  let cursor = abs;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!staysInside(flowDir, cursor)) {
    throw new Error(`不能写到流程目录外面 / refusing to write outside the flow directory`);
  }
}

function upstreamOf(flowDir: string, inputs: InputArtifact[]): PluginUpstream {
  const files = new Map<string, string>();
  const paths: string[] = [];
  const add = (rel: string, abs: string) => {
    const key = rel.replace(/\\/g, "/");
    if (files.has(key)) return;
    files.set(key, abs);
    paths.push(key);
  };
  for (const artifact of inputs) {
    if (!artifact.exists) continue;
    const rel = outputRel(artifact.output);
    if (artifact.isDir && !artifact.outside) {
      for (const file of artifact.files ?? []) add(`${rel}/${file}`, path.join(artifact.absPath, file));
      continue;
    }
    add(rel, artifact.absPath);
  }
  return {
    paths,
    read(rel: string) {
      const key = normRel(rel);
      const abs = files.get(key);
      if (!abs) throw new Error(`没有这个上游产物 "${rel}" / no such upstream output "${rel}"`);
      if (!staysInside(flowDir, abs)) throw linkOutsideError(key);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        throw new Error(`"${rel}" 是文件夹，先读里面的文件 / "${rel}" is a directory; read a file inside it`);
      }
      return fs.readFileSync(abs, "utf8");
    },
  };
}

function buildContext(ctx: ExecContext, config: Record<string, unknown>, signal: AbortSignal): PluginContext {
  const flowDir = ctx.loaded.dir;
  return {
    flowDir,
    stage: stageView(ctx.stage),
    config,
    inputs: jsonClone(ctx.flowInputs),
    upstream: upstreamOf(flowDir, ctx.inputs),
    writeOutput(rel: string, data: string | Uint8Array) {
      if (typeof data !== "string" && !(data instanceof Uint8Array)) {
        throw new Error(`writeOutput 的内容必须是字符串或字节 / writeOutput data must be a string or bytes`);
      }
      const key = normRel(rel);
      if (!key || !isSafeRelative(key)) {
        throw new Error(`产物路径必须留在流程目录内 / output path must stay inside the flow directory: "${rel}"`);
      }
      if (!outputAllowed(ctx.stage.outputs, key)) {
        throw new Error(`插件只能写这个阶段声明的产物，收到 "${rel}" / a plugin can only write this stage's declared outputs, got "${rel}"`);
      }
      const abs = path.resolve(flowDir, key);
      assertWriteInside(flowDir, abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      ctx.log(`已写入 / wrote ${key}`);
    },
    log(line: string) {
      ctx.log(String(line));
    },
    signal,
  };
}

async function runPlugin(
  run: () => Promise<void>,
  signal: AbortSignal,
  timeoutSec: number | undefined,
  log: (line: string) => void,
): Promise<void> {
  const running = (async () => {
    await run();
  })();
  if (timeoutSec === undefined) {
    await running;
    return;
  }
  // Settle when the plugin returns or when `signal` aborts, whichever is first.
  // Removing the listener on the way out leaves no pending timer promise behind.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      log(`超时（${timeoutSec} 秒），正在停止 / timed out after ${timeoutSec}s, stopping`);
      finish(new Error(timeoutMessage(timeoutSec)));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
    running.then(
      () => finish(signal.aborted ? new Error(timeoutMessage(timeoutSec)) : undefined),
      (err) => finish(signal.aborted ? new Error(timeoutMessage(timeoutSec)) : err),
    );
  });
}

export const pluginExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const ex = ctx.stage.executor as ExecutorPlugin;
    const started = Date.now();
    const resolved = resolveFlowPlugin(ctx.loaded.dir, ex.plugin);
    const plugin = await loadFlowgitPlugin(resolved);
    const timeoutSec = ex.timeoutSec;
    const controller = new AbortController();
    const timer = typeof timeoutSec === "number" ? setTimeout(() => controller.abort(), timeoutSec * 1000) : undefined;
    const config = ex.config ? jsonClone(ex.config) : {};
    ctx.log(`插件 / plugin ${plugin.name} (${ex.plugin})`);
    try {
      await runPlugin(() => Promise.resolve(plugin.run(buildContext(ctx, config, controller.signal))), controller.signal, timeoutSec, ctx.log);
    } catch (err) {
      if (isTimeoutError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`插件 "${plugin.name}" 运行失败 / plugin "${plugin.name}" failed: ${message}`, { cause: err });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const shown = path.relative(ctx.loaded.dir, resolved.root);
    const display = shown && !shown.startsWith("..") && !path.isAbsolute(shown) ? shown.split(path.sep).join("/") : resolved.root;
    return {
      params: {
        plugin: ex.plugin,
        name: plugin.name,
        resolved: display,
        version: resolved.version ?? null,
        ...(timeoutSec ? { timeoutSec } : {}),
        durationMs: Date.now() - started,
      },
    };
  },
};
