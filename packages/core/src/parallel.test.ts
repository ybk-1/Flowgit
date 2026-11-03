import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TokenBudgetError,
  TrustNeededError,
  findFlowFile,
  listRuns,
  loadFlow,
  planRunAll,
  readFlowFile,
  runAll,
  runStage,
  trustFlow,
  trustState,
  validateFlow,
  writeFlowFile,
  type Flow,
  type LlmComplete,
  type RunEvent,
} from "./index.js";
import { retryDelayMs } from "./retry.js";

const dirs: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
const savedHome = process.env.FLOWGIT_HOME;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, content: string | Buffer): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(async () => {
  if (savedHome === undefined) delete process.env.FLOWGIT_HOME;
  else process.env.FLOWGIT_HOME = savedHome;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) await server.close();
});

function listen(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const handle = {
        url: `http://127.0.0.1:${address.port}/echo`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      };
      servers.push(handle);
      resolve(handle);
    });
  });
}

function overlaps(a: { startedAt: string; finishedAt: string }, b: { startedAt: string; finishedAt: string }): boolean {
  return a.startedAt < b.finishedAt && b.startedAt < a.finishedAt;
}

function slow(file: string, ms: number): string {
  return `node -e "require('node:fs').writeFileSync('${file}', 'ok\\n'); setTimeout(() => {}, ${ms})"`;
}

function scriptFlow(concurrency?: number): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "parallel",
    ...(concurrency !== undefined ? { concurrency } : {}),
    stages: [
      { id: "a", name: "A", executor: { type: "script", run: slow("a.txt", 600) }, outputs: [{ type: "text/plain", path: "a.txt" }] },
      { id: "b", name: "B", executor: { type: "script", run: slow("b.txt", 600) }, outputs: [{ type: "text/plain", path: "b.txt" }] },
      {
        id: "c",
        name: "C",
        inputs: ["a", "b"],
        executor: {
          type: "script",
          run: "node -e \"const fs=require('node:fs'); if(!fs.existsSync('a.txt')||!fs.existsSync('b.txt')) process.exit(3); fs.writeFileSync('c.txt','ok\\n')\"",
        },
        outputs: [{ type: "text/plain", path: "c.txt" }],
      },
    ],
  };
}

const noWait = async () => {};
const zero = () => 0;

describe("parallel stages", () => {
  it("runs two independent branches at the same time, then the join, and keeps dependency order", async () => {
    const dir = temp("flowgit-par-");
    write(dir, "flow.json", JSON.stringify(scriptFlow()));
    const events: string[] = [];
    const onEvent = (event: RunEvent) => {
      if (event.type === "stage:start" || event.type === "stage:done") events.push(`${event.type}:${event.stage.id}`);
    };
    const records = await runAll(loadFlow(dir), { onEvent });
    expect(records.map((r) => r.stage)).toEqual(["a", "b", "c"]);
    const a = listRuns(dir, "a")[0]!;
    const b = listRuns(dir, "b")[0]!;
    const c = listRuns(dir, "c")[0]!;
    expect(overlaps(a, b)).toBe(true);
    expect(events.indexOf("stage:start:b")).toBeLessThan(events.indexOf("stage:done:a"));
    expect(events.indexOf("stage:start:a")).toBeLessThan(events.indexOf("stage:done:b"));
    expect(c.startedAt >= a.finishedAt).toBe(true);
    expect(c.startedAt >= b.finishedAt).toBe(true);
    expect(fs.readFileSync(path.join(dir, "c.txt"), "utf8")).toBe("ok\n");
  }, 15_000);

  it("does not overlap when concurrency is 1", async () => {
    const dir = temp("flowgit-seq-");
    write(dir, "flow.json", JSON.stringify(scriptFlow(1)));
    await runAll(loadFlow(dir));
    const a = listRuns(dir, "a")[0]!;
    const b = listRuns(dir, "b")[0]!;
    const first = a.startedAt <= b.startedAt ? a : b;
    const second = first === a ? b : a;
    expect(overlaps(a, b)).toBe(false);
    expect(second.startedAt >= first.finishedAt).toBe(true);
  }, 15_000);

  it("shows which stages start together, and a flow concurrency of 1 separates them", () => {
    const dir = temp("flowgit-plan-");
    write(dir, "flow.json", JSON.stringify(scriptFlow()));
    const loaded = loadFlow(dir);
    const together = planRunAll(loaded);
    expect(together.find((s) => s.stage.id === "a")?.together).toBe(together.find((s) => s.stage.id === "b")?.together);
    expect(together.find((s) => s.stage.id === "c")?.together).toBeGreaterThan(together.find((s) => s.stage.id === "a")!.together!);
    const one = planRunAll(loaded, { concurrency: 1 });
    expect(one.find((s) => s.stage.id === "a")?.together).not.toBe(one.find((s) => s.stage.id === "b")?.together);
  });

  it("keeps a hand edit and still runs an independent stage", async () => {
    const dir = temp("flowgit-edit-");
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "edit",
      stages: [
        {
          id: "a",
          name: "A",
          executor: { type: "script", run: "node -e \"require('node:fs').writeFileSync('a.txt','from-script\\n')\"" },
          outputs: [{ type: "text/plain", path: "a.txt" }],
        },
        {
          id: "b",
          name: "B",
          executor: { type: "script", run: "node -e \"require('node:fs').writeFileSync('b.txt','b\\n')\"" },
          outputs: [{ type: "text/plain", path: "b.txt" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    const loaded = loadFlow(dir);
    await runStage(loaded, "a");
    fs.writeFileSync(path.join(dir, "a.txt"), "hand\n");
    const records = await runAll(loaded, { concurrency: 2 });
    expect(records.find((r) => r.stage === "a")).toMatchObject({ executor: "manual" });
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("hand\n");
    expect(fs.readFileSync(path.join(dir, "b.txt"), "utf8")).toBe("b\n");
  });

  it("runs a plugin and an image stage together, and a copied flow runs nothing until it is trusted", async () => {
    const dir = temp("flowgit-plug-");
    process.env.FLOWGIT_HOME = temp("flowgit-plug-home-");
    write(
      dir,
      "plugins/slow/package.json",
      `${JSON.stringify({ name: "slow", version: "1.0.0", private: true, type: "module", main: "index.js" })}\n`,
    );
    write(
      dir,
      "plugins/slow/index.js",
      `export default { flowgitPlugin: 1, name: "slow", executor: { async run(ctx) { await new Promise((r) => setTimeout(r, 600)); ctx.writeOutput("out.txt", "plugin\\n"); } } };\n`,
    );
    write(dir, "prompts/pic.md", "a cat\n");
    write(dir, "demo/pic/a.png", TINY_PNG);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "copied",
      forkedFrom: { source: "https://example.com/someone/flow.git", commit: "abc123" },
      stages: [
        {
          id: "plug",
          name: "Plug",
          executor: { type: "plugin", plugin: "./plugins/slow" },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
        {
          id: "pic",
          name: "Pic",
          executor: { type: "image", model: "openai/gpt-image-1", prompt: "prompts/pic.md" },
          outputs: [{ type: "dir", path: "pics/" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    const loaded = loadFlow(dir);
    await expect(runAll(loaded, { env: { FLOWGIT_IMAGE_MOCK_DIR: path.join(dir, "demo") } })).rejects.toBeInstanceOf(TrustNeededError);
    expect(listRuns(dir, "plug")).toEqual([]);
    expect(listRuns(dir, "pic")).toEqual([]);
    expect(fs.existsSync(path.join(dir, "out.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "pics"))).toBe(false);

    trustFlow(loaded, trustState(loaded).fingerprint);
    await runAll(loaded, { env: { FLOWGIT_IMAGE_MOCK_DIR: path.join(dir, "demo") } });
    const plug = listRuns(dir, "plug")[0]!;
    const pic = listRuns(dir, "pic")[0]!;
    expect(plug.status).toBe("ok");
    expect(pic.status).toBe("ok");
    expect(overlaps(plug, pic)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "out.txt"), "utf8")).toBe("plugin\n");
    expect(fs.readdirSync(path.join(dir, "pics"))).toEqual(["001.png"]);
  }, 15_000);
});

describe("token budget", () => {
  function llmFlow(): Flow {
    return {
      format: "flowgit",
      version: "0.1",
      name: "budget",
      stages: [
        {
          id: "a",
          name: "A",
          executor: { type: "llm", prompt: "prompts/a.md" },
          outputs: [{ type: "text/markdown", path: "a.md" }],
        },
        {
          id: "b",
          name: "B",
          inputs: ["a"],
          executor: { type: "llm", prompt: "prompts/b.md" },
          outputs: [{ type: "text/markdown", path: "b.md" }],
        },
      ],
    };
  }

  function complete(usage: Record<string, number>, calls: string[]): LlmComplete {
    return async (req) => {
      calls.push(req.stageId);
      return { text: `${req.stageId}\n`, model: "test", usage };
    };
  }

  it("stops before the next model stage once this run is over budget and keeps the finished version", async () => {
    const dir = temp("flowgit-budget-");
    write(dir, "flow.json", JSON.stringify(llmFlow()));
    write(dir, "prompts/a.md", "a");
    write(dir, "prompts/b.md", "b");
    const calls: string[] = [];
    const err = await runAll(loadFlow(dir), {
      maxTokens: 50,
      llm: complete({ input_tokens: 40, output_tokens: 20 }, calls),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenBudgetError);
    expect((err as TokenBudgetError).message).toContain("超过预算");
    expect((err as TokenBudgetError).message).toContain("Token budget exceeded");
    expect((err as TokenBudgetError).stageId).toBe("b");
    expect(calls).toEqual(["a"]);
    expect(listRuns(dir, "a")[0]).toMatchObject({ status: "ok", n: 1 });
    expect(fs.readFileSync(path.join(dir, "a.md"), "utf8")).toBe("a\n");
    expect(listRuns(dir, "b")).toEqual([]);
    expect(fs.existsSync(path.join(dir, "b.md"))).toBe(false);
  });

  it("still starts the next model stage when usage equals the budget", async () => {
    const dir = temp("flowgit-budget-eq-");
    write(dir, "flow.json", JSON.stringify(llmFlow()));
    write(dir, "prompts/a.md", "a");
    write(dir, "prompts/b.md", "b");
    const calls: string[] = [];
    const records = await runAll(loadFlow(dir), {
      maxTokens: 10,
      llm: complete({ input_tokens: 10, output_tokens: 0 }, calls),
    });
    expect(calls).toEqual(["a", "b"]);
    expect(records.map((r) => r.stage)).toEqual(["a", "b"]);
  });
});

describe("retries", () => {
  function llmStage(retries: number): Flow {
    return {
      format: "flowgit",
      version: "0.1",
      name: "retry",
      stages: [
        {
          id: "ask",
          name: "Ask",
          executor: { type: "llm", prompt: "prompts/ask.md", retries },
          outputs: [{ type: "text/markdown", path: "out.md" }],
        },
      ],
    };
  }

  function failing(status: number | undefined, succeedAt: number): { llm: LlmComplete; calls: number[] } {
    const calls: number[] = [];
    const llm: LlmComplete = async () => {
      calls.push(1);
      if (calls.length < succeedAt) {
        const error = new Error(status === undefined ? "fetch failed" : `status ${status}`);
        if (status !== undefined) Object.assign(error, { status });
        throw error;
      }
      return { text: "ok\n", model: "test", usage: { input_tokens: 1, output_tokens: 1 } };
    };
    return { llm, calls };
  }

  const fast = { sleep: noWait, random: zero };

  it("retries a 429 and a network error the requested number of times, and records each retry", async () => {
    const dir = temp("flowgit-retry-429-");
    write(dir, "flow.json", JSON.stringify(llmStage(2)));
    write(dir, "prompts/ask.md", "ask");
    const rate = failing(429, 3);
    const run = await runStage(loadFlow(dir), "ask", { llm: rate.llm, ...fast });
    expect(rate.calls).toHaveLength(3);
    expect(run.params?.retries).toEqual([
      expect.objectContaining({ n: 1, status: 429, delayMs: retryDelayMs(1, 0) }),
      expect.objectContaining({ n: 2, status: 429, delayMs: retryDelayMs(2, 0) }),
    ]);

    const netDir = temp("flowgit-retry-net-");
    write(netDir, "flow.json", JSON.stringify(llmStage(1)));
    write(netDir, "prompts/ask.md", "ask");
    const net = failing(undefined, 2);
    const netRun = await runStage(loadFlow(netDir), "ask", { llm: net.llm, ...fast });
    expect(net.calls).toHaveLength(2);
    expect(netRun.params?.retries).toEqual([expect.objectContaining({ n: 1, error: "fetch failed", delayMs: retryDelayMs(1, 0) })]);
    expect((netRun.params?.retries as { status?: number }[])[0]?.status).toBeUndefined();
  });

  it("does not retry other 4xx or a schema failure", async () => {
    const dir = temp("flowgit-retry-400-");
    write(dir, "flow.json", JSON.stringify(llmStage(4)));
    write(dir, "prompts/ask.md", "ask");
    const bad = failing(400, 99);
    await expect(runStage(loadFlow(dir), "ask", { llm: bad.llm, ...fast })).rejects.toThrow(/status 400/);
    expect(bad.calls).toHaveLength(1);
    expect(listRuns(dir, "ask")[0]?.params?.retries).toBeUndefined();

    const schemaDir = temp("flowgit-retry-schema-");
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "schema",
      stages: [
        {
          id: "ask",
          name: "Ask",
          executor: { type: "llm", prompt: "prompts/ask.md", retries: 5 },
          outputs: [{ type: "application/json", path: "out.json", schema: "schemas/out.schema.json" }],
        },
      ],
    };
    write(schemaDir, "flow.json", JSON.stringify(flow));
    write(schemaDir, "prompts/ask.md", "ask");
    write(schemaDir, "schemas/out.schema.json", JSON.stringify({ type: "object", required: ["n"], properties: { n: { type: "number" } }, additionalProperties: false }));
    let calls = 0;
    const llm: LlmComplete = async () => {
      calls += 1;
      return { text: '{"n":"no"}\n', model: "test", usage: { input_tokens: 2, output_tokens: 2 } };
    };
    await expect(runStage(loadFlow(schemaDir), "ask", { llm, ...fast })).rejects.toThrow(/JSON Schema/);
    // one call plus the schema repair, not retries of the schema failure
    expect(calls).toBe(2);
    expect(listRuns(schemaDir, "ask")[0]?.params?.retries).toBeUndefined();
  });

  it("retries service 429 and 5xx, and does not retry other 4xx or a body that is not JSON", async () => {
    let mode: "429" | "500" | "400" | "json" | "drop" = "429";
    let hits = 0;
    const server = await listen((req, res) => {
      hits += 1;
      if (mode === "drop") {
        req.socket.destroy();
        return;
      }
      if (mode === "429" && hits < 3) {
        res.writeHead(429);
        res.end("slow down");
        return;
      }
      if (mode === "500") {
        res.writeHead(500);
        res.end("down");
        return;
      }
      if (mode === "400") {
        res.writeHead(400);
        res.end("nope");
        return;
      }
      if (mode === "json") {
        res.end("not-json");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    const flow = (retries: number): Flow => ({
      format: "flowgit",
      version: "0.1",
      name: "svc",
      stages: [
        {
          id: "echo",
          name: "Echo",
          executor: { type: "service", url: server.url, method: "POST", retries, timeoutSec: 2 },
          outputs: [{ type: "application/json", path: "echo.json" }],
        },
      ],
    });
    const dir = temp("flowgit-svc-retry-");
    write(dir, "flow.json", JSON.stringify(flow(2)));
    const ok = await runStage(loadFlow(dir), "echo", fast);
    expect(hits).toBe(3);
    expect(ok.params?.retries).toEqual([
      expect.objectContaining({ n: 1, status: 429, delayMs: retryDelayMs(1, 0) }),
      expect.objectContaining({ n: 2, status: 429, delayMs: retryDelayMs(2, 0) }),
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "echo.json"), "utf8"))).toEqual({ ok: true });

    mode = "500";
    hits = 0;
    const errDir = temp("flowgit-svc-500-");
    write(errDir, "flow.json", JSON.stringify(flow(2)));
    await expect(runStage(loadFlow(errDir), "echo", fast)).rejects.toThrow(/500/);
    expect(hits).toBe(3);
    expect(listRuns(errDir, "echo")[0]?.params?.retries).toHaveLength(2);

    mode = "400";
    hits = 0;
    const badDir = temp("flowgit-svc-400-");
    write(badDir, "flow.json", JSON.stringify(flow(3)));
    await expect(runStage(loadFlow(badDir), "echo", fast)).rejects.toThrow(/400/);
    expect(hits).toBe(1);
    expect(listRuns(badDir, "echo")[0]?.params?.retries).toBeUndefined();

    mode = "json";
    hits = 0;
    const jsonDir = temp("flowgit-svc-json-");
    write(jsonDir, "flow.json", JSON.stringify(flow(3)));
    await expect(runStage(loadFlow(jsonDir), "echo", fast)).rejects.toThrow(/不是 JSON/);
    expect(hits).toBe(1);

    mode = "drop";
    hits = 0;
    const dropDir = temp("flowgit-svc-drop-");
    write(dropDir, "flow.json", JSON.stringify(flow(1)));
    await expect(runStage(loadFlow(dropDir), "echo", fast)).rejects.toThrow(/service call failed|调用服务失败/);
    expect(hits).toBe(2);
    expect(listRuns(dropDir, "echo")[0]?.params?.retries).toEqual([expect.objectContaining({ n: 1 })]);
  });
});

describe("flow.md round trip", () => {
  it("keeps concurrency and retries", () => {
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "并行",
      concurrency: 3,
      stages: [
        {
          id: "ask",
          name: "Ask",
          executor: { type: "llm", prompt: "prompts/ask.md", retries: 2 },
          outputs: [{ type: "text/markdown", path: "out.md" }],
        },
        {
          id: "echo",
          name: "Echo",
          executor: { type: "service", url: "https://example.com/echo", retries: 1 },
          outputs: [{ type: "application/json", path: "echo.json" }],
        },
      ],
    };
    const dir = temp("flowgit-md-");
    write(dir, "prompts/ask.md", "ask");
    const file = path.join(dir, "flow.md");
    writeFlowFile(file, flow);
    expect(findFlowFile(dir)).toBe(file);
    expect(readFlowFile(file)).toEqual(flow);
    expect(validateFlow(readFlowFile(file), { dir }).filter((issue) => issue.level === "error")).toEqual([]);
    const bad = validateFlow({ ...flow, concurrency: 0 });
    expect(bad.some((issue) => issue.level === "error" && issue.path.includes("concurrency"))).toBe(true);
    const negative = validateFlow({
      ...flow,
      stages: [{ ...flow.stages[0]!, executor: { type: "llm", prompt: "prompts/ask.md", retries: -1 } }],
    });
    expect(negative.some((issue) => issue.level === "error" && issue.path.includes("retries"))).toBe(true);
  });
});
