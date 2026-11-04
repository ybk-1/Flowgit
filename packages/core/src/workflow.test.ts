import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HumanInputNeededError,
  doctor,
  flowToMermaid,
  isRunnableExecutor,
  listRuns,
  loadFlow,
  mockCompleteFromDir,
  planRunAll,
  renderSkillMd,
  runStage,
  stageStatus,
  validateFlow,
  type Flow,
} from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function flow(stages: Flow["stages"], inputs?: Flow["inputs"]): Flow {
  return { format: "flowgit", version: "0.1", name: "subflow test", inputs, stages };
}

const WRITE_JS = `
import fs from "node:fs";
const topic = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}").topic ?? "";
fs.mkdirSync("pics", { recursive: true });
fs.writeFileSync("out.md", topic + "\\n");
fs.writeFileSync("pics/a.txt", "pic\\n");
console.log("wrote out");
`;

function subFlow(extra: Record<string, unknown> = {}): Flow {
  return flow(
    [
      {
        id: "write",
        name: "Write",
        executor: { type: "script", run: "node write.mjs", ...extra },
        outputs: [
          { type: "text/markdown", path: "out.md" },
          { type: "dir", path: "pics/" },
        ],
      },
    ],
    { topic: { type: "string", required: true } },
  );
}

function parentOf(file: string, outputs: Flow["stages"][number]["outputs"], copy: Record<string, string>): Flow {
  return flow(
    [
      {
        id: "make",
        name: "Make",
        executor: { type: "workflow", engine: "flowgit", file, params: { inputs: { topic: "{{inputs.topic}}" }, copy } },
        outputs,
      },
    ],
    { topic: { type: "string", required: true } },
  );
}

describe("workflow executor", () => {
  it("copies sub-flow files and directories into the parent and prefixes logs", async () => {
    const dir = tmp("flowgit-subflow-");
    write(dir, "sub/flow.json", JSON.stringify(subFlow()));
    write(dir, "sub/write.mjs", WRITE_JS);
    write(
      dir,
      "flow.json",
      JSON.stringify(
        parentOf("sub/flow.json", [
          { type: "text/markdown", path: "result.md" },
          { type: "dir", path: "album/" },
        ], { "out.md": "result.md", pics: "album" }),
      ),
    );
    const loaded = loadFlow(dir);
    const run = await runStage(loaded, "make", { inputs: { topic: "cats" } });
    expect(fs.readFileSync(path.join(dir, "result.md"), "utf8")).toBe("cats\n");
    expect(fs.readFileSync(path.join(dir, "album", "a.txt"), "utf8")).toBe("pic\n");
    expect(fs.existsSync(path.join(dir, "sub", "runs", "write", "1", "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "runs", "make", "1", "run.json"))).toBe(true);
    expect(run.log).toContain("[子流程 / sub-flow make]");
    expect(run.log).toContain("wrote out");
    expect(run.status).toBe("ok");
  });

  it("leaves the parent waiting when the sub-flow waits on a human", async () => {
    const dir = tmp("flowgit-subflow-wait-");
    const child = flow([
      {
        id: "note",
        name: "笔记",
        executor: { type: "human", instructions: "写 notes.md / write notes.md" },
        outputs: [{ type: "text/markdown", path: "notes.md" }],
      },
    ]);
    write(dir, "sub/flow.json", JSON.stringify(child));
    write(
      dir,
      "flow.json",
      JSON.stringify(parentOf("sub/flow.json", [{ type: "text/markdown", path: "notes.md" }], { "notes.md": "notes.md" })),
    );
    const loaded = loadFlow(dir);
    const err = await runStage(loaded, "make", { inputs: { topic: "cats" } }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HumanInputNeededError);
    const wait = err as HumanInputNeededError;
    expect(wait.message).toContain("note");
    expect(wait.message).toContain("sub/notes.md");
    expect(wait.stage.id).toBe("make");
    expect(listRuns(dir, "make")).toEqual([]);
    expect(stageStatus(loaded, "make", { topic: "cats" }).state).not.toBe("error");
  });

  it("fails the parent when the sub-flow fails, and names the sub-flow stage", async () => {
    const dir = tmp("flowgit-subflow-fail-");
    write(dir, "sub/flow.json", JSON.stringify(subFlow()));
    write(dir, "sub/write.mjs", `console.error("boom"); process.exit(1);\n`);
    write(
      dir,
      "flow.json",
      JSON.stringify(parentOf("sub/flow.json", [{ type: "text/markdown", path: "result.md" }], { "out.md": "result.md" })),
    );
    const loaded = loadFlow(dir);
    await expect(runStage(loaded, "make", { inputs: { topic: "cats" } })).rejects.toThrow(/write/);
    const recorded = listRuns(dir, "make");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.status).toBe("error");
    expect(recorded[0]?.error).toContain("write");
    expect(fs.existsSync(path.join(dir, "result.md"))).toBe(false);
  });

  it("errors when sub-flows form a cycle", () => {
    const dir = tmp("flowgit-subflow-cycle-");
    const loop = flow([
      {
        id: "again",
        name: "Again",
        executor: {
          type: "workflow",
          engine: "flowgit",
          file: "flow.json",
          params: { copy: { "out.txt": "out.txt" } },
        },
        outputs: [{ type: "text/plain", path: "out.txt" }],
      },
    ]);
    write(dir, "sub/flow.json", JSON.stringify(loop));
    write(
      dir,
      "flow.json",
      JSON.stringify(parentOf("sub/flow.json", [{ type: "text/plain", path: "out.txt" }], { "out.txt": "out.txt" })),
    );
    const issues = validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir });
    expect(issues.some((i) => i.level === "error" && /cycle|环/.test(i.message))).toBe(true);
  });

  it("rejects a file path that escapes with ..", () => {
    const dir = tmp("flowgit-subflow-escape-");
    const bad = parentOf("../outside/flow.json", [{ type: "text/plain", path: "out.txt" }], { "out.txt": "out.txt" });
    const issues = validateFlow(bad, { dir });
    expect(issues.filter((i) => i.level === "error").some((i) => i.path.includes("/file") && /\.\.|inside|目录内/.test(i.message))).toBe(true);

    const nested = parentOf("sub/../../flow.json", [{ type: "text/plain", path: "out.txt" }], { "out.txt": "out.txt" });
    const again = validateFlow(nested, { dir });
    expect(again.some((i) => i.level === "error" && i.path.includes("/file"))).toBe(true);
  });

  it("marks the parent stale when the sub-flow prompt changes", async () => {
    const dir = tmp("flowgit-subflow-stale-");
    const child = flow(
      [
        {
          id: "draft",
          name: "Draft",
          executor: { type: "llm", prompt: "prompts/draft.md" },
          outputs: [{ type: "text/markdown", path: "out.md" }],
        },
        {
          id: "check",
          name: "Check",
          inputs: ["draft"],
          executor: { type: "script", run: "node scripts/check.mjs" },
          outputs: [{ type: "text/plain", path: "check.txt" }],
        },
      ],
      { topic: { type: "string", required: true } },
    );
    write(dir, "sub/flow.json", JSON.stringify(child));
    write(dir, "sub/prompts/draft.md", "Write about {{inputs.topic}}.\n");
    write(dir, "sub/demo-replies/draft.md", "# cats\n");
    write(
      dir,
      "sub/scripts/check.mjs",
      `import fs from "node:fs"; fs.writeFileSync("check.txt", "ok\\n");\n`,
    );
    write(
      dir,
      "flow.json",
      JSON.stringify(parentOf("sub/flow.json", [{ type: "text/markdown", path: "result.md" }], { "out.md": "result.md" })),
    );
    const loaded = loadFlow(dir);
    const llm = () => mockCompleteFromDir(path.join(dir, "sub", "demo-replies"));
    const prompt = path.join(dir, "sub", "prompts", "draft.md");
    const original = fs.readFileSync(prompt, "utf8");
    await runStage(loaded, "make", { inputs: { topic: "cats" }, llm: llm() });
    expect(stageStatus(loaded, "make", { topic: "cats" }).state).toBe("ok");
    fs.appendFileSync(prompt, "\nOne more line.\n");
    expect(stageStatus(loaded, "make", { topic: "cats" }).state).toBe("stale");
    fs.writeFileSync(prompt, original);
    await runStage(loaded, "make", { inputs: { topic: "cats" }, llm: llm() });
    expect(stageStatus(loaded, "make", { topic: "cats" }).state).toBe("ok");
    fs.appendFileSync(path.join(dir, "sub", "scripts", "check.mjs"), "\n");
    expect(stageStatus(loaded, "make", { topic: "cats" }).state).toBe("stale");
  });

  it("nests sub-flows up to 5 deep and errors past that", async () => {
    const okDir = tmp("flowgit-subflow-depth5-");
    writeChain(okDir, 5);
    expect(validateFlow(JSON.parse(fs.readFileSync(path.join(okDir, "flow.json"), "utf8")), { dir: okDir }).filter((i) => i.level === "error")).toEqual([]);
    await runStage(loadFlow(okDir), "run");
    expect(fs.readFileSync(path.join(okDir, "out.txt"), "utf8")).toBe("leaf\n");

    const deep = tmp("flowgit-subflow-depth6-");
    writeChain(deep, 6);
    const issues = validateFlow(JSON.parse(fs.readFileSync(path.join(deep, "flow.json"), "utf8")), { dir: deep });
    expect(issues.some((i) => i.level === "error" && /5/.test(i.message) && /deep|嵌套/.test(i.message))).toBe(true);
  });

  it("requires copy to cover every parent output", () => {
    const dir = tmp("flowgit-subflow-copy-");
    write(dir, "sub/flow.json", JSON.stringify(flow([
      { id: "write", name: "Write", executor: { type: "script", run: "node write.mjs" }, outputs: [{ type: "text/plain", path: "a.md" }] },
    ])));
    const parent = flow([
      {
        id: "make",
        name: "Make",
        executor: {
          type: "workflow",
          engine: "flowgit",
          file: "sub/flow.json",
          params: { copy: { "a.md": "a.md" } },
        },
        outputs: [
          { type: "text/plain", path: "a.md" },
          { type: "text/plain", path: "b.md" },
        ],
      },
    ]);
    write(dir, "flow.json", JSON.stringify(parent));
    const issues = validateFlow(parent, { dir });
    expect(issues.some((i) => i.level === "error" && i.message.includes("b.md"))).toBe(true);
  });

  it("keeps other engines reserved and describes flowgit to plan, doctor, graph and export-skill", async () => {
    const reserved = flow([
      {
        id: "draw",
        name: "Draw",
        executor: { type: "workflow", engine: "n8n", file: "n8n.json", params: { nodes: [{ id: 1 }], extra: true } },
        outputs: [{ type: "image/png", path: "out.png" }],
      },
    ]);
    const reservedIssues = validateFlow(reserved);
    expect(reservedIssues.filter((i) => i.level === "error")).toEqual([]);
    expect(reservedIssues.some((i) => i.level === "warning" && /comfyui|flowgit/.test(i.message))).toBe(true);
    expect(isRunnableExecutor(reserved.stages[0]!.executor)).toBe(false);

    const shaped = flow([
      {
        id: "make",
        name: "Make",
        executor: { type: "workflow", engine: "flowgit", file: "sub/flow.json", params: { inputs: {}, copy: {}, extra: 1 } },
        outputs: [{ type: "text/plain", path: "out.txt" }],
      },
    ]);
    expect(validateFlow(shaped).some((i) => i.level === "error" && /extra/.test(i.message))).toBe(true);

    const dir = tmp("flowgit-subflow-plan-");
    const child = flow(
      [
        {
          id: "draft",
          name: "Draft",
          executor: { type: "llm", prompt: "prompts/draft.md", model: "deepseek/deepseek-v4-flash" },
          outputs: [{ type: "text/markdown", path: "out.md" }],
        },
      ],
      { topic: { type: "string", required: true } },
    );
    write(dir, "sub/flow.json", JSON.stringify(child));
    write(dir, "sub/prompts/draft.md", "Write {{inputs.topic}}.\n");
    write(dir, "flow.json", JSON.stringify(parentOf("sub/flow.json", [{ type: "text/markdown", path: "result.md" }], { "out.md": "result.md" })));
    const loaded = loadFlow(dir);
    expect(isRunnableExecutor(loaded.flow.stages[0]!.executor)).toBe(true);
    const skill = renderSkillMd(loaded.flow);
    expect(skill).toContain("运行子流程 `sub/flow.json`");
    expect(skill).toContain("run the sub-flow `sub/flow.json`");
    expect(flowToMermaid(loaded.flow)).toContain("sub-flow");

    const planned = planRunAll(loaded, { inputs: { topic: "cats" }, env: {} });
    expect(planned.map((s) => s.action)).toEqual(["run"]);
    expect(planned[0]?.detail).toContain("sub/flow.json");
    expect(planned[0]?.callsModel).toBe(true);

    const mocked = planRunAll(loaded, { inputs: { topic: "cats" }, env: { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "sub", "demo-replies") } });
    expect(mocked[0]?.callsModel).toBe(false);

    const checks = await doctor(loaded, { inputs: { topic: "cats" }, env: {} });
    expect(checks.some((c) => c.stage === "make" && /reserved/.test(c.message))).toBe(false);
    expect(checks.some((c) => /sub\/flow\.json/.test(c.message) && /sub-flow|子流程/.test(c.message))).toBe(true);
    expect(checks.some((c) => c.level === "error" && /DEEPSEEK_API_KEY/.test(c.message))).toBe(true);

    const reservedPlan = planRunAll(loadFlow(writeReserved(dir)), { env: {} });
    expect(reservedPlan[0]?.action).toBe("cannot-run");
  });
});

function writeReserved(dir: string): string {
  const reservedDir = path.join(dir, "reserved");
  fs.mkdirSync(reservedDir, { recursive: true });
  const body = flow([
    {
      id: "draw",
      name: "Draw",
      executor: { type: "workflow", engine: "n8n", file: "n8n.json", params: { webhook: true } },
      outputs: [{ type: "text/plain", path: "out.txt" }],
    },
  ]);
  write(reservedDir, "flow.json", JSON.stringify(body));
  return reservedDir;
}

/** `levels` workflow stages, then a script that writes out.txt. */
function writeChain(root: string, levels: number): void {
  let dir = root;
  for (let i = 0; i < levels; i++) {
    fs.mkdirSync(dir, { recursive: true });
    const body = flow([
      {
        id: "run",
        name: "Run",
        executor: {
          type: "workflow",
          engine: "flowgit",
          file: "sub/flow.json",
          params: { copy: { "out.txt": "out.txt" } },
        },
        outputs: [{ type: "text/plain", path: "out.txt" }],
      },
    ]);
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(body));
    dir = path.join(dir, "sub");
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "flow.json"),
    JSON.stringify(
      flow([
        {
          id: "write",
          name: "Write",
          executor: { type: "script", run: "node write.mjs" },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ]),
    ),
  );
  fs.writeFileSync(path.join(dir, "write.mjs"), `import fs from "node:fs";\nfs.writeFileSync("out.txt", "leaf\\n");\n`);
}
