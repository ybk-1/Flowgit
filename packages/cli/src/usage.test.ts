import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the built CLI against a local OpenAI-compatible server that reports token usage,
// so the per-call lines, the run all total and the log column can be checked end to end.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");

let server: http.Server;
let work: string;

/** A streamed Chat Completions reply that reports 12 prompt and 7 completion tokens. */
function reply(res: http.ServerResponse, model: string) {
  const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) => ({ id: "c1", object: "chat.completion.chunk", created: 1, model, choices, ...extra });
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const data of [
    chunk([{ index: 0, delta: { role: "assistant", content: "# Hel" }, finish_reason: null }]),
    chunk([{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }]),
    chunk([], { usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }),
  ]) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

function flowgit(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "-C", path.join(work, "flow"), ...args], {
      env: { ...process.env, NO_COLOR: "1", FLOWGIT_HOME: path.join(work, "home"), FLOWGIT_LLM_MOCK_DIR: "", FLOWGIT_MODEL: "local/test", NODE_USE_ENV_PROXY: "" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

beforeAll(async () => {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => (req.url?.endsWith("/chat/completions") ? reply(res, String(JSON.parse(raw).model)) : res.writeHead(404).end()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-usage-"));
  fs.mkdirSync(path.join(work, "home"));
  fs.writeFileSync(path.join(work, "home", "providers.json"), JSON.stringify({ providers: { local: { protocol: "openai", baseUrl: `http://127.0.0.1:${port}/v1` } } }));
  const flow = path.join(work, "flow");
  fs.mkdirSync(flow);
  fs.writeFileSync(path.join(flow, "prompt.md"), "Say hello.");
  fs.writeFileSync(
    path.join(flow, "flow.json"),
    JSON.stringify({
      format: "flowgit",
      version: "0.1",
      name: "usage",
      stages: [
        { id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md" }, outputs: [{ type: "text/markdown", path: "draft.md" }] },
        { id: "polish", name: "polish", inputs: ["draft"], executor: { type: "llm", prompt: "prompt.md" }, outputs: [{ type: "text/markdown", path: "polish.md" }] },
        { id: "review", name: "review", inputs: ["polish"], executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "review.md" }] },
      ],
    }),
  );
});

afterAll(() => {
  server?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

describe("token usage", () => {
  it("logs each call, totals them when run all stops at a person, and shows them in the log", async () => {
    const r = await flowgit(["run", "all"]);
    expect(r.code, r.out).toBe(2);
    expect(r.out.match(/用量 \/ usage: 12 输入 input \+ 7 输出 output tokens/g)).toHaveLength(2);
    expect(r.out).toContain("用量合计 / total usage: 24 输入 input + 14 输出 output tokens（2 次模型调用 / model calls）");
    expect(r.out).toContain("waiting for you: review.md");
    // the total comes last, after the human stage's instructions
    expect(r.out.trimEnd().split("\n").at(-1)).toMatch(/^用量合计 \/ total usage: 24/);

    const log = await flowgit(["log", "draft"]);
    expect(log.out).toMatch(/v1\s+ok\s+.*local\/test · \d+s · 19 tokens/);

    // a single call already has its own line, so no total
    const one = await flowgit(["run", "polish"]);
    expect(one.out).toContain("usage: 12 输入 input + 7 输出 output tokens");
    expect(one.out).not.toContain("total usage");

    // the whole-flow log lists every run, newest first, and adds up every call so far
    const all = await flowgit(["log"]);
    expect(all.out).toContain("usage · 3 个版本 / run(s)");
    expect(all.out).toMatch(/polish polish\s+v2\s+ok[\s\S]*polish polish\s+v1\s+ok[\s\S]*draft draft\s+v1\s+ok/);
    expect(all.out).toContain("模型用量合计 / total model usage: 36 输入 input + 21 输出 output tokens（3 次模型调用 / model calls）");
  });
});
