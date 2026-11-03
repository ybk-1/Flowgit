import type { Flow, FlowInput, Stage } from "../types.js";

/**
 * Shared pieces of `flowgit import`.
 *
 * Dify DSL envelope (`version`, `kind: app`, `app`, `workflow`):
 * https://github.com/langgenius/dify/blob/main/api/services/entities/dsl_entities.py
 * https://docs.dify.ai/en/learn/key-concepts
 *
 * n8n workflow export (`nodes`, `connections`):
 * https://docs.n8n.io/workflows/export-import/
 *
 * A model name is copied into `model` only when it is a Flowgit preset's own
 * model id. deepseek-chat and deepseek-reasoner are the DeepSeek API model
 * ids: https://api-docs.deepseek.com/
 */

export type ImportFormat = "dify" | "n8n";

export interface ImportReportEntry {
  /** Original node title. Empty for a note about the whole graph. */
  node: string;
  /** Original node type, or "graph" for a whole-flow note. */
  type: string;
  /** What it became: llm, script, service, human, or a bilingual phrase. */
  became: string;
  /** Bilingual detail. Empty when there is nothing to add. */
  note: string;
}

export interface ImportResult {
  flow: Flow;
  /** Paths relative to the flow directory, using "/". Does not include flow.json. */
  files: Record<string, string>;
  report: ImportReportEntry[];
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}

export const UNKNOWN_IMPORT_FORMAT =
  "认不出这是 Dify 的 DSL（需要 app 和 workflow.graph）还是 n8n 的工作流（需要 nodes 和 connections） / This is neither a Dify DSL (needs app and workflow.graph) nor an n8n workflow (needs nodes and connections)";

export const NOT_DIFY =
  "这份文件不是 Dify 的 DSL（需要 app 和 workflow.graph） / This file is not a Dify DSL (it needs app and workflow.graph)";

export const NOT_N8N =
  "这份文件不是 n8n 的工作流（需要 nodes 和 connections） / This file is not an n8n workflow (it needs nodes and connections)";

/** The sentence a prompt uses in place of a reference to another node's output. */
export function upstreamNote(stageId: string): string {
  return `见上游产物 ${stageId} / see the upstream output ${stageId}`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

/** File name only, so a Windows or POSIX path never lands in forkedFrom.source. */
export function fileNameOnly(filename: string): string {
  const parts = filename.split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? "";
  return base && base !== "." && base !== ".." ? base : "workflow";
}

export function importSource(format: ImportFormat, filename: string): string {
  return `${format}:${fileNameOnly(filename)}`;
}

const SURE_MODELS: Record<string, string> = {
  "deepseek-chat": "deepseek/deepseek-chat",
  "deepseek-reasoner": "deepseek/deepseek-reasoner",
};

/** A Flowgit preset model, or undefined when the person should pick one. */
export function presetModel(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const bare = name.trim().split("/").pop()?.toLowerCase() ?? "";
  return SURE_MODELS[bare];
}

export function modelNote(original: string | undefined, mapped: string | undefined): string {
  if (!original) return "";
  if (mapped) return `原模型 / original model: ${original} → ${mapped}`;
  return `原模型 / original model: ${original}（未写入 model，请自己选 / not written to model; pick one）`;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A flow-input name `{{inputs.name}}` can use. Duplicates get _2, _3, ... */
export function inputKey(raw: string, used: Set<string>): string {
  let base = raw.normalize("NFKD").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base || !/^[A-Za-z_]/.test(base)) base = `input_${base || "value"}`;
  base = base.slice(0, 40);
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  used.add(key);
  return key;
}

/** A stage id: [a-z0-9-], starting with a letter. Duplicates get -2, -3, ... */
export function stageId(title: string, used: Set<string>): string {
  let base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!base || !/^[a-z]/.test(base)) base = base ? `n-${base}` : "stage";
  base = base.slice(0, 40).replace(/-+$/g, "");
  if (!/^[a-z]/.test(base)) base = "stage";
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

export function flowSlug(name: string): string | undefined {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return /^[a-z][a-z0-9-]{0,63}$/.test(slug) ? slug : undefined;
}

export function envVarName(raw: string, fallback = "HTTP_API_KEY"): string {
  let name = raw.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  if (!name || /^[0-9]/.test(name)) name = `ENV_${name || fallback}`;
  if (!IDENT.test(name)) name = fallback;
  return name.slice(0, 64);
}

/** True when a header or credential value must not be written into a file. */
export function looksLikeSecret(value: string): boolean {
  const text = value.trim();
  if (!text || text.includes("{{")) return false;
  if (/sk-[A-Za-z0-9_-]{8,}/.test(text)) return true;
  if (/AKIA[A-Z0-9]{16}/.test(text)) return true;
  if (/ghp_[A-Za-z0-9_]{10,}/.test(text)) return true;
  if (/github_pat_[A-Za-z0-9_]{10,}/.test(text)) return true;
  if (/xox[baprs]-[A-Za-z0-9-]{10,}/.test(text)) return true;
  if (/^Bearer\s+\S{12,}/i.test(text)) return true;
  if (/^Basic\s+[A-Za-z0-9+/=]{8,}/i.test(text)) return true;
  if (/^[A-Za-z0-9_-]{24,}$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text)) return true;
  return false;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…")
    .replace(/AKIA[A-Z0-9]{16}/g, "AKIA…")
    .replace(/ghp_[A-Za-z0-9_]{10,}/g, "ghp_…")
    .replace(/github_pat_[A-Za-z0-9_]{10,}/g, "github_pat_…")
    .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, "xox…")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer …")
    .replace(/Basic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic …");
}

export function summarize(value: unknown, max = 360): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return "";
  }
  if (!text || text === "{}" || text === "[]") return "";
  text = redactSecrets(text);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Dify `{{#nodeId.field#}}` and n8n `{{ $json.x }}` / `{{ $('Node').item.json.x }}`. */
export interface RewriteContext {
  /** Original node id or title → stage id. */
  stageOf: Map<string, string>;
  /** Node ids and titles that became flow inputs (start, triggers). */
  inputSources: Set<string>;
  inputNames: Set<string>;
  /** Original variable name → flow input name, when the import renamed it. */
  inputAlias?: Map<string, string>;
  /** Stage ids of the nodes that feed the text being rewritten. */
  upstream: string[];
}

function inputRef(ctx: RewriteContext, field: string): string | undefined {
  if (ctx.inputNames.has(field)) return field;
  const alias = ctx.inputAlias?.get(field);
  if (alias && ctx.inputNames.has(alias)) return alias;
  return undefined;
}

export interface RewriteResult {
  text: string;
  unmatched: string[];
}

/**
 * `{{#1711617514996.name#}}` is `[nodeId, name]`.
 * https://github.com/langgenius/dify/blob/main/web/app/components/base/prompt-editor/constants.tsx
 */
export function rewriteDifyText(text: string, ctx: RewriteContext): RewriteResult {
  const unmatched: string[] = [];
  const out = text.replace(/\{\{#\s*([^#{}]+?)\s*#\}\}/g, (raw, inner: string) => {
    const parts = inner.split(".").map((part) => part.trim()).filter(Boolean);
    const node = parts[0] ?? "";
    const field = parts[1] ?? "";
    const input = parts.length === 2 ? inputRef(ctx, field) : undefined;
    if (ctx.inputSources.has(node) && input) return `{{inputs.${input}}}`;
    const stage = ctx.stageOf.get(node);
    if (stage) return upstreamNote(stage);
    if (!unmatched.includes(raw)) unmatched.push(raw);
    return raw;
  });
  return { text: out, unmatched };
}

/**
 * `$json` is the current item; `$('Node').item.json` is another node's item.
 * https://docs.n8n.io/build/work-with-data/reference-data/reference-previous-nodes/
 */
export function rewriteN8nText(text: string, ctx: RewriteContext): RewriteResult {
  const unmatched: string[] = [];
  const nodeRef = (raw: string, node: string, field: string): string => {
    const input = inputRef(ctx, field);
    if (ctx.inputSources.has(node) && input) return `{{inputs.${input}}}`;
    const stage = ctx.stageOf.get(node);
    if (stage) return upstreamNote(stage);
    if (!unmatched.includes(raw)) unmatched.push(raw);
    return raw;
  };
  const jsonRef = (raw: string, field: string): string => {
    const input = inputRef(ctx, field);
    if (input) return `{{inputs.${input}}}`;
    if (ctx.upstream.length === 1) return upstreamNote(ctx.upstream[0]!);
    if (!unmatched.includes(raw)) unmatched.push(raw);
    return raw;
  };
  let out = text.replace(
    /=?\{\{\s*\$\(\s*(['"])([\s\S]+?)\1\s*\)\.item\.json\.([A-Za-z0-9_]+)\s*\}\}/g,
    (raw, _q: string, node: string, field: string) => nodeRef(raw, node, field),
  );
  out = out.replace(/=?\{\{\s*\$json\.([A-Za-z0-9_]+)\s*\}\}/g, (raw, field: string) => jsonRef(raw, field));
  out = out.replace(/=?\{\{\s*\$json\[\s*(['"])([A-Za-z0-9_]+)\1\s*\]\s*\}\}/g, (raw, _q: string, field: string) => jsonRef(raw, field));
  return { text: out, unmatched };
}

export function unmatchedNote(items: string[]): string {
  if (!items.length) return "";
  return `未替换 / left as-is: ${items.join(", ")}`;
}

export function joinNotes(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

export interface NamedHeader {
  name: string;
  value: string;
}

export function splitHeaderLines(text: string): NamedHeader[] {
  const out: NamedHeader[] = [];
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

function envFromTemplate(value: string): string | undefined {
  const dify = /\{\{#\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*#\}\}/.exec(value);
  if (dify?.[1]) return dify[1];
  const plain = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/.exec(value);
  if (plain?.[1]) return plain[1];
  return undefined;
}

/** A URL the service executor can call. Templates are removed first; anything left must be http(s). */
export function staticUrl(url: string): string | undefined {
  let text = url.trim();
  text = text.replace(/\{\{#[^#]*#\}\}/g, "");
  text = text.replace(/=\{\{[\s\S]*?\}\}/g, "");
  text = text.replace(/\{\{[\s\S]*?\}\}/g, "");
  text = text.trim();
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export interface ServicePlan {
  ok: boolean;
  method?: "GET" | "POST";
  url?: string;
  headers?: Record<string, string>;
  note: string;
}

/**
 * GET and POST become a service stage. Auth values become `{{env.NAME}}`.
 * A literal secret is never copied. Other methods and file uploads do not.
 */
export function planService(input: {
  method: string;
  url: string;
  headers: NamedHeader[];
  uploads: boolean;
  credentialName?: string;
  authStyle?: "bearer" | "basic" | "header";
}): ServicePlan {
  if (input.uploads) {
    return { ok: false, note: "要上传文件，改成人工阶段 / uploads a file, so this is a human stage" };
  }
  const method = input.method.trim().toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return { ok: false, note: `方法 ${method || "（空 / empty）"} 不是 GET 或 POST，改成人工阶段 / method ${method || "(empty)"} is not GET or POST, so this is a human stage` };
  }
  const url = staticUrl(input.url);
  if (!url) {
    return { ok: false, note: `地址不能当成 http(s) 服务调用，改成人工阶段 / the URL cannot be called as an http(s) service, so this is a human stage: ${redactSecrets(input.url)}` };
  }
  const notes: string[] = [];
  if (url !== input.url.trim() && input.url.includes("{{")) {
    notes.push("地址里的变量已去掉，GET 会另把流程输入放到查询参数里 / variables were removed from the URL; a GET also sends flow inputs as query parameters");
  }
  const headers = [...input.headers];
  if (input.authStyle && !headers.some((header) => header.name.toLowerCase() === "authorization")) {
    const env = envVarName(input.credentialName || "HTTP_API_KEY");
    const value = input.authStyle === "bearer" ? `Bearer {{env.${env}}}` : input.authStyle === "basic" ? `Basic {{env.${env}}}` : `{{env.${env}}}`;
    headers.push({ name: "Authorization", value });
    notes.push(`鉴权改为 {{env.${env}}} / auth is {{env.${env}}}`);
  }
  const resolved: Record<string, string> = {};
  for (const header of headers) {
    if (!header.value.trim()) continue;
    const env = envFromTemplate(header.value);
    if (env) {
      const token = `{{env.${env}}}`;
      resolved[header.name] = /bearer/i.test(header.value) ? `Bearer ${token}` : /basic/i.test(header.value) ? `Basic ${token}` : token;
      notes.push(`${header.name} 使用 {{env.${env}}} / ${header.name} uses {{env.${env}}}`);
      continue;
    }
    if (looksLikeSecret(header.value)) {
      const envName = envVarName(input.credentialName || header.name, "HTTP_API_KEY");
      const token = `{{env.${envName}}}`;
      resolved[header.name] = /^bearer\b/i.test(header.value.trim()) ? `Bearer ${token}` : /^basic\b/i.test(header.value.trim()) ? `Basic ${token}` : token;
      notes.push(`${header.name} 的原值没有写入，改为 {{env.${envName}}} / the original ${header.name} value was not written; it is {{env.${envName}}}`);
      continue;
    }
    if (header.value.includes("{{")) {
      notes.push(`请求头 ${header.name} 含变量，没有写入 / header ${header.name} contains a variable and was not written`);
      continue;
    }
    resolved[header.name] = header.value;
  }
  return { ok: true, method, url, headers: resolved, note: joinNotes(...notes) };
}

export function promptDocument(system: string, user: string): string {
  const parts: string[] = [];
  if (system.trim()) parts.push(`系统 / system:\n\n${system.trim()}\n`);
  if (user.trim()) parts.push(`用户 / user:\n\n${user.trim()}\n`);
  if (!parts.length) parts.push("（原节点没有提示词 / the original node had no prompt）\n");
  return parts.join("\n");
}

export interface CodeArg {
  name: string;
  /** Flow input name, when the selector points at one. */
  input?: string;
  /** Upstream stage id, when the selector points at a stage. */
  stage?: string;
  /** Field inside that stage's JSON output. */
  key?: string;
}

/** `$items` is the legacy Code/Function variable; `this.helpers` is the node-builder HTTP helper. The wrapper hosts neither. */
export function cannotHostCode(code: string): "items" | "helpers" | undefined {
  // https://docs.n8n.io/build/code-in-n8n/using-the-code-node/
  // https://docs.n8n.io/connect/create-nodes/build-your-node/reference/http-request-helpers/
  if (/\$items\b/.test(code)) return "items";
  if (/\bthis\.helpers\b/.test(code)) return "helpers";
  return undefined;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function writePreludeJs(): string {
  return [
    'import { mkdirSync as flowgitMkdir, readFileSync as flowgitRead, writeFileSync as flowgitWrite } from "node:fs";',
    'import { dirname as flowgitDirname } from "node:path";',
    "",
    "const flowgitFlowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS || \"{}\");",
    "const flowgitInputList = JSON.parse(process.env.FLOWGIT_INPUTS || \"[]\");",
    "const flowgitOutputList = JSON.parse(process.env.FLOWGIT_OUTPUTS || \"[]\");",
    "",
    "function flowgitReadArtifact(item) {",
    "  const text = flowgitRead(item.path, \"utf8\");",
    "  const asJson = String(item.type || \"\").includes(\"json\") || String(item.path).endsWith(\".json\");",
    "  if (!asJson) return { text };",
    "  try { return JSON.parse(text); } catch { return { text }; }",
    "}",
    "",
    "const flowgitUpstream = {};",
    "for (const item of flowgitInputList) flowgitUpstream[item.stage] = flowgitReadArtifact(item);",
    "",
    "function flowgitPick(stage, key) {",
    "  const data = flowgitUpstream[stage];",
    "  if (data && typeof data === \"object\" && Object.prototype.hasOwnProperty.call(data, key)) return data[key];",
    "  return data;",
    "}",
    "",
  ].join("\n");
}

function writeTailJs(expression: string): string {
  return [
    "",
    `const flowgitResult = await Promise.resolve(${expression});`,
    "let flowgitPayload = flowgitResult;",
    "if (Array.isArray(flowgitPayload)) {",
    "  const first = flowgitPayload[0];",
    "  flowgitPayload = first && typeof first === \"object\" && first.json && typeof first.json === \"object\" ? first.json : { items: flowgitPayload };",
    "} else if (flowgitPayload && typeof flowgitPayload === \"object\" && flowgitPayload.json && typeof flowgitPayload.json === \"object\") {",
    "  flowgitPayload = flowgitPayload.json;",
    "} else if (flowgitPayload === undefined) {",
    "  flowgitPayload = {};",
    "} else if (typeof flowgitPayload !== \"object\" || flowgitPayload === null) {",
    "  flowgitPayload = { result: flowgitPayload };",
    "}",
    "const flowgitOut = flowgitOutputList[0].path;",
    "flowgitMkdir(flowgitDirname(flowgitOut), { recursive: true });",
    "flowgitWrite(flowgitOut, JSON.stringify(flowgitPayload, null, 2) + \"\\n\");",
    "",
  ].join("\n");
}

function argObject(args: CodeArg[]): string {
  const fields = args.map((arg) => {
    if (arg.input) return `${arg.name}: Object.prototype.hasOwnProperty.call(flowgitFlowInputs, ${jsString(arg.input)}) ? flowgitFlowInputs[${jsString(arg.input)}] : undefined`;
    if (arg.stage) return `${arg.name}: flowgitPick(${jsString(arg.stage)}, ${jsString(arg.key ?? "")})`;
    return `${arg.name}: undefined`;
  });
  return `{ ${fields.join(", ")} }`;
}

/**
 * Dify's JavaScript code node defines `function main` and receives one object
 * of input variables.
 * https://docs.dify.ai/en/self-host/use-dify/nodes/code
 * https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/code/types.ts
 */
export function renderDifyJavaScript(code: string, args: CodeArg[]): string {
  return `${writePreludeJs()}${code.trim()}\n${writeTailJs(`main(${argObject(args)})`)}`;
}

/**
 * n8n's Code node is a script. `return` is wrapped in a function. `$json` is
 * the current item (flow inputs, then the single upstream output). `$('Name')`
 * reads another stage, or the flow inputs when Name is a trigger.
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/
 */
export function renderN8nJavaScript(code: string, aliases: Record<string, string | null>): string {
  const aliasLiteral = JSON.stringify(aliases);
  const body = [
    writePreludeJs().trimEnd(),
    `const flowgitAliases = ${aliasLiteral};`,
    "const $json = { ...flowgitFlowInputs };",
    "if (flowgitInputList.length === 1) {",
    "  const data = flowgitUpstream[flowgitInputList[0].stage];",
    "  if (data && typeof data === \"object\" && !Array.isArray(data)) Object.assign($json, data);",
    "}",
    "function $(name) {",
    "  const id = Object.prototype.hasOwnProperty.call(flowgitAliases, name) ? flowgitAliases[name] : name;",
    "  const data = id && flowgitUpstream[id] && typeof flowgitUpstream[id] === \"object\" ? { ...flowgitUpstream[id] } : {};",
    "  if (!id) Object.assign(data, flowgitFlowInputs);",
    "  return { item: { json: data }, first: () => ({ json: data }), all: () => [{ json: data }] };",
    "}",
    "const $input = { item: { json: $json }, first: () => ({ json: $json }), all: () => [{ json: $json }] };",
    writeTailJs(`(async () => {\n${code.replace(/\r\n/g, "\n")}\n})()`).trimEnd(),
    "",
  ];
  return body.join("\n");
}

function pythonPrelude(): string {
  return [
    "import json",
    "import os",
    "from pathlib import Path",
    "",
    "_fg_flow_inputs = json.loads(os.environ.get(\"FLOWGIT_FLOW_INPUTS\") or \"{}\")",
    "_fg_input_list = json.loads(os.environ.get(\"FLOWGIT_INPUTS\") or \"[]\")",
    "_fg_output_list = json.loads(os.environ.get(\"FLOWGIT_OUTPUTS\") or \"[]\")",
    "",
    "def _fg_read(item):",
    "    text = Path(item[\"path\"]).read_text(encoding=\"utf-8\")",
    "    as_json = \"json\" in str(item.get(\"type\", \"\")) or str(item.get(\"path\", \"\")).endswith(\".json\")",
    "    if not as_json:",
    "        return {\"text\": text}",
    "    try:",
    "        return json.loads(text)",
    "    except json.JSONDecodeError:",
    "        return {\"text\": text}",
    "",
    "_fg_upstream = {}",
    "for _fg_item in _fg_input_list:",
    "    _fg_upstream[_fg_item[\"stage\"]] = _fg_read(_fg_item)",
    "",
    "def _fg_pick(stage, key):",
    "    data = _fg_upstream.get(stage)",
    "    if isinstance(data, dict) and key in data:",
    "        return data[key]",
    "    return data",
    "",
  ].join("\n");
}

function pythonTail(call: string): string {
  return [
    "",
    `_fg_result = ${call}`,
    "if not isinstance(_fg_result, dict):",
    "    _fg_result = {\"result\": _fg_result}",
    "_fg_out = Path(_fg_output_list[0][\"path\"])",
    "_fg_out.parent.mkdir(parents=True, exist_ok=True)",
    "_fg_out.write_text(json.dumps(_fg_result, ensure_ascii=False, indent=2) + \"\\n\", encoding=\"utf-8\")",
    "",
  ].join("\n");
}

function pythonCall(args: CodeArg[]): string {
  const fields = args.map((arg) => {
    if (arg.input) return `${arg.name}=_fg_flow_inputs.get(${jsString(arg.input)})`;
    if (arg.stage) return `${arg.name}=_fg_pick(${jsString(arg.stage)}, ${jsString(arg.key ?? "")})`;
    return `${arg.name}=None`;
  });
  return `main(${fields.join(", ")})`;
}

/** Dify's Python code node defines `main` and returns a dict. https://docs.dify.ai/en/self-host/use-dify/nodes/code */
export function renderDifyPython(code: string, args: CodeArg[]): string {
  return `${pythonPrelude()}${code.trim()}\n${pythonTail(pythonCall(args))}`;
}

function indent(code: string, spaces = 4): string {
  const pad = " ".repeat(spaces);
  return code.replace(/\r\n/g, "\n").split("\n").map((line) => (line.trim() === "" ? "" : pad + line)).join("\n");
}

/**
 * n8n Python code uses `return` and `_items` / `_item`.
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/
 */
export function renderN8nPython(code: string): string {
  const body = [
    pythonPrelude().trimEnd(),
    "_fg_json = dict(_fg_flow_inputs)",
    "if len(_fg_input_list) == 1:",
    "    _fg_data = _fg_upstream.get(_fg_input_list[0][\"stage\"])",
    "    if isinstance(_fg_data, dict):",
    "        _fg_json.update(_fg_data)",
    "_items = [{\"json\": _fg_json}]",
    "_item = _items[0]",
    "def _fg_user():",
    indent(code),
    "    return None",
    pythonTail("_fg_user()").trimEnd(),
    "",
  ];
  return `${body.join("\n")}\n`;
}

export function hasMain(code: string, language: "python" | "javascript"): boolean {
  if (language === "python") return /^\s*def\s+main\s*\(/m.test(code);
  return /function\s+main\s*\(/.test(code);
}

export function humanInstructions(options: {
  title: string;
  type: string;
  kindZh: string;
  kindEn: string;
  summary?: string;
  branch?: boolean;
  code?: string;
}): string {
  const lines = [
    `原节点「${options.title}」（${options.type}）是${options.kindZh}。请按原来的作用手动完成，并把结果写到这个阶段的产物里。`,
    `Original node "${options.title}" (${options.type}) is a ${options.kindEn}. Do that step by hand and write the result to this stage's output.`,
  ];
  if (options.summary?.trim()) lines.push(redactSecrets(options.summary.trim()));
  if (options.branch) {
    lines.push("Flowgit 没有分支，两条路径都按顺序保留，请自行选择。 / Flowgit has no branches, so both paths are kept in order; choose by hand.");
  }
  if (options.code) {
    const fence = options.code.includes("```") ? "~~~~" : "```";
    lines.push(`原代码 / original code:\n${fence}\n${options.code.replace(/\r\n/g, "\n").trim()}\n${fence}`);
  }
  return lines.join("\n\n");
}

export interface HumanKind {
  zh: string;
  en: string;
  branch: boolean;
}

/** Branch, loop, knowledge, aggregator, classifier, or anything else a person has to do. */
export function humanKind(type: string): HumanKind {
  const name = type.toLowerCase();
  if (name === "if-else" || name === "if" || name === "switch") return { zh: "条件分支", en: "branch", branch: true };
  if (name === "iteration" || name === "loop" || name.includes("splitinbatches")) return { zh: "循环", en: "loop", branch: false };
  if (name.includes("knowledge")) return { zh: "知识库检索", en: "knowledge retrieval", branch: false };
  if (name.includes("aggregator") || name === "merge" || name === "variable-assigner" || name === "assigner") {
    return { zh: "变量聚合", en: "aggregator", branch: false };
  }
  if (name.includes("classifier")) return { zh: "问题分类", en: "question classifier", branch: false };
  if (name === "end" || name === "answer") return { zh: "结尾", en: "end", branch: false };
  return { zh: "未识别的节点", en: "unknown node", branch: false };
}

/**
 * Kahn's algorithm in file order. A cycle drops one edge and is reported,
 * so the flow still validates. Several nodes with no upstream are reported too.
 */
export function orderStages(stages: Stage[], notices: string[]): Stage[] {
  const ids = new Set(stages.map((stage) => stage.id));
  const deps = new Map<string, string[]>();
  for (const stage of stages) {
    deps.set(stage.id, [...new Set((stage.inputs ?? []).filter((id) => ids.has(id) && id !== stage.id))]);
  }
  const entries = stages.filter((stage) => (deps.get(stage.id) ?? []).length === 0).map((stage) => stage.id);
  if (entries.length > 1) {
    notices.push(`多个入口，按拓扑序排列：${entries.join(", ")} / Several entry points, ordered topologically: ${entries.join(", ")}`);
  }
  const done = new Set<string>();
  const order: string[] = [];
  const pending = new Set(stages.map((stage) => stage.id));
  while (pending.size) {
    const ready = stages.filter((stage) => pending.has(stage.id) && (deps.get(stage.id) ?? []).every((id) => done.has(id)));
    if (ready.length) {
      for (const stage of ready) {
        order.push(stage.id);
        done.add(stage.id);
        pending.delete(stage.id);
      }
      continue;
    }
    const stuck = stages.find((stage) => pending.has(stage.id))!;
    const drop = (deps.get(stuck.id) ?? []).find((id) => !done.has(id));
    if (!drop) {
      order.push(stuck.id);
      done.add(stuck.id);
      pending.delete(stuck.id);
      continue;
    }
    deps.set(stuck.id, (deps.get(stuck.id) ?? []).filter((id) => id !== drop));
    notices.push(`依赖成环，已去掉 ${drop} → ${stuck.id}，其余按拓扑序排列 / A cycle was broken by dropping ${drop} → ${stuck.id}; the rest stay in topological order`);
  }
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  return order.map((id) => {
    const stage = { ...byId.get(id)! };
    const inputs = deps.get(id) ?? [];
    if (inputs.length) stage.inputs = inputs;
    else delete stage.inputs;
    return stage;
  });
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderImportReadme(flow: Flow, report: ImportReportEntry[], notices: string[]): string {
  const source = flow.forkedFrom?.source ?? "";
  const lines = [
    `# ${flow.name}`,
    "",
    flow.description ?? "",
    "",
    `从 ${source} 导入。会运行命令或调用服务时，第一次运行前先确认（\`flowgit trust\`）。`,
    `Imported from ${source}. When it runs commands or calls services, confirm before the first run (\`flowgit trust\`).`,
    "",
    "## 导入报告 / Import report",
    "",
    "| 原节点 / Original | 类型 / Type | 变成 / Became | 说明 / Notes |",
    "| --- | --- | --- | --- |",
  ];
  for (const entry of report) {
    lines.push(`| ${tableCell(entry.node || "—")} | ${tableCell(entry.type)} | ${tableCell(entry.became)} | ${tableCell(entry.note)} |`);
  }
  if (notices.length) {
    lines.push("", ...notices.map((notice) => `- ${notice}`));
  }
  lines.push("");
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n");
}

export function assembleFlow(options: {
  format: ImportFormat;
  filename: string;
  name: string;
  description?: string;
  inputs: Record<string, FlowInput>;
  stages: Stage[];
  files: Record<string, string>;
  report: ImportReportEntry[];
  notices: string[];
}): ImportResult {
  const stages = options.stages.length
    ? options.stages
    : [
        {
          id: "imported",
          name: "导入结果",
          description: "导入 / import",
          executor: {
            type: "human" as const,
            instructions: humanInstructions({
              title: options.name,
              type: "empty",
              kindZh: "空的流程",
              kindEn: "empty flow",
              summary: "原文件在输入之后没有节点。 / The file had no nodes after its inputs.",
            }),
          },
          outputs: [{ type: "text/markdown", path: "outputs/imported.md" }],
        },
      ];
  if (!options.stages.length) {
    options.report.push({
      node: "",
      type: "empty",
      became: "human",
      note: "没有可运行的节点，加了一个人工阶段 / no runnable nodes, so one human stage was added",
    });
  }
  const ordered = orderStages(stages, options.notices);
  const id = flowSlug(options.name);
  const flow: Flow = {
    format: "flowgit",
    version: "0.1",
    ...(id ? { id } : {}),
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    forkedFrom: { source: importSource(options.format, options.filename) },
    ...(Object.keys(options.inputs).length ? { inputs: options.inputs } : {}),
    stages: ordered,
  };
  const files = { ...options.files, "README.md": renderImportReadme(flow, options.report, options.notices) };
  const report = [...options.report];
  for (const notice of options.notices) report.push({ node: "", type: "graph", became: "说明 / note", note: notice });
  return { flow, files, report };
}

export function stageDescription(origin: string, title: string, type: string): string {
  return `从 ${origin} 节点「${title}」（${type}）导入 / imported from the ${origin} node "${title}" (${type})`;
}

export function outputFor(id: string, kind: "llm" | "human" | "script" | "service"): { type: string; path: string } {
  if (kind === "script") return { type: "application/json", path: `outputs/${id}.json` };
  if (kind === "service") return { type: "text/plain", path: `outputs/${id}.txt` };
  return { type: "text/markdown", path: `outputs/${id}.md` };
}
