import { host, path } from "./host/current.js";
import { renderTemplate } from "./executors/llm.js";
import type { Executor, ExecutorWorkflow, FlowgitWorkflowParams } from "./types.js";
import { isSafeRelative } from "./util.js";

/** How many Flowgit sub-flows may be entered under the root flow. The next one is an error. */
export const MAX_SUBFLOW_DEPTH = 5;

export function isFlowgitWorkflow(ex: Executor): ex is ExecutorWorkflow & { engine: "flowgit"; params?: FlowgitWorkflowParams } {
  return ex.type === "workflow" && ex.engine === "flowgit";
}

export function flowgitParams(ex: ExecutorWorkflow): FlowgitWorkflowParams {
  const raw = ex.params;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const { inputs, copy } = raw as FlowgitWorkflowParams;
  return {
    inputs: inputs && typeof inputs === "object" && !Array.isArray(inputs) ? inputs : undefined,
    copy: copy && typeof copy === "object" && !Array.isArray(copy) ? copy : undefined,
  };
}

/** Replace {{inputs.key}} in every string, at any depth. Other values pass through. */
export function renderInputTree(value: unknown, flowInputs: Record<string, unknown>): unknown {
  if (typeof value === "string") return renderTemplate(value, flowInputs);
  if (Array.isArray(value)) return value.map((item) => renderInputTree(item, flowInputs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderInputTree(item, flowInputs)]));
  }
  return value;
}

/** Output and copy paths compared without a trailing slash or a leading ./ */
export function normRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Stable id for a flow.json. Follows a symlink so a loop through a link is still a cycle. */
export function flowFileId(file: string): string {
  const abs = path.resolve(file);
  try {
    return host().exists(abs) ? host().realpath(abs) : abs;
  } catch {
    return abs;
  }
}

export function subflowEscapeMessage(file: string): string {
  return `子流程路径必须是相对路径，且在流程目录内 / sub-flow path must be relative and stay inside the flow directory: "${file}"`;
}

/** Why `file` cannot be a sub-flow path, or undefined when the string itself is safe. */
export function subflowPathProblem(file: string): string | undefined {
  if (!isSafeRelative(file)) return subflowEscapeMessage(file);
  if (path.basename(file) !== "flow.json") {
    return `file 要指向子流程的 flow.json / file must point at the sub-flow's flow.json: "${file}"`;
  }
  return undefined;
}

/** Absolute flow.json path, or why `file` is not allowed. */
export function resolveSubflowFile(dir: string, file: string): { abs: string } | { error: string } {
  const problem = subflowPathProblem(file);
  if (problem) return { error: problem };
  const abs = path.resolve(dir, file);
  if (!staysInside(dir, abs)) return { error: subflowEscapeMessage(file) };
  return { abs: flowFileId(abs) };
}

export function staysInside(root: string, abs: string): boolean {
  const rel = path.relative(flowFileId(root), flowFileId(abs));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Chain of flow.json files from the outermost flow through the current one.
 * `flowStack` is that chain when this flow was entered as a sub-flow.
 */
export function subflowStack(currentFile: string, flowStack?: string[]): string[] {
  if (flowStack?.length) return flowStack.map(flowFileId);
  return [flowFileId(currentFile)];
}

/**
 * Whether `next` may be entered. `stack` includes the current flow.json.
 * A repeat is a cycle. More than MAX_SUBFLOW_DEPTH entries under the root is too deep
 * (stack length counts the root, so the limit is MAX + 1 files).
 */
export function subflowEnterProblem(stack: string[], next: string): string | undefined {
  const id = flowFileId(next);
  if (stack.includes(id)) {
    const chain = [...stack, id].map((file) => path.basename(path.dirname(file)) + "/" + path.basename(file)).join(" -> ");
    return `子流程形成了环：${chain} / sub-flows form a cycle: ${chain}`;
  }
  if (stack.length >= MAX_SUBFLOW_DEPTH + 1) {
    return `子流程嵌套超过 ${MAX_SUBFLOW_DEPTH} 层 / sub-flow nesting is deeper than ${MAX_SUBFLOW_DEPTH}`;
  }
  return undefined;
}
