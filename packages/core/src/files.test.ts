import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flowFiles, loadFlow, type Flow } from "./index.js";

const dirs: string[] = [];

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("flowFiles", () => {
  it("leaves out runs, local config and .env, and outputs only when asked", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-files-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "files",
      stages: [
        { id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "notes.md" }] },
        { id: "assets", name: "Assets", executor: { type: "human" }, outputs: [{ type: "dir", path: "assets/" }] },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "prompts/draft.md", "prompt");
    write(dir, "README.md", "hi");
    write(dir, "notes.md", "the output");
    write(dir, "assets/a.png", "img");
    write(dir, "runs/notes/1/run.json", "{}");
    write(dir, "flowgit.local.json", "{}");
    write(dir, ".env", "SECRET=1");
    write(dir, ".env.local", "x");
    write(dir, "node_modules/pkg/index.js", "x");
    write(dir, ".git/config", "x");

    const loaded = loadFlow(dir);
    const without = flowFiles(loaded, { withOutputs: false });
    expect(without).toEqual(expect.arrayContaining(["README.md", "flow.json", "prompts/draft.md"]));
    expect(without).toHaveLength(3);
    for (const skipped of ["notes.md", "assets/a.png", ".env", ".env.local", "flowgit.local.json"]) {
      expect(without, skipped).not.toContain(skipped);
    }
    expect(without.some((f) => f.startsWith("runs/") || f.startsWith("node_modules/") || f.startsWith(".git/"))).toBe(false);

    const withOutputs = flowFiles(loaded, { withOutputs: true });
    expect(withOutputs).toEqual(expect.arrayContaining([...without, "notes.md", "assets/a.png"]));
    expect(withOutputs).toHaveLength(without.length + 2);
    expect(withOutputs.some((f) => f.startsWith("runs/") || f === ".env" || f === "flowgit.local.json")).toBe(false);
  });
});
