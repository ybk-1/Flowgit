import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseFlowMd, renderFlowMd } from "./flowmd.js";
import {
  doctor,
  flowActions,
  listMcpTools,
  listRuns,
  loadFlow,
  planRunAll,
  runStage,
  stageConfigHash,
  stageStatus,
  validateFlow,
  type ExecutorMcp,
  type Flow,
  type McpStdioServer,
  type Output,
} from "./index.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exampleDir = path.join(repoDir, "examples/mcp-echo");
const serverScript = path.join(exampleDir, "scripts/fake-mcp.mjs");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-mcp-"));
  dirs.push(dir);
  return dir;
}

function stdio(env: Record<string, string> = { ECHO_TOKEN: "${ECHO_TOKEN}" }): McpStdioServer {
  return { command: "node", args: [serverScript], env };
}

function writeFlow(dir: string, flow: Flow): void {
  fs.writeFileSync(path.join(dir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
}

function mcpFlow(output: Output, args: Record<string, unknown>, extra: Partial<ExecutorMcp> = {}, withNote = false): Flow {
  const echo: Flow["stages"][number] = {
    id: "echo",
    name: "回声",
    ...(withNote ? { inputs: ["note"] } : {}),
    executor: { type: "mcp", server: "echo", tool: "echo", args, timeoutSec: 30, ...extra },
    outputs: [output],
  };
  return {
    format: "flowgit",
    version: "0.1",
    name: "mcp",
    inputs: { x: { type: "string", required: true } },
    mcpServers: { echo: stdio() },
    stages: [
      ...(withNote
        ? [{ id: "note", name: "笔记", executor: { type: "human" as const }, outputs: [{ type: "text/markdown", path: "note.md" }] }]
        : []),
      echo,
    ],
  };
}

const env = { PATH: process.env.PATH ?? "", ECHO_TOKEN: "secret-token" };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("mcp validation", () => {
  it("rejects a literal secret in env, an unknown server, and more than one output", () => {
    const dir = tempDir();
    const secret: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "secret",
      mcpServers: { echo: { command: "node", args: ["s.mjs"], env: { API_KEY: "sk-literal-secret" } } },
      stages: [
        {
          id: "echo",
          name: "echo",
          executor: { type: "mcp", server: "echo", tool: "echo" },
          outputs: [{ type: "text/plain", path: "a.txt" }],
        },
      ],
    };
    const secretMsgs = validateFlow(secret).map((i) => i.message).join("\n");
    expect(secretMsgs).toContain("不能把密钥直接写进 flow.json");
    expect(secretMsgs).toContain("literal secret");

    const missing = mcpFlow({ type: "text/plain", path: "a.txt" }, { text: "hi" });
    missing.stages[0]!.executor = { type: "mcp", server: "missing", tool: "echo" };
    expect(validateFlow(missing).map((i) => i.message).join("\n")).toContain("not defined in mcpServers");

    const two = mcpFlow({ type: "text/plain", path: "a.txt" }, { text: "hi" });
    two.stages[0]!.outputs.push({ type: "text/plain", path: "b.txt" });
    expect(validateFlow(two).map((i) => i.message).join("\n")).toContain("exactly one output");

    const both = {
      format: "flowgit",
      version: "0.1",
      name: "both",
      mcpServers: { echo: { command: "node", url: "https://example.com/mcp" } },
      stages: [{ id: "echo", name: "echo", executor: { type: "mcp", server: "echo", tool: "echo" }, outputs: [{ type: "text/plain", path: "a.txt" }] }],
    };
    expect(validateFlow(both).some((i) => i.level === "error")).toBe(true);

    const http: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "http",
      mcpServers: { remote: { url: "https://example.com/mcp" } },
      stages: [{ id: "echo", name: "echo", executor: { type: "mcp", server: "remote", tool: "search", timeoutSec: 5 }, outputs: [{ type: "application/json", path: "out.json" }] }],
    };
    expect(validateFlow(http).filter((i) => i.level === "error")).toEqual([]);
    writeFlow(dir, http);
    const checks = doctor(loadFlow(dir), { env: {} });
    expect(checks.some((c) => c.stage === "echo" && c.level === "ok" && c.message.includes("https://example.com/mcp"))).toBe(true);
    expect(checks.some((c) => c.level === "error")).toBe(false);
  });

  it("round-trips the example through flow.md", () => {
    const loaded = loadFlow(exampleDir);
    expect(validateFlow(loaded.flow, { dir: loaded.dir })).toEqual([]);
    expect(parseFlowMd(renderFlowMd(loaded.flow))).toEqual(loaded.flow);
    expect(flowActions(loaded.flow)).toEqual([
      { stage: "echo", kind: "mcp", detail: "node scripts/fake-mcp.mjs", env: ["ECHO_TOKEN"] },
    ]);
  });
});

describe("mcp executor", () => {
  it("writes joined text, logs stderr, and lists tools", async () => {
    const dir = tempDir();
    writeFlow(dir, mcpFlow({ type: "text/markdown", path: "out.md" }, { text: "ignored", mode: "lines" }));
    const loaded = loadFlow(dir);
    const run = await runStage(loaded, "echo", { inputs: { x: "hi" }, env });
    expect(fs.readFileSync(path.join(dir, "out.md"), "utf8")).toBe("one\n\ntwo");
    expect(run.log).toContain("stderr-ready");
    expect(run.params).toMatchObject({ server: "echo", tool: "echo", timeoutSec: 30 });
    const tools = await listMcpTools(dir, loaded.flow.mcpServers, "echo", env);
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
    expect(tools[0]?.inputSchema.properties).toHaveProperty("text");
    expect(tools[0]?.inputSchema.required).toContain("text");
  });

  it("writes structuredContent for JSON, including {{inputs.x}} and {{upstream.note}}", async () => {
    const dir = tempDir();
    writeFlow(
      dir,
      mcpFlow(
        { type: "application/json", path: "out.json" },
        { text: "{{inputs.x}}", path: "{{upstream.note}}", note: "{{upstream.note.content}}", mode: "json" },
        {},
        true,
      ),
    );
    fs.writeFileSync(path.join(dir, "note.md"), "upstream-body\n");
    const loaded = loadFlow(dir);
    await runStage(loaded, "note", { inputs: { x: "hello" }, env });
    await runStage(loaded, "echo", { inputs: { x: "hello" }, env });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"))).toEqual({
      text: "hello",
      note: "upstream-body\n",
      path: "note.md",
    });
  });

  it("saves a directory of image and audio items plus result.md", async () => {
    const dir = tempDir();
    writeFlow(dir, mcpFlow({ type: "dir", path: "out/" }, { text: "x", mode: "image" }));
    const loaded = loadFlow(dir);
    await runStage(loaded, "echo", { inputs: { x: "x" }, env });
    const png = fs.readFileSync(path.join(dir, "out/001.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(8);
    expect(png.length).toBeLessThan(1024);
    const wav = fs.readFileSync(path.join(dir, "out/002.wav"));
    expect(wav.subarray(0, 4).toString("utf8")).toBe("RIFF");
    expect(fs.readFileSync(path.join(dir, "out/result.md"), "utf8")).toBe("a pixel");
  });

  it("fails the stage when the tool sets isError", async () => {
    const dir = tempDir();
    writeFlow(dir, mcpFlow({ type: "text/plain", path: "out.txt" }, { text: "x", mode: "error" }));
    const loaded = loadFlow(dir);
    await expect(runStage(loaded, "echo", { inputs: { x: "x" }, env })).rejects.toThrow("tool failed: boom");
    const run = listRuns(dir, "echo").at(-1);
    expect(run?.status).toBe("error");
    expect(run?.error).toContain("tool failed: boom");
    expect(fs.existsSync(path.join(dir, "out.txt"))).toBe(false);
  });

  it("kills the child when timeoutSec elapses", async () => {
    const dir = tempDir();
    const flow = mcpFlow({ type: "text/plain", path: "out.txt" }, { text: "x", mode: "hang" }, { timeoutSec: 1 });
    writeFlow(dir, flow);
    const loaded = loadFlow(dir);
    const started = Date.now();
    await expect(runStage(loaded, "echo", { inputs: { x: "x" }, env })).rejects.toThrow("超时（1 秒），已停止 / Timed out after 1s and was stopped");
    expect(Date.now() - started).toBeLessThan(8000);
    const run = listRuns(dir, "echo").at(-1);
    expect(run?.status).toBe("error");
    const pid = Number(run?.log?.match(/pid:(\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    let gone = false;
    for (let i = 0; i < 20; i++) {
      if (!alive(pid)) {
        gone = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(gone).toBe(true);
  });

  it("refuses to start when an env var is missing, and doctor says so", async () => {
    const dir = tempDir();
    writeFlow(dir, mcpFlow({ type: "text/plain", path: "out.txt" }, { text: "{{inputs.x}}" }));
    const loaded = loadFlow(dir);
    await expect(runStage(loaded, "echo", { inputs: { x: "hi" }, env: { PATH: env.PATH } })).rejects.toThrow(/ECHO_TOKEN/);
    expect(fs.existsSync(path.join(dir, "out.txt"))).toBe(false);
    const missing = doctor(loaded, { inputs: { x: "hi" }, env: { PATH: "" } });
    expect(missing).toContainEqual(expect.objectContaining({ level: "error", stage: "echo", message: expect.stringContaining("ECHO_TOKEN") }));
    expect(missing).toContainEqual(expect.objectContaining({ level: "error", stage: "echo", message: expect.stringContaining("node") }));
    const ready = doctor(loaded, { inputs: { x: "hi" }, env: { PATH: path.dirname(process.execPath), ECHO_TOKEN: "x" } });
    expect(ready.filter((c) => c.stage === "echo" && c.level === "error")).toEqual([]);
    const plan = planRunAll(loaded, { inputs: { x: "hi" }, env });
    expect(plan.map((s) => `${s.stage.id}:${s.action}`)).toEqual(["echo:run"]);
    expect(plan[0]?.detail).toContain("node");
    expect(plan[0]?.detail).toContain("echo");
  });

  it("marks the stage stale when args change, but not when an env value changes", async () => {
    const dir = tempDir();
    writeFlow(dir, mcpFlow({ type: "text/markdown", path: "out.md" }, { text: "{{inputs.x}}", mode: "text" }));
    const loaded = loadFlow(dir);
    await runStage(loaded, "echo", { inputs: { x: "hi" }, env });
    expect(stageStatus(loaded, "echo", { x: "hi" }).state).toBe("ok");
    expect(fs.readFileSync(path.join(dir, "out.md"), "utf8")).toBe("hi");

    const stage = loaded.flow.stages[0]!;
    const before = stageConfigHash(dir, stage, new Set(), loaded.flow);
    const server = loaded.flow.mcpServers!.echo as McpStdioServer;
    server.env = { ECHO_TOKEN: "${OTHER_TOKEN}" };
    expect(stageConfigHash(dir, stage, new Set(), loaded.flow)).toBe(before);
    expect(stageStatus(loaded, "echo", { x: "hi" }).state).toBe("ok");

    server.command = "other-bin";
    expect(stageConfigHash(dir, stage, new Set(), loaded.flow)).not.toBe(before);
    server.command = "node";

    (stage.executor as ExecutorMcp).args = { text: "changed", mode: "text" };
    expect(stageStatus(loaded, "echo", { x: "hi" }).state).toBe("stale");
  });

  it("runs the mcp-echo example", async () => {
    const dir = tempDir();
    fs.cpSync(exampleDir, dir, { recursive: true });
    const loaded = loadFlow(dir);
    const run = await runStage(loaded, "echo", { inputs: { text: "hello" }, env });
    expect(run.status).toBe("ok");
    expect(fs.readFileSync(path.join(dir, "echo.md"), "utf8")).toBe("hello");
  });
});
