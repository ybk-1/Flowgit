import type { Executor, FlowInput, Stage } from "../types.js";
import {
  type ImportReportEntry,
  type ImportResult,
  type NamedHeader,
  type RewriteContext,
  ImportFormatError,
  NOT_N8N,
  asRecord,
  asString,
  assembleFlow,
  cannotHostCode,
  humanInstructions,
  humanKind,
  inputKey,
  joinNotes,
  modelNote,
  outputFor,
  planService,
  presetModel,
  promptDocument,
  renderN8nJavaScript,
  renderN8nPython,
  rewriteN8nText,
  stageDescription,
  stageId,
  summarize,
  unmatchedNote,
} from "./common.js";

/**
 * n8n workflow JSON → Flowgit.
 *
 * Export shape (`name`, `nodes`, `connections`, keyed by node name, `main`
 * outputs): https://docs.n8n.io/workflows/export-import/
 *
 * Manual trigger (older exports use `n8n-nodes-base.manualTrigger`; the
 * current node is `n8n-nodes-base.manualWorkflowTrigger`):
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/
 * Webhook: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
 * Form trigger (`formFields.values[].fieldLabel` / `fieldType`):
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.formtrigger/
 * Code (`jsCode` / `pythonCode`; `$items` and `this.helpers` are not hosted):
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/
 * https://docs.n8n.io/build/code-in-n8n/using-the-code-node/
 * https://docs.n8n.io/connect/create-nodes/build-your-node/reference/http-request-helpers/
 * Expressions `{{ $json.x }}` and `{{ $('Node').item.json.x }}`:
 * https://docs.n8n.io/build/work-with-data/reference-data/reference-previous-nodes/
 * HTTP Request (GET/POST, credentials by name, never the secret):
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
 * IF (output 0 is true, output 1 is false):
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/
 */

interface N8nNode {
  id: string;
  name: string;
  type: string;
  disabled: boolean;
  parameters: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

interface N8nEdge {
  from: string;
  to: string;
  output: number;
}

type TriggerKind = "manual" | "webhook" | "form";

export function isN8nDocument(value: unknown): boolean {
  const root = unwrap(value);
  return Boolean(root && Array.isArray(root.nodes) && asRecord(root.connections));
}

export function importN8n(text: string, filename: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new ImportFormatError(`n8n 工作流不是合法的 JSON / n8n workflow is not valid JSON: ${(err as Error).message}`);
  }
  const root = unwrap(data);
  if (!root || !Array.isArray(root.nodes) || !asRecord(root.connections)) throw new ImportFormatError(NOT_N8N);
  const extra = Array.isArray(data) && data.length > 1 ? data.length - 1 : 0;
  const nodes = readNodes(root.nodes);
  const edges = readEdges(asRecord(root.connections) ?? {}, nodes);
  const name = asString(root.name) ?? fileTitle(filename);
  const description = asString(asRecord(root.meta)?.description) ?? asString(root.description);

  const usedIds = new Set<string>();
  const stageOfName = new Map<string, string>();
  for (const node of nodes) {
    if (node.disabled || triggerKind(node.type)) continue;
    stageOfName.set(node.name, stageId(node.name, usedIds));
  }

  const usedInputs = new Set<string>();
  const inputs: Record<string, FlowInput> = {};
  const inputAlias = new Map<string, string>();
  const inputSources = new Set<string>();
  const report: ImportReportEntry[] = [];
  const notices: string[] = [];
  if (extra) {
    notices.push(`文件里有 ${extra + 1} 个工作流，只导入了第一个 / the file has ${extra + 1} workflows; only the first was imported`);
  }
  for (const node of nodes) {
    if (node.disabled) {
      report.push({ node: node.name, type: shortType(node.type), became: "跳过 / skipped", note: "节点已停用 / node is disabled" });
      continue;
    }
    const trigger = triggerKind(node.type);
    if (!trigger) continue;
    inputSources.add(node.name);
    if (node.id) inputSources.add(node.id);
    const made = readTriggerInputs(node, trigger, inputs, usedInputs, inputAlias);
    report.push({
      node: node.name,
      type: shortType(node.type),
      became: "流程输入 / flow input",
      note: made.length ? made.join(", ") : triggerNote(trigger),
    });
  }

  const stageOf = new Map<string, string>(stageOfName);
  for (const node of nodes) {
    const id = stageOfName.get(node.name);
    if (id && node.id) stageOf.set(node.id, id);
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, { output: number; target: string }[]>();
  for (const edge of edges) {
    const from = stageOf.get(edge.from);
    const toNode = nodes.find((node) => node.name === edge.to);
    if (!toNode || toNode.disabled || triggerKind(toNode.type)) continue;
    if (from) {
      const list = incoming.get(edge.to) ?? [];
      if (!list.includes(from)) list.push(from);
      incoming.set(edge.to, list);
    }
    const outs = outgoing.get(edge.from) ?? [];
    outs.push({ output: edge.output, target: edge.to });
    outgoing.set(edge.from, outs);
  }

  const files: Record<string, string> = {};
  const stages: Stage[] = [];
  let branched = false;
  const aliases: Record<string, string | null> = {};
  for (const node of nodes) {
    if (node.disabled) continue;
    if (triggerKind(node.type)) aliases[node.name] = null;
    else if (stageOfName.has(node.name)) aliases[node.name] = stageOfName.get(node.name)!;
  }

  for (const node of nodes) {
    if (node.disabled || triggerKind(node.type)) continue;
    const id = stageOfName.get(node.name)!;
    const upstream = incoming.get(node.name) ?? [];
    const ctx: RewriteContext = {
      stageOf,
      inputSources,
      inputNames: new Set(Object.keys(inputs)),
      inputAlias,
      upstream,
    };
    const built = buildNode(node, id, ctx, files, aliases);
    const kind = humanKind(shortType(node.type));
    const outs = outgoing.get(node.name) ?? [];
    if (kind.branch && outs.length >= 2) branched = true;
    const paths = outs
      .map((edge) => `${edge.output === 0 ? "true" : edge.output === 1 ? "false" : `out ${edge.output}`} → ${edge.target}`)
      .join(", ");
    stages.push({
      id,
      name: node.name,
      description: stageDescription("n8n", node.name, shortType(node.type)),
      ...(upstream.length ? { inputs: upstream } : {}),
      executor: built.executor,
      outputs: [outputFor(id, built.output)],
    });
    report.push({
      node: node.name,
      type: shortType(node.type),
      became: built.became,
      note: joinNotes(built.note, paths && kind.branch ? `路径 / paths: ${paths}` : ""),
    });
  }
  if (branched) {
    notices.push("Flowgit 没有分支，两条路径都按顺序保留。 / Flowgit has no branches, so both paths are kept in order.");
  }
  return assembleFlow({
    format: "n8n",
    filename,
    name,
    ...(description ? { description } : {}),
    inputs,
    stages,
    files,
    report,
    notices,
  });
}

function unwrap(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function fileTitle(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "workflow";
  return base.replace(/\.json$/i, "") || "Imported flow";
}

function shortType(type: string): string {
  return type.split(".").pop() || type;
}

function triggerKind(type: string): TriggerKind | undefined {
  const name = shortType(type).toLowerCase();
  if (name === "manualtrigger" || name === "manualworkflowtrigger") return "manual";
  if (name === "webhook") return "webhook";
  if (name === "formtrigger") return "form";
  return undefined;
}

function triggerNote(kind: TriggerKind): string {
  if (kind === "manual") return "手动触发没有字段 / manual trigger has no fields";
  if (kind === "webhook") return "Webhook 没有声明字段 / webhook declares no fields";
  return "表单没有字段 / form has no fields";
}

function isLlm(type: string): boolean {
  const name = type.toLowerCase();
  if (name.includes("langchain")) return /agent|chain|openai|lmchat/.test(name);
  return name.endsWith(".openai") || name.endsWith("openai");
}

function isCode(type: string): boolean {
  const name = shortType(type).toLowerCase();
  return name === "code" || name === "function" || name === "functionitem";
}

function readNodes(value: unknown[]): N8nNode[] {
  const nodes: N8nNode[] = [];
  for (const item of value) {
    const node = asRecord(item);
    const name = asString(node?.name);
    const type = asString(node?.type);
    if (!name || !type) continue;
    nodes.push({
      id: asString(node?.id) ?? name,
      name,
      type,
      disabled: node?.disabled === true,
      parameters: asRecord(node?.parameters) ?? {},
      credentials: asRecord(node?.credentials) ?? {},
    });
  }
  return nodes;
}

function readEdges(connections: Record<string, unknown>, nodes: N8nNode[]): N8nEdge[] {
  const known = new Set(nodes.map((node) => node.name));
  const edges: N8nEdge[] = [];
  for (const [from, outputs] of Object.entries(connections)) {
    const main = asRecord(outputs)?.main;
    if (!Array.isArray(main) || !known.has(from)) continue;
    main.forEach((group, output) => {
      if (!Array.isArray(group)) return;
      for (const link of group) {
        const target = asString(asRecord(link)?.node);
        if (!target || target === from || !known.has(target)) continue;
        edges.push({ from, to: target, output });
      }
    });
  }
  return edges;
}

function addInput(
  inputs: Record<string, FlowInput>,
  used: Set<string>,
  alias: Map<string, string>,
  original: string,
  input: FlowInput,
): string {
  const key = inputKey(original, used);
  alias.set(original, key);
  inputs[key] = input;
  return key;
}

function readTriggerInputs(
  node: N8nNode,
  kind: TriggerKind,
  inputs: Record<string, FlowInput>,
  used: Set<string>,
  alias: Map<string, string>,
): string[] {
  if (kind !== "form") return [];
  const values = asRecord(node.parameters.formFields)?.values;
  if (!Array.isArray(values)) return [];
  const made: string[] = [];
  for (const item of values) {
    const field = asRecord(item);
    if (!field) continue;
    const label = asString(field.fieldLabel) ?? asString(field.fieldName) ?? "";
    const original = asString(field.fieldName) ?? label;
    if (!original) continue;
    const typeName = (asString(field.fieldType) ?? "text").toLowerCase();
    const input: FlowInput = { type: "string" };
    if (typeName === "number") input.type = "number";
    else if (typeName === "checkbox") input.type = "boolean";
    else if (typeName === "file") input.type = "file";
    if (label && label !== original) input.description = label;
    if (field.requiredField === true) input.required = true;
    const options = asRecord(field.fieldOptions)?.values;
    if (typeName === "dropdown" && Array.isArray(options)) {
      const values = options.map((option) => asString(asRecord(option)?.option)).filter((option): option is string => Boolean(option));
      if (values.length) input.enum = values;
    }
    made.push(addInput(inputs, used, alias, original, input));
  }
  return made;
}

function credentialName(credentials: Record<string, unknown>): string | undefined {
  for (const value of Object.values(credentials)) {
    const name = asString(asRecord(value)?.name);
    if (name) return name;
  }
  return undefined;
}

function modelOf(parameters: Record<string, unknown>): string | undefined {
  const direct = asString(parameters.model);
  if (direct && !direct.includes("{{")) return direct;
  const model = asRecord(parameters.model);
  const named = asString(model?.name) ?? asString(model?.value);
  if (named && !named.includes("{{")) return named;
  const modelId = asRecord(parameters.modelId);
  const id = asString(modelId?.value) ?? asString(modelId?.cachedResultName);
  if (id && !id.includes("{{")) return id;
  return undefined;
}

function collectPrompt(parameters: Record<string, unknown>, ctx: RewriteContext): { system: string; user: string; unmatched: string[] } {
  const system: string[] = [];
  const user: string[] = [];
  const unmatched: string[] = [];
  const take = (raw: string, role: "system" | "user") => {
    const rewritten = rewriteN8nText(raw, ctx);
    for (const item of rewritten.unmatched) if (!unmatched.includes(item)) unmatched.push(item);
    (role === "system" ? system : user).push(rewritten.text);
  };
  const options = asRecord(parameters.options);
  const systemMessage = asString(options?.systemMessage) ?? asString(parameters.systemMessage);
  if (systemMessage) take(systemMessage, "system");
  const messages = asRecord(parameters.messages)?.values ?? asRecord(parameters.prompt)?.messages;
  if (Array.isArray(messages)) {
    for (const item of messages) {
      const message = asRecord(item);
      const content = asString(message?.content) ?? asString(message?.text) ?? "";
      if (!content) continue;
      take(content, asString(message?.role) === "system" ? "system" : "user");
    }
  }
  if (!user.length) {
    for (const key of ["text", "prompt", "instructions"]) {
      const value = asString(parameters[key]);
      if (!value) continue;
      take(value, "user");
      break;
    }
  }
  return { system: system.join("\n\n"), user: user.join("\n\n"), unmatched };
}

function namedParameters(value: unknown): NamedHeader[] {
  const list = Array.isArray(value) ? value : asRecord(value)?.parameters ?? asRecord(value)?.values;
  if (!Array.isArray(list)) return [];
  const headers: NamedHeader[] = [];
  for (const item of list) {
    const row = asRecord(item);
    const name = asString(row?.name);
    if (!name) continue;
    headers.push({ name, value: asString(row?.value) ?? "" });
  }
  return headers;
}

function uploads(parameters: Record<string, unknown>): boolean {
  const content = `${asString(parameters.contentType) ?? ""} ${asString(parameters.bodyContentType) ?? ""}`.toLowerCase();
  if (content.includes("multipart") || content.includes("binary")) return true;
  if (parameters.sendBinary === true || asString(parameters.binaryPropertyName)) return true;
  const body = namedParameters(parameters.bodyParameters);
  return body.some((item) => /file|binary/i.test(item.name) && item.value.includes("binary"));
}

function authStyle(parameters: Record<string, unknown>): "bearer" | "basic" | "header" | undefined {
  if (!Object.keys(asRecord(parameters) ?? {}).length) return undefined;
  const authentication = asString(parameters.authentication);
  if (authentication === "none") return undefined;
  const generic = (asString(parameters.genericAuthType) ?? "").toLowerCase();
  if (generic.includes("bearer")) return "bearer";
  if (generic.includes("basic")) return "basic";
  if (authentication || generic) return "header";
  return undefined;
}

function conditionSummary(parameters: Record<string, unknown>): string {
  const root = asRecord(parameters.conditions);
  const list = Array.isArray(root?.conditions) ? root.conditions : Array.isArray(parameters.conditions) ? parameters.conditions : [];
  const bits = list.map((item) => {
    const row = asRecord(item);
    if (!row) return "";
    const operator = asString(asRecord(row.operator)?.operation) ?? asString(row.operation) ?? "";
    return `${asString(row.leftValue) ?? ""} ${operator} ${asString(row.rightValue) ?? ""}`.trim();
  }).filter(Boolean);
  const combinator = asString(root?.combinator);
  return joinNotes(combinator ? `combinator: ${combinator}` : "", bits.join("; "));
}

function codeText(parameters: Record<string, unknown>): { language: "python" | "javascript"; code: string } {
  const language = (asString(parameters.language) ?? "").toLowerCase();
  if (language.includes("python")) return { language: "python", code: asString(parameters.pythonCode) ?? asString(parameters.code) ?? "" };
  return {
    language: "javascript",
    code: asString(parameters.jsCode) ?? asString(parameters.functionCode) ?? asString(parameters.code) ?? "",
  };
}

function buildNode(
  node: N8nNode,
  id: string,
  ctx: RewriteContext,
  files: Record<string, string>,
  aliases: Record<string, string | null>,
): { executor: Executor; output: "llm" | "human" | "script" | "service"; became: string; note: string } {
  const type = shortType(node.type);
  if (isLlm(node.type)) {
    const parts = collectPrompt(node.parameters, ctx);
    const file = `prompts/${id}.md`;
    files[file] = promptDocument(parts.system, parts.user);
    const original = modelOf(node.parameters);
    const mapped = presetModel(original);
    return {
      executor: { type: "llm", prompt: file, ...(mapped ? { model: mapped } : {}) },
      output: "llm",
      became: "llm",
      note: joinNotes(modelNote(original, mapped), unmatchedNote(parts.unmatched)),
    };
  }
  if (isCode(node.type)) {
    const source = codeText(node.parameters);
    const blocked = cannotHostCode(source.code);
    if (!source.code || blocked) {
      const why = !source.code
        ? "没有代码 / no code"
        : blocked === "items"
          ? "用了 $items，包装层放不下 / uses $items, which the wrapper cannot host"
          : "用了 this.helpers，包装层放不下 / uses this.helpers, which the wrapper cannot host";
      return {
        executor: {
          type: "human",
          instructions: humanInstructions({ title: node.name, type, kindZh: "代码", kindEn: "code", summary: why, code: source.code }),
        },
        output: "human",
        became: "human",
        note: why,
      };
    }
    if (source.language === "python") {
      const file = `scripts/${id}.py`;
      files[file] = renderN8nPython(source.code);
      return {
        executor: { type: "script", run: `python3 ${file}`, requires: ["python3"] },
        output: "script",
        became: "script",
        note: "Python",
      };
    }
    const file = `scripts/${id}.mjs`;
    files[file] = renderN8nJavaScript(source.code, aliases);
    return {
      executor: { type: "script", run: `node ${file}` },
      output: "script",
      became: "script",
      note: "JavaScript",
    };
  }
  if (type.toLowerCase() === "httprequest") {
    const method = asString(node.parameters.method) ?? asString(node.parameters.requestMethod) ?? "";
    const url = asString(node.parameters.url) ?? "";
    const sendHeaders = node.parameters.sendHeaders !== false;
    const headers = sendHeaders ? namedParameters(node.parameters.headerParameters ?? node.parameters.headers) : [];
    const cred = credentialName(node.credentials);
    const style = cred || asString(node.parameters.authentication) ? authStyle({ ...node.parameters, ...(cred ? { authentication: asString(node.parameters.authentication) ?? "genericCredentialType" } : {}) }) : undefined;
    const plan = planService({
      method,
      url,
      headers,
      uploads: uploads(node.parameters),
      ...(cred ? { credentialName: cred } : {}),
      ...(style ? { authStyle: style } : {}),
    });
    if (!plan.ok || !plan.url || !plan.method) {
      return {
        executor: {
          type: "human",
          instructions: humanInstructions({
            title: node.name,
            type,
            kindZh: "HTTP 请求",
            kindEn: "HTTP request",
            summary: joinNotes(plan.note, method, url),
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
  const kind = humanKind(type);
  const summary = kind.branch ? conditionSummary(node.parameters) : summarize(node.parameters);
  return {
    executor: {
      type: "human",
      instructions: humanInstructions({
        title: node.name,
        type,
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
