/**
 * TypeScript view of flow.json (spec v0.1). The JSON Schema in
 * ../schema/flow.schema.json is the source of truth; keep both in sync.
 */

export type FlowInputType = "string" | "text" | "number" | "boolean" | "file";

export interface FlowInput {
  type: FlowInputType;
  description?: string;
  default?: unknown;
  required?: boolean;
  /** Allowed values, e.g. ["zh", "en"]. */
  enum?: unknown[];
}

export interface FlowAuthor {
  name: string;
  url?: string;
}

export interface Output {
  id?: string;
  /** MIME-like type: text/markdown, application/json, flowgit/storyboard+json, video/mp4, dir ... */
  type: string;
  /** Relative to the flow directory. Ends with "/" for a directory. */
  path: string;
  description?: string;
}

export interface ExecutorHuman {
  type: "human";
  instructions?: string;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ExecutorLlm {
  type: "llm";
  prompt: string;
  system?: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
}

export interface ExecutorScript {
  type: "script";
  run: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecutorWorkflow {
  type: "workflow";
  engine: string;
  file: string;
  params?: Record<string, unknown>;
}

export interface ExecutorService {
  type: "service";
  url: string;
  method?: "GET" | "POST";
}

export interface ExecutorMcp {
  type: "mcp";
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}

export type Executor =
  | ExecutorHuman
  | ExecutorLlm
  | ExecutorScript
  | ExecutorWorkflow
  | ExecutorService
  | ExecutorMcp;

export type ExecutorType = Executor["type"];

export interface Stage {
  id: string;
  name: string;
  description?: string;
  inputs?: string[];
  executor: Executor;
  outputs: Output[];
}

export interface Flow {
  format: "flowgit";
  version: string;
  /** Optional slug: lowercase letters, digits, hyphens. */
  id?: string;
  name: string;
  description?: string;
  language?: string;
  author?: FlowAuthor;
  license?: string;
  tags?: string[];
  inputs?: Record<string, FlowInput>;
  stages: Stage[];
}

/** A flow loaded from disk. */
export interface LoadedFlow {
  /** Absolute path of the directory holding flow.json. */
  dir: string;
  /** Absolute path of flow.json. */
  file: string;
  flow: Flow;
}

export type IssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: IssueLevel;
  /** JSON pointer-ish location, e.g. /stages/2/inputs/0 */
  path: string;
  message: string;
}

/* ---------- runs (versions) ---------- */

export interface RunOutputRecord {
  path: string;
  type: string;
  /** sha256 of the file, or of the sorted file list for a directory. */
  sha256: string;
  bytes: number;
  isDir: boolean;
}

export interface RunInputRef {
  stage: string;
  path: string;
  sha256: string;
}

export type RunStatus = "ok" | "error";

export interface RunRecord {
  stage: string;
  n: number;
  status: RunStatus;
  /** "manual" = a hand edit of the outputs, recorded as its own version. */
  executor: ExecutorType | "manual";
  startedAt: string;
  finishedAt: string;
  /** Fingerprint of upstream artifacts + flow inputs at the time of the run. */
  inputHash: string;
  inputs: RunInputRef[];
  flowInputs: Record<string, unknown>;
  outputs: RunOutputRecord[];
  /** Executor-specific details (model, usage, command ...). */
  params?: Record<string, unknown>;
  /** Short log captured from the executor. */
  log?: string;
  error?: string;
}

/**
 * never-run: no run yet, upstream ready
 * waiting-upstream: an upstream stage has no successful run (or its files are gone)
 * ok: latest run succeeded, upstream and outputs unchanged since
 * stale: upstream artifacts or flow inputs changed since the latest run
 * edited: someone changed this stage's outputs by hand since the latest run
 * error: latest run failed
 */
export type StageState =
  | "never-run"
  | "waiting-upstream"
  | "ok"
  | "stale"
  | "edited"
  | "error";

export interface StageStatus {
  stage: Stage;
  state: StageState;
  latest?: RunRecord;
  runs: number;
  /** Upstream stage ids that have no successful run yet. */
  missingUpstream: string[];
}
