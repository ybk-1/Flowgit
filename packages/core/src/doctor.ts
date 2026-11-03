import fs from "node:fs";
import path from "node:path";
import { AGENT_ADAPTERS } from "./executors/agent.js";
import { headerEnvNames } from "./executors/service.js";
import { DEFAULT_MODEL } from "./executors/llm.js";
import { isRunnableExecutor } from "./executors/index.js";
import { loadFlow } from "./load.js";
import { isHttpServer, isStdioServer, mcpEnvNames } from "./mcp.js";
import { inspectPlugin } from "./plugins.js";
import { imageKeyState, resolveImageModel } from "./image-providers.js";
import { DEFAULT_PROVIDER, flowKeyEndpoint, flowKeyEndpointNote, providerKeyState, resolveModel, type ResolvedProvider } from "./providers.js";
import { pickProxy, proxyOff, proxyProblem, proxySourceLabel, showProxy, systemProxy, type ProxyInfo } from "./proxy.js";
import { MissingInputsError, loadFlowInputs } from "./runs.js";
import { flowFileId, flowgitParams, renderInputTree, resolveSubflowFile, subflowEnterProblem, subflowStack } from "./subflow.js";
import type { ExecutorWorkflow, LoadedFlow, Stage } from "./types.js";
import { trustState } from "./trust.js";
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
  /** Looks up the system proxy; tests pass their own. */
  systemProxy?: () => ProxyInfo | undefined;
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
  const localEndpoint = flowKeyEndpoint(provider, loaded.dir);
  const endpoint: DoctorCheck[] = localEndpoint
    ? [
        {
          level: "warn",
          stage: stage.id,
          message: flowKeyEndpointNote(provider, localEndpoint),
          hint: `不是你自己改的就删掉 flowgit.local.json 里的 providers.${provider.id} / if you didn't set it yourself, delete providers.${provider.id} from flowgit.local.json`,
        },
      ]
    : [];
  return [...endpoint, ...keyChecks(loaded, stage, provider, label, env)];
}

function keyChecks(loaded: LoadedFlow, stage: Stage, provider: ResolvedProvider, label: string, env: NodeJS.ProcessEnv): DoctorCheck[] {
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

/**
 * Preset id → key env. Keep this in step with
 * packages/cli/templates/short-video/scripts/tts-presets.mjs.
 * `extra` is a non-secret value the official URL needs (workspace id or region).
 */
const TTS_PRESETS: Record<string, { key: string; extra?: string }> = {
  openai: { key: "OPENAI_API_KEY" },
  dashscope: { key: "DASHSCOPE_API_KEY", extra: "DASHSCOPE_WORKSPACE_ID" },
  volcengine: { key: "VOLCENGINE_API_KEY" },
  minimax: { key: "MINIMAX_API_KEY" },
  azure: { key: "SPEECH_KEY", extra: "SPEECH_REGION" },
};

/** The short-video template's voice stage. A missing key skips synthesis; that is a warning, not a failure. */
function ttsCheck(stageId: string, command: string, env: NodeJS.ProcessEnv): DoctorCheck | undefined {
  if (!/(?:^|\s)["']?scripts\/tts\.mjs["']?(?:\s|$)/.test(command)) return undefined;
  const selected = env.FLOWGIT_TTS?.trim() ?? "";
  if (selected) {
    const slash = selected.indexOf("/");
    const id = (slash > 0 ? selected.slice(0, slash) : selected).toLowerCase();
    const preset = slash > 0 && slash < selected.length - 1 ? TTS_PRESETS[id] : undefined;
    if (!preset) {
      return {
        level: "error",
        stage: stageId,
        message: `不认识的语音预设 ${selected}。运行 node scripts/tts.mjs --list 查看 / Unknown speech preset ${selected}. Run node scripts/tts.mjs --list`,
      };
    }
    const override = env.FLOWGIT_TTS_API_KEY?.trim() ?? "";
    const vendor = env[preset.key]?.trim() ?? "";
    if (!override && !vendor) {
      return {
        level: "error",
        stage: stageId,
        message: `没有设置 ${preset.key}，配音阶段会失败 / ${preset.key} is not set, so the voice stage fails`,
        hint:
          `设置 ${preset.key}，或用 FLOWGIT_TTS_API_KEY 覆盖（PowerShell：$env:${preset.key}="..."；macOS/Linux：export ${preset.key}=...）\n` +
          `Set ${preset.key}, or override it with FLOWGIT_TTS_API_KEY (PowerShell: $env:${preset.key}="..."; macOS/Linux: export ${preset.key}=...)`,
      };
    }
    if (preset.extra && !env.FLOWGIT_TTS_BASE_URL?.trim() && !env[preset.extra]?.trim()) {
      return {
        level: "error",
        stage: stageId,
        message: `没有设置 ${preset.extra}，配音阶段拼不出接口地址 / ${preset.extra} is not set, so the voice stage cannot build the speech URL`,
        hint: `也可以设置 FLOWGIT_TTS_BASE_URL / or set FLOWGIT_TTS_BASE_URL`,
      };
    }
    const keyName = override ? "FLOWGIT_TTS_API_KEY" : preset.key;
    return { level: "ok", stage: stageId, message: `${keyName} 已设置 / ${keyName} is set` };
  }
  if (env.FLOWGIT_TTS_API_KEY?.trim()) {
    return { level: "ok", stage: stageId, message: "FLOWGIT_TTS_API_KEY 已设置 / FLOWGIT_TTS_API_KEY is set" };
  }
  return {
    level: "warn",
    stage: stageId,
    message: "没有设置 FLOWGIT_TTS_API_KEY，配音阶段会跳过自动配音 / FLOWGIT_TTS_API_KEY is not set, so the voice stage skips automatic voiceover",
    hint:
      '可以自己录 assets/voice.mp3，或设置 FLOWGIT_TTS_API_KEY（PowerShell：$env:FLOWGIT_TTS_API_KEY="..."；macOS/Linux：export FLOWGIT_TTS_API_KEY=...）\n' +
      'Record assets/voice.mp3 yourself, or set FLOWGIT_TTS_API_KEY (PowerShell: $env:FLOWGIT_TTS_API_KEY="..."; macOS/Linux: export FLOWGIT_TTS_API_KEY=...)',
  };
}

function imageChecks(stage: Stage, env: NodeJS.ProcessEnv): DoctorCheck[] {
  const ex = stage.executor;
  if (ex.type !== "image") return [];
  const mockDir = env.FLOWGIT_IMAGE_MOCK_DIR;
  if (mockDir) {
    const dir = path.join(path.resolve(mockDir), stage.id);
    const pictures = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
      ? fs.readdirSync(dir).filter((name) => [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(name).toLowerCase()))
      : [];
    return [
      pictures.length
        ? { level: "ok", stage: stage.id, message: `用固定图片 / canned pictures in ${dir}` }
        : {
            level: "error",
            stage: stage.id,
            message: `FLOWGIT_IMAGE_MOCK_DIR 里没有这个阶段的图片 / no canned pictures for this stage in FLOWGIT_IMAGE_MOCK_DIR`,
            hint: `需要 / expected pictures in ${dir}`,
          },
    ];
  }
  let label = ex.model;
  let apiKeyEnv = "";
  try {
    const resolved = resolveImageModel(ex.model, env);
    label = `${resolved.preset.id}/${resolved.model}`;
    apiKeyEnv = resolved.preset.apiKeyEnv;
  } catch (err) {
    return [{ level: "error", stage: stage.id, message: (err as Error).message }];
  }
  if (imageKeyState({ apiKeyEnv }, env) === "set") {
    return [{ level: "ok", stage: stage.id, message: `生图 ${label}，密钥 ${apiKeyEnv} 已设置 / image ${label}, key ${apiKeyEnv} is set` }];
  }
  return [
    {
      level: "error",
      stage: stage.id,
      message: `生图 ${label} 的密钥 ${apiKeyEnv} 没有设置 / key ${apiKeyEnv} for image ${label} is not set`,
      hint:
        `PowerShell：$env:${apiKeyEnv}="..."；macOS/Linux：export ${apiKeyEnv}=...\n` +
        `或者先用固定图片试跑 / or try canned pictures first: FLOWGIT_IMAGE_MOCK_DIR=<目录 directory>`,
    },
  ];
}

function pluginChecks(loaded: LoadedFlow, stage: Stage): DoctorCheck[] {
  const ex = stage.executor;
  if (ex.type !== "plugin") return [];
  const report = inspectPlugin(loaded.dir, ex.plugin);
  return [
    {
      level: report.missing ? "error" : "ok",
      stage: stage.id,
      message: report.message,
      ...(report.hint ? { hint: report.hint } : {}),
    },
  ];
}

function mcpChecks(loaded: LoadedFlow, stage: Stage, env: NodeJS.ProcessEnv): DoctorCheck[] {
  const ex = stage.executor;
  if (ex.type !== "mcp") return [];
  const server = loaded.flow.mcpServers?.[ex.server];
  if (!server) {
    return [{
      level: "error",
      stage: stage.id,
      message: `MCP 服务器 "${ex.server}" 没有在 mcpServers 里定义 / MCP server "${ex.server}" is not defined in mcpServers`,
    }];
  }
  if (isHttpServer(server)) {
    return [{ level: "ok", stage: stage.id, message: `远程 MCP / remote MCP ${server.url}` }];
  }
  if (!isStdioServer(server)) return [];
  const command = server.command.includes("/") || server.command.includes("\\")
    ? pathExistsCheck(stage.id, server.command, loaded.dir)
    : programCheck(stage.id, server.command, env);
  const vars = mcpEnvNames(server.env).map((name) =>
    env[name]
      ? { level: "ok" as const, stage: stage.id, message: `MCP 环境变量 ${name} 已设置 / MCP env ${name} is set` }
      : {
          level: "error" as const,
          stage: stage.id,
          message: `MCP 环境变量 ${name} 没有设置 / MCP env ${name} is not set`,
          hint: `PowerShell：$env:${name}="..."；macOS/Linux：export ${name}=...`,
        },
  );
  return [command, ...vars];
}

function pathExistsCheck(stage: string, command: string, dir: string): DoctorCheck {
  const abs = path.isAbsolute(command) ? command : path.resolve(dir, command);
  return fs.existsSync(abs)
    ? { level: "ok", stage, message: `找到 / found ${command}` }
    : {
        level: "error",
        stage,
        message: `找不到 ${command} / ${command} not found`,
        hint: "确认这个路径是对的 / check that path",
      };
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
      const checks = [...new Set(programs)].map((p) => programCheck(stage.id, p, env));
      const tts = ttsCheck(stage.id, ex.run, env);
      if (tts) checks.push(tts);
      return checks;
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
    case "mcp":
      return mcpChecks(loaded, stage, env);
    case "plugin":
      return pluginChecks(loaded, stage);
    case "image":
      return imageChecks(stage, env);
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
 * (or canned replies), proxy settings, the programs that script and agent
 * stages start, and whether each plugin resolves. A short-video voice stage with no FLOWGIT_TTS_API_KEY is a
 * warning, not an error. Makes no network calls and runs nothing.
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

  const trust = trustState(loaded, env);
  if (trust.needed) {
    checks.push({
      level: "warn",
      message:
        trust.reason === "changed"
          ? `要运行的命令和你上次确认的不一样了 / the commands changed since you confirmed them`
          : `从 ${trust.source ?? "?"} 复制来的流程，还没确认它会做的事 / copied from ${trust.source ?? "?"}; what it does hasn't been confirmed yet`,
      hint: `flowgit trust 看一眼并确认，第一次运行时也会问你 / run flowgit trust to look and confirm; the first run asks too`,
    });
  } else if (trust.reason === "trusted") {
    checks.push({ level: "ok", message: `已确认从 ${trust.source ?? "?"} 复制来的流程 / confirmed the flow copied from ${trust.source ?? "?"}` });
  }

  // Stages with the same result share one line, e.g. "edit, export: found node".
  const merged: DoctorCheck[] = [];
  for (const ch of loaded.flow.stages.flatMap((s) => stageChecks(loaded, s, opts, env))) {
    const same = merged.find((m) => m.level === ch.level && m.message === ch.message && m.hint === ch.hint);
    if (same) same.stage = `${same.stage}, ${ch.stage}`;
    else merged.push(ch);
  }
  checks.push(...merged);

  // llm stages inside a flowgit sub-flow call models too
  const callsNetwork =
    loaded.flow.stages.some((s) => s.executor.type === "service" || (s.executor.type === "image" && !env.FLOWGIT_IMAGE_MOCK_DIR)) ||
    (!env.FLOWGIT_LLM_MOCK_DIR && flowUsesLlm(loaded));
  if (callsNetwork) checks.push(...proxyChecks(env, opts.systemProxy ?? systemProxy));
  return checks;
}

/** The proxy that model and service requests will go through, as `flowgit run` picks it. */
function proxyChecks(env: NodeJS.ProcessEnv, system: () => ProxyInfo | undefined): DoctorCheck[] {
  if (proxyOff(env)) return [{ level: "ok", message: "不走代理（FLOWGIT_PROXY=off）/ not using a proxy (FLOWGIT_PROXY=off)" }];
  const proxy = pickProxy(env, system);
  if (!proxy) return [];
  const problem = proxyProblem(proxy);
  if (problem) return [{ level: "warn", message: problem.join(" / ") }];
  const [zh, en] = proxySourceLabel(proxy);
  const where = showProxy(proxy.url);
  return [
    {
      level: "ok",
      message: `模型和服务请求走代理 ${where}（${zh}）/ model and service requests go through ${where} (${en})`,
      hint: "不想走代理就设置 FLOWGIT_PROXY=off / set FLOWGIT_PROXY=off to skip it",
    },
  ];
}
