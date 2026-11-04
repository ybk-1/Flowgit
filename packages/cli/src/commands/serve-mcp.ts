import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Command } from "commander";
import {
  HumanInputNeededError,
  askableFiles,
  callMcpTool,
  execActions,
  execRefusal,
  findOnPath,
  isMcpRunTool,
  loadFlow,
  mcpInstructions,
  mcpTools,
  runAll,
  runStage,
  trustState,
  writeHumanFiles,
  type LoadedFlow,
  type McpRunOutcome,
  type McpToolBackend,
  type McpWaiting,
  type RunOptions,
  type RunRecord,
  DEFAULT_MODEL,
  resolveModel,
} from "@flowgit/core";

// The tools themselves live in @flowgit/core (mcp-tools.ts), shared with the cloud's remote MCP URL.

export interface ServeMcpOptions {
  /** Allow script, agent, service, mcp, plugin and image stages to run. */
  allowExec?: boolean;
  /** Model override for llm stages, like `flowgit run --model`. */
  model?: string;
  version: string;
}

function waitingOf(err: HumanInputNeededError): McpWaiting {
  return {
    stage: err.stage.id,
    name: err.stage.name,
    kind: "human",
    missing: err.missing,
    ...(err.instructions ? { instructions: err.instructions } : {}),
    ...(err.subflowStage ? { subflowStage: err.subflowStage } : {}),
  };
}

const TRUST_REFUSAL =
  `这个流程是从别处复制来的，还没确认。先在终端里运行 flowgit trust，看过它会做什么再确认 / ` +
  `This flow was copied from elsewhere and hasn't been confirmed. Run flowgit trust in a terminal first, look at what it does, and confirm.`;

export function createFlowMcpServer(dir: string, opts: ServeMcpOptions): Server {
  const first = loadFlow(dir);
  const server = new Server(
    { name: "flowgit", title: `Flowgit: ${first.flow.name}`, version: opts.version },
    { capabilities: { tools: {} }, instructions: mcpInstructions(first, `in ${first.dir}`) },
  );
  let busy = false;
  // Inputs given in earlier calls of this session, so run_stage after a waiting run_flow needs no repeat.
  let remembered: Record<string, unknown> = {};

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
    const files = askableFiles(err.stage, waitingOf(err));
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

  const backend: McpToolBackend = {
    localPaths: true,
    load: () => loadFlow(dir),
    inputs: (given) => {
      remembered = { ...remembered, ...given };
      return remembered;
    },
    refuse: (loaded, stageId) => {
      const trust = trustState(loaded);
      if (trust.needed) return { message: TRUST_REFUSAL, data: { source: trust.source ?? null, actions: trust.actions } };
      const exec = execActions(loaded, stageId);
      if (exec.length && !opts.allowExec) return { message: execRefusal(exec) };
      return undefined;
    },
    runFlow: async (loaded, inputs): Promise<McpRunOutcome> => {
      const records: RunRecord[] = [];
      // Each answered question lets the run go one human stage further.
      for (let round = 0; round <= loaded.flow.stages.length; round++) {
        try {
          records.push(...(await runAll(loaded, runOptions(inputs))));
          break;
        } catch (err) {
          if (!(err instanceof HumanInputNeededError)) throw err;
          if (await askFor(loaded, err)) continue;
          return { status: "waiting", records, waiting: waitingOf(err) };
        }
      }
      return { status: "done", records };
    },
    runStage: async (loaded, stageId, inputs): Promise<McpRunOutcome> => {
      for (let round = 0; round < 2; round++) {
        try {
          return { status: "done", records: [await runStage(loaded, stageId, runOptions(inputs))] };
        } catch (err) {
          if (!(err instanceof HumanInputNeededError)) throw err;
          if (round === 0 && (await askFor(loaded, err))) continue;
          return { status: "waiting", records: [], waiting: waitingOf(err) };
        }
      }
      return { status: "refused", message: "没有完成 / did not finish" };
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools(loadFlow(dir)) as Tool[] }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    if (!isMcpRunTool(name)) return (await callMcpTool(backend, name, args)) as CallToolResult;
    if (busy) {
      return {
        content: [{ type: "text", text: "已经有一次运行在进行，等它结束再试 / a run is already in progress; try again when it finishes" }],
        isError: true,
      };
    }
    busy = true;
    try {
      return (await callMcpTool(backend, name, args)) as CallToolResult;
    } finally {
      busy = false;
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
    .option("--allow-exec", "允许运行 script、agent、service、mcp、plugin 和 image 阶段 / allow script, agent, service, mcp, plugin and image stages to run")
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
