import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFlow } from "@flowgit/core";
import { afterEach, describe, expect, it } from "vitest";
import { addModelUsage, alignCells, columnHeaders, filesToCopy, parseConcurrency, parseRowRange, rowFolder } from "./batch.js";

describe("rowFolder", () => {
  it("strips characters that cannot be in a file name and keeps the row number", () => {
    expect(rowFolder(1, "a/b:c*d?")).toBe("001-abcd");
    expect(rowFolder(2, "  my report.  ")).toBe("002-my report");
    expect(rowFolder(3, "")).toBe("003-row");
    expect(rowFolder(4, "...")).toBe("004-row");
  });

  it("keeps at most 40 characters", () => {
    expect(rowFolder(12, "猫".repeat(41))).toBe(`012-${"猫".repeat(40)}`);
  });
});

describe("parseConcurrency", () => {
  it("defaults to 1 and allows 1 through 4", () => {
    expect(parseConcurrency(undefined)).toBe(1);
    expect(parseConcurrency("1")).toBe(1);
    expect(parseConcurrency("4")).toBe(4);
  });

  it("rejects 0, fractions, and anything above 4", () => {
    expect(() => parseConcurrency("0")).toThrow(/at most 4|1 到 4/);
    expect(() => parseConcurrency("1.5")).toThrow(/1 到 4/);
    expect(() => parseConcurrency("5")).toThrow(/at most 4/);
  });
});

describe("parseRowRange", () => {
  it("reads an inclusive 1-based range", () => {
    expect(parseRowRange("1-3", 3)).toEqual([1, 3]);
    expect(parseRowRange("2-2", 4)).toEqual([2, 2]);
  });

  it("rejects a bad shape or a range outside the file", () => {
    expect(() => parseRowRange("2", 4)).toThrow(/a-b/);
    expect(() => parseRowRange("3-1", 4)).toThrow(/a <= b/);
    expect(() => parseRowRange("2-5", 4)).toThrow(/4 data row/);
  });
});

describe("columnHeaders and alignCells", () => {
  it("trims headers and rejects an empty or repeated name", () => {
    expect(columnHeaders([" topic ", "tone"])).toEqual(["topic", "tone"]);
    expect(() => columnHeaders(["topic", " "])).toThrow(/column 2 is empty/);
    expect(() => columnHeaders(["topic", "topic"])).toThrow(/duplicate column: topic/);
  });

  it("pads a short row and rejects extra cells", () => {
    expect(alignCells(["狗"], 3, 3)).toEqual(["狗", "", ""]);
    expect(() => alignCells(["a", "b", "c", "d"], 3, 2)).toThrow(/data row 2 has 1 extra/);
  });
});

describe("addModelUsage", () => {
  it("sums input and output tokens and counts each model call", () => {
    const bucket = { input: 0, output: 0, calls: 0 };
    addModelUsage(bucket, { usage: { input_tokens: 3, output_tokens: 4 }, llmCalls: [{}, {}] });
    addModelUsage(bucket, { usage: { prompt_tokens: 1, completion_tokens: 2 } });
    addModelUsage(bucket, undefined);
    expect(bucket).toEqual({ input: 4, output: 6, calls: 3 });
  });
});

describe("filesToCopy", () => {
  let dir = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves out outputs, runs, local inputs, env files, and the batch directory", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-copy-"));
    fs.mkdirSync(path.join(dir, "runs", "draft", "9"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(dir, "batch"), { recursive: true });
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "runs", "draft", "9", "run.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "");
    fs.writeFileSync(path.join(dir, "batch", "keep-me.txt"), "stay");
    fs.writeFileSync(path.join(dir, "batch-note.txt"), "keep");
    fs.writeFileSync(path.join(dir, "note.md"), "SHOULD-NOT-COPY");
    fs.writeFileSync(path.join(dir, "keep.txt"), "yes");
    fs.writeFileSync(path.join(dir, "sub", "ok.txt"), "yes");
    fs.writeFileSync(path.join(dir, ".env"), "SECRET");
    fs.writeFileSync(path.join(dir, ".env.local"), "SECRET");
    fs.writeFileSync(path.join(dir, "flowgit.local.json"), "{}\n");
    fs.writeFileSync(
      path.join(dir, "flow.json"),
      JSON.stringify({
        format: "flowgit",
        version: "0.1",
        name: "copy",
        stages: [{ id: "write", name: "write", executor: { type: "human" }, outputs: [{ type: "text/plain", path: "note.md" }] }],
      }),
    );

    const files = filesToCopy(loadFlow(dir), "batch");
    expect(files).toEqual(expect.arrayContaining(["flow.json", "keep.txt", "sub/ok.txt", "batch-note.txt"]));
    for (const excluded of ["note.md", "batch/keep-me.txt", ".env", ".env.local", "flowgit.local.json"]) {
      expect(files, excluded).not.toContain(excluded);
    }
    expect(files.some((rel) => rel.startsWith("runs/") || rel.startsWith("node_modules/"))).toBe(false);
  });
});
