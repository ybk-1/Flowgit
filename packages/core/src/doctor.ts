import fs from "node:fs";
import path from "node:path";
import { AGENT_ADAPTERS } from "./executors/agent.js";
import { headerEnvNames } from "./executors/service.js";
import { DEFAULT_MODEL, ignoredProxyVar } from "./executors/llm.js";
import { isRunnableExecutor } from "./executors/index.js";
import { loadFlow } from "./load.js";
import { DEFAULT_PROVIDER, providerKeyState, resolveModel } from "./providers.js";
import { MissingInputsError, loadFlowInputs } from "./runs.js";
import { flowFileId, flowgitParams, renderInputTree, resolveSubflowFile, subflowEnterProblem, subflowStack } from "./subflow.js";
import type { ExecutorWorkflow, LoadedFlow, Stage } from "./types.js";
import { findOnPath } from "./util.js";

export type DoctorLevel = "ok" | "warn" | "error";

/** One line of `flowgit doctor`. Messages and hints are bilingual. */
export interface DoctorCheck {
  level: DoctorLevel;
  /** Stage id, when the check is about one stage. */
  stage?: string;
  message: string;
  /** What to do about it. */
  hint?: string;
}

export interface DoctorOptions {
  /** Same as `run --model`: check llm stages against this model. */
  model?: string;
  /** Flow input overrides, as with `run --input`. */
  inputs?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}

export const MIN_NODE_MAJOR = 22;

const SHELL_BUILTINS = new Set(["cd", "echo", "exit", "export", "set", "true", "false", "test", "[", "exec", "source", ".", "call", "start", "type"]);

/** The program a shell command starts, e.g. "node" in "node scripts/x.mjs". Undefined for paths, builtins and anything unclear. */
export function commandProgram(command: string): string | undefined {
  for (const word of command.trim().split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue; // FOO=bar prefix
    const clean = word.replace(/^['"]|['"]$/g, "");
    if (!/^[A-Za-z0-9_.+-]+$/.test(clean) || SHELL_BUILTINS.has(clean.toLowerCase())) return undefined;
    return clean;
  }
  return undefined;
}

function programCheck(stage: string, program: string, env: NodeJS.ProcessEnv, install?: string): DoctorCheck {
  return findOnPath(program, env)
    ? { level: "ok", stage, message: `找到 / found ${program}` }
    : {
        level: "error",
        stage,
        message: `找不到 ${program} / ${program} not found on PATH`,
        hint: install ? `安装 / install: ${install}` : `先安装 ${program}，或把它所在的文件夹加进 PATH / install ${program}, or add its folder to PATH`,
      };
}

function llmChecks(loaded: LoadedFlow, stage: Stage, opts: DoctorOptions, env: NodeJS.ProcessEnv): DoctorCheck[] {
  const ex = stage.executor;
  if (ex.type !== "llm") return [];
  const mockDir = env.FLOWGIT_LLM_MOCK_DIR;
  if (mockDir) {
    const dir = path.resolve(mockDir); // relative to the current folder, as in a run
    const file = ["md", "txt", "json"].map((e) => path.join(dir, `${stage.id}.${e}`)).find((f) => fs.existsSync(f));
    return [
      file
        ? { level: "ok", stage: stage.id, message: `用固定回复 / canned reply ${path.relative(loaded.dir, file) || file}` }
        : {
            level: "error",
            stage: stage.id,
            message: `FLOWGIT_LLM_MOCK_DIR 里没有这个阶段的回复 / no canned reply for this stage in FLOWGIT_LLM_MOCK_DIR`,
            hint: `需要 / expected ${stage.id}.md|txt|json in ${dir}`,
          },
    ];
  }
  const spec = opts.model ?? ex.model ?? env.FLOWGIT_MODEL ?? DEFAULT_MODEL;
  let resolved: ReturnType<typeof resolveModel>;
  try {
    resolved = resolveModel(spec, loaded.dir);
  } catch (err) {
    return [{ level: "error", stage: stage.id, message: (err as Error).message }];
  }
  const { provider, model } = resolved;
  const label = provider.id === DEFAULT_PROVIDER ? model : `${provider.id}/${model}`;
  const state = providerKeyState(provider, env);
  if (state === "none") {
    return [
      {
        level: "ok",
        stage: stage.id,
        message: `模型 ${label}，不需要密钥 / model ${label}, no key needed`,
        hint: `确认 ${provider.baseUrl} 上的服务在运行 / make sure the server at ${provider.baseUrl} is running`,
      },
    ];
  }
  if (state === "set") {
    return [{ level: "ok", stage: stage.id, message: `模型 ${label}，密钥 ${provider.apiKeyEnv} 已设置 / model ${label}, key ${provider.apiKeyEnv} is set` }];
  }
  const v = provider.apiKeyEnv ?? "";
  const demo = fs.existsSync(path.join(loaded.dir, "demo-replies"));
  return [
    {
      level: "error",
      stage: stage.id,
      message: `模型 ${label} 的密钥 ${v} 没有设置 / key ${v} for model ${label} is not set`,
      hint:
        `PowerShell：$env:${v}="..."；macOS/Linux：export ${v}=...` +
        (demo ? `\n或者先用示例回复试跑 / or try the canned replies first: FLOWGIT_LLM_MOCK_DIR=demo-replies` : ""),
    },
  ];
}

function workflowChecks(loaded: LoadedFlow, stage: Stage, opts: DoctorOptions, env: NodeJS.ProcessEnv, stack: string[]): DoctorCheck[] {
  const ex = stage.executor as ExecutorWorkflow;
  const stackNow = subflowStack(loaded.file, stack);
  const resolved = resolveSubflowFile(loaded.dir, ex.file);
  if ("error" in resolved) return [{ level: "error", stage: stage.id, message: resolved.error }];
  const problem = subflowEnterProblem(stackNow, resolved.abs);
  if (problem) return [{ level: "error", stage: stage.id, message: problem }];
  let sub: LoadedFlow;
  try {
    sub = loadFlow(path.dirname(resolved.abs));
  } catch (err) {
    return [{ level: "error", stage: stage.id, message: (err as Error).message }];
  }
  const checks: DoctorCheck[] = [{ level: "ok", stage: stage.id, message: `运行子流程 ${ex.file} / run the sub-flow ${ex.file}` }];
  let rendered: Record<string, unknown> = {};
  try {
    const parentInputs = loadFlowInputs(loaded.dir, loaded.flow, opts.inputs);
    rendered = renderInputTree(flowgitParams(ex).inputs ?? {}, parentInputs) as Record<string, unknown>;
    loadFlowInputs(sub.dir, sub.flow, rendered);
  } catch (err) {
    if (err instanceof MissingInputsError) {
      checks.push({
        level: "warn",
        stage: stage.id,
        message: `子流程还没填输入 / sub-flow inputs not set: ${err.missing.join(", ")}`,
        hint: `在 params.inputs 里传入 / pass them in params.inputs`,
      });
    } else {
      checks.push({ level: "error", stage: stage.id, message: (err as Error).message });
    }
  }
  const nextStack = [...stackNow, flowFileId(resolved.abs)];
  for (const child of sub.flow.stages) {
    for (const check of stageChecks(sub, child, { ...opts, inputs: rendered }, env, nextStack)) {
      checks.push({ ...check, stage: check.stage ? `${stage.id}/${check.stage}` : stage.id });
    }
  }
  return checks;
}

/** True when this flow, or a flowgit sub-flow under it, has an llm stage. */
function flowUsesLlm(loaded: LoadedFlow, stack?: string[]): boolean {
  const stackNow = subflowStack(loaded.file, stack);
  for (const stage of loaded.flow.stages) {
    const ex = stage.executor;
    if (ex.type === "llm") return true;
    if (ex.type !== "workflow" || ex.engine !== "flowgit") continue;
    const resolved = resolveSubflowFile(loaded.dir, ex.file);
    if ("error" in resolved || subflowEnterProblem(stackNow, resolved.abs)) continue;
    try {
      if (flowUsesLlm(loadFlow(path.dirname(resolved.abs)), [...stackNow, flowFileId(resolved.abs)])) return true;
    } catch {
      // workflowChecks reports a sub-flow that cannot be loaded
    }
  }
  return false;
}

function stageChecks(loaded: LoadedFlow, stage: Stage, opts: DoctorOptions, env: NodeJS.ProcessEnv, stack: string[] = []): DoctorCheck[] {
  const ex = stage.executor;
  if (!isRunnableExecutor(ex)) {
    if (ex.type === "workflow") {
      return [{
        level: "warn",
        stage: stage.id,
        message: `workflow 引擎 "${ex.engine}" 还不能运行，目前只有 flowgit / workflow engine "${ex.engine}" cannot run yet; only "flowgit" can`,
      }];
    }
    return [{ level: "warn", stage: stage.id, message: `${ex.type} 执行器在 v0.1 还不能运行 / the ${ex.type} executor is reserved and can't run in v0.1` }];
  }
  switch (ex.type) {
    case "human":
      return [];
    case "llm":
      return llmChecks(loaded, stage, opts, env);
    case "script": {
      const programs = [commandProgram(ex.run), ...(ex.requires ?? [])].filter((p): p is string => !!p);
      return [...new Set(programs)].map((p) => programCheck(stage.id, p, env));
    }
    case "workflow":
      return workflowChecks(loaded, stage, opts, env, stack);
    case "service":
      return headerEnvNames(ex.headers).map((name) =>
        env[name]
          ? { level: "ok" as const, stage: stage.id, message: `请求头里的 ${name} 已设置 / header env ${name} is set` }
          : {
              level: "error" as const,
              stage: stage.id,
              message: `请求头里的环境变量 ${name} 没有设置 / header env ${name} is not set`,
              hint: `PowerShell：$env:${name}="..."；macOS/Linux：export ${name}=...`,
            },
      );
    case "agent": {
      if (ex.agent === "custom") {
        const program = ex.command ? commandProgram(ex.command) : undefined;
        return program ? [programCheck(stage.id, program, env)] : [];
      }
      const adapter = AGENT_ADAPTERS[ex.agent];
      const checks = [programCheck(stage.id, adapter.bin, env, `${adapter.install} (${adapter.docs})`)];
      if (ex.agent === "cursor" && !(ex.args ?? []).some((a) => ["--force", "-f", "--yolo"].includes(a))) {
        checks.push({
          level: "warn",
          stage: stage.id,
          message: "Cursor 不加 --force 只会提出修改，不会写文件 / without --force Cursor only proposes changes and writes nothing",
          hint: '--force 同时允许它执行命令；信任这个流程的话，在 executor.args 里加上 "--force" / --force also lets it run commands; if you trust this flow, add "--force" to executor.args',
        });
      }
      return checks;
    }
    default:
      return [];
  }
}

/**
 * Check whether this machine can run a flow: Node version, flow inputs, model keys
 * (or canned replies), proxy settings, and the programs that script and agent
 * stages start. Makes no network calls and runs nothing.
 */
export function doctor(loaded: LoadedFlow, opts: DoctorOptions = {}): DoctorCheck[] {
  const env = opts.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const node = process.versions.node;
  checks.push(
    Number(node.split(".")[0]) >= MIN_NODE_MAJOR
      ? { level: "ok", message: `Node.js ${node}` }
      : { level: "error", message: `Node.js ${node} 太旧，需要 ${MIN_NODE_MAJOR} 或更新 / Node.js ${node} is too old; needs ${MIN_NODE_MAJOR} or newer`, hint: "https://nodejs.org" },
  );

  if (Object.keys(loaded.flow.inputs ?? {}).length) {
    try {
      loadFlowInputs(loaded.dir, loaded.flow, opts.inputs);
      checks.push({ level: "ok", message: "流程输入都填好了 / flow inputs are set" });
    } catch (err) {
      if (err instanceof MissingInputsError) {
        checks.push({
          level: "warn",
          message: `还没填流程输入 / flow inputs not set: ${err.missing.join(", ")}`,
          hint: `flowgit inputs set ${err.missing[0]}=...`,
        });
      } else {
        checks.push({ level: "error", message: (err as Error).message });
      }
    }
  }

  // Stages with the same result share one line, e.g. "edit, export: found node".
  const merged: DoctorCheck[] = [];
  for (const ch of loaded.flow.stages.flatMap((s) => stageChecks(loaded, s, opts, env))) {
    const same = merged.find((m) => m.level === ch.level && m.message === ch.message && m.hint === ch.hint);
    if (same) same.stage = `${same.stage}, ${ch.stage}`;
    else merged.push(ch);
  }
  checks.push(...merged);

  const callsModels = !env.FLOWGIT_LLM_MOCK_DIR && flowUsesLlm(loaded);
  const proxy = callsModels ? ignoredProxyVar(env) : undefined;
  if (proxy) {
    checks.push({
      level: "warn",
      message: `设置了 ${proxy}，但 Node 默认不走代理。要通过代理连模型的话，再设置 NODE_USE_ENV_PROXY=1 / ${proxy} is set, but Node ignores proxies by default. If you need it to reach the model, also set NODE_USE_ENV_PROXY=1`,
      hint: 'PowerShell：$env:NODE_USE_ENV_PROXY="1"；macOS/Linux：export NODE_USE_ENV_PROXY=1',
    });
  }
  return checks;
}
