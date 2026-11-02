import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listRuns, loadFlow, runStage, stageStatus, validateFlow, type Flow } from "./index.js";

const dirs: string[] = [];

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FLOWGIT_LLM_MOCK_DIR;
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
    expect(run.params?.repairUsage).toEqual({ input_tokens: 2, output_tokens: 2 });

    fs.rmSync(path.join(mock, "make.repair.json"));
    await expect(runStage(loadFlow(dir), "make", { inputs: { topic: "x" }, force: true })).rejects.toThrow(/repair\.json/);
    expect(listRuns(dir, "make").at(-1)?.status).toBe("error");
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
