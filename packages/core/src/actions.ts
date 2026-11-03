import { host, path } from "./host/current.js";
import { headerEnvNames } from "./executors/service.js";
import { IMAGE_PRESETS } from "./image-providers.js";
import { isStdioServer, mcpEnvNames, mcpLaunchDetail } from "./mcp.js";
import { pluginActionDetail } from "./plugins.js";
import { resolveSubflowFile } from "./subflow.js";
import type { Flow } from "./types.js";

/** Something a flow does on this machine beyond calling a model. */
export interface FlowAction {
  /** Stage id; a stage inside a sub-flow is written `<workflow stage>/<stage>`. */
  stage: string;
  kind: "script" | "agent" | "service" | "workflow" | "mcp" | "plugin" | "image";
  /** The command, the agent (and its extra arguments), the method and URL, the sub-flow file, the MCP command or URL, or the plugin and where it resolved. */
  detail: string;
  /** Environment variables a service call sends in its headers, or an MCP server reads from `${VAR}`. */
  env?: string[];
}

/**
 * The commands a flow runs, the agents it starts, the services it calls, the MCP servers it starts and the plugins it loads, in stage order.
 * Shown when a flow comes from somewhere else, so people can look before they run it.
 * With `dir`, a flowgit sub-flow's own actions are listed under its workflow stage, since
 * running the parent runs them too.
 */
export function flowActions(flow: Flow, dir?: string): FlowAction[] {
  const actions: FlowAction[] = [];
  const visit = (current: Flow, prefix: string, at: string | undefined, seen: Set<string>) => {
    for (const stage of current.stages ?? []) {
      const ex = stage.executor;
      const id = `${prefix}${stage.id}`;
      if (ex.type === "script") {
        actions.push({ stage: id, kind: "script", detail: ex.run });
      } else if (ex.type === "agent") {
        const base = ex.agent === "custom" ? `custom: ${ex.command ?? ""}`.trim() : ex.agent;
        actions.push({ stage: id, kind: "agent", detail: ex.args?.length ? `${base} ${ex.args.join(" ")}` : base });
      } else if (ex.type === "service") {
        const env = headerEnvNames(ex.headers);
        actions.push({ stage: id, kind: "service", detail: `${ex.method ?? "GET"} ${ex.url}`, ...(env.length ? { env } : {}) });
      } else if (ex.type === "plugin") {
        actions.push({ stage: id, kind: "plugin", detail: pluginActionDetail(at, ex.plugin) });
      } else if (ex.type === "mcp") {
        const server = current.mcpServers?.[ex.server];
        const env = server && isStdioServer(server) ? mcpEnvNames(server.env) : [];
        actions.push({
          stage: id,
          kind: "mcp",
          detail: mcpLaunchDetail(server) ?? ex.server,
          ...(env.length ? { env } : {}),
        });
      } else if (ex.type === "image") {
        const slash = ex.model.indexOf("/");
        const providerId = slash < 0 ? "" : ex.model.slice(0, slash);
        const preset = Object.hasOwn(IMAGE_PRESETS, providerId) ? IMAGE_PRESETS[providerId] : undefined;
        actions.push({
          stage: id,
          kind: "image",
          detail: ex.model,
          ...(preset ? { env: [preset.apiKeyEnv] } : {}),
        });
      } else if (ex.type === "workflow" && ex.engine === "flowgit") {
        actions.push({ stage: id, kind: "workflow", detail: `子流程 / sub-flow ${ex.file}` });
        if (!at) continue;
        const resolved = resolveSubflowFile(at, ex.file);
        if ("error" in resolved || seen.has(resolved.abs) || !host().exists(resolved.abs)) continue;
        let sub: Flow;
        try {
          sub = JSON.parse(host().readFile(resolved.abs, "utf8")) as Flow;
        } catch {
          continue; // validate reports it
        }
        visit(sub, `${id}/`, path.dirname(resolved.abs), new Set([...seen, resolved.abs]));
      }
    }
  };
  visit(flow, "", dir, new Set());
  return actions;
}
