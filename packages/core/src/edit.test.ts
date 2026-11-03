import { describe, expect, it } from "vitest";
import { addStage, editFlowMeta, editStage, flowMetaFromBody, isEditablePrompt, removeStage, stagePatchFromBody, type Flow } from "./index.js";

function flow(): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "t",
    inputs: { name: { type: "string", required: true } },
    stages: [
      { id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "notes.md" }] },
      {
        id: "draft",
        name: "Draft",
        inputs: ["notes"],
        executor: { type: "llm", prompt: "prompts/draft.md" },
        outputs: [{ type: "text/markdown", path: "report.md" }],
      },
      {
        id: "check",
        name: "Check",
        inputs: ["draft"],
        executor: { type: "script", run: "node scripts/check.mjs" },
        outputs: [{ type: "application/json", path: "check.json" }],
      },
    ],
  };
}

describe("addStage", () => {
  it("inserts a stage in the middle and defaults its input to the stage before it", () => {
    const original = flow();
    const next = addStage(original, { id: "polish", type: "llm", after: "draft", name: "润色" });
    expect(next.stages.map((s) => s.id)).toEqual(["notes", "draft", "polish", "check"]);
    expect(next.stages[2]).toMatchObject({
      name: "润色",
      inputs: ["draft"],
      executor: { type: "llm", prompt: "prompts/polish.md" },
      outputs: [{ type: "text/markdown", path: "polish.md" }],
    });
    expect(original.stages.map((s) => s.id)).toEqual(["notes", "draft", "check"]);
  });

  it("appends a stage and defaults its input to the previous one", () => {
    const next = addStage(flow(), { id: "extra", type: "human" });
    expect(next.stages.map((s) => s.id)).toEqual(["notes", "draft", "check", "extra"]);
    expect(next.stages[3]).toMatchObject({
      inputs: ["check"],
      executor: { type: "human" },
      outputs: [{ type: "text/markdown", path: "extra.md" }],
    });
  });

  it("uses explicit inputs when they are given, including none", () => {
    expect(addStage(flow(), { id: "extra", type: "llm", inputs: ["notes"] }).stages[3]?.inputs).toEqual(["notes"]);
    expect(addStage(flow(), { id: "extra", type: "human", inputs: [] }).stages[3]?.inputs).toBeUndefined();
  });

  it("rejects a duplicate id", () => {
    expect(() => addStage(flow(), { id: "draft", type: "human" })).toThrow(/已经有阶段 "draft".*already exists/s);
  });

  it("requires a script stage to name its command and outputs", () => {
    expect(() => addStage(flow(), { id: "pack", type: "script" })).toThrow(/--output/);
    expect(() => addStage(flow(), { id: "pack", type: "script", outputs: [{ type: "text/plain", path: "out.txt" }] })).toThrow(/--run/);
    const next = addStage(flow(), {
      id: "pack",
      type: "script",
      run: "node scripts/pack.mjs",
      outputs: [{ type: "text/plain", path: "out.txt" }],
    });
    expect(next.stages[3]).toMatchObject({ executor: { type: "script", run: "node scripts/pack.mjs" }, outputs: [{ path: "out.txt" }] });
  });

  it("defaults an agent stage to a directory output", () => {
    const next = addStage(flow(), { id: "page", type: "agent" });
    expect(next.stages[3]).toMatchObject({
      executor: { type: "agent", agent: "claude-code", prompt: "prompts/page.md" },
      outputs: [{ type: "dir", path: "page/" }],
    });
  });
});

describe("removeStage", () => {
  it("refuses to remove a stage that others depend on", () => {
    const original = flow();
    expect(() => removeStage(original, "draft")).toThrow(/check/);
    expect(() => removeStage(original, "draft")).toThrow(/--force/);
    expect(original.stages.map((s) => s.id)).toEqual(["notes", "draft", "check"]);
  });

  it("drops references with force and leaves the other stages' key order", () => {
    const next = removeStage(flow(), "draft", { force: true });
    expect(next.stages.map((s) => s.id)).toEqual(["notes", "check"]);
    expect(next.stages[1]?.inputs).toBeUndefined();
    expect(Object.keys(next.stages[1] ?? {})).toEqual(["id", "name", "executor", "outputs"]);

    const branched = flow();
    branched.stages[2]!.inputs = ["notes", "draft"];
    const kept = removeStage(branched, "draft", { force: true });
    expect(kept.stages[1]?.inputs).toEqual(["notes"]);
    expect(Object.keys(kept.stages[1] ?? {})).toEqual(["id", "name", "inputs", "executor", "outputs"]);
  });

  it("removes a stage nobody depends on", () => {
    const next = removeStage(flow(), "check");
    expect(next.stages.map((s) => s.id)).toEqual(["notes", "draft"]);
  });
});

describe("editStage", () => {
  it("renames a stage, sets the model and retries, and keeps the other executor fields", () => {
    const original = flow();
    original.stages[1]!.executor = { type: "llm", prompt: "prompts/draft.md", effort: "low" };
    const next = editStage(original, "draft", { name: "润色", model: "glm/glm-5.3", retries: 2 });
    expect(next.stages[1]).toMatchObject({
      name: "润色",
      inputs: ["notes"],
      executor: { type: "llm", prompt: "prompts/draft.md", effort: "low", model: "glm/glm-5.3", retries: 2 },
    });
    expect(original.stages[1]).toMatchObject({ name: "Draft", executor: { type: "llm", effort: "low" } });
    expect(original.stages[1]?.executor).not.toHaveProperty("model");
  });

  it("adds and clears a dependency without moving the stage", () => {
    const linked = editStage(flow(), "check", { inputs: ["draft", "notes"] });
    expect(linked.stages.map((s) => s.id)).toEqual(["notes", "draft", "check"]);
    expect(linked.stages[2]?.inputs).toEqual(["draft", "notes"]);
    const cleared = editStage(linked, "check", { inputs: [] });
    expect(cleared.stages[2]?.inputs).toBeUndefined();
    expect(Object.keys(cleared.stages[2] ?? {})).toEqual(["id", "name", "executor", "outputs"]);
  });

  it("refuses a dependency that would cycle and leaves the flow unchanged", () => {
    const original = flow();
    expect(() => editStage(original, "notes", { inputs: ["check"] })).toThrow(/会形成环/);
    expect(() => editStage(original, "notes", { inputs: ["check"] })).toThrow(/would cycle/);
    expect(() => editStage(original, "notes", { inputs: ["notes"] })).toThrow(/notes/);
    expect(original.stages[0]?.inputs).toBeUndefined();
    expect(original.stages.map((s) => s.id)).toEqual(["notes", "draft", "check"]);
  });

  it("refuses an unknown stage and an unknown upstream", () => {
    expect(() => editStage(flow(), "missing", { name: "x" })).toThrow(/没有阶段 "missing"/);
    expect(() => editStage(flow(), "draft", { inputs: ["ghost"] })).toThrow(/ghost/);
  });

  it("switches a human stage to a script and refuses a script with no command", () => {
    expect(() => editStage(flow(), "notes", { type: "script" })).toThrow(/命令/);
    const next = editStage(flow(), "notes", {
      type: "script",
      run: "node scripts/pack.mjs",
      timeoutSec: 30,
      outputs: [{ type: "text/plain", path: "out.txt" }],
    });
    expect(next.stages[0]).toMatchObject({
      executor: { type: "script", run: "node scripts/pack.mjs", timeoutSec: 30 },
      outputs: [{ type: "text/plain", path: "out.txt" }],
    });
  });

  it("moves a stage after another without adding a dependency", () => {
    const next = editStage(flow(), "notes", { after: "draft" });
    expect(next.stages.map((s) => s.id)).toEqual(["draft", "notes", "check"]);
    expect(next.stages[1]?.inputs).toBeUndefined();
  });

  it("reads a stage patch from the same JSON shape as stage add", () => {
    const { id, patch } = stagePatchFromBody({
      id: " draft ",
      type: "llm",
      name: "润色",
      inputs: ["notes"],
      model: "deepseek/deepseek-chat",
      retries: 1,
      outputs: [{ type: "text/markdown", path: "out.md" }],
    });
    expect(id).toBe("draft");
    expect(patch).toMatchObject({ type: "llm", name: "润色", inputs: ["notes"], model: "deepseek/deepseek-chat", retries: 1 });
    expect(() => stagePatchFromBody({ id: "draft", nope: true })).toThrow(/unknown field/);
    expect(() => stagePatchFromBody({ name: "x" })).toThrow(/缺少阶段 id/);
  });
});

describe("editFlowMeta", () => {
  it("changes the name, description, concurrency and input definitions, and leaves the stages", () => {
    const original = flow();
    const next = editFlowMeta(original, {
      name: "周报",
      description: "说明",
      concurrency: 4,
      inputs: {
        tone: { type: "string", enum: ["calm", "bold"], default: "calm", description: "语气" },
      },
    });
    expect(next.name).toBe("周报");
    expect(next.description).toBe("说明");
    expect(next.concurrency).toBe(4);
    expect(next.inputs).toEqual({
      tone: { type: "string", description: "语气", enum: ["calm", "bold"], default: "calm" },
    });
    expect(next.stages).toBe(original.stages);
    expect(original.name).toBe("t");
    expect(original.inputs?.name).toBeDefined();
  });

  it("clears the description and concurrency, and refuses an empty name or a bad input", () => {
    const next = editFlowMeta({ ...flow(), description: "keep", concurrency: 3 }, { description: null, concurrency: null });
    expect(next.description).toBeUndefined();
    expect(next.concurrency).toBeUndefined();
    expect(() => editFlowMeta(flow(), { name: "  " })).toThrow(/不能是空的/);
    expect(() => editFlowMeta(flow(), { concurrency: 0 })).toThrow(/concurrency/);
    expect(() => editFlowMeta(flow(), { inputs: { "bad name": { type: "string" } } })).toThrow(/bad name/);
    expect(() => editFlowMeta(flow(), { inputs: { tone: { type: "string", enum: ["a"], default: "b" } } })).toThrow(/enum/);
  });

  it("reads only name, description, concurrency and inputs from the body", () => {
    expect(flowMetaFromBody({ name: "周报", concurrency: 3, inputs: { tone: { type: "string", enum: ["a", "b"] } } })).toEqual({
      name: "周报",
      concurrency: 3,
      inputs: { tone: { type: "string", enum: ["a", "b"] } },
    });
    expect(() => flowMetaFromBody({ stages: [] })).toThrow(/unknown field/);
  });
});

describe("isEditablePrompt", () => {
  it("allows a stage's prompt file and prompts/<file>.md, and nothing else", () => {
    const sample = flow();
    expect(isEditablePrompt(sample, "prompts/draft.md")).toBe(true);
    expect(isEditablePrompt(sample, "prompts/extra.md")).toBe(true);
    expect(isEditablePrompt(sample, "notes.md")).toBe(false);
    expect(isEditablePrompt(sample, "../prompts/draft.md")).toBe(false);
    expect(isEditablePrompt(sample, "prompts/../flow.json")).toBe(false);
  });
});
