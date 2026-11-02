import { headerEnvNames } from "./executors/service.js";
import type { Flow } from "./types.js";

/** Something a flow does on this machine beyond calling a model. */
export interface FlowAction {
  stage: string;
  kind: "script" | "agent" | "service";
  /** The command, the agent (and its extra arguments), or the method and URL, as flow.json has them. */
  detail: string;
  /** Environment variables a service call sends in its headers. */
  env?: string[];
}

/**
 * The commands a flow runs, the agents it starts and the services it calls, in stage order.
 * Shown when a flow comes from somewhere else, so people can look before they run it.
 */
export function flowActions(flow: Flow): FlowAction[] {
  const actions: FlowAction[] = [];
  for (const stage of flow.stages ?? []) {
    const ex = stage.executor;
    if (ex.type === "script") {
      actions.push({ stage: stage.id, kind: "script", detail: ex.run });
    } else if (ex.type === "agent") {
      const base = ex.agent === "custom" ? `custom: ${ex.command ?? ""}`.trim() : ex.agent;
      actions.push({ stage: stage.id, kind: "agent", detail: ex.args?.length ? `${base} ${ex.args.join(" ")}` : base });
    } else if (ex.type === "service") {
      const env = headerEnvNames(ex.headers);
      actions.push({ stage: stage.id, kind: "service", detail: `${ex.method ?? "GET"} ${ex.url}`, ...(env.length ? { env } : {}) });
    }
  }
  return actions;
}
