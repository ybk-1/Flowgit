import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctor, loadFlow, planRunAll, runStage, stageConfigHash, type Flow } from "./index.js";

const dirs: string[] = [];

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function flow(url: string, extra: Record<string, unknown> = {}): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "svc",
    inputs: { topic: { type: "string", required: true } },
    stages: [
      {
        id: "note",
        name: "Note",
        executor: { type: "human" },
        outputs: [{ type: "text/markdown", path: "note.md" }],
      },
      {
        id: "echo",
        name: "Echo",
        inputs: ["note"],
        executor: { type: "service", url, method: "POST", headers: { Authorization: "Bearer {{env.ECHO_TOKEN}}" }, timeoutSec: 5, ...extra },
        outputs: [{ type: "application/json", path: "echo.json" }],
      },
    ],
  };
}

function listen(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}/echo`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

describe("service executor", () => {
  it("POSTs inputs and upstream text, and writes a pretty JSON reply", async () => {
    let hits = 0;
    let seen: { auth?: string; body?: unknown } = {};
    const server = await listen(async (req, res) => {
      hits += 1;
      seen = { auth: req.headers.authorization, body: JSON.parse(await readBody(req)) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, topic: "cats" }));
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-svc-"));
    dirs.push(dir);
    try {
      write(dir, "flow.json", JSON.stringify(flow(server.url)));
      write(dir, "note.md", "hello note\n");
      const loaded = loadFlow(dir);
      await runStage(loaded, "note", { inputs: { topic: "cats" } });
      const run = await runStage(loaded, "echo", { inputs: { topic: "cats" }, env: { ECHO_TOKEN: "secret-token" } });
      expect(hits).toBe(1);
      expect(seen.auth).toBe("Bearer secret-token");
      expect(seen.body).toEqual({ inputs: { topic: "cats" }, upstream: { note: { "note.md": "hello note\n" } } });
      expect(fs.readFileSync(path.join(dir, "echo.json"), "utf8")).toBe(`${JSON.stringify({ ok: true, topic: "cats" }, null, 2)}\n`);
      expect(run.params).toMatchObject({ method: "POST", status: 200 });
    } finally {
      await server.close();
    }
  });

  it("fails on HTTP 500 with the status, and does not call when an env var is missing", async () => {
    let hits = 0;
    const server = await listen(async (_req, res) => {
      hits += 1;
      res.statusCode = 500;
      res.end("nope, the boiler is down");
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-svc-err-"));
    dirs.push(dir);
    try {
      write(dir, "flow.json", JSON.stringify(flow(server.url)));
      write(dir, "note.md", "hello\n");
      const loaded = loadFlow(dir);
      await runStage(loaded, "note", { inputs: { topic: "cats" } });
      await expect(runStage(loaded, "echo", { inputs: { topic: "cats" }, env: { ECHO_TOKEN: "x" } })).rejects.toThrow(/500/);
      expect(hits).toBe(1);
      hits = 0;
      await expect(runStage(loaded, "echo", { inputs: { topic: "cats" }, env: {} })).rejects.toThrow(/ECHO_TOKEN/);
      expect(hits).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("stops when timeoutSec elapses", async () => {
    const server = await listen(() => {
      // never respond
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-svc-timeout-"));
    dirs.push(dir);
    try {
      write(dir, "flow.json", JSON.stringify(flow(server.url, { timeoutSec: 1, headers: {} })));
      write(dir, "note.md", "hello\n");
      const loaded = loadFlow(dir);
      await runStage(loaded, "note", { inputs: { topic: "cats" } });
      const started = Date.now();
      await expect(runStage(loaded, "echo", { inputs: { topic: "cats" } })).rejects.toThrow(/超时（1 秒）/);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await server.close();
    }
  });

  it("follows a same-origin redirect but never sends the headers to another origin", async () => {
    const other: { auth?: string; hits: number } = { hits: 0 };
    const elsewhere = await listen((req, res) => {
      other.hits += 1;
      other.auth = req.headers["x-api-key"] as string | undefined;
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
    const seen: string[] = [];
    const server = await listen(async (req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers["x-api-key"] ?? ""} ${await readBody(req)}`.trim());
      if (req.url === "/echo") {
        res.writeHead(307, { location: "/v2/echo" });
        res.end();
      } else if (req.url === "/v2/echo") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ moved: true }));
      } else {
        res.writeHead(302, { location: elsewhere.url });
        res.end();
      }
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-svc-redirect-"));
    dirs.push(dir);
    try {
      const headers = { "X-Api-Key": "{{env.ECHO_TOKEN}}" };
      write(dir, "flow.json", JSON.stringify(flow(server.url, { headers })));
      write(dir, "note.md", "hi\n");
      const loaded = loadFlow(dir);
      await runStage(loaded, "note", { inputs: { topic: "cats" } });
      await runStage(loaded, "echo", { inputs: { topic: "cats" }, env: { ECHO_TOKEN: "k1" } });
      expect(JSON.parse(fs.readFileSync(path.join(dir, "echo.json"), "utf8"))).toEqual({ moved: true });
      // 307 keeps the method and the body.
      expect(seen).toHaveLength(2);
      expect(seen[1]).toMatch(/^POST \/v2\/echo k1 \{"inputs"/);

      write(dir, "flow.json", JSON.stringify(flow(server.url.replace("/echo", "/away"), { headers })));
      await expect(runStage(loadFlow(dir), "echo", { inputs: { topic: "cats" }, env: { ECHO_TOKEN: "k1" } })).rejects.toThrow(
        /redirected to another origin/,
      );
      expect(other.hits).toBe(0);
    } finally {
      await server.close();
      await elsewhere.close();
    }
  });

  it("doctor names a missing header env, and dry-run treats service as runnable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-svc-doctor-"));
    dirs.push(dir);
    write(dir, "flow.json", JSON.stringify(flow("http://127.0.0.1:9/echo")));
    write(dir, "note.md", "hello\n");
    const loaded = loadFlow(dir);
    const checks = doctor(loaded, { inputs: { topic: "cats" }, env: {} });
    expect(checks).toContainEqual(expect.objectContaining({ level: "error", stage: "echo", message: expect.stringContaining("ECHO_TOKEN") }));
    const go = planRunAll(loaded, { inputs: { topic: "cats" }, env: {} });
    expect(go.map((s) => `${s.stage.id}:${s.action}`)).toEqual(["note:run", "echo:run"]);
    expect(go[1]?.detail).toContain("POST http://127.0.0.1:9/echo");
    const echo = loaded.flow.stages[1]!;
    const before = stageConfigHash(dir, echo);
    if (echo.executor.type === "service") echo.executor.headers = { Authorization: "Bearer {{env.OTHER_TOKEN}}" };
    expect(stageConfigHash(dir, echo)).not.toBe(before);
  });
});
