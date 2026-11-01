import type { ExecutorType } from "../types.js";
import { agentExecutor } from "./agent.js";
import { humanExecutor } from "./human.js";
import { llmExecutor } from "./llm.js";
import { scriptExecutor } from "./script.js";
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
export {
  llmExecutor,
  anthropicComplete,
  openaiComplete,
  providerComplete,
  providerKey,
  proxyHint,
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
};

export function getExecutor(type: ExecutorType): StageExecutor {
  const ex = registry[type];
  if (!ex) throw new ExecutorNotImplementedError(type);
  return ex;
}

export function isRunnableExecutor(type: ExecutorType): boolean {
  return type in registry;
}
