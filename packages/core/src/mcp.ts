import type { Flow, McpHttpServer, McpServerConfig, McpStdioServer, Stage, ValidationIssue } from "./types.js";

/** An env value that is exactly `${VAR}` and nothing else. */
export const MCP_ENV_VALUE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function isStdioServer(server: McpServerConfig): server is McpStdioServer {
  return typeof (server as McpStdioServer).command === "string";
}

export function isHttpServer(server: McpServerConfig): server is McpHttpServer {
  return typeof (server as McpHttpServer).url === "string" && !isStdioServer(server);
}

/** Variable names referenced as `${VAR}` in a stdio server's env. */
export function mcpEnvNames(env: Record<string, string> | undefined): string[] {
  const names: string[] = [];
  for (const value of Object.values(env ?? {})) {
    const match = MCP_ENV_VALUE.exec(value);
    if (match && !names.includes(match[1]!)) names.push(match[1]!);
  }
  return names;
}

/**
 * Fill `${VAR}` from the environment. A value that is not exactly `${VAR}`
 * is a literal secret and throws before anything is started.
 */
export function resolveMcpEnv(env: Record<string, string> | undefined, processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const bad: string[] = [];
  const missing: string[] = [];
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    const match = MCP_ENV_VALUE.exec(value);
    if (!match) {
      bad.push(key);
      continue;
    }
    const found = processEnv[match[1]!];
    if (found === undefined || found === "") missing.push(match[1]!);
    else resolved[key] = found;
  }
  if (bad.length) {
    throw new Error(
      `环境变量 ${bad.join(", ")} 必须写成 \${变量名}，不能把密钥直接写进 flow.json / env ${bad.join(", ")} must be \${VAR}; do not put a literal secret in flow.json`,
    );
  }
  if (missing.length) {
    throw new Error(`还没设置环境变量 ${missing.join(", ")} / Environment variable(s) not set: ${missing.join(", ")}`);
  }
  return resolved;
}

/** Command line or URL a server would be started with. Undefined when the entry is missing. */
export function mcpLaunchDetail(server: McpServerConfig | undefined): string | undefined {
  if (!server) return undefined;
  if (isStdioServer(server)) return [server.command, ...(server.args ?? [])].join(" ");
  if (isHttpServer(server)) return server.url;
  return undefined;
}

/**
 * What staleness hashes for one `mcpServers` entry: the launch config, with
 * env values dropped (keys stay, so adding a variable still marks the stage stale).
 */
export function mcpServerFingerprint(server: McpServerConfig | undefined): unknown {
  if (!server) return null;
  if (isHttpServer(server)) return { url: server.url };
  if (isStdioServer(server)) {
    return {
      command: server.command,
      args: server.args ?? [],
      env: server.env ? Object.keys(server.env).sort() : [],
    };
  }
  return null;
}

/** A literal env value is an error. Checked for every server, whether or not a stage uses it. */
export function mcpEnvIssues(flow: Flow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [name, server] of Object.entries(flow.mcpServers ?? {})) {
    if (!isStdioServer(server) || !server.env) continue;
    for (const [key, value] of Object.entries(server.env)) {
      if (MCP_ENV_VALUE.test(value)) continue;
      issues.push({
        level: "error",
        path: `/mcpServers/${name}/env/${key}`,
        message: `环境变量 ${key} 必须写成 \${变量名}，不能把密钥直接写进 flow.json / env ${key} must be \${VAR}; do not put a literal secret in flow.json`,
      });
    }
  }
  return issues;
}

/** An mcp stage has one output, and `server` names an `mcpServers` entry. */
export function mcpStageIssues(flow: Flow, stage: Stage, base: string): ValidationIssue[] {
  if (stage.executor.type !== "mcp") return [];
  const issues: ValidationIssue[] = [];
  if (stage.outputs.length !== 1) {
    issues.push({
      level: "error",
      path: `${base}/outputs`,
      message: `mcp 阶段只能有一个产物 / an mcp stage needs exactly one output (stage "${stage.id}" has ${stage.outputs.length})`,
    });
  }
  if (!flow.mcpServers || !Object.hasOwn(flow.mcpServers, stage.executor.server)) {
    issues.push({
      level: "error",
      path: `${base}/executor/server`,
      message: `MCP 服务器 "${stage.executor.server}" 没有在 mcpServers 里定义 / MCP server "${stage.executor.server}" is not defined in mcpServers`,
    });
  }
  return issues;
}
