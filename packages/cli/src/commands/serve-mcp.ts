import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Command } from "commander";
import {
  HumanInputNeededError,
  MissingInputsError,
  findOnPath,
  flowActions,
  isDirOutput,
  isTextType,
  latestOkRun,
  loadFlow,
  loadFlowInputs,
  outputAbs,
  outputRel,
  requireStage,
  resolveFlowInputs,
  runAll,
  runStage,
  statusAll,
  trustState,
  listFiles,
  type FlowAction,
  type FlowInput,
  type LoadedFlow,
  type RunOptions,
  type RunRecord,
  type Stage,
  DEFAULT_MODEL,
  resolveModel,
} from "@flowgit/core";

/** A text output bigger than this is returned as a path, not its content. */
export const MAX_TEXT_BYTES = 100_000;

/** Action kinds that need --allow-exec: they run commands, start processes or call services. */
const EXEC_KINDS = new Set<FlowAction["kind"]>(["script", "agent", "service", "mcp"] as FlowAction["kind"][]);

export interface ServeMcpOptions {
  /** Allow script, agent, service and mcp stages to run. */
  allowExec?: boolean;
  /** Model override for llm stages, like `flowgit run --model`. */
  model?: string;
  version: string;
}

type ToolArgs = Record<string, unknown>;

/* ---------- tool schemas ---------- */

/** JSON Schema for one flow input. "text" and "file" are strings; enum is kept. */
function inputSchema(def: FlowInput): Record<string, unknown> {
  const type = def.type === "number" ? "number" : def.type === "boolean" ? "boolean" : "string";
  const schema: Record<string, unknown> = { type };
  if (def.description) schema.description = def.description;
  if (def.enum) schema.enum = def.enum;
  if (def.default !== undefined) schema.default = def.default;
  return schema;
}

/** The run_flow parameters: exactly the flow inputs. Required ones that already have a value are optional here. */
export function flowInputsSchema(loaded: LoadedFlow): Tool["inputSchema"] {
  const defs = loaded.flow.inputs ?? {};
  const known = resolveFlowInputs(loaded.dir, loaded.flow);
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const [key, def] of Object.entries(defs)) {
    properties[key] = inputSchema(def);
    if (def.required && (known[key] === undefined || known[key] === "")) required.push(key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function toolList(loaded: LoadedFlow): Tool[] {
  const ids = loaded.flow.stages.map((s) => s.id);
  const stageList = loaded.flow.stages.map((s) => `${s.id} (${s.executor.type}): ${s.name}`).join("; ");
  const what = loaded.flow.description ? ` ${loaded.flow.description}` : "";
  return [
    {
      name: "run_flow",
      title: `运行流程 / Run ${loaded.flow.name}`,
      description:
        `Run the Flowgit flow "${loaded.flow.name}" from the start, skipping stages that are already up to date.${what} ` +
        `Stages: ${stageList}. Stops at a human stage that is waiting and says which files to prepare. ` +
        `Returns each stage's state and the final outputs.`,
      inputSchema: flowInputsSchema(loaded),
    },
    {
      name: "run_stage",
      title: "运行一个阶段 / Run one stage",
      description:
        "Run one stage of the flow again, even if it is up to date. Its upstream stages must have run. " +
        "For a human stage, `files` can supply the text of its outputs (output path → content).",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ids, description: "Stage id" },
          inputs: { type: "object", description: "Flow input overrides for this run", additionalProperties: true },
          files: {
            type: "object",
            description: "Human stages only: output path → text to write before the stage runs",
            additionalProperties: { type: "string" },
          },
        },
        required: ["stage"],
        additionalProperties: false,
      },
    },
    {
      name: "get_output",
      title: "读取产物 / Read outputs",
      description: `Read a stage's current outputs: text files as text (up to ${MAX_TEXT_BYTES} bytes), other files and folders as paths.`,
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ids, description: "Stage id" },
          path: { type: "string", description: "Only this output path (optional)" },
        },
        required: ["stage"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "status",
      title: "流程状态 / Flow status",
      description: "Every stage's state, latest version and outputs, the same as `flowgit status --json`.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
  ];
}

/* ---------- results ---------- */

function textResult(summary: string, data?: unknown): CallToolResult {
  const text = data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 2)}`;
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string, data?: unknown): CallToolResult {
  return { ...textResult(message, data), isError: true };
}

/** `flowgit status --json`, as an object. */
export function statusJson(loaded: LoadedFlow, overrides: Record<string, unknown> = {}) {
  let flowInputs: Record<string, unknown>;
  let missingInputs: string[] = [];
  try {
    flowInputs = loadFlowInputs(loaded.dir, loaded.flow, overrides);
  } catch (err) {
    if (!(err instanceof MissingInputsError)) throw err;
    missingInputs = err.missing;
    flowInputs = resolveFlowInputs(loaded.dir, loaded.flow, overrides);
  }
  return {
    flow: { name: loaded.flow.name, version: loaded.flow.version, dir: loaded.dir },
    missingInputs,
    stages: statusAll(loaded, flowInputs).map((s) => ({
      id: s.stage.id,
      name: s.stage.name,
      executor: s.stage.executor.type,
      state: s.state,
      runs: s.runs,
      latest: s.latest ? { n: s.latest.n, status: s.latest.status, finishedAt: s.latest.finishedAt } : null,
      current: s.current ?? null,
      missingUpstream: s.missingUpstream,
      outputs: s.stage.outputs,
    })),
  };
}

/** One output as the client sees it: text inline when small, otherwise its path. */
function readOutput(loaded: LoadedFlow, stage: Stage, rel: string) {
  const out = stage.outputs.find((o) => outputRel(o) === rel)!;
  const abs = outputAbs(loaded.dir, out);
  const base = { stage: stage.id, path: rel, type: out.type, absPath: abs };
  if (!fs.existsSync(abs)) return { ...base, exists: false };
  const st = fs.statSync(abs);
  if (st.isDirectory()) return { ...base, exists: true, isDir: true, files: listFiles(abs) };
  if (!isDirOutput(out) && isTextType(out.type, out.path) && st.size <= MAX_TEXT_BYTES) {
    return { ...base, exists: true, bytes: st.size, text: fs.readFileSync(abs, "utf8") };
  }
  return { ...base, exists: true, bytes: st.size, note: st.size > MAX_TEXT_BYTES ? "too big to inline / 太大，只给路径" : "binary / 二进制文件，只给路径" };
}

function stageOutputs(loaded: LoadedFlow, stage: Stage) {
  return stage.outputs.map((o) => readOutput(loaded, stage, outputRel(o)));
}

/** Stages nothing else reads from: their outputs are what the flow makes. */
function finalStages(loaded: LoadedFlow): Stage[] {
  const read = new Set(loaded.flow.stages.flatMap((s) => s.inputs ?? []));
  return loaded.flow.stages.filter((s) => !read.has(s.id));
}

function stageStates(loaded: LoadedFlow, overrides: Record<string, unknown>) {
  return statusJson(loaded, overrides).stages.map((s) => ({ id: s.id, name: s.name, executor: s.executor, state: s.state, latest: s.latest }));
}

/** What a waiting human stage needs, with absolute paths so the client can put the files there. */
function waitingInfo(loaded: LoadedFlow, err: HumanInputNeededError) {
  return {
    stage: err.stage.id,
    name: err.stage.name,
    ...(err.subflowStage ? { subflowStage: err.subflowStage } : {}),
    ...(err.instructions ? { instructions: err.instructions } : {}),
    files: err.missing.map((rel) => ({ path: rel, absPath: path.join(loaded.dir, rel) })),
    next: `把文件放好后再调用 run_flow，或者用 run_stage 的 files 直接给内容 / Put the files in place and call run_flow again, or pass their text in run_stage's files`,
  };
}

/* ---------- safety ---------- */

/** Actions that need --allow-exec, for the whole flow or one stage (and its sub-flow). */
export function execActions(loaded: LoadedFlow, stageId?: string): FlowAction[] {
  return flowActions(loaded.flow, loaded.dir).filter(
    (a) => EXEC_KINDS.has(a.kind) && (stageId === undefined || a.stage === stageId || a.stage.startsWith(`${stageId}/`)),
  );
}

export function execRefusal(actions: FlowAction[]): string {
  const list = actions.map((a) => `  - ${a.stage} (${a.kind}): ${a.detail}`).join("\n");
  return (
    `这个流程会在你的电脑上运行命令、启动程序或调用服务，所以 MCP 调用被拒绝了。确认没问题后，用 flowgit serve --mcp --allow-exec 启动服务器。\n` +
    `This flow runs commands, starts programs or calls services on your computer, so the MCP call was refused. If that is fine, start the server with flowgit serve --mcp --allow-exec.\n${list}`
  );
}

/* ---------- the server ---------- */

/** Text-file outputs of a human stage that a form can ask for; undefined when any missing one is not plain text. */
function askableFiles(loaded: LoadedFlow, err: HumanInputNeededError): string[] | undefined {
  if (err.subflowStage) return undefined;
  for (const rel of err.missing) {
    const out = err.stage.outputs.find((o) => outputRel(o) === rel);
    if (!out || isDirOutput(out) || !isTextType(out.type, out.path)) return undefined;
  }
  return err.missing;
}

function writeHumanFiles(loaded: LoadedFlow, stage: Stage, files: Record<string, unknown>): void {
  for (const [rel, text] of Object.entries(files)) {
    const out = stage.outputs.find((o) => outputRel(o) === rel);
    if (!out) {
      const known = stage.outputs.map((o) => outputRel(o)).join(", ");
      throw new Error(`「${stage.name}」没有产物 ${rel}，可以写的是 / stage "${stage.id}" has no output ${rel}; its outputs are: ${known}`);
    }
    if (isDirOutput(out) || typeof text !== "string") {
      throw new Error(`${rel} 只能给一段文字 / ${rel} takes a text string only`);
    }
    const abs = outputAbs(loaded.dir, out);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
}

export function createFlowMcpServer(dir: string, opts: ServeMcpOptions): Server {
  const first = loadFlow(dir);
  const server = new Server(
    { name: "flowgit", title: `Flowgit: ${first.flow.name}`, version: opts.version },
    {
      capabilities: { tools: {} },
      instructions:
        `This server runs the Flowgit flow "${first.flow.name}" in ${first.dir}. ` +
        `Call run_flow with the flow inputs; if it stops at a human stage, ask the user for the files it lists. ` +
        `Use get_output to read a stage's outputs and status to see every stage.`,
    },
  );
  let busy = false;
  // Inputs given in earlier calls of this session, so run_stage after a waiting run_flow needs no repeat.
  let remembered: Record<string, unknown> = {};
  const withRemembered = (given: Record<string, unknown>) => {
    remembered = { ...remembered, ...given };
    return remembered;
  };

  const clientName = () => {
    const v = server.getClientVersion();
    return v ? `${v.name}${v.version ? ` ${v.version}` : ""}` : undefined;
  };
  const runOptions = (inputs: Record<string, unknown>): RunOptions => {
    const client = clientName();
    return { inputs, model: opts.model, caller: client ? { via: "mcp", client } : { via: "mcp" } };
  };
  const canAsk = () => {
    const el = server.getClientCapabilities()?.elicitation as { form?: unknown; url?: unknown } | undefined;
    return !!el && (el.form !== undefined || el.url === undefined);
  };

  /** Ask the person for a waiting human stage's text files. True when they were written. */
  const askFor = async (loaded: LoadedFlow, err: HumanInputNeededError): Promise<boolean> => {
    const files = askableFiles(loaded, err);
    if (!files || !canAsk()) return false;
    const properties: Record<string, { type: "string"; title: string; description?: string }> = {};
    files.forEach((rel, i) => {
      properties[`file${i}`] = { type: "string", title: rel, ...(err.instructions ? { description: err.instructions } : {}) };
    });
    let answer;
    try {
      answer = await server.elicitInput({
        mode: "form",
        message: `「${err.stage.name}」需要你来写 / "${err.stage.name}" needs you: ${files.join(", ")}`,
        requestedSchema: { type: "object", properties, required: Object.keys(properties) },
      });
    } catch {
      return false; // the client said it can, but the request failed: fall back to "waiting"
    }
    if (answer.action !== "accept" || !answer.content) return false;
    const content = answer.content;
    writeHumanFiles(loaded, err.stage, Object.fromEntries(files.map((rel, i) => [rel, String(content[`file${i}`] ?? "")])));
    return true;
  };

  const runFlow = async (args: ToolArgs): Promise<CallToolResult> => {
    const loaded = loadFlow(dir);
    const exec = execActions(loaded);
    if (exec.length && !opts.allowExec) return errorResult(execRefusal(exec));
    const inputs = withRemembered(args);
    const records: RunRecord[] = [];
    // Each answered question lets the run go one human stage further.
    for (let round = 0; round <= loaded.flow.stages.length; round++) {
      try {
        records.push(...(await runAll(loaded, runOptions(inputs))));
        break;
      } catch (err) {
        if (err instanceof HumanInputNeededError) {
          if (await askFor(loaded, err)) continue;
          return textResult(`⏸ ${err.message}`, {
            status: "waiting",
            waiting: waitingInfo(loaded, err),
            ran: records.map((r) => ({ stage: r.stage, n: r.n, status: r.status })),
            stages: stageStates(loaded, inputs),
          });
        }
        throw err;
      }
    }
    const outputs = finalStages(loaded).flatMap((s) => stageOutputs(loaded, s));
    const summary = records.length
      ? `✓ 处理了 ${records.length} 个阶段 / ran ${records.length} stage(s)`
      : "✓ 没有要跑的，全部已是最新 / nothing to do, all stages up to date";
    return textResult(summary, {
      status: "done",
      ran: records.map((r) => ({ stage: r.stage, n: r.n, status: r.status, executor: r.executor })),
      stages: stageStates(loaded, inputs),
      outputs,
    });
  };

  const runOne = async (args: ToolArgs): Promise<CallToolResult> => {
    const loaded = loadFlow(dir);
    const stageId = String(args.stage ?? "");
    const stage = requireStage(loaded.flow, stageId);
    const exec = execActions(loaded, stageId);
    if (exec.length && !opts.allowExec) return errorResult(execRefusal(exec));
    const inputs = withRemembered((args.inputs && typeof args.inputs === "object" ? args.inputs : {}) as Record<string, unknown>);
    if (args.files !== undefined) {
      if (stage.executor.type !== "human") {
        return errorResult(`files 只能给人工阶段 / files only works for a human stage; "${stage.id}" is ${stage.executor.type}`);
      }
      writeHumanFiles(loaded, stage, args.files as Record<string, unknown>);
    }
    for (let round = 0; round < 2; round++) {
      try {
        const record = await runStage(loaded, stageId, runOptions(inputs));
        return textResult(`✓ 「${stage.name}」完成，v${record.n} / stage "${stage.id}" done as v${record.n}`, {
          status: "done",
          run: { stage: record.stage, n: record.n, executor: record.executor, params: record.params },
          outputs: stageOutputs(loaded, stage),
        });
      } catch (err) {
        if (err instanceof HumanInputNeededError) {
          if (round === 0 && (await askFor(loaded, err))) continue;
          return textResult(`⏸ ${err.message}`, { status: "waiting", waiting: waitingInfo(loaded, err) });
        }
        throw err;
      }
    }
    return errorResult("没有完成 / did not finish");
  };

  const getOutput = (args: ToolArgs): CallToolResult => {
    const loaded = loadFlow(dir);
    const stage = requireStage(loaded.flow, String(args.stage ?? ""));
    const latest = latestOkRun(loaded.dir, stage.id);
    if (args.path !== undefined) {
      const rel = String(args.path);
      if (!stage.outputs.some((o) => outputRel(o) === rel)) {
        const known = stage.outputs.map((o) => outputRel(o)).join(", ");
        return errorResult(`「${stage.name}」没有产物 ${rel} / stage "${stage.id}" has no output ${rel}; its outputs are: ${known}`);
      }
      return textResult(`「${stage.name}」/ ${stage.id}: ${rel}`, { latest: latest?.n ?? null, outputs: [readOutput(loaded, stage, rel)] });
    }
    return textResult(`「${stage.name}」/ ${stage.id}`, { latest: latest?.n ?? null, outputs: stageOutputs(loaded, stage) });
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList(loadFlow(dir)) }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as ToolArgs;
    try {
      if (name === "status") return textResult(`流程状态 / flow status`, statusJson(loadFlow(dir), remembered));
      if (name === "get_output") return getOutput(args);
      if (name !== "run_flow" && name !== "run_stage") return errorResult(`没有这个工具 / unknown tool: ${name}`);
      const trust = trustState(loadFlow(dir));
      if (trust.needed) {
        return errorResult(
          `这个流程是从别处复制来的，还没确认。先在终端里运行 flowgit trust，看过它会做什么再确认 / ` +
            `This flow was copied from elsewhere and hasn't been confirmed. Run flowgit trust in a terminal first, look at what it does, and confirm.`,
          { source: trust.source ?? null, actions: trust.actions },
        );
      }
      if (busy) return errorResult("已经有一次运行在进行，等它结束再试 / a run is already in progress; try again when it finishes");
      busy = true;
      try {
        return name === "run_flow" ? await runFlow(args) : await runOne(args);
      } finally {
        busy = false;
      }
    } catch (err) {
      if (err instanceof MissingInputsError) {
        return errorResult(
          `缺少流程输入：${err.missing.join(", ")}。在 run_flow 的参数或 run_stage 的 inputs 里传入 / Missing flow inputs: ${err.missing.join(", ")}. Pass them as run_flow parameters or in run_stage's inputs`,
        );
      }
      return errorResult((err as Error).message);
    }
  });

  return server;
}

/* ---------- client setup snippets ---------- */

/** How a client should start this server: `flowgit` when it is on PATH, otherwise node with this CLI's script. */
function launchCommand(dir: string, allowExec: boolean, model?: string): { command: string; args: string[] } {
  const tail = ["serve", "--mcp", dir, ...(allowExec ? ["--allow-exec"] : []), ...(model ? ["--model", model] : [])];
  // On Windows flowgit on PATH is a .cmd shim, which clients that start the command without a shell can't run.
  if (process.platform !== "win32" && findOnPath("flowgit")) return { command: "flowgit", args: tail };
  return { command: process.execPath, args: [path.resolve(process.argv[1] ?? "flowgit"), ...tail] };
}

/** Env vars the flow's llm stages read their keys from, as placeholders for the snippets. */
function keyVars(loaded: LoadedFlow, model?: string): string[] {
  const names = new Set<string>();
  for (const s of loaded.flow.stages) {
    if (s.executor.type !== "llm") continue;
    try {
      const spec = model ?? s.executor.model ?? process.env.FLOWGIT_MODEL ?? DEFAULT_MODEL;
      const key = resolveModel(spec, loaded.dir).provider.apiKeyEnv;
      if (key) names.add(key);
    } catch {
      // flowgit doctor reports an unknown provider
    }
  }
  return [...names];
}

function serverName(loaded: LoadedFlow): string {
  const id = (loaded.flow.id ?? path.basename(loaded.dir)).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `flowgit-${id || "flow"}`;
}

const quote = (s: string) => (/^[\w./:@=-]+$/.test(s) ? s : JSON.stringify(s));

export function printConfig(loaded: LoadedFlow, opts: { allowExec?: boolean; model?: string } = {}): string {
  const name = serverName(loaded);
  const { command, args } = launchCommand(loaded.dir, !!opts.allowExec, opts.model);
  const keys = keyVars(loaded, opts.model);
  const lines: string[] = [];
  const json = (env: Record<string, string>) =>
    JSON.stringify({ mcpServers: { [name]: { command, args, ...(Object.keys(env).length ? { env } : {}) } } }, null, 2);

  lines.push("# Claude Code");
  lines.push("# https://code.claude.com/docs/en/mcp");
  // --env before --transport: right before the name, the name would be read as another KEY=value.
  // Single quotes keep ${VAR} literal, so Claude Code expands it when it starts the server and the key is not saved.
  const envFlags = keys.map((k) => `--env '${k}=\${${k}}' `).join("");
  lines.push(`claude mcp add ${envFlags}--transport stdio ${name} -- ${[command, ...args].map(quote).join(" ")}`);
  lines.push("# 或者放进项目的 .mcp.json（${VAR} 会从环境变量展开）/ or in the project's .mcp.json (${VAR} expands from the environment):");
  lines.push(json(Object.fromEntries(keys.map((k) => [k, `\${${k}}`]))));
  lines.push("");
  lines.push("# Claude Desktop: claude_desktop_config.json");
  lines.push("# https://modelcontextprotocol.io/docs/develop/connect-local-servers");
  lines.push("#   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json");
  lines.push("#   Windows: %APPDATA%\\Claude\\claude_desktop_config.json");
  lines.push("#   Linux:   ~/.config/Claude/claude_desktop_config.json");
  if (keys.length) lines.push("# 不会展开环境变量，把 <你的密钥> 换成真的密钥 / env vars are not expanded here: replace <your key> with the key");
  lines.push(json(Object.fromEntries(keys.map((k) => [k, "<你的密钥 / your key>"]))));
  lines.push("");
  lines.push("# Cursor: .cursor/mcp.json（这个项目 / this project）or ~/.cursor/mcp.json（所有项目 / every project）");
  lines.push("# https://cursor.com/docs/context/mcp");
  lines.push(json(Object.fromEntries(keys.map((k) => [k, `\${env:${k}}`]))));
  return lines.join("\n");
}

/* ---------- the command ---------- */

export function registerServeMcp(program: Command, deps: { version: string; dirOf: () => string; fail: (err: unknown) => never }): void {
  program
    .command("serve")
    .description("把流程变成 MCP 服务器，给别的 AI 工具调用 / serve this flow as an MCP server for other AI tools")
    .argument("[dir]", "流程目录，默认是 -C 或当前目录 / flow directory (default: -C or the current one)")
    .option("--mcp", "在 stdio 上启动 MCP 服务器 / start an MCP server over stdio")
    .option("--allow-exec", "允许运行 script、agent、service 和 mcp 阶段 / allow script, agent, service and mcp stages to run")
    .option("--model <model>", "llm 阶段用的模型 / model for llm stages")
    .option("--print-config", "打印 Claude Code、Claude Desktop 和 Cursor 的接入配置 / print setup for Claude Code, Claude Desktop and Cursor")
    .action(async (dirArg: string | undefined, opts: { mcp?: boolean; allowExec?: boolean; model?: string; printConfig?: boolean }) => {
      try {
        if (!opts.mcp) throw new Error("现在只支持 --mcp：flowgit serve --mcp / only --mcp is supported for now: flowgit serve --mcp");
        const loaded = loadFlow(dirArg ? path.resolve(dirArg) : deps.dirOf());
        if (opts.printConfig) {
          console.log(printConfig(loaded, { allowExec: opts.allowExec, model: opts.model }));
          return;
        }
        const server = createFlowMcpServer(loaded.dir, { allowExec: opts.allowExec, model: opts.model, version: deps.version });
        await server.connect(new StdioServerTransport());
        // stdout is the MCP channel: anything for people goes to stderr.
        console.error(`flowgit MCP 服务器已启动 / MCP server started: ${loaded.flow.name} (${loaded.dir})`);
      } catch (err) {
        deps.fail(err);
      }
    });
}
