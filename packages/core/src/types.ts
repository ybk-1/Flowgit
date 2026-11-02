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
  /** Relative path of a JSON Schema file. Only for JSON outputs. Checked after the stage runs. */
  schema?: string;
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
  /** "<model>" or "<provider>/<model>", e.g. "glm/glm-5.3". No prefix = anthropic. */
  model?: string;
  effort?: Effort;
  maxTokens?: number;
}

export interface ExecutorScript {
  type: "script";
  run: string;
  /** Programs the command needs on PATH besides its own, e.g. ["ffmpeg"]. Checked before it runs and by `flowgit doctor`. */
  requires?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Stop the process tree after this many seconds. Unset means no limit. */
  timeoutSec?: number;
}

/** Built-in agent CLIs, plus "custom" for any other command. */
export type AgentName = "claude-code" | "codex" | "cursor" | "gemini" | "custom";

export interface ExecutorAgent {
  type: "agent";
  agent: AgentName;
  /** Prompt file (Markdown). {{inputs.key}} is filled in; Flowgit appends the upstream and output file lists. */
  prompt: string;
  /** custom only: shell command. {{promptFile}} becomes the path of the rendered prompt; the prompt is also on stdin. */
  command?: string;
  /** Extra arguments added to the agent command (e.g. a model flag). */
  args?: string[];
  /** Stop the process tree after this many seconds. Unset means no limit. */
  timeoutSec?: number;
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
  /** Header values may contain {{env.NAME}}, read from the environment at run time. */
  headers?: Record<string, string>;
  /** Abort the request after this many seconds. Default 60. */
  timeoutSec?: number;
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
  | ExecutorAgent
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

/** Where a flow was copied from, when `init` cloned a Git URL. Never a local path. */
export interface ForkedFrom {
  source: string;
  ref?: string;
  commit?: string;
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
  /** Set when the flow was initialized from a Git URL. */
  forkedFrom?: ForkedFrom;
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
