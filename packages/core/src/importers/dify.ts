import { parse } from "yaml";
import type { Executor, FlowInput, Stage } from "../types.js";
import {
  type CodeArg,
  type ImportReportEntry,
  type ImportResult,
  type NamedHeader,
  type RewriteContext,
  ImportFormatError,
  NOT_DIFY,
  asRecord,
  asString,
  assembleFlow,
  cannotHostCode,
  hasMain,
  humanInstructions,
  humanKind,
  inputKey,
  joinNotes,
  modelNote,
  outputFor,
  planService,
  presetModel,
  promptDocument,
  renderDifyJavaScript,
  renderDifyPython,
  rewriteDifyText,
  splitHeaderLines,
  stageDescription,
  stageId,
  summarize,
  unmatchedNote,
  upstreamNote,
} from "./common.js";

/**
 * Dify DSL → Flowgit.
 *
 * The export is YAML with `app` and `workflow.graph` (`nodes`, `edges`):
 * https://github.com/langgenius/dify/blob/main/api/services/entities/dsl_entities.py
 * https://docs.dify.ai/en/learn/key-concepts
 *
 * Node types (`start`, `llm`, `code`, `http-request`, `if-else`, `end`, ...):
 * https://github.com/langgenius/dify/blob/main/web/app/components/workflow/types.ts
 * Start variables: https://docs.dify.ai/en/self-host/use-dify/nodes/start
 * https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/start/types.ts
 * LLM prompts: https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/llm/types.ts
 * Code (`python3` / `javascript`, `function`/`def main`): https://docs.dify.ai/en/self-host/use-dify/nodes/code
 * https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/code/types.ts
 * HTTP (`get`/`post`/..., `authorization`, body `form-data`/`binary`):
 * https://docs.dify.ai/en/cloud/use-dify/nodes/http-request
 * https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/http/types.ts
 * Branches: https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/if-else/types.ts
 * End / answer: https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/end/types.ts
 * https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/answer/types.ts
 * Variable text `{{#nodeId.field#}}`:
 * https://github.com/langgenius/dify/blob/main/web/app/components/base/prompt-editor/constants.tsx
 */

interface DifyNode {
  id: string;
  title: string;
  type: string;
  data: Record<string, unknown>;
}

interface DifyEdge {
  source: string;
  target: string;
  sourceHandle: string;
}

export function isDifyDocument(value: unknown): boolean {
  const root = asRecord(value);
  const graph = asRecord(asRecord(root?.workflow)?.graph);
  return Boolean(asRecord(root?.app) && graph && Array.isArray(graph.nodes));
}

export function importDify(text: string, filename: string): ImportResult {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    throw new ImportFormatError(`Dify DSL 不是合法的 YAML / Dify DSL is not valid YAML: ${(err as Error).message}`);
  }
  if (!isDifyDocument(data)) throw new ImportFormatError(NOT_DIFY);
  const root = asRecord(data)!;
  const app = asRecord(root.app) ?? {};
  const graph = asRecord(asRecord(root.workflow)?.graph) ?? {};
  const nodes = readNodes(graph.nodes);
  const edges = readEdges(graph.edges);
  const name = asString(app.name) ?? fileTitle(filename);
  const description = asString(app.description);

  const usedIds = new Set<string>();
  const stageOfId = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === "start") continue;
    stageOfId.set(node.id, stageId(node.title, usedIds));
  }

  const usedInputs = new Set<string>();
  const inputs: Record<string, FlowInput> = {};
  const inputAlias = new Map<string, string>();
  const inputSources = new Set<string>();
  const report: ImportReportEntry[] = [];
  for (const node of nodes) {
    if (node.type !== "start") continue;
    inputSources.add(node.id);
    inputSources.add(node.title);
    const made = readStartInputs(node, inputs, usedInputs, inputAlias);
    report.push({
      node: node.title,
      type: node.type,
      became: "流程输入 / flow input",
      note: made.length ? made.join(", ") : "没有声明变量 / no variables declared",
    });
  }

  const stageOf = new Map<string, string>();
  for (const node of nodes) {
    const id = stageOfId.get(node.id);
    if (!id) continue;
    stageOf.set(node.id, id);
    stageOf.set(node.title, id);
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, { handle: string; target: string }[]>();
  for (const edge of edges) {
    const from = stageOf.get(edge.source);
    const to = stageOf.get(edge.target);
    if (to && from) {
      const list = incoming.get(edge.target) ?? [];
      if (!list.includes(from)) list.push(from);
      incoming.set(edge.target, list);
    }
    const outs = outgoing.get(edge.source) ?? [];
    outs.push({ handle: edge.sourceHandle, target: edge.target });
    outgoing.set(edge.source, outs);
  }

  const notices: string[] = [];
  let branched = false;
  const files: Record<string, string> = {};
  const stages: Stage[] = [];

  for (const node of nodes) {
    if (node.type === "start") continue;
    const id = stageOfId.get(node.id)!;
    const upstream = incoming.get(node.id) ?? [];
    const ctx: RewriteContext = {
      stageOf,
      inputSources,
      inputNames: new Set(Object.keys(inputs)),
      inputAlias,
      upstream,
    };
    const built = buildNode(node, id, ctx, files);
    const kind = humanKind(node.type);
    if (kind.branch && (outgoing.get(node.id)?.length ?? 0) >= 2) branched = true;
    const paths = (outgoing.get(node.id) ?? [])
      .map((edge) => {
        const title = nodes.find((item) => item.id === edge.target)?.title ?? edge.target;
        return `${edge.handle || "next"} → ${title}`;
      })
      .join(", ");
    stages.push({
      id,
      name: node.title,
      description: stageDescription("Dify", node.title, node.type),
      ...(upstream.length ? { inputs: upstream } : {}),
      executor: built.executor,
      outputs: [outputFor(id, built.output)],
    });
    report.push({
      node: node.title,
      type: node.type,
      became: built.became,
      note: joinNotes(built.note, paths && kind.branch ? `路径 / paths: ${paths}` : ""),
    });
  }
  if (branched) {
    notices.push("Flowgit 没有分支，两条路径都按顺序保留。 / Flowgit has no branches, so both paths are kept in order.");
  }
  return assembleFlow({ format: "dify", filename, name, ...(description ? { description } : {}), inputs, stages, files, report, notices });
}

function fileTitle(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "workflow";
  return base.replace(/\.(ya?ml|json)$/i, "") || "Imported flow";
}

function readNodes(value: unknown): DifyNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: DifyNode[] = [];
  for (const item of value) {
    const node = asRecord(item);
    const data = asRecord(node?.data) ?? {};
    const id = asString(node?.id);
    if (!id) continue;
    const type = asString(data.type) ?? asString(node?.type) ?? "unknown";
    const title = asString(data.title) ?? type;
    nodes.push({ id, title, type, data });
  }
  return nodes;
}

function readEdges(value: unknown): DifyEdge[] {
  if (!Array.isArray(value)) return [];
  const edges: DifyEdge[] = [];
  for (const item of value) {
    const edge = asRecord(item);
    const source = asString(edge?.source);
    const target = asString(edge?.target);
    if (!source || !target || source === target) continue;
    edges.push({ source, target, sourceHandle: asString(edge?.sourceHandle) ?? "" });
  }
  return edges;
}

function labelOf(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  return asString(record?.variable) ?? fallback;
}

function readStartInputs(
  node: DifyNode,
  inputs: Record<string, FlowInput>,
  used: Set<string>,
  alias: Map<string, string>,
): string[] {
  const variables = Array.isArray(node.data.variables) ? node.data.variables : [];
  const made: string[] = [];
  for (const item of variables) {
    const variable = asRecord(item);
    const original = asString(variable?.variable);
    if (!original) continue;
    const key = inputKey(original, used);
    alias.set(original, key);
    const typeName = asString(variable?.type) ?? "text-input";
    const input: FlowInput = { type: "string" };
    if (typeName === "number") input.type = "number";
    else if (typeName === "checkbox") input.type = "boolean";
    else if (typeName === "file" || typeName === "file-list" || typeName === "files") input.type = "file";
    else input.type = "string";
    const label = labelOf(variable?.label, original);
    const extra: string[] = [];
    if (label !== original) extra.push(label);
    if (typeName === "paragraph") extra.push("paragraph");
    if (typeof variable?.max_length === "number") extra.push(`最多 ${variable.max_length} 字 / up to ${variable.max_length} characters`);
    if (extra.length) input.description = extra.join(" · ");
    if (variable?.required === true) input.required = true;
    if (typeName === "select" && Array.isArray(variable?.options)) {
      const options = variable.options.filter((option) => typeof option === "string" || typeof option === "number");
      if (options.length) input.enum = options;
    }
    if (variable?.default !== undefined && variable.default !== "") input.default = variable.default;
    inputs[key] = input;
    made.push(key);
  }
  return made;
}

function selectorArgs(data: Record<string, unknown>, ctx: RewriteContext): { args: CodeArg[]; unbound: string[] } {
  const variables = Array.isArray(data.variables) ? data.variables : [];
  const args: CodeArg[] = [];
  const unbound: string[] = [];
  for (const item of variables) {
    const variable = asRecord(item);
    const name = asString(variable?.variable);
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const selector = Array.isArray(variable?.value_selector) ? variable.value_selector.map((part) => String(part)) : [];
    const node = selector[0] ?? "";
    const key = selector[1] ?? "";
    const input = ctx.inputSources.has(node) ? (ctx.inputNames.has(key) ? key : ctx.inputAlias?.get(key)) : undefined;
    if (input && ctx.inputNames.has(input)) {
      args.push({ name, input });
      continue;
    }
    const stage = ctx.stageOf.get(node);
    if (stage) {
      args.push({ name, stage, key });
      continue;
    }
    args.push({ name });
    unbound.push(`${name}: ${selector.join(".") || "?"}`);
  }
  return { args, unbound };
}

function promptParts(data: Record<string, unknown>, ctx: RewriteContext): { system: string; user: string; unmatched: string[] } {
  const template = data.prompt_template;
  const items = Array.isArray(template) ? template : template ? [template] : [];
  const system: string[] = [];
  const user: string[] = [];
  const unmatched: string[] = [];
  for (const item of items) {
    const prompt = asRecord(item);
    if (!prompt) continue;
    const raw = asString(prompt.jinja2_text) || asString(prompt.text) || "";
    const rewritten = rewriteDifyText(raw, ctx);
    unmatched.push(...rewritten.unmatched.filter((entry) => !unmatched.includes(entry)));
    const role = asString(prompt.role) ?? "user";
    if (role === "system") system.push(rewritten.text);
    else user.push(rewritten.text);
  }
  return { system: system.join("\n\n"), user: user.join("\n\n"), unmatched };
}

function httpHeaders(data: Record<string, unknown>): { headers: NamedHeader[]; authStyle?: "bearer" | "basic" | "header"; credentialName?: string } {
  const headers = splitHeaderLines(asString(data.headers) ?? "");
  const authorization = asRecord(data.authorization);
  if (!authorization || authorization.type === "no-auth") return { headers };
  const config = asRecord(authorization.config);
  const style = asString(config?.type);
  const apiKey = asString(config?.api_key) ?? "";
  const headerName = asString(config?.header) || "Authorization";
  if (style === "custom") headers.push({ name: headerName, value: apiKey });
  else if (style === "basic") headers.push({ name: "Authorization", value: apiKey ? `Basic ${apiKey}` : "" });
  else headers.push({ name: "Authorization", value: apiKey ? `Bearer ${apiKey}` : "" });
  const env = /\{\{#\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*#\}\}/.exec(apiKey);
  return { headers, credentialName: env?.[1] };
}

function uploadsFile(data: Record<string, unknown>): boolean {
  const body = asRecord(data.body);
  const type = asString(body?.type);
  if (type === "form-data" || type === "binary") return true;
  const payload = body?.data;
  if (!Array.isArray(payload)) return false;
  return payload.some((item) => asRecord(item)?.type === "file");
}

function conditionSummary(data: Record<string, unknown>): string {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const list = cases.length ? cases : [{ case_id: "true", logical_operator: data.logical_operator, conditions: data.conditions }];
  const lines: string[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const conditions = Array.isArray(record.conditions) ? record.conditions : [];
    const bits = conditions.map((condition) => {
      const row = asRecord(condition);
      if (!row) return "";
      const selector = Array.isArray(row.variable_selector) ? row.variable_selector.join(".") : "";
      return `${selector} ${asString(row.comparison_operator) ?? ""} ${JSON.stringify(row.value ?? "")}`.trim();
    }).filter(Boolean);
    lines.push(`${asString(record.case_id) ?? "case"} (${asString(record.logical_operator) ?? "and"}): ${bits.join("; ")}`);
  }
  return lines.join("\n");
}

function endSummary(node: DifyNode, ctx: RewriteContext): string {
  if (node.type === "answer") {
    const rewritten = rewriteDifyText(asString(node.data.answer) ?? "", ctx);
    const extra = unmatchedNote(rewritten.unmatched);
    return joinNotes(rewritten.text ? `回答 / answer:\n${rewritten.text}` : "", extra, "这一阶段的产物就是流程的结果。 / This stage's output is the flow's result.");
  }
  const outputs = Array.isArray(node.data.outputs) ? node.data.outputs : [];
  const lines = outputs.map((item) => {
    const output = asRecord(item);
    const name = asString(output?.variable) ?? "output";
    const selector = Array.isArray(output?.value_selector) ? output.value_selector.map(String) : [];
    const stage = ctx.stageOf.get(selector[0] ?? "");
    const where = stage ? upstreamNote(stage) : selector.join(".") || "?";
    return `${name}: ${where}`;
  });
  return joinNotes(lines.join("\n"), "这一阶段的产物就是流程的结果。 / This stage's output is the flow's result.");
}

function buildNode(
  node: DifyNode,
  id: string,
  ctx: RewriteContext,
  files: Record<string, string>,
): { executor: Executor; output: "llm" | "human" | "script" | "service"; became: string; note: string } {
  if (node.type === "llm") {
    const parts = promptParts(node.data, ctx);
    const file = `prompts/${id}.md`;
    files[file] = promptDocument(parts.system, parts.user);
    const original = asString(asRecord(node.data.model)?.name);
    const mapped = presetModel(original);
    return {
      executor: { type: "llm", prompt: file, ...(mapped ? { model: mapped } : {}) },
      output: "llm",
      became: "llm",
      note: joinNotes(modelNote(original, mapped), unmatchedNote(parts.unmatched)),
    };
  }
  if (node.type === "code") {
    const code = asString(node.data.code) ?? "";
    const language = asString(node.data.code_language) === "javascript" ? "javascript" : "python";
    const blocked = cannotHostCode(code);
    if (!code || blocked || !hasMain(code, language)) {
      const why = !code
        ? "没有代码 / no code"
        : blocked === "items"
          ? "用了 $items，包装层放不下 / uses $items, which the wrapper cannot host"
          : blocked === "helpers"
            ? "用了 this.helpers，包装层放不下 / uses this.helpers, which the wrapper cannot host"
            : "没有 main 函数，包装层无法调用 / there is no main function for the wrapper to call";
      return {
        executor: {
          type: "human",
          instructions: humanInstructions({ title: node.title, type: node.type, kindZh: "代码", kindEn: "code", summary: why, code }),
        },
        output: "human",
        became: "human",
        note: why,
      };
    }
    const bound = selectorArgs(node.data, ctx);
    if (language === "javascript") {
      const file = `scripts/${id}.mjs`;
      files[file] = renderDifyJavaScript(code, bound.args);
      return {
        executor: { type: "script", run: `node ${file}` },
        output: "script",
        became: "script",
        note: joinNotes("JavaScript", unmatchedNote(bound.unbound)),
      };
    }
    const file = `scripts/${id}.py`;
    files[file] = renderDifyPython(code, bound.args);
    return {
      executor: { type: "script", run: `python3 ${file}`, requires: ["python3"] },
      output: "script",
      became: "script",
      note: joinNotes("Python", unmatchedNote(bound.unbound)),
    };
  }
  if (node.type === "http-request") {
    const method = asString(node.data.method) ?? "";
    const url = asString(node.data.url) ?? "";
    const auth = httpHeaders(node.data);
    const plan = planService({
      method,
      url,
      headers: auth.headers,
      uploads: uploadsFile(node.data),
      ...(auth.credentialName ? { credentialName: auth.credentialName } : {}),
    });
    if (!plan.ok || !plan.url || !plan.method) {
      return {
        executor: {
          type: "human",
          instructions: humanInstructions({
            title: node.title,
            type: node.type,
            kindZh: "HTTP 请求",
            kindEn: "HTTP request",
            summary: joinNotes(plan.note, method, redactUrl(url)),
          }),
        },
        output: "human",
        became: "human",
        note: plan.note,
      };
    }
    return {
      executor: {
        type: "service",
        url: plan.url,
        method: plan.method,
        ...(plan.headers && Object.keys(plan.headers).length ? { headers: plan.headers } : {}),
      },
      output: "service",
      became: "service",
      note: joinNotes(`${plan.method} ${plan.url}`, plan.note),
    };
  }
  const kind = humanKind(node.type);
  const summary = node.type === "end" || node.type === "answer"
    ? endSummary(node, ctx)
    : joinNotes(kind.branch ? conditionSummary(node.data) : "", summarize(node.data));
  return {
    executor: {
      type: "human",
      instructions: humanInstructions({
        title: node.title,
        type: node.type,
        kindZh: kind.zh,
        kindEn: kind.en,
        summary,
        branch: kind.branch,
      }),
    },
    output: "human",
    became: "human",
    note: kind.en,
  };
}

function redactUrl(url: string): string {
  return url.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…");
}
