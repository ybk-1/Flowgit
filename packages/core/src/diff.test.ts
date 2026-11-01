import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffRuns, type Flow } from "./index.js";

const flow: Flow = {
  format: "flowgit",
  version: "0.1",
  name: "diff",
  stages: [
    {
      id: "make",
      name: "Make",
      executor: { type: "script", run: "true" },
      outputs: [
        { type: "text/markdown", path: "notes.md" },
        { type: "application/json", path: "data.json" },
        { type: "dir", path: "assets/" },
        { type: "video/mp4", path: "clip.mp4" },
      ],
    },
  ],
};

let dir: string;

function writeAt(root: string, rel: string, content: string | Buffer): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** A recorded version: runs/<stage>/<n>/outputs/<files>. */
function snapshot(n: number, files: Record<string, string | Buffer>): void {
  const root = path.join(dir, "runs", "make", String(n), "outputs");
  for (const [rel, content] of Object.entries(files)) writeAt(root, rel, content);
  fs.writeFileSync(
    path.join(dir, "runs", "make", String(n), "run.json"),
    `${JSON.stringify({ stage: "make", n, status: "ok" })}\n`,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-diff-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("diffRuns", () => {
  it("line-diffs text and JSON, lists directory changes, and compares binaries by sha256", () => {
    snapshot(1, {
      "notes.md": "# Hello\nkeep this\nold line\n",
      "data.json": '{\n  "title": "cats",\n  "n": 1\n}\n',
      "assets/keep.txt": "same",
      "assets/gone.txt": "bye",
      "assets/edit.txt": "v1",
      "assets/sub/a.txt": "nested",
      "clip.mp4": Buffer.from([0, 1, 2, 3]),
    });
    snapshot(2, {
      "notes.md": "# Hello\nkeep this\nnew line\n",
      "data.json": '{\n  "title": "dogs",\n  "n": 1\n}\n',
      "assets/keep.txt": "same",
      "assets/edit.txt": "v2",
      "assets/sub/a.txt": "nested",
      "assets/sub/b.txt": "added",
      "assets/fresh.txt": "hi",
      "clip.mp4": Buffer.from([0, 1, 2, 9]),
    });

    const diff = diffRuns(dir, flow, "make", 1, 2);
    expect(diff).toMatchObject({ stage: "make", a: 1, b: 2 });

    const notes = diff.outputs.find((o) => o.path === "notes.md");
    expect(notes).toMatchObject({ kind: "text", type: "text/markdown", same: false });
    if (notes?.kind !== "text") throw new Error("expected a text diff");
    expect(notes.diff).toMatch(/^--- /m);
    expect(notes.diff).toMatch(/^\+\+\+ /m);
    expect(notes.diff).toMatch(/^-old line$/m);
    expect(notes.diff).toMatch(/^\+new line$/m);
    expect(notes.diff).not.toMatch(/^-keep this$/m);

    const json = diff.outputs.find((o) => o.path === "data.json");
    expect(json).toMatchObject({ kind: "text", type: "application/json", same: false });
    if (json?.kind !== "text") throw new Error("expected a text diff");
    expect(json.diff).toMatch(/^- {2}"title": "cats",$/m);
    expect(json.diff).toMatch(/^\+ {2}"title": "dogs",$/m);

    const assets = diff.outputs.find((o) => o.path === "assets");
    expect(assets).toMatchObject({
      kind: "dir",
      same: false,
      added: ["fresh.txt", "sub/b.txt"],
      removed: ["gone.txt"],
      changed: ["edit.txt"],
    });

    const clip = diff.outputs.find((o) => o.path === "clip.mp4");
    expect(clip).toEqual({ kind: "binary", path: "clip.mp4", type: "video/mp4", same: false });
  });

  it("reports identical text, directory, and binary outputs as the same", () => {
    const files = {
      "notes.md": "# same\n",
      "data.json": "{}\n",
      "assets/keep.txt": "same",
      "clip.mp4": Buffer.from([7, 7, 7]),
    };
    snapshot(1, files);
    snapshot(2, files);
    const diff = diffRuns(dir, flow, "make", 1, 2);
    expect(diff.outputs.map((o) => ({ path: o.path, kind: o.kind, same: o.same }))).toEqual([
      { path: "notes.md", kind: "text", same: true },
      { path: "data.json", kind: "text", same: true },
      { path: "assets", kind: "dir", same: true },
      { path: "clip.mp4", kind: "binary", same: true },
    ]);
    const notes = diff.outputs[0];
    if (notes?.kind !== "text") throw new Error("expected text");
    expect(notes.diff).toBe("");
    const assets = diff.outputs[2];
    if (assets?.kind !== "dir") throw new Error("expected dir");
    expect(assets.added).toEqual([]);
    expect(assets.removed).toEqual([]);
    expect(assets.changed).toEqual([]);
  });

  it("compares a version with the current files when b is omitted", () => {
    snapshot(1, {
      "notes.md": "version one\n",
      "data.json": "{\"n\":1}\n",
      "assets/only-old.txt": "x",
      "clip.mp4": Buffer.from([1]),
    });
    writeAt(dir, "notes.md", "current text\n");
    writeAt(dir, "data.json", "{\"n\":2}\n");
    writeAt(dir, "assets/only-new.txt", "y");
    writeAt(dir, "clip.mp4", Buffer.from([1]));

    const diff = diffRuns(dir, flow, "make", 1);
    expect(diff.b).toBeNull();
    const notes = diff.outputs.find((o) => o.path === "notes.md");
    if (notes?.kind !== "text") throw new Error("expected text");
    expect(notes.same).toBe(false);
    expect(notes.diff).toMatch(/^-version one$/m);
    expect(notes.diff).toMatch(/^\+current text$/m);
    const json = diff.outputs.find((o) => o.path === "data.json");
    if (json?.kind !== "text") throw new Error("expected json text");
    expect(json.diff).toContain('"n":2');
    const assets = diff.outputs.find((o) => o.path === "assets");
    expect(assets).toMatchObject({ kind: "dir", added: ["only-new.txt"], removed: ["only-old.txt"], changed: [] });
    expect(diff.outputs.find((o) => o.path === "clip.mp4")).toMatchObject({ kind: "binary", same: true });
  });

  it("rejects a missing version with a bilingual error", () => {
    snapshot(1, { "notes.md": "a\n", "data.json": "{}\n", "clip.mp4": Buffer.from([1]) });
    expect(() => diffRuns(dir, flow, "make", 1, 4)).toThrow(/没有 v4.*has no run #4/s);
    expect(() => diffRuns(dir, flow, "make", 9)).toThrow(/没有 v9.*has no run #9/s);
    expect(() => diffRuns(dir, flow, "missing", 1)).toThrow(/Unknown stage "missing"/);
  });
});
