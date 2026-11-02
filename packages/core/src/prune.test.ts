import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  diffRuns,
  formatByteSize,
  listRuns,
  loadFlow,
  nextRunNumber,
  planPrune,
  prune,
  restoreStage,
  runStage,
  runsDirBytes,
  runsPruneHint,
  writeFlowFile,
  type Flow,
  type RunRecord,
} from "./index.js";

const flow: Flow = {
  format: "flowgit",
  version: "0.1",
  name: "prune",
  stages: [
    {
      id: "draft",
      name: "草稿",
      executor: { type: "script", run: "node write.cjs" },
      outputs: [{ type: "text/plain", path: "note.txt" }],
    },
    {
      id: "other",
      name: "其他",
      executor: { type: "script", run: "node other.cjs" },
      outputs: [{ type: "text/plain", path: "other.txt" }],
    },
  ],
};

let dir: string;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function writeRun(stage: string, n: number, opts: { status: "ok" | "error"; executor: RunRecord["executor"]; content: string; output: string }): void {
  const base = path.join(dir, "runs", stage, String(n));
  fs.mkdirSync(path.join(base, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(base, "pad.bin"), Buffer.alloc(128, n));
  if (opts.status === "ok") fs.writeFileSync(path.join(base, "outputs", opts.output), opts.content);
  const record: RunRecord = {
    stage,
    n,
    status: opts.status,
    executor: opts.executor,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    inputHash: "x",
    inputs: [],
    flowInputs: {},
    outputs:
      opts.status === "ok"
        ? [{ path: opts.output, type: "text/plain", sha256: sha(opts.content), bytes: Buffer.byteLength(opts.content), isDir: false }]
        : [],
    ...(opts.status === "error" ? { error: "failed" } : {}),
  };
  fs.writeFileSync(path.join(base, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
}

/** draft: v1 matches the current file, v2 is manual, v4 is the newest success, v7 and v8 are the newest two. */
function seed(): void {
  const draft: Array<[number, "ok" | "error", RunRecord["executor"], string]> = [
    [1, "ok", "script", "old"],
    [2, "ok", "manual", "hand"],
    [3, "ok", "script", "mid"],
    [4, "ok", "script", "latest-good"],
    [5, "error", "script", ""],
    [6, "error", "script", ""],
    [7, "error", "script", ""],
    [8, "error", "script", ""],
  ];
  for (const [n, status, executor, content] of draft) writeRun("draft", n, { status, executor, content, output: "note.txt" });
  for (let n = 1; n <= 7; n += 1) writeRun("other", n, { status: "ok", executor: "script", content: `other-${n}`, output: "other.txt" });
  fs.writeFileSync(path.join(dir, "note.txt"), "old");
  fs.writeFileSync(path.join(dir, "other.txt"), "other-7");
}

function versionDirs(stage: string): string[] {
  const base = path.join(dir, "runs", stage);
  return fs
    .readdirSync(base)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-prune-"));
  seed();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("planPrune", () => {
  it("keeps the newest versions, every manual version, the current files, and the newest success", () => {
    const plan = planPrune(dir, flow, { keep: 2 });
    expect(plan.delete.map((item) => `${item.stage}#${item.n}`)).toEqual([
      "draft#3",
      "draft#5",
      "draft#6",
      "other#1",
      "other#2",
      "other#3",
      "other#4",
      "other#5",
    ]);
    expect(plan.bytes).toBe(plan.delete.reduce((sum, item) => sum + item.bytes, 0));
    expect(plan.bytes).toBeGreaterThan(0);
    expect(versionDirs("draft")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

    const keepOne = planPrune(dir, flow, { keep: 1 });
    expect(keepOne.delete.filter((item) => item.stage === "draft").map((item) => item.n)).toEqual([3, 5, 6, 7]);
  });

  it("keeps only the newest version whose outputs match the current files", () => {
    writeRun("draft", 3, { status: "ok", executor: "script", content: "old", output: "note.txt" });
    const gone = planPrune(dir, flow, { keep: 2, stage: "draft" }).delete.map((item) => item.n);
    expect(gone).toEqual([1, 5, 6]);
  });

  it("does not treat a missing output as a match", () => {
    fs.rmSync(path.join(dir, "note.txt"));
    const gone = planPrune(dir, flow, { keep: 1, stage: "draft" }).delete.map((item) => item.n);
    expect(gone).toContain(1);
    expect(gone).not.toContain(2);
    expect(gone).not.toContain(4);
    expect(gone).not.toContain(8);
  });

  it("defaults to keeping 5, and --stage leaves other stages alone", () => {
    const planned = planPrune(dir, flow);
    expect(planned.delete.filter((item) => item.stage === "draft").map((item) => item.n)).toEqual([3]);
    expect(planned.delete.filter((item) => item.stage === "other").map((item) => item.n)).toEqual([1, 2]);

    const one = planPrune(dir, flow, { stage: "other", keep: 2 });
    expect(one.delete.map((item) => item.stage)).toEqual(["other", "other", "other", "other", "other"]);
    expect(one.delete.map((item) => item.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a keep below 1 and an unknown stage", () => {
    expect(() => planPrune(dir, flow, { keep: 0 })).toThrow(/至少是 1/);
    expect(() => planPrune(dir, flow, { keep: 0 })).toThrow(/at least 1/);
    expect(() => planPrune(dir, flow, { keep: 1.5 })).toThrow(/at least 1/);
    expect(() => planPrune(dir, flow, { stage: "missing" })).toThrow(/Unknown stage "missing"/);
  });

  it("deletes nothing when every version is inside --keep", () => {
    fs.rmSync(path.join(dir, "runs"), { recursive: true, force: true });
    writeRun("draft", 1, { status: "ok", executor: "script", content: "only", output: "note.txt" });
    fs.writeFileSync(path.join(dir, "note.txt"), "only");
    expect(planPrune(dir, flow, { stage: "draft" }).delete).toEqual([]);
  });
});

describe("prune", () => {
  it("removes whole version folders and never reuses a version number", async () => {
    fs.mkdirSync(path.join(dir, "runs", "draft", "9"));
    fs.writeFileSync(path.join(dir, "runs", "draft", "9", "junk"), "keep this number");
    writeFlowFile(path.join(dir, "flow.json"), flow);
    fs.writeFileSync(path.join(dir, "write.cjs"), 'const fs = require("node:fs"); fs.writeFileSync("note.txt", "ran\\n");\n');
    fs.writeFileSync(path.join(dir, "note.txt"), "latest-good");

    const plan = prune(dir, flow, { keep: 2, stage: "draft" });
    expect(plan.delete.map((item) => item.n)).toEqual([1, 3, 5, 6]);
    expect(versionDirs("draft")).toEqual(["2", "4", "7", "8", "9"]);
    expect(versionDirs("other")).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(fs.existsSync(path.join(dir, "runs", "draft", "9", "junk"))).toBe(true);
    expect(nextRunNumber(dir, "draft")).toBe(10);
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("latest-good");

    const again = prune(dir, flow, { keep: 2, stage: "draft" });
    expect(again.delete).toEqual([]);
    expect(nextRunNumber(dir, "draft")).toBe(10);

    const loaded = loadFlow(dir);
    const run = await runStage(loaded, "draft");
    expect(run.n).toBe(10);
    expect(versionDirs("draft")).toEqual(["2", "4", "7", "8", "9", "10"]);
    expect(nextRunNumber(dir, "draft")).toBe(11);
  });

  it("still diffs, restores, and lists history when version numbers have gaps", () => {
    prune(dir, flow, { keep: 2, stage: "draft" });
    expect(listRuns(dir, "draft").map((run) => run.n)).toEqual([1, 2, 4, 7, 8]);

    const diff = diffRuns(dir, flow, "draft", 1, 4);
    const note = diff.outputs.find((output) => output.path === "note.txt");
    expect(note).toMatchObject({ kind: "text", same: false });
    if (note?.kind !== "text") throw new Error("expected a text diff");
    expect(note.diff).toContain("old");
    expect(note.diff).toContain("latest-good");
    expect(() => diffRuns(dir, flow, "draft", 1, 3)).toThrow(/没有 v3/);
    expect(() => diffRuns(dir, flow, "draft", 1, 3)).toThrow(/has no run #3/);

    const restored = restoreStage({ dir, file: path.join(dir, "flow.json"), flow }, "draft", 4);
    expect(restored.run.n).toBe(4);
    expect(restored.kept).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("latest-good");
    expect(listRuns(dir, "draft").map((run) => run.n)).toEqual([1, 2, 4, 7, 8]);
  });
});

describe("runs prune hint", () => {
  it("formats KB, MB and GB, and speaks up only above 500 MB", () => {
    expect(formatByteSize(0)).toBe("0.0 KB");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatByteSize(Math.round(1.2 * 1024 ** 3))).toBe("1.2 GB");

    const alone = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-prune-bytes-"));
    fs.mkdirSync(path.join(alone, "runs", "draft", "1"), { recursive: true });
    fs.writeFileSync(path.join(alone, "runs", "draft", "1", "pad.bin"), Buffer.alloc(2048));
    fs.writeFileSync(path.join(alone, "outside.bin"), Buffer.alloc(9999));
    expect(runsDirBytes(alone)).toBe(2048);
    fs.rmSync(alone, { recursive: true, force: true });

    const line = "runs/ 占用 1.2 GB，可以用 flowgit prune 清理 / runs/ uses 1.2 GB; clean up with flowgit prune";
    expect(runsPruneHint(500 * 1024 * 1024)).toBeUndefined();
    expect(runsPruneHint(500 * 1024 * 1024 + 1)).toBe(
      "runs/ 占用 500.0 MB，可以用 flowgit prune 清理 / runs/ uses 500.0 MB; clean up with flowgit prune",
    );
    expect(runsPruneHint(Math.round(1.2 * 1024 ** 3))).toBe(line);
    expect(runsPruneHint(runsDirBytes(dir))).toBeUndefined();
  });
});
