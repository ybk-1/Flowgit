import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { TrustNeededError, findOnPath, loadFlow, runStage, trustFlow, trustState, validateFlow, writeFlowFile, type Executor, type ImportResult } from "../index.js";
import { importDify } from "./dify.js";
import { detectImportFormat, importWorkflow } from "./index.js";
import { importN8n } from "./n8n.js";

const dirs: string[] = [];
const savedHome = process.env.FLOWGIT_HOME;
const savedMock = process.env.FLOWGIT_LLM_MOCK_DIR;

afterEach(() => {
  if (savedHome === undefined) delete process.env.FLOWGIT_HOME;
  else process.env.FLOWGIT_HOME = savedHome;
  if (savedMock === undefined) delete process.env.FLOWGIT_LLM_MOCK_DIR;
  else process.env.FLOWGIT_LLM_MOCK_DIR = savedMock;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function pythonBin(): string | undefined {
  for (const name of ["python3", "python"]) {
    const found = findOnPath(name);
    if (!found) continue;
    const probe = spawnSync(found, ["-c", "print(1)"], { encoding: "utf8", timeout: 15_000 });
    if (probe.status === 0 && probe.stdout.trim() === "1") return found;
  }
  return undefined;
}

const python = pythonBin();

function dNode(id: string, type: string, title: string, data: Record<string, unknown> = {}) {
  return { id, type: "custom", data: { ...data, type, title } };
}

function dEdge(source: string, target: string, sourceHandle = "source") {
  return { id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle, targetHandle: "target" };
}

function dify(nodes: unknown[], edges: unknown[] = [], app: Record<string, unknown> = {}): string {
  return stringify({
    version: "0.1.5",
    kind: "app",
    app: { name: "Sample", mode: "workflow", description: "Hand-written sample", ...app },
    workflow: { graph: { nodes, edges } },
  });
}

function nNode(name: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "node", name, type, typeVersion: 1, position: [0, 0], parameters, ...extra };
}

function n8n(nodes: unknown[], connections: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: "Sample", nodes, connections, ...extra });
}

function stage(result: ImportResult, id: string) {
  const found = result.flow.stages.find((item) => item.id === id);
  expect(found, id).toBeTruthy();
  return found!;
}

function executor<T extends Executor["type"]>(result: ImportResult, id: string, type: T): Extract<Executor, { type: T }> {
  const ex = stage(result, id).executor;
  expect(ex.type).toBe(type);
  return ex as Extract<Executor, { type: T }>;
}

function materialize(dir: string, result: ImportResult): void {
  for (const [rel, content] of Object.entries(result.files)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  writeFlowFile(path.join(dir, "flow.json"), result.flow);
}

const SECRET = "sk-abcdefghijklmnopqrstuvwxyz";

describe("import format", () => {
  it("detects Dify YAML and n8n JSON, and rejects anything else in both languages", () => {
    const dsl = dify([dNode("start", "start", "Start", { variables: [] })]);
    const workflow = n8n([nNode("When clicking", "n8n-nodes-base.manualTrigger")]);
    expect(detectImportFormat(dsl)).toBe("dify");
    expect(detectImportFormat(workflow)).toBe("n8n");
    expect(detectImportFormat("hello")).toBeUndefined();
    expect(() => importWorkflow("hello", { filename: "notes.txt" })).toThrow(/认不出这是 Dify/);
    expect(() => importWorkflow("hello", { filename: "notes.txt" })).toThrow(/neither a Dify DSL/);
    expect(() => importWorkflow(workflow, { filename: "a.json", format: "dify" })).toThrow(/不是 Dify/);
    expect(() => importWorkflow(dsl, { filename: "a.yml", format: "n8n" })).toThrow(/不是 n8n/);
  });

  it("stores only the file name in forkedFrom.source", () => {
    const result = importDify(dify([dNode("start", "start", "Start", { variables: [] }), dNode("note", "template-transform", "Note")]), "C:\\Users\\ada\\topic.yml");
    expect(result.flow.forkedFrom).toEqual({ source: "dify:topic.yml" });
    expect(JSON.stringify(result)).not.toContain("Users");
    expect(importN8n(n8n([nNode("Manual", "n8n-nodes-base.manualWorkflowTrigger"), nNode("Note", "n8n-nodes-base.noOp")], { Manual: { main: [[{ node: "Note", type: "main", index: 0 }]] } }), "/home/ada/flow.json").flow.forkedFrom).toEqual({ source: "n8n:flow.json" });
  });
});

describe("Dify node mapping", () => {
  const start = dNode("start", "start", "Start", {
    variables: [
      { variable: "topic", label: "Topic", type: "text-input", required: true },
      { variable: "notes", label: "Notes", type: "paragraph", required: false },
      { variable: "tone", label: "Tone", type: "select", required: false, options: ["calm", "brief"] },
      { variable: "days", label: "Days", type: "number", required: true },
    ],
  });

  it("maps start variables to flow inputs", () => {
    const result = importDify(dify([start, dNode("keep", "template-transform", "Keep")], [dEdge("start", "keep")]), "start.yml");
    expect(result.flow.inputs).toMatchObject({
      topic: { type: "string", required: true },
      notes: { type: "string" },
      tone: { type: "string", enum: ["calm", "brief"] },
      days: { type: "number", required: true },
    });
    expect(result.report.find((entry) => entry.node === "Start")?.became).toBe("流程输入 / flow input");
  });

  it("maps an llm node, rewrites references, and keeps a sure preset", () => {
    const result = importDify(
      dify(
        [
          start,
          dNode("llm", "llm", "Draft", {
            model: { provider: "langgenius/deepseek/deepseek", name: "deepseek-chat", mode: "chat" },
            prompt_template: [
              { role: "system", text: "Be brief." },
              { role: "user", text: "Write about {{#start.topic#}} and {{#start.tone#}}. Skip {{#missing.nope#}}." },
            ],
          }),
        ],
        [dEdge("start", "llm")],
      ),
      "llm.yml",
    );
    const ex = executor(result, "draft", "llm");
    expect(ex.model).toBe("deepseek/deepseek-chat");
    expect(ex.prompt).toBe("prompts/draft.md");
    const prompt = result.files["prompts/draft.md"] ?? "";
    expect(prompt).toContain("{{inputs.topic}}");
    expect(prompt).toContain("{{inputs.tone}}");
    expect(prompt).toContain("{{#missing.nope#}}");
    expect(prompt).toContain("系统 / system:");
    expect(result.report.find((entry) => entry.node === "Draft")?.note).toContain("deepseek-chat");
    expect(result.report.find((entry) => entry.node === "Draft")?.note).toContain("{{#missing.nope#}}");
  });

  it("leaves an unsure model name out of model and records it", () => {
    const result = importDify(
      dify([dNode("llm", "llm", "Draft", { model: { name: "gpt-4o", mode: "chat" }, prompt_template: [{ role: "user", text: "Hi" }] })]),
      "gpt.yml",
    );
    expect(executor(result, "draft", "llm").model).toBeUndefined();
    expect(result.report.find((entry) => entry.node === "Draft")?.note).toContain("gpt-4o");
    expect(result.report.find((entry) => entry.node === "Draft")?.note).toContain("未写入 model");
  });

  it("maps python and javascript code to wrappers, and quotes code the wrapper cannot host", () => {
    const py = importDify(
      dify(
        [
          start,
          dNode("code", "code", "Count", {
            code_language: "python3",
            code: "def main(topic: str) -> dict:\n    return {'chars': len(topic)}\n",
            variables: [{ variable: "topic", value_selector: ["start", "topic"] }],
          }),
        ],
        [dEdge("start", "code")],
      ),
      "py.yml",
    );
    expect(executor(py, "count", "script").run).toBe("python3 scripts/count.py");
    expect(py.files["scripts/count.py"]).toContain("FLOWGIT_FLOW_INPUTS");
    expect(py.files["scripts/count.py"]).toContain("def main");

    const js = importDify(
      dify(
        [
          start,
          dNode("code", "code", "Count", {
            code_language: "javascript",
            code: "function main({ topic }) {\n  return { chars: String(topic ?? '').length };\n}\n",
            variables: [{ variable: "topic", value_selector: ["start", "topic"] }],
          }),
        ],
        [dEdge("start", "code")],
      ),
      "js.yml",
    );
    expect(executor(js, "count", "script").run).toBe("node scripts/count.mjs");
    expect(js.files["scripts/count.mjs"]).toContain("function main");

    const blocked = importDify(
      dify([dNode("code", "code", "Legacy", { code_language: "javascript", code: "return $items.map((item) => item);" })]),
      "legacy.yml",
    );
    expect(executor(blocked, "legacy", "human").instructions).toContain("$items");
    expect(blocked.files["scripts/legacy.mjs"]).toBeUndefined();
  });

  it("maps GET and POST, replaces a literal key, and leaves other methods and uploads to a person", () => {
    const ok = importDify(
      dify([
        dNode("http", "http-request", "Lookup", {
          method: "get",
          url: "https://example.com/lookup",
          authorization: { type: "api-key", config: { type: "bearer", api_key: "{{#env.LOOKUP_TOKEN#}}" } },
          headers: "Accept: application/json",
          body: { type: "none" },
        }),
      ]),
      "http.yml",
    );
    const service = executor(ok, "lookup", "service");
    expect(service.method).toBe("GET");
    expect(service.url).toBe("https://example.com/lookup");
    expect(service.headers?.Authorization).toBe("Bearer {{env.LOOKUP_TOKEN}}");
    expect(service.headers?.Accept).toBe("application/json");

    const post = importDify(dify([dNode("http", "http-request", "Send", { method: "post", url: "https://example.com/items", authorization: { type: "no-auth" }, body: { type: "json" } })]), "post.yml");
    expect(executor(post, "send", "service").method).toBe("POST");

    const secret = importDify(
      dify([dNode("http", "http-request", "Keyed", { method: "post", url: "https://example.com/items", authorization: { type: "api-key", config: { type: "bearer", api_key: SECRET } }, body: { type: "none" } })]),
      "key.yml",
    );
    expect(JSON.stringify(secret)).not.toContain(SECRET);
    expect(executor(secret, "keyed", "service").headers?.Authorization).toBe("Bearer {{env.AUTHORIZATION}}");

    const put = importDify(dify([dNode("http", "http-request", "Update", { method: "put", url: "https://example.com/items", authorization: { type: "no-auth" } })]), "put.yml");
    expect(executor(put, "update", "human").instructions).toContain("PUT");

    const upload = importDify(dify([dNode("http", "http-request", "Upload", { method: "post", url: "https://example.com/files", authorization: { type: "no-auth" }, body: { type: "form-data", data: [] } })]), "upload.yml");
    expect(stage(upload, "upload").executor.type).toBe("human");
    expect(upload.report.find((entry) => entry.node === "Upload")?.note).toContain("上传文件");
  });

  it("keeps both sides of a branch and maps loops, knowledge, aggregators, classifiers, and unknown nodes to a person", () => {
    const result = importDify(
      dify(
        [
          start,
          dNode("branch", "if-else", "Route", { cases: [{ case_id: "true", logical_operator: "and", conditions: [{ variable_selector: ["start", "topic"], comparison_operator: "contains", value: "news" }] }] }),
          dNode("loop", "iteration", "Repeat"),
          dNode("know", "knowledge-retrieval", "Search"),
          dNode("agg", "variable-aggregator", "Gather"),
          dNode("cls", "question-classifier", "Sort"),
          dNode("odd", "template-transform", "Shape"),
          dNode("end", "end", "End", { outputs: [{ variable: "result", value_selector: ["branch", "result"] }] }),
        ],
        [dEdge("start", "branch"), dEdge("branch", "loop", "true"), dEdge("branch", "know", "false")],
      ),
      "rest.yml",
    );
    expect(result.flow.stages.map((item) => item.id)).toEqual(expect.arrayContaining(["route", "repeat", "search", "gather", "sort", "shape", "end"]));
    expect(result.flow.stages.every((item) => item.executor.type === "human")).toBe(true);
    expect(executor(result, "route", "human").instructions).toContain("没有分支");
    expect(result.report.some((entry) => entry.note.includes("没有分支"))).toBe(true);
    expect(result.report.find((entry) => entry.node === "Repeat")?.note).toBe("loop");
    expect(result.report.find((entry) => entry.node === "Search")?.note).toBe("knowledge retrieval");
    expect(result.report.find((entry) => entry.node === "Gather")?.note).toBe("aggregator");
    expect(result.report.find((entry) => entry.node === "Sort")?.note).toBe("question classifier");
    expect(result.report.find((entry) => entry.node === "Shape")?.note).toBe("unknown node");
    expect(executor(result, "end", "human").instructions).toContain("见上游产物 route / see the upstream output route");
    expect(result.files["README.md"]).toContain("## 导入报告 / Import report");
    expect(validateFlow(result.flow).filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("numbers duplicate titles, reports several entries, and breaks a cycle", () => {
    const dup = importDify(dify([dNode("a", "template-transform", "Draft"), dNode("b", "template-transform", "Draft")]), "dup.yml");
    expect(dup.flow.stages.map((item) => item.id).sort()).toEqual(["draft", "draft-2"]);
    expect(dup.report.some((entry) => entry.note.includes("多个入口"))).toBe(true);

    const cycle = importDify(
      dify([dNode("a", "template-transform", "Alpha"), dNode("b", "template-transform", "Beta")], [dEdge("a", "b"), dEdge("b", "a")]),
      "cycle.yml",
    );
    expect(cycle.report.some((entry) => entry.note.includes("成环"))).toBe(true);
    expect(validateFlow(cycle.flow).filter((issue) => issue.level === "error")).toEqual([]);
  });
});

describe("n8n node mapping", () => {
  it("maps manual, webhook, and form triggers to flow inputs", () => {
    const manual = importN8n(n8n([nNode("When clicking", "n8n-nodes-base.manualTrigger"), nNode("Note", "n8n-nodes-base.noOp")], { "When clicking": { main: [[{ node: "Note", type: "main", index: 0 }]] } }), "manual.json");
    expect(manual.flow.inputs).toBeUndefined();
    expect(manual.report.find((entry) => entry.node === "When clicking")?.note).toContain("没有字段");

    const hook = importN8n(n8n([nNode("Hook", "n8n-nodes-base.webhook", { httpMethod: "POST", path: "lead" }), nNode("Note", "n8n-nodes-base.noOp")], { Hook: { main: [[{ node: "Note", type: "main", index: 0 }]] } }), "hook.json");
    expect(hook.report.find((entry) => entry.node === "Hook")?.note).toContain("没有声明字段");

    const form = importN8n(
      n8n([
        nNode("Intake", "n8n-nodes-base.formTrigger", {
          formFields: {
            values: [
              { fieldName: "topic", fieldLabel: "Topic", fieldType: "text", requiredField: true },
              { fieldLabel: "Tone", fieldType: "dropdown", fieldOptions: { values: [{ option: "calm" }, { option: "brief" }] } },
            ],
          },
        }),
        nNode("Note", "n8n-nodes-base.noOp"),
      ], { Intake: { main: [[{ node: "Note", type: "main", index: 0 }]] } }),
      "form.json",
    );
    expect(form.flow.inputs).toMatchObject({
      topic: { type: "string", required: true },
      tone: { type: "string", enum: ["calm", "brief"] },
    });
  });

  it("maps LangChain agent, chain, and OpenAI nodes, and rewrites expressions", () => {
    const text = "Topic {{ $json.topic }} from {{ $('Intake').item.json.topic }} via {{ $json.note }} and {{ $('Missing Node').item.json.x }}";
    const connections = { Intake: { main: [[{ node: "Route", type: "main", index: 0 }]] }, Route: { main: [[{ node: "Draft", type: "main", index: 0 }]] } };
    const intake = nNode("Intake", "n8n-nodes-base.formTrigger", { formFields: { values: [{ fieldName: "topic", fieldLabel: "Topic", requiredField: true }] } });
    const route = nNode("Route", "n8n-nodes-base.if");
    const agent = importN8n(
      n8n([intake, route, nNode("Draft", "@n8n/n8n-nodes-langchain.agent", { text, model: "gpt-4o", options: { systemMessage: "Be brief." } })], connections),
      "agent.json",
    );
    expect(executor(agent, "draft", "llm").model).toBeUndefined();
    const prompt = agent.files["prompts/draft.md"] ?? "";
    expect(prompt).toContain("{{inputs.topic}}");
    expect(prompt).toContain("见上游产物 route / see the upstream output route");
    expect(prompt).toContain("{{ $('Missing Node').item.json.x }}");
    expect(agent.report.find((entry) => entry.node === "Draft")?.note).toContain("gpt-4o");

    const chain = importN8n(n8n([nNode("Chain", "@n8n/n8n-nodes-langchain.chainLlm", { prompt: "Hello", model: "deepseek-chat" })]), "chain.json");
    expect(executor(chain, "chain", "llm").model).toBe("deepseek/deepseek-chat");

    const openai = importN8n(
      n8n([nNode("Ask", "@n8n/n8n-nodes-langchain.openAi", { messages: { values: [{ role: "user", content: "Hello {{ $json.topic }}" }] } })]),
      "openai.json",
    );
    expect(stage(openai, "ask").executor.type).toBe("llm");
  });

  it("maps Code to a wrapper and quotes $items or this.helpers", () => {
    const code = importN8n(
      n8n([nNode("Count", "n8n-nodes-base.code", { language: "javaScript", jsCode: "const topic = String($json.topic ?? '');\nreturn [{ json: { chars: topic.length } }];" })]),
      "code.json",
    );
    expect(executor(code, "count", "script").run).toBe("node scripts/count.mjs");
    expect(code.files["scripts/count.mjs"]).toContain("FLOWGIT_FLOW_INPUTS");
    expect(code.files["scripts/count.mjs"]).toContain("$json");

    const items = importN8n(n8n([nNode("Legacy", "n8n-nodes-base.code", { jsCode: "return $items;" })]), "items.json");
    expect(executor(items, "legacy", "human").instructions).toContain("$items");
    const helpers = importN8n(n8n([nNode("Call", "n8n-nodes-base.function", { functionCode: "const res = await this.helpers.httpRequest({ url: 'https://example.com' });\nreturn items;" })]), "helpers.json");
    expect(executor(helpers, "call", "human").instructions).toContain("this.helpers");
  });

  it("maps GET and POST with a credential name, and leaves other methods and uploads", () => {
    const get = importN8n(
      n8n([
        nNode(
          "Lookup",
          "n8n-nodes-base.httpRequest",
          { method: "GET", url: "https://example.com/lookup", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendHeaders: true, headerParameters: { parameters: [{ name: "Accept", value: "application/json" }] } },
          { credentials: { httpHeaderAuth: { id: "1", name: "Lookup Token" } } },
        ),
      ]),
      "get.json",
    );
    const service = executor(get, "lookup", "service");
    expect(service.method).toBe("GET");
    expect(service.headers?.Authorization).toBe("{{env.LOOKUP_TOKEN}}");
    expect(service.headers?.Accept).toBe("application/json");
    expect(JSON.stringify(get)).not.toContain(SECRET);

    const post = importN8n(n8n([nNode("Send", "n8n-nodes-base.httpRequest", { method: "POST", url: "https://example.com/items" })]), "post.json");
    expect(executor(post, "send", "service").method).toBe("POST");

    const secret = importN8n(
      n8n([nNode("Keyed", "n8n-nodes-base.httpRequest", { method: "POST", url: "https://example.com/items", sendHeaders: true, headerParameters: { parameters: [{ name: "Authorization", value: `Bearer ${SECRET}` }] } })]),
      "key.json",
    );
    expect(JSON.stringify(secret)).not.toContain(SECRET);
    expect(executor(secret, "keyed", "service").headers?.Authorization).toContain("{{env.");

    const put = importN8n(n8n([nNode("Update", "n8n-nodes-base.httpRequest", { method: "PUT", url: "https://example.com/items" })]), "put.json");
    expect(stage(put, "update").executor.type).toBe("human");

    const upload = importN8n(n8n([nNode("Upload", "n8n-nodes-base.httpRequest", { method: "POST", url: "https://example.com/files", contentType: "multipart-form-data" })]), "upload.json");
    expect(stage(upload, "upload").executor.type).toBe("human");
    expect(upload.report.find((entry) => entry.node === "Upload")?.note).toContain("上传文件");
  });

  it("keeps both IF paths and maps switch, loop, and merge to a person", () => {
    const result = importN8n(
      n8n(
        [nNode("Route", "n8n-nodes-base.if"), nNode("Yes", "n8n-nodes-base.noOp"), nNode("No", "n8n-nodes-base.noOp"), nNode("Again", "n8n-nodes-base.splitInBatches"), nNode("Choose", "n8n-nodes-base.switch"), nNode("Gather", "n8n-nodes-base.merge")],
        { Route: { main: [[{ node: "Yes", type: "main", index: 0 }], [{ node: "No", type: "main", index: 0 }]] } },
      ),
      "branch.json",
    );
    expect(result.flow.stages.map((item) => item.id)).toEqual(expect.arrayContaining(["route", "yes", "no", "again", "choose", "gather"]));
    expect(result.report.some((entry) => entry.note.includes("没有分支"))).toBe(true);
    expect(result.report.find((entry) => entry.node === "Again")?.note).toBe("loop");
    expect(result.report.find((entry) => entry.node === "Choose")?.note).toBe("branch");
    expect(result.report.find((entry) => entry.node === "Gather")?.note).toBe("aggregator");
    expect(validateFlow(result.flow).filter((issue) => issue.level === "error")).toEqual([]);
  });
});

function difySample(): string {
  return dify(
    [
      dNode("start", "start", "Start", {
        variables: [
          { variable: "topic", label: "Topic", type: "text-input", required: true },
          { variable: "tone", label: "Tone", type: "select", required: false, options: ["calm", "brief"] },
        ],
      }),
      dNode("llm", "llm", "Draft", {
        model: { provider: "langgenius/deepseek/deepseek", name: "deepseek-chat", mode: "chat" },
        prompt_template: [{ role: "user", text: "Write about {{#start.topic#}}. Ignore {{#missing.nope#}}." }],
      }),
      dNode("branch", "if-else", "Route", {
        cases: [{ case_id: "true", logical_operator: "and", conditions: [{ variable_selector: ["start", "topic"], comparison_operator: "contains", value: "news" }] }],
      }),
      dNode("code", "code", "Count", {
        code_language: "python3",
        code: "def main(topic: str) -> dict:\n    return {'chars': len(topic)}\n",
        variables: [{ variable: "topic", value_selector: ["start", "topic"] }],
      }),
      dNode("http", "http-request", "Lookup", {
        method: "get",
        url: "https://example.com/lookup",
        authorization: { type: "api-key", config: { type: "bearer", api_key: "{{#env.LOOKUP_TOKEN#}}" } },
        headers: "",
        body: { type: "none" },
      }),
      dNode("end", "answer", "Answer", { answer: "{{#llm.text#}}" }),
    ],
    [dEdge("start", "llm"), dEdge("llm", "branch"), dEdge("branch", "code", "true"), dEdge("branch", "http", "false"), dEdge("code", "end"), dEdge("http", "end")],
    { name: "Topic summary", description: "Summarize a topic" },
  );
}

function n8nSample(): string {
  return n8n(
    [
      nNode("Intake", "n8n-nodes-base.formTrigger", { formFields: { values: [{ fieldName: "topic", fieldLabel: "Topic", fieldType: "text", requiredField: true }] } }),
      nNode("Route", "n8n-nodes-base.if", { conditions: { combinator: "and", conditions: [{ leftValue: "={{ $json.topic }}", rightValue: "news", operator: { type: "string", operation: "contains" } }] } }),
      nNode("Draft", "@n8n/n8n-nodes-langchain.agent", { text: "Topic: {{ $json.topic }}", model: "deepseek-chat", options: { systemMessage: "Be brief." } }),
      nNode("Count", "n8n-nodes-base.code", { language: "javaScript", jsCode: "const topic = String($json.topic ?? '');\nreturn [{ json: { chars: topic.length } }];" }),
      nNode("Lookup", "n8n-nodes-base.httpRequest", { method: "POST", url: "https://example.com/lookup" }, { credentials: { httpHeaderAuth: { name: "Lookup Token" } } }),
      nNode("Join", "n8n-nodes-base.noOp"),
    ],
    {
      Intake: { main: [[{ node: "Route", type: "main", index: 0 }]] },
      Route: { main: [[{ node: "Draft", type: "main", index: 0 }], [{ node: "Lookup", type: "main", index: 0 }]] },
      Draft: { main: [[{ node: "Count", type: "main", index: 0 }]] },
      Count: { main: [[{ node: "Join", type: "main", index: 0 }]] },
      Lookup: { main: [[{ node: "Join", type: "main", index: 0 }]] },
    },
    { name: "Topic summary" },
  );
}

describe("imported samples", () => {
  it("turns a Dify workflow of 6 nodes into a flow that validates", () => {
    const result = importWorkflow(difySample(), { filename: "topic.yml" });
    expect(result.flow.forkedFrom).toEqual({ source: "dify:topic.yml" });
    expect(result.flow.stages.length).toBeGreaterThanOrEqual(5);
    expect(result.flow.stages.map((item) => item.id)).toEqual(expect.arrayContaining(["draft", "route", "count", "lookup", "answer"]));
    const dir = tmp("flowgit-import-dify-");
    materialize(dir, result);
    expect(loadFlow(dir).flow.name).toBe("Topic summary");
    expect(result.files["README.md"]).toContain("## 导入报告 / Import report");
  });

  it("runs the Dify llm stage from FLOWGIT_LLM_MOCK_DIR and asks for confirmation first", async () => {
    const dir = tmp("flowgit-import-dify-run-");
    process.env.FLOWGIT_HOME = tmp("flowgit-import-home-");
    const result = importDify(difySample(), "topic.yml");
    materialize(dir, result);
    const loaded = loadFlow(dir);
    expect(trustState(loaded).needed).toBe(true);
    await expect(runStage(loaded, "draft", { inputs: { topic: "hello" } })).rejects.toBeInstanceOf(TrustNeededError);
    trustFlow(loaded);
    const mock = path.join(dir, "mock");
    fs.mkdirSync(mock);
    fs.writeFileSync(path.join(mock, "draft.md"), "mocked draft\n");
    process.env.FLOWGIT_LLM_MOCK_DIR = mock;
    const record = await runStage(loadFlow(dir), "draft", { inputs: { topic: "hello" } });
    expect(record.status).toBe("ok");
    expect(fs.readFileSync(path.join(dir, "outputs", "draft.md"), "utf8")).toContain("mocked draft");
  });

  it.skipIf(!python)("runs the Dify python wrapper", async () => {
    const dir = tmp("flowgit-import-py-");
    process.env.FLOWGIT_HOME = tmp("flowgit-import-home-");
    const result = importDify(difySample(), "topic.yml");
    materialize(dir, result);
    trustFlow(loadFlow(dir));
    const mock = path.join(dir, "mock");
    fs.mkdirSync(mock);
    fs.writeFileSync(path.join(mock, "draft.md"), "mocked draft\n");
    process.env.FLOWGIT_LLM_MOCK_DIR = mock;
    const inputs = { topic: "hello" };
    await runStage(loadFlow(dir), "draft", { inputs });
    fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "outputs", "route.md"), "ok\n");
    await runStage(loadFlow(dir), "route", { inputs });
    if (findOnPath("python3")) {
      await runStage(loadFlow(dir), "count", { inputs });
    } else {
      const script = path.join(dir, "scripts", "count.py");
      const output = path.join(dir, "outputs", "count.json");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const run = spawnSync(python!, [script], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          FLOWGIT_FLOW_INPUTS: JSON.stringify(inputs),
          FLOWGIT_INPUTS: "[]",
          FLOWGIT_OUTPUTS: JSON.stringify([{ path: "outputs/count.json", type: "application/json" }]),
        },
      });
      expect(run.status, run.stderr).toBe(0);
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, "outputs", "count.json"), "utf8"))).toEqual({ chars: 5 });
  });

  it("turns an n8n workflow of 6 nodes into a flow that validates", () => {
    const result = importWorkflow(n8nSample(), { filename: "topic.json" });
    expect(result.flow.forkedFrom).toEqual({ source: "n8n:topic.json" });
    expect(result.flow.stages.map((item) => item.id)).toEqual(expect.arrayContaining(["route", "draft", "count", "lookup", "join"]));
    const dir = tmp("flowgit-import-n8n-");
    materialize(dir, result);
    expect(loadFlow(dir).flow.inputs?.topic?.required).toBe(true);
    expect(result.files["prompts/draft.md"]).toContain("{{inputs.topic}}");
  });

  it("runs the n8n llm stage and the JavaScript wrapper", async () => {
    const dir = tmp("flowgit-import-n8n-run-");
    process.env.FLOWGIT_HOME = tmp("flowgit-import-home-");
    const result = importN8n(n8nSample(), "topic.json");
    materialize(dir, result);
    const loaded = loadFlow(dir);
    expect(trustState(loaded).needed).toBe(true);
    trustFlow(loaded);
    fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "outputs", "route.md"), "ok\n");
    const inputs = { topic: "hello" };
    await runStage(loadFlow(dir), "route", { inputs });
    const mock = path.join(dir, "mock");
    fs.mkdirSync(mock);
    fs.writeFileSync(path.join(mock, "draft.md"), "mocked draft\n");
    process.env.FLOWGIT_LLM_MOCK_DIR = mock;
    await runStage(loadFlow(dir), "draft", { inputs });
    await runStage(loadFlow(dir), "count", { inputs });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "outputs", "count.json"), "utf8"))).toEqual({ chars: 5 });
  });

  it("runs a Dify JavaScript wrapper", () => {
    const result = importDify(
      dify(
        [
          dNode("start", "start", "Start", { variables: [{ variable: "topic", label: "Topic", type: "text-input", required: true }] }),
          dNode("code", "code", "Count", {
            code_language: "javascript",
            code: "function main({ topic }) {\n  return { chars: String(topic ?? '').length };\n}\n",
            variables: [{ variable: "topic", value_selector: ["start", "topic"] }],
          }),
        ],
        [dEdge("start", "code")],
      ),
      "js.yml",
    );
    const dir = tmp("flowgit-import-js-");
    materialize(dir, result);
    const output = path.join(dir, "outputs", "count.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const run = spawnSync(process.execPath, [path.join(dir, "scripts", "count.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        FLOWGIT_FLOW_INPUTS: JSON.stringify({ topic: "hello" }),
        FLOWGIT_INPUTS: "[]",
        FLOWGIT_OUTPUTS: JSON.stringify([{ path: "outputs/count.json", type: "application/json" }]),
      },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual({ chars: 5 });
  });
});
