import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
// MIT: https://github.com/modelcontextprotocol/typescript-sdk
// Streamable HTTP: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
import { isHttpServer, isStdioServer, resolveMcpEnv } from "../mcp.js";
import type { ExecutorMcp, McpServerConfig, Output, Stage } from "../types.js";
import { isDirOutput, isTextType, outputRel, readFlowText, wantsJson } from "../util.js";
import { renderTemplate } from "./llm.js";
import type { ExecContext, ExecResult, StageExecutor } from "./types.js";

const CLIENT_INFO = { name: "flowgit", version: "0.1.0" };
/** JSON-RPC code the MCP SDK raises when a request passes its timeout. */
const REQUEST_TIMEOUT = -32001;

export interface McpToolDescription {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface McpToolResult {
  content?: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport;

function timeoutMessage(seconds: number): string {
  return `超时（${seconds} 秒），已停止 / Timed out after ${seconds}s and was stopped`;
}

function isRequestTimeout(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: number }).code === REQUEST_TIMEOUT;
}

function killChild(transport: McpTransport): void {
  if (!(transport instanceof StdioClientTransport)) return;
  const pid = transport.pid;
  if (!pid || pid <= 0) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

function stageById(ctx: ExecContext, id: string): Stage {
  const stage = ctx.loaded.flow.stages.find((s) => s.id === id);
  if (!stage) throw new Error(`没有这个阶段 "${id}" / no stage "${id}"`);
  return stage;
}

function firstOutput(stage: Stage): Output {
  const output = stage.outputs[0];
  if (!output) throw new Error(`阶段 "${stage.id}" 没有产物 / stage "${stage.id}" has no output`);
  return output;
}

/** Relative path of a stage's first output: `{{upstream.<stageId>}}`. */
function upstreamPath(ctx: ExecContext, id: string): string {
  return outputRel(firstOutput(stageById(ctx, id)));
}

/** Text of a stage's first output: `{{upstream.<stageId>.content}}`. */
function upstreamContent(ctx: ExecContext, id: string): string {
  const output = firstOutput(stageById(ctx, id));
  if (isDirOutput(output)) {
    throw new Error(`{{upstream.${id}.content}} 不能读取文件夹 ${output.path} / {{upstream.${id}.content}} cannot read the directory ${output.path}`);
  }
  const rel = outputRel(output);
  const abs = path.join(ctx.loaded.dir, rel);
  if (!fs.existsSync(abs)) throw new Error(`上游产物还不存在：${rel} / upstream output does not exist yet: ${rel}`);
  if (!isTextType(output.type, output.path)) {
    throw new Error(`{{upstream.${id}.content}} 只能读取文本，${rel} 不是文本 / {{upstream.${id}.content}} only reads text, and ${rel} is not text`);
  }
  return readFlowText(ctx.loaded.dir, rel);
}

/** `{{inputs.key}}` first, then upstream path and content, so file text is not scanned again. */
export function renderMcpString(template: string, ctx: ExecContext): string {
  const withInputs = renderTemplate(template, ctx.flowInputs);
  return withInputs
    .replace(/\{\{\s*upstream\.([A-Za-z0-9_-]+)\.content\s*\}\}/g, (_m, id: string) => upstreamContent(ctx, id))
    .replace(/\{\{\s*upstream\.([A-Za-z0-9_-]+)\s*\}\}/g, (_m, id: string) => upstreamPath(ctx, id));
}

export function renderMcpArgs(value: unknown, ctx: ExecContext): unknown {
  if (typeof value === "string") return renderMcpString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => renderMcpArgs(item, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = renderMcpArgs(item, ctx);
    return out;
  }
  return value;
}

function textOf(content: McpContent[]): string {
  return content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text!).join("\n\n");
}

function fileExt(mime: string | undefined, kind: "image" | "audio"): string {
  const sub = (mime ?? "").split("/")[1]?.split(";")[0]?.trim().toLowerCase() ?? "";
  const known: Record<string, string> = {
    png: "png",
    jpeg: "jpg",
    jpg: "jpg",
    gif: "gif",
    webp: "webp",
    "svg+xml": "svg",
    mpeg: kind === "audio" ? "mp3" : "mpg",
    mp3: "mp3",
    wav: "wav",
    wave: "wav",
    "x-wav": "wav",
    ogg: "ogg",
    webm: "webm",
    flac: "flac",
    mp4: kind === "audio" ? "m4a" : "mp4",
  };
  if (known[sub]) return known[sub]!;
  const plain = sub.split("+")[0] ?? "";
  if (/^[a-z0-9]+$/.test(plain)) return plain;
  return kind === "image" ? "img" : "audio";
}

function decodeBase64(data: string | undefined, kind: string): Buffer {
  if (!data || /[^A-Za-z0-9+/=\s]/.test(data)) {
    throw new Error(`工具返回的 ${kind} 不是合法的 base64 / the tool returned ${kind} that is not valid base64`);
  }
  return Buffer.from(data.replace(/\s/g, ""), "base64");
}

function writeToolResult(ctx: ExecContext, result: McpToolResult): void {
  const content = result.content ?? [];
  if (result.isError) {
    const text = textOf(content).trim();
    throw new Error(text || "工具返回了错误 / the tool returned an error");
  }
  const output = ctx.stage.outputs[0]!;
  const abs = path.join(ctx.loaded.dir, outputRel(output));
  if (isDirOutput(output)) {
    fs.rmSync(abs, { recursive: true, force: true });
    fs.mkdirSync(abs, { recursive: true });
    const texts: string[] = [];
    let n = 0;
    for (const item of content) {
      if (item.type === "text") {
        if (typeof item.text === "string") texts.push(item.text);
        continue;
      }
      if (item.type !== "image" && item.type !== "audio") continue;
      n += 1;
      const ext = fileExt(item.mimeType, item.type);
      const name = `${String(n).padStart(3, "0")}.${ext}`;
      fs.writeFileSync(path.join(abs, name), decodeBase64(item.data, item.type));
    }
    if (texts.length) fs.writeFileSync(path.join(abs, "result.md"), texts.join("\n\n"));
    if (n === 0 && texts.length === 0) {
      throw new Error("工具没有返回可以保存的内容 / the tool returned nothing to save");
    }
    ctx.log(`已写入 / wrote ${outputRel(output)}/`);
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (wantsJson(output.type, output.path)) {
    const data = result.structuredContent !== undefined ? result.structuredContent : content;
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
  } else {
    const text = textOf(content);
    if (!content.some((item) => item.type === "text")) {
      throw new Error("工具没有返回文本 / the tool returned no text");
    }
    fs.writeFileSync(abs, text);
  }
  ctx.log(`已写入 / wrote ${outputRel(output)}`);
}

function openTransport(server: McpServerConfig, cwd: string, env: NodeJS.ProcessEnv, log?: (line: string) => void): McpTransport {
  if (isStdioServer(server)) {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: resolveMcpEnv(server.env, env),
      stderr: "pipe",
      cwd,
    });
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) if (line.trim()) log?.(line);
    });
    return transport;
  }
  if (!isHttpServer(server)) {
    throw new Error("MCP 服务器配置不对 / MCP server config is not stdio or url");
  }
  let url: URL;
  try {
    url = new URL(server.url);
  } catch {
    throw new Error(`MCP 地址不是合法的 URL / MCP url is not a valid URL: ${server.url}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MCP 只允许 http 和 https，收到 ${url.protocol} / MCP url must be http or https, got ${url.protocol}`);
  }
  return new StreamableHTTPClientTransport(url);
}

/**
 * Connect, run `fn`, then close. On timeout the stdio child is killed.
 * `timeoutSec` is the stage's `executor.timeoutSec`, or 60 when that is unset.
 */
async function withMcpClient<T>(
  server: McpServerConfig,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutSec: number,
  log: ((line: string) => void) | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const timeoutMs = timeoutSec * 1000;
  const transport = openTransport(server, cwd, env, log);
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const started = Date.now();
  let timedOut = false;
  const stopForTimeout = () => {
    if (timedOut) return;
    timedOut = true;
    log?.(`超时（${timeoutSec} 秒），正在停止 / timed out after ${timeoutSec}s, stopping`);
    killChild(transport);
    void transport.close().catch(() => {});
  };
  const timer = setTimeout(stopForTimeout, timeoutMs);
  const hitDeadline = () => timedOut || Date.now() - started >= timeoutMs - 50;
  try {
    await client.connect(transport, { timeout: timeoutMs });
    const result = await fn(client);
    if (hitDeadline()) throw new Error(timeoutMessage(timeoutSec));
    return result;
  } catch (err) {
    if (hitDeadline() || isRequestTimeout(err)) {
      stopForTimeout();
      throw new Error(timeoutMessage(timeoutSec));
    }
    throw err;
  } finally {
    clearTimeout(timer);
    await Promise.race([client.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
}

function requireServer(servers: Record<string, McpServerConfig> | undefined, name: string): McpServerConfig {
  const server = servers?.[name];
  if (!server) throw new Error(`MCP 服务器 "${name}" 没有在 mcpServers 里定义 / MCP server "${name}" is not defined in mcpServers`);
  return server;
}

/** List tools on one configured server. Used by `flowgit mcp tools`. */
export async function listMcpTools(
  dir: string,
  servers: Record<string, McpServerConfig> | undefined,
  serverName: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutSec = 60,
): Promise<McpToolDescription[]> {
  const server = requireServer(servers, serverName);
  return withMcpClient(server, dir, env, timeoutSec, undefined, async (client) => {
    const listed = await client.listTools(undefined, { timeout: timeoutSec * 1000 });
    return listed.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    }));
  });
}

export const mcpExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const ex = ctx.stage.executor as ExecutorMcp;
    if (ctx.stage.outputs.length !== 1) {
      throw new Error(`mcp 阶段只能有一个产物 / an mcp stage needs exactly one output ("${ctx.stage.id}" has ${ctx.stage.outputs.length})`);
    }
    const server = requireServer(ctx.loaded.flow.mcpServers, ex.server);
    const timeoutSec = ex.timeoutSec ?? 60;
    const args = renderMcpArgs(ex.args ?? {}, ctx) as Record<string, unknown>;
    const started = Date.now();
    ctx.log(`调用工具 / calling ${ex.tool} on ${ex.server}`);
    const result = await withMcpClient(
      server,
      ctx.loaded.dir,
      ctx.options.env ?? process.env,
      timeoutSec,
      ctx.log,
      async (client) => {
        const called = await client.callTool({ name: ex.tool, arguments: args }, undefined, { timeout: timeoutSec * 1000 });
        return called as McpToolResult;
      },
    );
    writeToolResult(ctx, result);
    return { params: { server: ex.server, tool: ex.tool, timeoutSec, durationMs: Date.now() - started } };
  },
};
