import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flowLog, loadFlow, type Flow } from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeRun(dir: string, stage: string, n: number, record: Record<string, unknown>): void {
  const file = path.join(dir, "runs", stage, String(n), "run.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record));
}

describe("flowLog (flowgit log with no stage)", () => {
  it("sums token usage from every run.json, per stage and overall", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-usage-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "usage",
      stages: [
        { id: "notes", name: "笔记", executor: { type: "human" }, outputs: [{ type: "text/plain", path: "notes.md" }] },
        {
          id: "draft",
          name: "草稿",
          inputs: ["notes"],
          executor: { type: "script", run: "true" },
          outputs: [{ type: "text/plain", path: "draft.txt" }],
        },
      ],
    };
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow));
    writeRun(dir, "notes", 1, {
      stage: "notes",
      n: 1,
      status: "ok",
      executor: "llm",
      startedAt: "2026-11-01T09:00:00.000Z",
      finishedAt: "2026-11-01T10:00:00.000Z",
      params: { usage: { input_tokens: 10, output_tokens: 4 } },
    });
    writeRun(dir, "notes", 2, {
      stage: "notes",
      n: 2,
      status: "ok",
      executor: "manual",
      startedAt: "2026-11-03T09:00:00.000Z",
      finishedAt: "2026-11-03T10:00:00.000Z",
    });
    writeRun(dir, "draft", 1, {
      stage: "draft",
      n: 1,
      status: "ok",
      executor: "llm",
      startedAt: "2026-11-02T09:00:00.000Z",
      finishedAt: "2026-11-02T10:00:00.000Z",
      params: { usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
    });

    const logged = flowLog(loadFlow(dir));
    expect(logged.runs.map((run) => `${run.stage}#${run.n}`)).toEqual(["notes#2", "draft#1", "notes#1"]);
    expect(logged.stages).toEqual([
      { id: "notes", name: "笔记", input: 10, output: 4, calls: 1 },
      { id: "draft", name: "草稿", input: 7, output: 3, calls: 1 },
    ]);
    expect(logged.total).toEqual({ input: 17, output: 7, calls: 2 });
  });

  it("counts a schema repair as two model calls, also on a failed run", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-usage-repair-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "usage",
      stages: [{ id: "make", name: "Make", executor: { type: "llm", prompt: "make.md" }, outputs: [{ type: "application/json", path: "out.json" }] }],
    };
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow));
    fs.writeFileSync(path.join(dir, "make.md"), "Write JSON.");
    const calls = [
      { input_tokens: 10, output_tokens: 5 },
      { input_tokens: 3, output_tokens: 2 },
    ];
    const usage = { input_tokens: 13, output_tokens: 7 };
    writeRun(dir, "make", 1, { stage: "make", n: 1, status: "error", executor: "llm", startedAt: "2026-11-02T09:00:00.000Z", finishedAt: "2026-11-02T09:01:00.000Z", params: { usage, llmCalls: calls } });
    writeRun(dir, "make", 2, { stage: "make", n: 2, status: "ok", executor: "llm", startedAt: "2026-11-02T10:00:00.000Z", finishedAt: "2026-11-02T10:01:00.000Z", params: { usage, llmCalls: calls } });
    expect(flowLog(loadFlow(dir)).total).toEqual({ input: 26, output: 14, calls: 4 });
  });
});
