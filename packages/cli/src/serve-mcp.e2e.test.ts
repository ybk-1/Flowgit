import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Connects the SDK's own client to the built CLI's stdio server (dist/), with canned model replies.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const weeklyTemplate = path.join(here, "..", "templates", "weekly-report");

let work: string;
const clients: Client[] = [];

beforeEach(() => {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-serve-mcp-"));
});

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  fs.rmSync(work, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) base[k] = v;
  return { ...base, NO_COLOR: "1", FLOWGIT_HOME: path.join(work, "home"), FLOWGIT_PROXY: "off", ...extra };
}

async function connect(dir: string, opts: { args?: string[]; env?: Record<string, string>; answer?: (fields: string[]) => Record<string, string> | undefined } = {}) {
  const client = new Client({ name: "flowgit-test", version: "1.2.3" }, { capabilities: opts.answer ? { elicitation: {} } : {} });
  if (opts.answer) {
    const answer = opts.answer;
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      const schema = (req.params as { requestedSchema: { properties: Record<string, { title: string }> } }).requestedSchema;
      const keys = Object.keys(schema.properties);
      const values = answer(keys.map((k) => schema.properties[k]!.title));
      if (!values) return { action: "decline" };
      return { action: "accept", content: Object.fromEntries(keys.map((k) => [k, values[schema.properties[k]!.title] ?? ""])) };
    });
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "serve", "--mcp", dir, ...(opts.args ?? [])],
    env: env(opts.env),
    stderr: "pipe",
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const at = text.indexOf("\n\n{");
  return { result, text, data: at >= 0 ? JSON.parse(text.slice(at + 2)) : undefined };
}

/** A person writes notes.md, a model turns it into report.md. */
function humanLlmFlow(): { dir: string; mock: string } {
  const dir = path.join(work, "flow");
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "flow.json"),
    JSON.stringify({
      format: "flowgit",
      version: "0.1",
      id: "notes-to-report",
      name: "Notes to report",
      inputs: {
        topic: { type: "string", required: true, description: "What the report is about" },
        language: { type: "string", enum: ["zh", "en"], default: "en" },
      },
      stages: [
        { id: "notes", name: "Notes", executor: { type: "human", instructions: "Write notes.md" }, outputs: [{ type: "text/markdown", path: "notes.md" }] },
        { id: "draft", name: "Draft", inputs: ["notes"], executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ type: "text/markdown", path: "report.md" }] },
      ],
    }),
  );
  fs.writeFileSync(path.join(dir, "prompts", "draft.md"), "Write a report about {{inputs.topic}}.\n");
  const mock = path.join(work, "mock");
  fs.mkdirSync(mock);
  fs.writeFileSync(path.join(mock, "draft.md"), "# Report\n\nAll good.\n");
  return { dir, mock };
}

describe("flowgit serve --mcp", () => {
  it("lists the tools, with the flow inputs as run_flow's schema", async () => {
    const { dir, mock } = humanLlmFlow();
    const client = await connect(dir, { env: { FLOWGIT_LLM_MOCK_DIR: mock } });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["run_flow", "run_stage", "get_output", "status"]);
    const runFlow = tools.find((t) => t.name === "run_flow")!;
    expect(runFlow.inputSchema).toMatchObject({
      type: "object",
      properties: { topic: { type: "string" }, language: { type: "string", enum: ["zh", "en"], default: "en" } },
      required: ["topic"],
    });
  });

  it("runs a human + llm flow to the end on canned replies, recording the call in run.json", async () => {
    const { dir, mock } = humanLlmFlow();
    const client = await connect(dir, { env: { FLOWGIT_LLM_MOCK_DIR: mock } });

    const waiting = await call(client, "run_flow", { topic: "cats" });
    expect(waiting.result.isError).toBeFalsy();
    expect(waiting.data.status).toBe("waiting");
    expect(waiting.data.waiting).toMatchObject({ stage: "notes", instructions: "Write notes.md", files: [{ path: "notes.md", absPath: path.join(dir, "notes.md") }] });

    const notes = await call(client, "run_stage", { stage: "notes", files: { "notes.md": "- fed the cats\n" } });
    expect(notes.data?.status, notes.text).toBe("done");

    const done = await call(client, "run_flow", { topic: "cats" });
    expect(done.data.status, done.text).toBe("done");
    expect(done.data.ran).toEqual([{ stage: "draft", n: 1, status: "ok", executor: "llm" }]);
    expect(done.data.outputs).toEqual([expect.objectContaining({ stage: "draft", path: "report.md", text: "# Report\n\nAll good.\n" })]);

    const run = JSON.parse(fs.readFileSync(path.join(dir, "runs", "draft", "1", "run.json"), "utf8"));
    expect(run).toMatchObject({ via: "mcp", client: "flowgit-test 1.2.3", flowInputs: { topic: "cats" } });

    const out = await call(client, "get_output", { stage: "notes" });
    expect(out.data.outputs[0].text).toBe("- fed the cats\n");
    const status = await call(client, "status");
    expect(status.data.stages.map((s: { state: string }) => s.state)).toEqual(["ok", "ok"]);
  });

  it("asks the person for a human stage's text when the client supports elicitation", async () => {
    const { dir, mock } = humanLlmFlow();
    const asked: string[][] = [];
    const client = await connect(dir, {
      env: { FLOWGIT_LLM_MOCK_DIR: mock },
      answer: (fields) => {
        asked.push(fields);
        return { "notes.md": "- asked in the client\n" };
      },
    });
    const done = await call(client, "run_flow", { topic: "dogs" });
    expect(asked).toEqual([["notes.md"]]);
    expect(done.data.status, done.text).toBe("done");
    expect(fs.readFileSync(path.join(dir, "notes.md"), "utf8")).toBe("- asked in the client\n");
  });

  it("stops weekly-report at its human stage, and refuses its script stage without --allow-exec", async () => {
    const dir = path.join(work, "weekly");
    fs.cpSync(weeklyTemplate, dir, { recursive: true });
    const mockEnv = { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies") };

    const locked = await connect(dir, { env: mockEnv });
    const refused = await call(locked, "run_flow", { name: "Ada" });
    expect(refused.result.isError).toBe(true);
    expect(refused.text).toContain("--allow-exec");
    expect(refused.text).toContain("check (script): node scripts/check-report.mjs");
    expect((await call(locked, "run_stage", { stage: "check" })).result.isError).toBe(true);
    // the human stage on its own runs nothing
    const missing = await call(locked, "run_stage", { stage: "notes" });
    expect(missing.text).toContain("Missing flow inputs: name. Pass them as run_flow parameters or in run_stage's inputs");
    const human = await call(locked, "run_stage", { stage: "notes", inputs: { name: "Ada" } });
    expect(human.data?.status, human.text).toBe("waiting");
    expect(fs.existsSync(path.join(dir, "runs"))).toBe(false);

    const open = await connect(dir, { env: mockEnv, args: ["--allow-exec"] });
    const waiting = await call(open, "run_flow", { name: "Ada" });
    expect(waiting.data.status, waiting.text).toBe("waiting");
    expect(waiting.data.waiting.stage).toBe("notes");
    expect(waiting.data.waiting.files[0].path).toBe("notes.md");

    fs.copyFileSync(path.join(dir, "sample-notes.md"), path.join(dir, "notes.md"));
    const done = await call(open, "run_flow", { name: "Ada" });
    expect(done.data.status, done.text).toBe("done");
    expect(done.data.ran.map((r: { stage: string }) => r.stage)).toEqual(["notes", "draft", "check"]);
    expect(done.data.outputs[0]).toMatchObject({ stage: "check", path: "check.json" });
  });

  it("prints setup for Claude Code, Claude Desktop and Cursor", () => {
    const { dir } = humanLlmFlow();
    const r = spawnSync(process.execPath, [cli, "serve", "--mcp", dir, "--print-config", "--model", "deepseek/deepseek-chat"], { encoding: "utf8", env: env() });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("https://code.claude.com/docs/en/mcp");
    expect(r.stdout).toContain("claude mcp add --env 'DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}' --transport stdio flowgit-notes-to-report -- ");
    expect(r.stdout).toContain("https://modelcontextprotocol.io/docs/develop/connect-local-servers");
    expect(r.stdout).toContain("https://cursor.com/docs/context/mcp");
    expect(r.stdout).toContain('"DEEPSEEK_API_KEY": "${env:DEEPSEEK_API_KEY}"');
    expect(r.stdout).toContain('"--model"');
  });
});
