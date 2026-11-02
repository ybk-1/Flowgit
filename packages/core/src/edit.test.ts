import { describe, expect, it } from "vitest";
import { addStage, removeStage, type Flow } from "./index.js";

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
      executor: { type: "agent", agent: "cursor", prompt: "prompts/page.md" },
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
