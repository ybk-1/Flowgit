import type { ExecutorType } from "../types.js";
import { agentExecutor } from "./agent.js";
import { humanExecutor } from "./human.js";
import { llmExecutor } from "./llm.js";
import { scriptExecutor } from "./script.js";
import { serviceExecutor } from "./service.js";
import { workflowExecutor } from "./workflow.js";
import { imageExecutor } from "./image.js";
import { pluginExecutor } from "./plugin.js";
import { ExecutorNotImplementedError, type StageExecutor } from "./types.js";

export * from "./types.js";
export { humanExecutor } from "./human.js";
export { scriptExecutor } from "./script.js";
export {
  agentExecutor,
  AGENT_ADAPTERS,
  STDIN_INSTRUCTION,
  agentCommandLine,
  agentPromptRel,
  buildAgentPrompt,
  shellQuote,
  type AgentAdapter,
} from "./agent.js";
export { workflowExecutor } from "./workflow.js";
export { pluginExecutor } from "./plugin.js";
export { imageExecutor, mockPictures } from "./image.js";
export {
  llmExecutor,
  anthropicComplete,
  openaiComplete,
  providerComplete,
  providerKey,
  proxyHint,
  ignoredProxyVar,
  usageTokens,
  anthropicBody,
  openaiBody,
  mockCompleteFromDir,
  resolveLlm,
  renderTemplate,
  buildPrompt,
  defaultSystem,
  extractJson,
  DEFAULT_MODEL,
} from "./llm.js";

const registry: Partial<Record<ExecutorType, StageExecutor>> = {
  human: humanExecutor,
  llm: llmExecutor,
  script: scriptExecutor,
  agent: agentExecutor,
  service: serviceExecutor,
  workflow: workflowExecutor,
  plugin: pluginExecutor,
  image: imageExecutor,
};

/**
 * Add or replace the executor for `type`. The Node entry registers `mcp`, which starts
 * local servers and so is not part of the shared core; the browser entry registers a
 * stand-in that says the stage needs a computer.
 */
export function registerExecutor(type: ExecutorType, executor: StageExecutor): void {
  registry[type] = executor;
}

export function getExecutor(type: ExecutorType): StageExecutor {
  const ex = registry[type];
  if (!ex) throw new ExecutorNotImplementedError(type);
  return ex;
}

/** True when this executor can run. `workflow` runs for engines `"flowgit"` and `"comfyui"`. */
export function isRunnableExecutor(executor: ExecutorType | { type: ExecutorType; engine?: string }): boolean {
  const type = typeof executor === "string" ? executor : executor.type;
  if (type === "workflow") return typeof executor !== "string" && (executor.engine === "flowgit" || executor.engine === "comfyui");
  return type in registry;
}
