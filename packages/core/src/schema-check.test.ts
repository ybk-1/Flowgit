import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listRuns, loadFlow, runStage, setSchemaCompiler, stageStatus, validateFlow, type Flow, type LlmComplete, type LlmRequest, type RunEvent } from "./index.js";

const dirs: string[] = [];

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FLOWGIT_LLM_MOCK_DIR;
  setSchemaCompiler();
});

const schema = JSON.stringify({
  type: "object",
  required: ["n"],
  properties: { n: { type: "number" } },
  additionalProperties: false,
});

function project(dir: string, body: string): Flow {
  const flow: Flow = {
    format: "flowgit",
    version: "0.1",
    name: "schema",
    inputs: { topic: { type: "string", required: true } },
    stages: [
      {
        id: "make",
        name: "Make",
        executor: { type: "script", run: "node scripts/write.mjs" },
        outputs: [{ type: "application/json", path: "out.json", schema: "schemas/out.schema.json" }],
      },
    ],
  };
  write(dir, "flow.json", JSON.stringify(flow));
  write(dir, "schemas/out.schema.json", schema);
  write(dir, "scripts/write.mjs", body);
  return flow;
}

describe("JSON output schemas", () => {
  it("uses a plugged-in compiler instead of ajv (for pages whose CSP forbids new Function)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-plug-"));
    dirs.push(dir);
    project(dir, `import fs from "node:fs";\nfs.writeFileSync("out.json", JSON.stringify({ n: 1 }) + "\\n");\n`);
    const seen: unknown[] = [];
    setSchemaCompiler((compiled) => (data) => {
      seen.push(compiled, data);
      return [{ path: "/n", message: "plugged in" }];
    });
    await expect(runStage(loadFlow(dir), "make", { inputs: { topic: "x" } })).rejects.toThrow(/\/n: plugged in/);
    expect(seen).toContainEqual({ n: 1 });
    setSchemaCompiler();
    expect((await runStage(loadFlow(dir), "make", { inputs: { topic: "x" } })).status).toBe("ok");
  });

  it("accepts a valid output and fails an invalid one with the JSON path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-ok-"));
    dirs.push(dir);
    project(dir, `import fs from "node:fs";\nfs.writeFileSync("out.json", JSON.stringify({ n: 1 }) + "\\n");\n`);
    const ok = await runStage(loadFlow(dir), "make", { inputs: { topic: "x" } });
    expect(ok.status).toBe("ok");

    const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-bad-"));
    dirs.push(badDir);
    project(badDir, `import fs from "node:fs";\nfs.writeFileSync("out.json", JSON.stringify({ n: "no" }) + "\\n");\n`);
    await expect(runStage(loadFlow(badDir), "make", { inputs: { topic: "x" } })).rejects.toThrow(/\/n/);
    expect(listRuns(badDir, "make")[0]).toMatchObject({ status: "error" });
  });

  it("repairs an llm output from .repair.json and fails when that file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-repair-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "repair",
      inputs: { topic: { type: "string", required: true } },
      stages: [
        {
          id: "make",
          name: "Make",
          executor: { type: "llm", prompt: "prompts/make.md" },
          outputs: [{ type: "application/json", path: "out.json", schema: "schemas/out.schema.json" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "schemas/out.schema.json", schema);
    write(dir, "prompts/make.md", "Write JSON for {{inputs.topic}}.");
    const mock = path.join(dir, "mocks");
    write(mock, "make.json", '{"n":"no"}\n');
    write(mock, "make.repair.json", '{"n":2}\n');
    process.env.FLOWGIT_LLM_MOCK_DIR = mock;
    const run = await runStage(loadFlow(dir), "make", { inputs: { topic: "x" } });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"))).toEqual({ n: 2 });
    expect(run.params?.llmCalls).toHaveLength(2);
    // Canned replies report no usage, like the first call.
    expect(run.params?.repairUsage).toBeNull();

    fs.rmSync(path.join(mock, "make.repair.json"));
    await expect(runStage(loadFlow(dir), "make", { inputs: { topic: "x" }, force: true })).rejects.toThrow(/repair\.json/);
    expect(listRuns(dir, "make").at(-1)?.status).toBe("error");
  });

  it("sends the schema and the extra property to the repair call, and adds up both calls' usage", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-usage-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "usage",
      stages: [
        {
          id: "make",
          name: "Make",
          executor: { type: "llm", prompt: "prompts/make.md" },
          outputs: [{ type: "application/json", path: "out.json", schema: "schemas/out.schema.json" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "schemas/out.schema.json", schema);
    write(dir, "prompts/make.md", "Write JSON.");
    const prompts: string[] = [];
    const requests: LlmRequest[] = [];
    // A long first reply: the repair must see all of it, not a truncated copy.
    const first = JSON.stringify({ n: 1, extra: "x".repeat(6000) });
    const llm: LlmComplete = async (req) => {
      prompts.push(req.prompt);
      requests.push(req);
      return req.repair
        ? { text: '{"n":3}', model: "fake", usage: { input_tokens: 3, output_tokens: 2 } }
        : { text: first, model: "fake", usage: { input_tokens: 10, output_tokens: 5 } };
    };
    const run = await runStage(loadFlow(dir), "make", { llm });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"))).toEqual({ n: 3 });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('must NOT have additional properties: "extra"');
    expect(prompts[1]).toContain('"additionalProperties":false');
    // the repair continues the conversation: the original prompt, then the whole first reply
    expect(requests[0].history).toBeUndefined();
    expect(requests[1].history).toEqual([
      { role: "user", content: prompts[0] },
      { role: "assistant", content: first },
    ]);
    expect(prompts[1]).not.toContain("xxxx");
    expect(run.params?.usage).toEqual({ input_tokens: 13, output_tokens: 7 });
    expect(run.params?.llmCalls).toEqual([
      { input_tokens: 10, output_tokens: 5 },
      { input_tokens: 3, output_tokens: 2 },
    ]);
  });

  it("keeps both calls' usage on the error run when the repair still fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-repair-fail-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "repair-fail",
      stages: [
        {
          id: "make",
          name: "Make",
          executor: { type: "llm", prompt: "prompts/make.md" },
          outputs: [{ type: "application/json", path: "out.json", schema: "schemas/out.schema.json" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "schemas/out.schema.json", schema);
    write(dir, "prompts/make.md", "Write JSON.");
    const llm: LlmComplete = async (req) =>
      req.repair
        ? { text: '{"n":"still no"}', model: "fake", usage: { input_tokens: 3, output_tokens: 2 } }
        : { text: '{"n":"no"}', model: "fake", usage: { input_tokens: 10, output_tokens: 5 } };
    const errors: RunEvent[] = [];
    await expect(runStage(loadFlow(dir), "make", { llm, onEvent: (e) => e.type === "stage:error" && errors.push(e) })).rejects.toThrow(/JSON Schema/);
    const record = listRuns(dir, "make").at(-1);
    expect(record?.status).toBe("error");
    expect(record?.params?.usage).toEqual({ input_tokens: 13, output_tokens: 7 });
    expect(record?.params?.llmCalls).toHaveLength(2);
    expect(record?.log).toContain("修复用量 / repair usage: 3 输入 input + 2 输出 output tokens");
    expect(errors[0]).toMatchObject({ type: "stage:error", record: { params: { usage: { input_tokens: 13, output_tokens: 7 } } } });
  });

  it("keeps the usage of replies that are not JSON at all", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-not-json-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "not-json",
      stages: [
        {
          id: "make",
          name: "Make",
          executor: { type: "llm", prompt: "prompts/make.md" },
          outputs: [{ type: "application/json", path: "out.json", schema: "schemas/out.schema.json" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "schemas/out.schema.json", schema);
    write(dir, "prompts/make.md", "Write JSON.");
    // the repair reply is cut off mid-array
    const repairCut: LlmComplete = async (req) =>
      req.repair
        ? { text: '{"n": [1, 2', model: "fake", usage: { input_tokens: 3, output_tokens: 2 } }
        : { text: '{"n":"no"}', model: "fake", usage: { input_tokens: 10, output_tokens: 5 } };
    await expect(runStage(loadFlow(dir), "make", { llm: repairCut })).rejects.toThrow(/修复回复 \/ repair reply/);
    let record = listRuns(dir, "make").at(-1);
    expect(record?.status).toBe("error");
    expect(record?.params?.usage).toEqual({ input_tokens: 13, output_tokens: 7 });
    expect(record?.params?.llmCalls).toHaveLength(2);
    // the first reply is prose, so there is nothing to repair
    const prose: LlmComplete = async () => ({ text: "Sorry, here you go: n is one.", model: "fake", usage: { input_tokens: 10, output_tokens: 5 } });
    await expect(runStage(loadFlow(dir), "make", { llm: prose, force: true })).rejects.toThrow(/模型回复 \/ model reply/);
    record = listRuns(dir, "make").at(-1);
    expect(record?.params?.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(record?.params?.llmCalls).toHaveLength(1);
  });

  it("checks draft-07 schemas too, and rejects drafts it can't check", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-draft7-"));
    dirs.push(dir);
    project(dir, `import fs from "node:fs";\nfs.writeFileSync("out.json", JSON.stringify({ n: 1, extra: 1 }) + "\\n");\n`);
    write(dir, "schemas/out.schema.json", JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", ...JSON.parse(schema) }));
    expect(validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir })).toEqual([]);
    await expect(runStage(loadFlow(dir), "make", { inputs: { topic: "x" } })).rejects.toThrow(/additional properties: "extra"/);

    write(dir, "schemas/out.schema.json", JSON.stringify({ $schema: "http://json-schema.org/draft-04/schema#", type: "object" }));
    const messages = validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir }).map((i) => i.message);
    expect(messages.join("\n")).toContain("use draft-07, 2019-09 or 2020-12");
  });

  it("marks the stage stale when the schema file changes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-stale-"));
    dirs.push(dir);
    project(dir, `import fs from "node:fs";\nfs.writeFileSync("out.json", JSON.stringify({ n: 1 }) + "\\n");\n`);
    const loaded = loadFlow(dir);
    await runStage(loaded, "make", { inputs: { topic: "x" } });
    expect(stageStatus(loaded, "make", { topic: "x" }).state).toBe("ok");
    const changed = JSON.parse(schema) as { title?: string };
    changed.title = "changed";
    write(dir, "schemas/out.schema.json", JSON.stringify(changed));
    expect(stageStatus(loadFlow(dir), "make", { topic: "x" }).state).toBe("stale");
  });

  it("reports a missing schema file and a schema on a non-JSON output", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-validate-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "bad",
      stages: [
        {
          id: "a",
          name: "A",
          executor: { type: "human" },
          outputs: [{ type: "text/plain", path: "a.txt", schema: "schemas/out.schema.json" }],
        },
        {
          id: "b",
          name: "B",
          executor: { type: "human" },
          outputs: [{ type: "application/json", path: "b.json", schema: "schemas/missing.schema.json" }],
        },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "schemas/out.schema.json", schema);
    const messages = validateFlow(flow, { dir }).map((i) => i.message).join("\n");
    expect(messages).toContain("only for JSON outputs");
    expect(messages).toContain("schema file not found");
  });
});
