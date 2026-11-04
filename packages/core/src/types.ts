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
  /**
   * Extra attempts after a network error, HTTP 429 or 5xx. Default 0.
   * Other 4xx and schema failures are not retried.
   */
  retries?: number;
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

/**
 * Params when `engine` is `"flowgit"`.
 */
export interface FlowgitWorkflowParams {
  /** Passed to the sub-flow as its inputs. Strings may contain {{inputs.key}} from the parent. */
  inputs?: Record<string, unknown>;
  /** Sub-flow output path → this stage's output path. Every output of this stage must appear as a value. */
  copy?: Record<string, string>;
}

/** One picture per item of an array, written into one workflow input before that run. */
export interface ComfyuiEach {
  /** Relative path of an upstream JSON output. */
  from: string;
  /** Dotted path to the array inside that JSON, e.g. "scenes". */
  path: string;
  /** Field on each item. Its text is written into `target`. */
  field: string;
  /** `<node id>.inputs.<field>` in the API-format workflow. */
  target: string;
}

/** Params when `engine` is `"comfyui"`. The workflow file is ComfyUI's API export. */
export interface ComfyuiWorkflowParams {
  /** ComfyUI address. Defaults to http://127.0.0.1:8188. FLOWGIT_COMFYUI_URL is used when this is unset; this wins. */
  server?: string;
  /** `<node id>.inputs.<field>` → value, applied before the run. Strings may use {{inputs.name}} and {{upstream.<id>.content}}. */
  set?: Record<string, unknown>;
  /** Run once per item of an upstream JSON array. */
  each?: ComfyuiEach;
  /** Whole submission, including polling and downloads. Default 600. */
  timeoutSec?: number;
  /** Extra attempts after a network error, HTTP 429 or 5xx. Default 0. Same rules as service. */
  retries?: number;
}

export interface ExecutorWorkflow {
  type: "workflow";
  /** `"flowgit"` runs a Flowgit sub-flow. `"comfyui"` runs a local ComfyUI. Any other engine is reserved. */
  engine: string;
  /** `flow.json` for flowgit, or an API-format workflow JSON for comfyui. Relative to this flow's directory and inside it. */
  file: string;
  /** Shape depends on `engine`. Other engines: any object. */
  params?: FlowgitWorkflowParams | ComfyuiWorkflowParams | Record<string, unknown>;
}

export interface ExecutorService {
  type: "service";
  url: string;
  method?: "GET" | "POST";
  /** Header values may contain {{env.NAME}}, read from the environment at run time. */
  headers?: Record<string, string>;
  /** Abort the request after this many seconds. Default 60. */
  timeoutSec?: number;
  /**
   * Extra attempts after a network error, HTTP 429 or 5xx. Default 0.
   * Other 4xx and a body that is not usable are not retried.
   */
  retries?: number;
}

/** A local MCP server started as a child process. Same shape as Claude Desktop / Cursor. */
export interface McpStdioServer {
  command: string;
  args?: string[];
  /**
   * Environment for the child. Each value must be `${VAR}`; the variable is
   * read from the environment when the stage runs and is never stored in a file.
   */
  env?: Record<string, string>;
}

/** A remote MCP server reached over Streamable HTTP. */
export interface McpHttpServer {
  url: string;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

export interface ExecutorMcp {
  type: "mcp";
  /** Name of an entry in `mcpServers`. */
  server: string;
  tool: string;
  /**
   * Arguments passed to the tool. Strings may use `{{inputs.key}}`,
   * `{{upstream.<stageId>}}` (relative path of that stage's first output)
   * and `{{upstream.<stageId>.content}}` (its text).
   */
  args?: Record<string, unknown>;
  /** Stop the call and kill the stdio child after this many seconds. Default 60. */
  timeoutSec?: number;
}

/**
 * A custom executor loaded from the flow directory.
 * `plugin` is a package name, resolved only from this flow's `node_modules`,
 * or a `./` path that stays inside the flow directory.
 */
export interface ExecutorPlugin {
  type: "plugin";
  plugin: string;
  /** JSON object passed to the plugin as `ctx.config`. Counts toward staleness. */
  config?: Record<string, unknown>;
  /** Abort the plugin's `signal` after this many seconds. Unset means no limit. */
  timeoutSec?: number;
}

/** One image per item of an array inside an upstream JSON file. */
export interface ImageEach {
  /** Relative path of an upstream JSON output. */
  from: string;
  /** Dotted path to the array inside that JSON, e.g. "shots". */
  path: string;
  /** Field on each item. Its text is appended to the rendered prompt. */
  field: string;
}

export interface ExecutorImage {
  type: "image";
  /** "<provider>/<model>", e.g. "zhipu/cogview-4". */
  model: string;
  /** Prompt file. {{inputs.key}} is filled in. With `each`, the item's field is appended. */
  prompt: string;
  /** e.g. "1024x1024". Default 1024x1024. DashScope receives "1024*1024". */
  size?: string;
  /** Pictures of this one prompt. Default 1. Must be 1 or omitted when `each` is set. */
  n?: number;
  each?: ImageEach;
  /** Stop one picture, including DashScope polling, after this many seconds. Default 180. */
  timeoutSec?: number;
}

export type Executor =
  | ExecutorHuman
  | ExecutorLlm
  | ExecutorScript
  | ExecutorAgent
  | ExecutorWorkflow
  | ExecutorService
  | ExecutorMcp
  | ExecutorPlugin
  | ExecutorImage;

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
  /**
   * Named MCP servers. Stdio entries are `{ command, args?, env? }`;
   * Streamable HTTP entries are `{ url }`. `env` values must be `${VAR}`.
   */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * How many stages `run all` may run at once. Independent stages share a wave,
   * up to this many. Default 2. `run all --concurrency` overrides it.
   */
  concurrency?: number;
  stages: Stage[];
}

/** A flow loaded from disk. */
export interface LoadedFlow {
  /** Absolute path of the directory holding the flow file. */
  dir: string;
  /** Absolute path of the flow file: flow.json or flow.md. */
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
  /** Who asked for the run, when it was not the CLI or the board: "mcp" for `flowgit serve --mcp`. */
  via?: "mcp";
  /** The MCP client that made the call, as it named itself (e.g. "claude-code 2.1.0"). */
  client?: string;
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
  /**
   * The successful run whose output snapshot the files on disk match (the
   * newest, if several). After a restore it is the restored run, not `latest`.
   * Set for an ok stage, and for a stale one with more than one successful
   * run; unset for a hand edit, an error or a wait.
   */
  current?: number;
  /** Upstream stage ids that have no successful run yet. */
  missingUpstream: string[];
}
