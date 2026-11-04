// Browser entry (the "browser" condition in package.json). It imports no node: module:
// files live in a memory host (persist them with createMemoryHost({ onChange })), model and
// service calls use the browser's fetch, and stages that need a computer (script, agent,
// MCP, plugin) fail with a bilingual message instead of running.
import { setHost } from "./host/current.js";
import { createMemoryHost, needsComputerError } from "./host/memory.js";
import { registerExecutor } from "./executors/index.js";

setHost(createMemoryHost());
registerExecutor("mcp", {
  run: async () => {
    throw needsComputerError("MCP 阶段 / An MCP stage");
  },
});

export * from "./types.js";
export * from "./graph.js";
export * from "./layout.js";
export * from "./load.js";
export * from "./flowmd.js";
export * from "./runs.js";
export * from "./prune.js";
export * from "./diff.js";
export * from "./run.js";
export * from "./executors/index.js";
export * from "./skill.js";
export * from "./providers.js";
export * from "./image-providers.js";
export * from "./mermaid.js";
export * from "./plan.js";
export {
  RUNS_ON_COMPUTER,
  descriptionAllows,
  descriptionLanguage,
  generateFlow,
  generateMockComplete,
  generatePromptFile,
  writeGeneratedFlow,
  type GenerateFile,
  type GenerateOptions,
  type GeneratePlanStep,
  type GeneratePreview,
  type GenerateResult,
} from "./generate.js";
export * from "./usage.js";
export * from "./files.js";
export * from "./edit.js";
export * from "./privacy.js";
export * from "./actions.js";
export * from "./plugins.js";
export * from "./trust.js";
export * from "./mcp-tools.js";
export {
  ImportFormatError,
  NOT_DIFY,
  NOT_N8N,
  UNKNOWN_IMPORT_FORMAT,
  detectImportFormat,
  fileNameOnly,
  importSource,
  importWorkflow,
  presetModel,
  upstreamNote,
  type ImportFormat,
  type ImportReportEntry,
  type ImportResult,
} from "./importers/index.js";
export * from "./proxy-env.js";
export { setSchemaCompiler, type SchemaCompiler, type SchemaError } from "./schema-check.js";
export * from "./host/index.js";
export { hashPath, listFiles, isTextType, wantsJson, isDirOutput, outputRel, isSafeRelative, findOnPath, staysInside, readFlowText } from "./util.js";
export {
  runFlowTests,
  type FlowTestCaseResult,
  type FlowTestCheckResult,
  type FlowTestOptions,
  type FlowTestReport,
} from "./flowtest.js";
