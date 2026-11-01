import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HumanInputNeededError,
  MissingInputsError,
  UpstreamNotReadyError,
  allDownstream,
  extractJson,
  listRuns,
  loadFlow,
  loadFlowInputs,
  renderSkillMd,
  renderTemplate,
  resolveFlowInputs,
  restoreRun,
  runAll,
  runStage,
  stageStatus,
  topoOrder,
  validateFlow,
  type Flow,
  type LlmComplete,
  type LlmRequest,
} from "./index.js";

const baseFlow = (): Flow => ({
  format: "flowgit",
  version: "0.1",
  name: "test flow",
  inputs: { topic: { type: "string", required: true } },
  stages: [
    {
      id: "script",
      name: "脚本",
      executor: { type: "llm", prompt: "prompts/script.md" },
      outputs: [{ type: "text/markdown", path: "script.md" }],
    },
    {
      id: "storyboard",
      name: "分镜",
      inputs: ["script"],
      executor: { type: "llm", prompt: "prompts/storyboard.md" },
      outputs: [{ type: "flowgit/storyboard+json", path: "storyboard.json" }],
    },
    {
      id: "assets",
      name: "素材",
      inputs: ["storyboard"],
      executor: { type: "human", instructions: "put files in assets/" },
      outputs: [{ type: "dir", path: "assets/" }],
    },
    {
      id: "edit",
      name: "剪辑",
      inputs: ["storyboard", "assets"],
      executor: { type: "script", run: "node scripts/edit.mjs" },
      outputs: [{ type: "application/json", path: "timeline.json" }],
    },
  ],
});

let dir: string;
let calls: LlmRequest[];

const mockLlm: LlmComplete = async (req) => {
  calls.push(req);
  if (req.stageId === "script") return { text: `# Script about ${req.prompt.match(/topic=(\S+)/)?.[1]}\n\nline ${calls.length}`, model: "mock" };
  return { text: "Here you go:\n```json\n{\"shots\":[{\"id\":\"s1\",\"duration\":3}]}\n```", model: "mock" };
};

function writeProject(flow: Flow = baseFlow()) {
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow, null, 2));
  fs.writeFileSync(path.join(dir, "prompts/script.md"), "Write a script. topic={{inputs.topic}}");
  fs.writeFileSync(path.join(dir, "prompts/storyboard.md"), "Make a storyboard as JSON.");
  fs.writeFileSync(
    path.join(dir, "scripts/edit.mjs"),
    `import fs from "node:fs";
const sb = JSON.parse(fs.readFileSync("storyboard.json", "utf8"));
const assets = fs.readdirSync("assets");
fs.writeFileSync("timeline.json", JSON.stringify({ clips: sb.shots.length, assets }));
console.log("edited", process.env.FLOWGIT_STAGE);`,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-test-"));
  calls = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("validateFlow", () => {
  it("accepts a well-formed flow", () => {
    writeProject();
    expect(validateFlow(baseFlow(), { dir }).filter((i) => i.level === "error")).toEqual([]);
  });

  it("rejects unknown inputs, duplicates, cycles and unsafe paths", () => {
    const flow = baseFlow();
    flow.stages[1].inputs = ["nope"];
    flow.stages.push({ ...flow.stages[0] });
    flow.stages[2].outputs = [{ type: "dir", path: "../outside/" }];
    const msgs = validateFlow(flow).map((i) => i.message).join("\n");
    expect(msgs).toContain('unknown stage "nope"');
    expect(msgs).toContain('duplicate stage id "script"');
    expect(msgs).toContain("stay inside the flow directory");

    const cyclic = baseFlow();
    cyclic.stages[0].inputs = ["edit"];
    expect(validateFlow(cyclic).map((i) => i.message).join("\n")).toContain("cycle");
  });

  it("reports schema errors in plain words", () => {
    const flow = baseFlow() as unknown as Record<string, unknown>;
    (flow.stages as Record<string, unknown>[])[0].executor = { type: "robot" };
    flow.extra = 1;
    const msgs = validateFlow(flow).map((i) => i.message);
    expect(msgs.some((m) => m.includes("executor.type must be one of"))).toBe(true);
    expect(msgs.some((m) => m.includes('unknown property "extra"'))).toBe(true);
  });

  it("needs exactly one output for llm stages and checks the prompt file", () => {
    const flow = baseFlow();
    flow.stages[0].outputs.push({ type: "text/plain", path: "notes.txt" });
    const msgs = validateFlow(flow, { dir }).map((i) => i.message).join("\n");
    expect(msgs).toContain("exactly one output");
    expect(msgs).toContain("prompt file not found: prompts/script.md");
  });

  it("warns about reserved executors", () => {
    const flow = baseFlow();
    flow.stages[3].executor = { type: "mcp", server: "x", tool: "y" };
    const issues = validateFlow(flow);
    expect(issues).toContainEqual(expect.objectContaining({ level: "warning", message: expect.stringContaining('"mcp" is reserved') }));
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("graph", () => {
  it("orders stages and finds everything downstream", () => {
    const flow = baseFlow();
    expect(topoOrder(flow)).toEqual(["script", "storyboard", "assets", "edit"]);
    expect(allDownstream(flow, "storyboard")).toEqual(["assets", "edit"]);
    expect(allDownstream(flow, "edit")).toEqual([]);
  });
});

describe("helpers", () => {
  it("renders templates and extracts JSON from model replies", () => {
    expect(renderTemplate("a {{inputs.x}} b {{ inputs.y }}", { x: 1 })).toBe("a 1 b ");
    expect(JSON.parse(extractJson("sure!\n```json\n{\"a\":1}\n```\nbye"))).toEqual({ a: 1 });
    expect(JSON.parse(extractJson('prefix {"b":[1,2]} suffix'))).toEqual({ b: [1, 2] });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("exports a SKILL.md with every stage", () => {
    const md = renderSkillMd(baseFlow());
    expect(md).toMatch(/^---\nname: test-flow\n/);
    for (const id of ["script", "storyboard", "assets", "edit"]) expect(md).toContain(`flowgit run ${id}`);
  });
});

describe("running a flow", () => {
  it("requires flow inputs", async () => {
    writeProject();
    await expect(runStage(loadFlow(dir), "script", { llm: mockLlm })).rejects.toBeInstanceOf(MissingInputsError);
  });

  it("resolves defaults without checks, and checks required and enum values when loading", () => {
    const flow: Flow = {
      ...baseFlow(),
      inputs: {
        topic: { type: "string", required: true },
        n: { type: "number", default: 3 },
        language: { type: "string", enum: ["zh", "en"], default: "zh" },
      },
    };
    expect(resolveFlowInputs(dir, flow)).toEqual({ n: 3, language: "zh" });
    expect(() => loadFlowInputs(dir, flow)).toThrow(MissingInputsError);
    expect(loadFlowInputs(dir, flow, { topic: "cats", n: "5" })).toEqual({ topic: "cats", n: 5, language: "zh" });
    expect(() => loadFlowInputs(dir, flow, { topic: "cats", language: "fr" })).toThrow(/must be one of "zh", "en"/);
  });

  it("rejects numbers and booleans that don't parse, instead of running with NaN or false", () => {
    const flow: Flow = {
      ...baseFlow(),
      inputs: { n: { type: "number", default: 3 }, loud: { type: "boolean", default: false } },
    };
    expect(loadFlowInputs(dir, flow, { n: "2.5", loud: "true" })).toEqual({ n: 2.5, loud: true });
    expect(() => loadFlowInputs(dir, flow, { n: "abc" })).toThrow('Input "n" must be a number, got "abc"');
    expect(() => loadFlowInputs(dir, flow, { loud: "yes" })).toThrow('Input "loud" must be true or false, got "yes"');
    // status still resolves them, unchecked, so the board can show what was typed
    expect(resolveFlowInputs(dir, flow, { n: "abc" })).toMatchObject({ n: "abc" });
  });

  it("runs stages, records versions, detects stale and edited stages, and restores", async () => {
    writeProject();
    const loaded = loadFlow(dir);
    const opts = { llm: mockLlm, inputs: { topic: "cats" } };

    await expect(runStage(loaded, "storyboard", opts)).rejects.toBeInstanceOf(UpstreamNotReadyError);

    // downstream of a stage that never ran is waiting
    expect(stageStatus(loaded, "edit", opts.inputs).state).toBe("waiting-upstream");

    const r1 = await runStage(loaded, "script", opts);
    expect(r1).toMatchObject({ stage: "script", n: 1, status: "ok", executor: "llm" });
    expect(fs.readFileSync(path.join(dir, "script.md"), "utf8")).toContain("Script about cats");
    expect(fs.existsSync(path.join(dir, "runs/script/1/outputs/script.md"))).toBe(true);

    await runStage(loaded, "storyboard", opts);
    // the upstream script is passed to the model
    expect(calls[1].prompt).toContain("Script about cats");
    // JSON outputs are extracted from fenced replies
    expect(JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"))).toEqual({ shots: [{ id: "s1", duration: 3 }] });
    expect(stageStatus(loaded, "storyboard", opts.inputs).state).toBe("ok");

    // hand edit of the script: script is "edited", storyboard becomes "stale"
    fs.appendFileSync(path.join(dir, "script.md"), "\nmore");
    expect(stageStatus(loaded, "script", opts.inputs).state).toBe("edited");
    expect(stageStatus(loaded, "storyboard", opts.inputs).state).toBe("stale");
    // staleness propagates: assets never ran, so it waits
    expect(stageStatus(loaded, "assets", opts.inputs).state).toBe("waiting-upstream");

    const r2 = await runStage(loaded, "storyboard", opts);
    expect(r2.n).toBe(2);
    expect(stageStatus(loaded, "storyboard", opts.inputs).state).toBe("ok");

    // a hand edit is saved as its own version before an explicit re-run
    fs.writeFileSync(path.join(dir, "storyboard.json"), '{"shots":[]}');
    expect(stageStatus(loaded, "storyboard", opts.inputs).state).toBe("edited");
    const r4 = await runStage(loaded, "storyboard", opts);
    expect(r4.n).toBe(4);
    const manual = listRuns(dir, "storyboard").find((r) => r.n === 3)!;
    expect(manual.executor).toBe("manual");
    expect(fs.readFileSync(path.join(dir, "runs/storyboard/3/outputs/storyboard.json"), "utf8")).toBe('{"shots":[]}');

    // a different flow input makes the first stage stale
    expect(stageStatus(loaded, "script", { topic: "dogs" }).state).toBe("stale");

    // editing a prompt file makes its stage stale
    fs.appendFileSync(path.join(dir, "prompts/storyboard.md"), "\nUse 9:16.");
    expect(stageStatus(loaded, "storyboard", opts.inputs).state).toBe("stale");

    // restore v1 of the storyboard
    fs.writeFileSync(path.join(dir, "storyboard.json"), "{}");
    restoreRun(loaded.dir, loaded.flow, "storyboard", 1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8")).shots).toHaveLength(1);
    expect(listRuns(dir, "storyboard").map((r) => r.n)).toEqual([1, 2, 3, 4]);
  });

  it("stops at a human stage, accepts --from, and runs scripts", async () => {
    writeProject();
    const loaded = loadFlow(dir);
    const opts = { llm: mockLlm, inputs: { topic: "cats" } };

    await expect(runAll(loaded, opts)).rejects.toBeInstanceOf(HumanInputNeededError);
    expect(listRuns(dir, "assets")).toEqual([]);

    const src = path.join(dir, "..", `${path.basename(dir)}-src`);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "s1.jpg"), "fake");
    try {
      await runStage(loaded, "assets", { ...opts, from: [src] });
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
    expect(fs.existsSync(path.join(dir, "assets/s1.jpg"))).toBe(true);

    const records = await runAll(loaded, opts);
    expect(records.map((r) => r.stage)).toEqual(["edit"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8"))).toEqual({ clips: 1, assets: ["s1.jpg"] });
    expect(records[0].log).toContain("edited edit");

    // nothing left to do
    expect(await runAll(loaded, opts)).toEqual([]);
    // editing the script file of a stage makes it stale again
    fs.appendFileSync(path.join(dir, "scripts/edit.mjs"), "\n// tweak");
    expect((await runAll(loaded, opts)).map((r) => r.stage)).toEqual(["edit"]);
  });

  it("records failed script runs", async () => {
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "fail",
      stages: [{ id: "boom", name: "boom", executor: { type: "script", run: "exit 3" }, outputs: [{ type: "text/plain", path: "x.txt" }] }],
    };
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow));
    const loaded = loadFlow(dir);
    await expect(runStage(loaded, "boom")).rejects.toThrow("exited with code 3");
    const [run] = listRuns(dir, "boom");
    expect(run).toMatchObject({ n: 1, status: "error" });
    expect(stageStatus(loaded, "boom", {}).state).toBe("error");
  });

  it("fails when a stage does not write its declared outputs", async () => {
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "lazy",
      stages: [{ id: "lazy", name: "lazy", executor: { type: "script", run: "true" }, outputs: [{ type: "text/plain", path: "x.txt" }] }],
    };
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow));
    await expect(runStage(loadFlow(dir), "lazy")).rejects.toThrow("did not produce: x.txt");
  });
});
