import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  anthropicBody,
  effectiveProvider,
  listRuns,
  loadFlow,
  loadProviders,
  openaiBody,
  parseModelSpec,
  providerKeyState,
  resolveModel,
  runStage,
  type Flow,
  type LlmRequest,
  type ResolvedProvider,
} from "./index.js";

/* ---------- a local server that speaks both protocols ---------- */

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: http.Server;
let base: string;
let seen: Seen[] = [];

function sse(res: http.ServerResponse, events: [string | null, unknown][]) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  }
  res.end();
}

function anthropicReply(res: http.ServerResponse, model: string, text: string) {
  sse(res, [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, 3) } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(3) } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
}

function openaiReply(res: http.ServerResponse, model: string, text: string, finish = "stop") {
  const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) => ({ id: "c1", object: "chat.completion.chunk", created: 1, model, choices, ...extra });
  sse(res, [
    [null, chunk([{ index: 0, delta: { role: "assistant", content: text.slice(0, 3) }, finish_reason: null }])],
    [null, chunk([{ index: 0, delta: { content: text.slice(3) }, finish_reason: finish }])],
    [null, chunk([], { usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } })],
    [null, "[DONE]"],
  ]);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const model = String(body.model ?? "");
      if (model === "bad-key") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid key" } }));
        return;
      }
      if (req.url?.endsWith("/v1/messages")) return anthropicReply(res, model, "# Hello from anthropic protocol");
      if (req.url?.endsWith("/chat/completions")) {
        return openaiReply(res, model, model === "too-long" ? "cut off" : "# Hello from openai protocol", model === "too-long" ? "length" : "stop");
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

/* ---------- a one-stage flow ---------- */

const ENV_KEYS = [
  "FLOWGIT_HOME",
  "FLOWGIT_MODEL",
  "FLOWGIT_LLM_MOCK_DIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "TEST_GLM_KEY",
  "TEST_OAI_KEY",
];
let savedEnv: Record<string, string | undefined>;
let dir: string;
let home: string;

function flowWith(model?: string, effort?: "high"): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "provider test",
    stages: [
      {
        id: "write",
        name: "写 write",
        executor: { type: "llm", prompt: "prompt.md", ...(model ? { model } : {}), ...(effort ? { effort } : {}) },
        outputs: [{ type: "text/markdown", path: "out.md" }],
      },
    ],
  };
}

function writeFlow(flow: Flow, local?: unknown) {
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow));
  fs.writeFileSync(path.join(dir, "prompt.md"), "Say hello.");
  if (local !== undefined) fs.writeFileSync(path.join(dir, "flowgit.local.json"), JSON.stringify(local));
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-providers-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-home-"));
  process.env.FLOWGIT_HOME = home;
  seen = [];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

/* ---------- tests ---------- */

describe("model specs and provider config", () => {
  it("parses <provider>/<model> and keeps bare names on anthropic", () => {
    expect(parseModelSpec("claude-opus-5-5")).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(parseModelSpec("glm/glm-5.3")).toEqual({ provider: "glm", model: "glm-5.3" });
    // only the first slash splits, so OpenRouter-style ids survive
    expect(parseModelSpec("openrouter/openai/gpt-5")).toEqual({ provider: "openrouter", model: "openai/gpt-5" });
    expect(() => parseModelSpec("glm/")).toThrow(/provider>\/<model/);
  });

  it("merges presets, the global file and flowgit.local.json, field by field", () => {
    fs.writeFileSync(
      path.join(home, "providers.json"),
      JSON.stringify({ providers: { glm: { apiKeyEnv: "ZAI_API_KEY" }, local: { protocol: "openai", baseUrl: "http://127.0.0.1:1234/v1" } } }),
    );
    writeFlow(flowWith(), { inputs: {}, providers: { local: { baseUrl: "http://127.0.0.1:9999/v1" } } });
    const all = loadProviders(dir);
    expect(Object.keys(all)).toEqual(expect.arrayContaining(["anthropic", "openai", "openrouter", "glm", "deepseek", "moonshot", "qwen", "ollama", "local"]));
    expect(all.glm).toMatchObject({ protocol: "anthropic", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKeyEnv: "ZAI_API_KEY", source: "global" });
    expect(all.local).toMatchObject({ protocol: "openai", baseUrl: "http://127.0.0.1:9999/v1", source: "flow" });
    expect(all.ollama.apiKeyEnv).toBeUndefined();
    expect(providerKeyState(all.ollama)).toBe("none");
    expect(providerKeyState(all.glm, { ZAI_API_KEY: "x" })).toBe("set");
    expect(providerKeyState(all.anthropic, { ANTHROPIC_AUTH_TOKEN: "x" })).toBe("set");
  });

  it("refuses keys in files, unknown fields, bad values and half-defined providers", () => {
    const bad = (providers: unknown) => {
      fs.writeFileSync(path.join(home, "providers.json"), JSON.stringify({ providers }));
      return () => loadProviders();
    };
    expect(bad({ glm: { apiKey: "sk-123" } })).toThrow(/never put a key in a file/);
    expect(bad({ glm: { token: "sk-123" } })).toThrow(/never put a key in a file/);
    expect(bad({ glm: { url: "https://x" } })).toThrow(/unknown field/);
    expect(bad({ glm: { protocol: "grpc" } })).toThrow(/must be "anthropic" or "openai"/);
    expect(bad({ glm: { baseUrl: "ftp://x" } })).toThrow(/http\(s\) URL/);
    expect(bad({ glm: { apiKeyEnv: "my key" } })).toThrow(/environment variable name/);
    expect(bad({ mine: { protocol: "openai" } })).toThrow(/needs protocol and baseUrl/);
    fs.writeFileSync(path.join(home, "providers.json"), "{ nope");
    expect(() => loadProviders()).toThrow(/not valid JSON/);
  });

  it("names unknown providers and only treats api.anthropic.com as Anthropic's API", () => {
    expect(() => resolveModel("nope/model-1")).toThrow(/Unknown provider "nope"/);
    expect(resolveModel("claude-opus-5-5").provider).toMatchObject({ baseUrl: "https://api.anthropic.com", claudeApi: true });
    expect(resolveModel("glm/glm-5.3").provider.claudeApi).toBe(false);
    expect(resolveModel("openai/gpt-5").provider).toMatchObject({ baseUrl: "https://api.openai.com/v1", openaiApi: true });
    expect(resolveModel("deepseek/deepseek-v4-pro").provider.openaiApi).toBe(false);
    // Claude Code users often point ANTHROPIC_BASE_URL at another vendor
    process.env.ANTHROPIC_BASE_URL = "https://open.bigmodel.cn/api/anthropic";
    expect(resolveModel("claude-opus-5-5").provider).toMatchObject({ baseUrl: "https://open.bigmodel.cn/api/anthropic", claudeApi: false });
  });

  it("sends Claude-only parameters to Anthropic's API only, and max_completion_tokens to OpenAI only", () => {
    const req = (provider: ResolvedProvider): LlmRequest => ({ stageId: "s", provider, model: "m", system: "sys", prompt: "hi", maxTokens: 1000, effort: "high" });
    const all = loadProviders();
    const official = anthropicBody(req(effectiveProvider(all.anthropic)));
    expect(official).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "high" } });
    const glm = anthropicBody(req(effectiveProvider(all.glm)));
    expect(glm).toEqual({ model: "m", max_tokens: 1000, system: "sys", messages: [{ role: "user", content: "hi" }] });
    const oai = openaiBody(req(effectiveProvider(all.openai)));
    expect(oai).toMatchObject({ max_completion_tokens: 1000, stream: true });
    expect(oai).not.toHaveProperty("max_tokens");
    const ds = openaiBody(req(effectiveProvider(all.deepseek)));
    expect(ds).toMatchObject({ max_tokens: 1000, messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] });
    expect(JSON.stringify(ds)).not.toMatch(/effort/);
  });
});

describe("calling a provider over HTTP", () => {
  it("anthropic protocol: plain messages request to a third-party endpoint, key from apiKeyEnv only", async () => {
    process.env.ANTHROPIC_API_KEY = "claude-key-must-not-leak";
    process.env.TEST_GLM_KEY = "glm-key";
    writeFlow(flowWith("myglm/glm-5.3", "high"), { providers: { myglm: { protocol: "anthropic", baseUrl: base, apiKeyEnv: "TEST_GLM_KEY" } } });
    const logs: string[] = [];
    const run = await runStage(loadFlow(dir), "write", { onEvent: (e) => e.type === "stage:log" && logs.push(e.line) });

    expect(fs.readFileSync(path.join(dir, "out.md"), "utf8")).toBe("# Hello from anthropic protocol\n");
    expect(seen).toHaveLength(1);
    const r = seen[0];
    expect(r.url).toBe("/v1/messages");
    expect(r.body).toEqual({ model: "glm-5.3", max_tokens: 16000, system: expect.any(String), messages: [{ role: "user", content: expect.stringContaining("Say hello.") }], stream: true });
    expect(r.headers["anthropic-beta"]).toBeUndefined();
    expect(r.headers.authorization).toBe("Bearer glm-key");
    expect(r.headers["x-api-key"]).toBe("glm-key");
    expect(JSON.stringify(r.headers)).not.toContain("claude-key-must-not-leak");
    expect(logs.join("\n")).toMatch(/effort only applies to Anthropic's own API/);
    expect(run.params).toMatchObject({ provider: "myglm", protocol: "anthropic", model: "glm-5.3", requestedModel: "glm-5.3", usage: { output_tokens: 7 } });
    expect(listRuns(dir, "write")[0].params?.provider).toBe("myglm");
  });

  it("default provider follows ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, without Claude-only parameters off Anthropic's API", async () => {
    process.env.ANTHROPIC_BASE_URL = base;
    process.env.ANTHROPIC_AUTH_TOKEN = "token-1";
    writeFlow(flowWith(undefined, "high"));
    await runStage(loadFlow(dir), "write", { model: "claude-opus-5-5" });
    expect(seen[0].url).toBe("/v1/messages");
    expect(seen[0].body).not.toHaveProperty("fallbacks");
    expect(seen[0].body).not.toHaveProperty("output_config");
    expect(seen[0].headers.authorization).toBe("Bearer token-1");
  });

  it("openai protocol: chat completions with max_tokens, streamed reply and usage", async () => {
    process.env.TEST_OAI_KEY = "oai-key";
    process.env.OPENAI_ORG_ID = "org-must-not-leak";
    process.env.OPENAI_API_KEY = "openai-key-must-not-leak";
    fs.writeFileSync(path.join(home, "providers.json"), JSON.stringify({ providers: { mine: { protocol: "openai", baseUrl: `${base}/v1`, apiKeyEnv: "TEST_OAI_KEY" } } }));
    writeFlow(flowWith(undefined, "high"));
    process.env.FLOWGIT_MODEL = "mine/deepseek-v4-pro";
    const run = await runStage(loadFlow(dir), "write", {});

    expect(fs.readFileSync(path.join(dir, "out.md"), "utf8")).toBe("# Hello from openai protocol\n");
    const r = seen[0];
    expect(r.url).toBe("/v1/chat/completions");
    expect(r.body).toMatchObject({ model: "deepseek-v4-pro", max_tokens: 16000, stream: true, stream_options: { include_usage: true } });
    expect((r.body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
    expect(JSON.stringify(r.body)).not.toMatch(/effort|max_completion_tokens/);
    expect(r.headers.authorization).toBe("Bearer oai-key");
    expect(JSON.stringify(r.headers)).not.toMatch(/must-not-leak/);
    expect(run.params).toMatchObject({ provider: "mine", protocol: "openai", model: "deepseek-v4-pro", stopReason: "stop", usage: { completion_tokens: 7 } });
  });

  it("explains a missing key before sending anything, and a rejected key or a cut-off reply after", async () => {
    writeFlow(flowWith("myglm/glm-5.3"), { providers: { myglm: { protocol: "anthropic", baseUrl: base, apiKeyEnv: "TEST_GLM_KEY" }, mine: { protocol: "openai", baseUrl: `${base}/v1`, apiKeyEnv: "TEST_OAI_KEY" } } });
    await expect(runStage(loadFlow(dir), "write", {})).rejects.toThrow(/TEST_GLM_KEY.*\n.*Missing key: provider "myglm"/);
    expect(seen).toHaveLength(0);

    process.env.TEST_GLM_KEY = "wrong";
    await expect(runStage(loadFlow(dir), "write", { model: "myglm/bad-key" })).rejects.toThrow(/Request to myglm .*failed[\s\S]*check TEST_GLM_KEY/);

    process.env.TEST_OAI_KEY = "k";
    await expect(runStage(loadFlow(dir), "write", { model: "mine/too-long" })).rejects.toThrow(/hit maxTokens/);
  });
});
