import type { ResolvedProvider } from "../providers.js";
import type { Effort, LoadedFlow, Output, RunRecord, Stage } from "../types.js";

/** One upstream artifact as it stands in the flow directory when a stage runs. */
export interface InputArtifact {
  stage: string;
  stageName: string;
  output: Output;
  absPath: string;
  exists: boolean;
  isDir: boolean;
  /** Text content for text-like artifacts (files only). */
  text?: string;
  /** Relative file list for directories. */
  files?: string[];
  /** A file output that is a link to somewhere outside the flow directory: its text is not read. */
  outside?: boolean;
}

export interface LlmRequest {
  stageId: string;
  /** Where the request goes (endpoint, protocol, key variable). */
  provider: ResolvedProvider;
  /** Model name as the provider knows it, without the "<provider>/" prefix. */
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  effort?: Effort;
  /** True when this call asks the model to repair a JSON output that failed its schema. */
  repair?: boolean;
}

export interface LlmResponse {
  text: string;
  model: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
}

export type LlmComplete = (req: LlmRequest) => Promise<LlmResponse>;

export interface RunOptions {
  /** Flow input overrides (--input key=value). */
  inputs?: Record<string, unknown>;
  /** For human stages: files to copy into the declared output paths, in order. */
  from?: string[];
  /** Model override for llm stages: "<model>" or "<provider>/<model>". */
  model?: string;
  /** Replace the real model call (tests, FLOWGIT_LLM_MOCK_DIR). */
  llm?: LlmComplete;
  /** Extra environment for script stages. */
  env?: Record<string, string>;
  /** Re-run stages that are already ok (runAll). */
  force?: boolean;
  /** Progress callback. */
  onEvent?: (event: RunEvent) => void;
}

export type RunEvent =
  | { type: "stage:start"; stage: Stage }
  | { type: "stage:skip"; stage: Stage; reason: string }
  | { type: "stage:log"; stage: Stage; line: string }
  | { type: "stage:done"; stage: Stage; n: number; record: RunRecord }
  | { type: "stage:error"; stage: Stage; error: Error };

export interface ExecContext {
  loaded: LoadedFlow;
  stage: Stage;
  inputs: InputArtifact[];
  flowInputs: Record<string, unknown>;
  options: RunOptions;
  log: (line: string) => void;
}

export interface ExecResult {
  /** Executor-specific details stored in run.json (model, usage, command ...). */
  params?: Record<string, unknown>;
}

export interface StageExecutor {
  run(ctx: ExecContext): Promise<ExecResult>;
}

export class HumanInputNeededError extends Error {
  constructor(
    public readonly stage: Stage,
    public readonly missing: string[],
    public readonly instructions?: string,
  ) {
    super(`「${stage.name}」在等你 / Stage "${stage.id}" is waiting for you: ${missing.join(", ")}`);
    this.name = "HumanInputNeededError";
  }
}

export class ExecutorNotImplementedError extends Error {
  constructor(public readonly executorType: string) {
    super(`执行器 "${executorType}" 在 v0.1 里只是预留，还不能运行 / Executor "${executorType}" is reserved in spec v0.1 and cannot run yet`);
    this.name = "ExecutorNotImplementedError";
  }
}
