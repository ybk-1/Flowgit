import { flowActions, type FlowAction } from "./actions.js";
import { requireStage } from "./graph.js";
import { host, path } from "./host/current.js";
import { latestOkRun, listRuns, loadFlowInputs, MissingInputsError, outputAbs, resolveFlowInputs, statusAll } from "./runs.js";
import type { FlowInput, LoadedFlow, RunRecord, Stage } from "./types.js";
import { isDirOutput, isTextType, listFiles, outputRel } from "./util.js";

/**
 * The four MCP tools a flow offers (run_flow, run_stage, get_output, status), shared by the local
 * `flowgit serve --mcp` (stdio) and the cloud's remote MCP URL (Streamable HTTP). Tool schemas and
 * results are plain objects in the MCP shapes (https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
 * so this file needs no MCP library. How a run happens is the backend's business: in process on a
 * computer, or as a cloud run.
 */

/** A text output bigger than this is returned as a path, not its content. */
export const MCP_MAX_TEXT_BYTES = 100_000;

/** Action kinds that run commands, start processes or call services: the local server needs --allow-exec for them. */
export const MCP_EXEC_KINDS: ReadonlySet<FlowAction["kind"]> = new Set<FlowAction["kind"]>(["script", "agent", "service", "mcp", "plugin", "image"]);

/** One tool as tools/list describes it. */
export interface McpToolInfo {
  name: string;
  title?: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, object>; required?: string[]; [key: string]: unknown };
  annotations?: { readOnlyHint?: boolean };
}

/** A tools/call result. */
export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

/** A stage the run stopped at, waiting for a person or (in the cloud) a computer. */
export interface McpWaiting {
  stage: string;
  name: string;
  kind: "human" | "computer";
  missing: string[];
  instructions?: string;
  /** Set when `stage` is a workflow stage waiting on a human stage in its sub-flow. */
  subflowStage?: { id: string; name: string };
}

/** How a run asked for by a tool ended. `records` are the versions it made, oldest first. */
export type McpRunOutcome =
  | { status: "done"; records: RunRecord[] }
  | { status: "waiting"; records: RunRecord[]; waiting: McpWaiting }
  | { status: "refused"; message: string; data?: unknown };

/** Where and how the tools run. */
export interface McpToolBackend {
  /** The flow as it is now. */
  load(): LoadedFlow;
  /** Flow inputs for a call: `given` plus anything the backend keeps between calls. */
  inputs(given: Record<string, unknown>): Record<string, unknown>;
  /** Run like `run all`, until done or a waiting stage. */
  runFlow(loaded: LoadedFlow, inputs: Record<string, unknown>): Promise<McpRunOutcome>;
  /** Run one stage again. */
  runStage(loaded: LoadedFlow, stageId: string, inputs: Record<string, unknown>): Promise<McpRunOutcome>;
  /** True on a computer: results show absolute file paths. False in the cloud. */
  localPaths: boolean;
  /** What to do about a waiting stage, as one bilingual line. */
  nextHint?: (waiting: McpWaiting) => string;
  /** A reason to refuse a run before anything happens (trust, --allow-exec, ...); `stageId` for run_stage. */
  refuse?: (loaded: LoadedFlow, stageId?: string) => { message: string; data?: unknown } | undefined;
}

/* ---------- tool schemas ---------- */

/** JSON Schema for one flow input. "text" and "file" are strings; enum and default are kept. */
function inputSchema(def: FlowInput): Record<string, unknown> {
  const type = def.type === "number" ? "number" : def.type === "boolean" ? "boolean" : "string";
  const schema: Record<string, unknown> = { type };
  if (def.description) schema.description = def.description;
  if (def.enum) schema.enum = def.enum;
  if (def.default !== undefined) schema.default = def.default;
  return schema;
}

/** The run_flow parameters: exactly the flow inputs. Required ones that already have a value are optional here. */
export function flowInputsSchema(loaded: LoadedFlow): McpToolInfo["inputSchema"] {
  const defs = loaded.flow.inputs ?? {};
  const known = resolveFlowInputs(loaded.dir, loaded.flow);
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const [key, def] of Object.entries(defs)) {
    properties[key] = inputSchema(def);
    if (def.required && (known[key] === undefined || known[key] === "")) required.push(key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export function mcpTools(loaded: LoadedFlow): McpToolInfo[] {
  const ids = loaded.flow.stages.map((s) => s.id);
  const stageList = loaded.flow.stages.map((s) => `${s.id} (${s.executor.type}): ${s.name}`).join("; ");
  const what = loaded.flow.description ? ` ${loaded.flow.description}` : "";
  return [
    {
      name: "run_flow",
      title: `运行流程 / Run ${loaded.flow.name}`,
      description:
        `Run the Flowgit flow "${loaded.flow.name}" from the start, skipping stages that are already up to date.${what} ` +
        `Stages: ${stageList}. Stops at a human stage that is waiting and says which files to prepare. ` +
        `Returns each stage's state and the final outputs.`,
      inputSchema: flowInputsSchema(loaded),
    },
    {
      name: "run_stage",
      title: "运行一个阶段 / Run one stage",
      description:
        "Run one stage of the flow again, even if it is up to date. Its upstream stages must have run. " +
        "For a human stage, `files` can supply the text of its outputs (output path → content).",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ids, description: "Stage id" },
          inputs: { type: "object", description: "Flow input overrides for this run", additionalProperties: true },
          files: {
            type: "object",
            description: "Human stages only: output path → text to write before the stage runs",
            additionalProperties: { type: "string" },
          },
        },
        required: ["stage"],
        additionalProperties: false,
      },
    },
    {
      name: "get_output",
      title: "读取产物 / Read outputs",
      description: `Read a stage's current outputs: text files as text (up to ${MCP_MAX_TEXT_BYTES} bytes), other files and folders as paths.`,
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ids, description: "Stage id" },
          path: { type: "string", description: "Only this output path (optional)" },
        },
        required: ["stage"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "status",
      title: "流程状态 / Flow status",
      description: "Every stage's state, latest version and outputs, the same as `flowgit status --json`.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
  ];
}

/** Server instructions sent on initialize. */
export function mcpInstructions(loaded: LoadedFlow, where: string): string {
  return (
    `This server runs the Flowgit flow "${loaded.flow.name}" ${where}. ` +
    `Call run_flow with the flow inputs; if it stops at a human stage, ask the user for the files it lists. ` +
    `Use get_output to read a stage's outputs and status to see every stage.`
  );
}

/* ---------- results ---------- */

export function mcpText(summary: string, data?: unknown): McpToolResult {
  const text = data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 2)}`;
  return { content: [{ type: "text", text }] };
}

export function mcpError(message: string, data?: unknown): McpToolResult {
  return { ...mcpText(message, data), isError: true };
}

/** `flowgit status --json`, as an object. */
export function statusJson(loaded: LoadedFlow, overrides: Record<string, unknown> = {}, localPaths = true) {
  let flowInputs: Record<string, unknown>;
  let missingInputs: string[] = [];
  try {
    flowInputs = loadFlowInputs(loaded.dir, loaded.flow, overrides);
  } catch (err) {
    if (!(err instanceof MissingInputsError)) throw err;
    missingInputs = err.missing;
    flowInputs = resolveFlowInputs(loaded.dir, loaded.flow, overrides);
  }
  return {
    flow: { name: loaded.flow.name, version: loaded.flow.version, ...(localPaths ? { dir: loaded.dir } : {}) },
    missingInputs,
    stages: statusAll(loaded, flowInputs).map((s) => ({
      id: s.stage.id,
      name: s.stage.name,
      executor: s.stage.executor.type,
      state: s.state,
      runs: s.runs,
      latest: s.latest ? { n: s.latest.n, status: s.latest.status, finishedAt: s.latest.finishedAt } : null,
      current: s.current ?? null,
      missingUpstream: s.missingUpstream,
      outputs: s.stage.outputs,
    })),
  };
}

/** One output as the client sees it: text inline when small, otherwise its path. */
export function readOutput(loaded: LoadedFlow, stage: Stage, rel: string, localPaths = true) {
  const h = host();
  const out = stage.outputs.find((o) => outputRel(o) === rel)!;
  const abs = outputAbs(loaded.dir, out);
  const base = { stage: stage.id, path: rel, type: out.type, ...(localPaths ? { absPath: abs } : {}) };
  if (!h.exists(abs)) return { ...base, exists: false };
  const st = h.stat(abs);
  if (st.isDirectory()) return { ...base, exists: true, isDir: true, files: listFiles(abs) };
  if (!isDirOutput(out) && isTextType(out.type, out.path) && st.size <= MCP_MAX_TEXT_BYTES) {
    return { ...base, exists: true, bytes: st.size, text: h.readFile(abs, "utf8") };
  }
  return { ...base, exists: true, bytes: st.size, note: st.size > MCP_MAX_TEXT_BYTES ? "too big to inline / 太大，只给路径" : "binary / 二进制文件，只给路径" };
}

function stageOutputs(loaded: LoadedFlow, stage: Stage, localPaths: boolean) {
  return stage.outputs.map((o) => readOutput(loaded, stage, outputRel(o), localPaths));
}

/** Stages nothing else reads from: their outputs are what the flow makes. */
export function finalStages(loaded: LoadedFlow): Stage[] {
  const read = new Set(loaded.flow.stages.flatMap((s) => s.inputs ?? []));
  return loaded.flow.stages.filter((s) => !read.has(s.id));
}

function stageStates(loaded: LoadedFlow, overrides: Record<string, unknown>) {
  return statusJson(loaded, overrides).stages.map((s) => ({ id: s.id, name: s.name, executor: s.executor, state: s.state, latest: s.latest }));
}

const DEFAULT_NEXT =
  "把文件放好后再调用 run_flow，或者用 run_stage 的 files 直接给内容 / Put the files in place and call run_flow again, or pass their text in run_stage's files";

/** What a waiting stage needs. On a computer the files come with absolute paths so the client can put them there. */
function waitingInfo(loaded: LoadedFlow, backend: McpToolBackend, waiting: McpWaiting) {
  return {
    stage: waiting.stage,
    name: waiting.name,
    kind: waiting.kind,
    ...(waiting.subflowStage ? { subflowStage: waiting.subflowStage } : {}),
    ...(waiting.instructions ? { instructions: waiting.instructions } : {}),
    files: waiting.missing.map((rel) => ({ path: rel, ...(backend.localPaths ? { absPath: path.join(loaded.dir, rel) } : {}) })),
    next: backend.nextHint?.(waiting) ?? DEFAULT_NEXT,
  };
}

function waitingLine(waiting: McpWaiting): string {
  if (waiting.subflowStage) {
    return `⏸ 子流程的阶段「${waiting.subflowStage.name}」(${waiting.subflowStage.id}) 在等你：${waiting.missing.join(", ")} / sub-flow stage "${waiting.subflowStage.id}" is waiting for you: ${waiting.missing.join(", ")}`;
  }
  if (waiting.kind === "computer") return `⏸ 「${waiting.name}」要在电脑上运行 / Stage "${waiting.stage}" needs a computer`;
  return `⏸ 「${waiting.name}」在等你 / Stage "${waiting.stage}" is waiting for you: ${waiting.missing.join(", ")}`;
}

/* ---------- safety ---------- */

/** Actions that need --allow-exec on a computer, for the whole flow or one stage (and its sub-flow). */
export function execActions(loaded: LoadedFlow, stageId?: string): FlowAction[] {
  return flowActions(loaded.flow, loaded.dir).filter(
    (a) => MCP_EXEC_KINDS.has(a.kind) && (stageId === undefined || a.stage === stageId || a.stage.startsWith(`${stageId}/`)),
  );
}

export function execRefusal(actions: FlowAction[]): string {
  const list = actions.map((a) => `  - ${a.stage} (${a.kind}): ${a.detail}`).join("\n");
  return (
    `这个流程会在你的电脑上运行命令、启动程序或调用服务，所以 MCP 调用被拒绝了。确认没问题后，用 flowgit serve --mcp --allow-exec 启动服务器。\n` +
    `This flow runs commands, starts programs or calls services on your computer, so the MCP call was refused. If that is fine, start the server with flowgit serve --mcp --allow-exec.\n${list}`
  );
}

/** Text-file outputs of a waiting human stage that a form can ask for; undefined when any missing one is not plain text. */
export function askableFiles(stage: Stage, waiting: McpWaiting): string[] | undefined {
  if (waiting.subflowStage || waiting.kind !== "human") return undefined;
  for (const rel of waiting.missing) {
    const out = stage.outputs.find((o) => outputRel(o) === rel);
    if (!out || isDirOutput(out) || !isTextType(out.type, out.path)) return undefined;
  }
  return waiting.missing;
}

/** Write text into a human stage's outputs (run_stage's `files`, or answers to a form). */
export function writeHumanFiles(loaded: LoadedFlow, stage: Stage, files: Record<string, unknown>): void {
  const h = host();
  for (const [rel, text] of Object.entries(files)) {
    const out = stage.outputs.find((o) => outputRel(o) === rel);
    if (!out) {
      const known = stage.outputs.map((o) => outputRel(o)).join(", ");
      throw new Error(`「${stage.name}」没有产物 ${rel}，可以写的是 / stage "${stage.id}" has no output ${rel}; its outputs are: ${known}`);
    }
    if (isDirOutput(out) || typeof text !== "string") {
      throw new Error(`${rel} 只能给一段文字 / ${rel} takes a text string only`);
    }
    const abs = outputAbs(loaded.dir, out);
    h.mkdir(path.dirname(abs), { recursive: true });
    h.writeFile(abs, text);
  }
}

/** Versions made since `since` (ISO), oldest first: what a run just did, for backends that run elsewhere. */
export function recordsSince(loaded: LoadedFlow, since: string): RunRecord[] {
  return loaded.flow.stages
    .flatMap((s) => listRuns(loaded.dir, s.id))
    .filter((r) => r.startedAt >= since)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.n - b.n);
}

/* ---------- the calls ---------- */

type ToolArgs = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function missingInputsResult(err: MissingInputsError): McpToolResult {
  return mcpError(
    `缺少流程输入：${err.missing.join(", ")}。在 run_flow 的参数或 run_stage 的 inputs 里传入 / Missing flow inputs: ${err.missing.join(", ")}. Pass them as run_flow parameters or in run_stage's inputs`,
  );
}

/** Read-only tools: status and get_output. */
function readTool(backend: McpToolBackend, name: string, args: ToolArgs): McpToolResult {
  const loaded = backend.load();
  if (name === "status") return mcpText("流程状态 / flow status", statusJson(loaded, backend.inputs({}), backend.localPaths));
  const stage = requireStage(loaded.flow, String(args.stage ?? ""));
  const latest = latestOkRun(loaded.dir, stage.id);
  if (args.path !== undefined) {
    const rel = String(args.path);
    if (!stage.outputs.some((o) => outputRel(o) === rel)) {
      const known = stage.outputs.map((o) => outputRel(o)).join(", ");
      return mcpError(`「${stage.name}」没有产物 ${rel} / stage "${stage.id}" has no output ${rel}; its outputs are: ${known}`);
    }
    return mcpText(`「${stage.name}」/ ${stage.id}: ${rel}`, { latest: latest?.n ?? null, outputs: [readOutput(loaded, stage, rel, backend.localPaths)] });
  }
  return mcpText(`「${stage.name}」/ ${stage.id}`, { latest: latest?.n ?? null, outputs: stageOutputs(loaded, stage, backend.localPaths) });
}

async function runFlowTool(backend: McpToolBackend, args: ToolArgs): Promise<McpToolResult> {
  const loaded = backend.load();
  const refused = backend.refuse?.(loaded);
  if (refused) return mcpError(refused.message, refused.data);
  const inputs = backend.inputs(args);
  loadFlowInputs(loaded.dir, loaded.flow, inputs); // missing or wrong inputs: say so before anything starts
  const outcome = await backend.runFlow(loaded, inputs);
  if (outcome.status === "refused") return mcpError(outcome.message, outcome.data);
  const after = backend.load();
  const ran = outcome.records.map((r) => ({ stage: r.stage, n: r.n, status: r.status, executor: r.executor }));
  if (outcome.status === "waiting") {
    return mcpText(waitingLine(outcome.waiting), {
      status: "waiting",
      waiting: waitingInfo(after, backend, outcome.waiting),
      ran: ran.map(({ executor: _e, ...rest }) => rest),
      stages: stageStates(after, inputs),
    });
  }
  const summary = outcome.records.length
    ? `✓ 处理了 ${outcome.records.length} 个阶段 / ran ${outcome.records.length} stage(s)`
    : "✓ 没有要跑的，全部已是最新 / nothing to do, all stages up to date";
  return mcpText(summary, {
    status: "done",
    ran,
    stages: stageStates(after, inputs),
    outputs: finalStages(after).flatMap((s) => stageOutputs(after, s, backend.localPaths)),
  });
}

async function runStageTool(backend: McpToolBackend, args: ToolArgs): Promise<McpToolResult> {
  const loaded = backend.load();
  const stageId = String(args.stage ?? "");
  const stage = requireStage(loaded.flow, stageId);
  const refused = backend.refuse?.(loaded, stageId);
  if (refused) return mcpError(refused.message, refused.data);
  const inputs = backend.inputs(asObject(args.inputs));
  if (args.files !== undefined) {
    if (stage.executor.type !== "human") {
      return mcpError(`files 只能给人工阶段 / files only works for a human stage; "${stage.id}" is ${stage.executor.type}`);
    }
  }
  loadFlowInputs(loaded.dir, loaded.flow, inputs);
  if (args.files !== undefined) writeHumanFiles(loaded, stage, asObject(args.files));
  const outcome = await backend.runStage(loaded, stageId, inputs);
  if (outcome.status === "refused") return mcpError(outcome.message, outcome.data);
  const after = backend.load();
  if (outcome.status === "waiting") return mcpText(waitingLine(outcome.waiting), { status: "waiting", waiting: waitingInfo(after, backend, outcome.waiting) });
  const record = [...outcome.records].reverse().find((r) => r.stage === stageId) ?? latestOkRun(after.dir, stageId);
  if (!record) return mcpError("没有完成 / did not finish");
  return mcpText(`✓ 「${stage.name}」完成，v${record.n} / stage "${stage.id}" done as v${record.n}`, {
    status: "done",
    run: { stage: record.stage, n: record.n, executor: record.executor, params: record.params },
    outputs: stageOutputs(after, requireStage(after.flow, stageId), backend.localPaths),
  });
}

export const MCP_TOOL_NAMES = ["run_flow", "run_stage", "get_output", "status"] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export function isMcpRunTool(name: string): boolean {
  return name === "run_flow" || name === "run_stage";
}

/** Answer one tools/call. Errors come back as `isError` results, never thrown. */
export async function callMcpTool(backend: McpToolBackend, name: string, args: ToolArgs = {}): Promise<McpToolResult> {
  try {
    if (name === "status" || name === "get_output") return readTool(backend, name, args);
    if (name === "run_flow") return await runFlowTool(backend, args);
    if (name === "run_stage") return await runStageTool(backend, args);
    return mcpError(`没有这个工具 / unknown tool: ${name}`);
  } catch (err) {
    if (err instanceof MissingInputsError) return missingInputsResult(err);
    return mcpError((err as Error).message);
  }
}
