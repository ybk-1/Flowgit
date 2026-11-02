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

  it("leaves out a sub-flow's outputs and runs too, but keeps its flow, prompts and scripts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-files-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "parent",
      stages: [
        {
          id: "make",
          name: "Make",
          executor: { type: "workflow", engine: "flowgit", file: "subflows/brief/flow.json", params: { copy: { "brief.md": "brief.md" } } },
          outputs: [{ type: "text/markdown", path: "brief.md" }],
        },
      ],
    };
    const sub: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "brief",
      stages: [
        { id: "draft", name: "Draft", executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ type: "text/markdown", path: "brief.md" }] },
        { id: "check", name: "Check", executor: { type: "script", run: "node scripts/check.mjs" }, outputs: [{ type: "text/plain", path: "check.txt" }] },
      ],
    };
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "brief.md", "copied back");
    write(dir, "subflows/brief/flow.json", JSON.stringify(sub));
    write(dir, "subflows/brief/prompts/draft.md", "prompt");
    write(dir, "subflows/brief/scripts/check.mjs", "// check");
    write(dir, "subflows/brief/brief.md", "the brief");
    write(dir, "subflows/brief/check.txt", "ok");
    write(dir, "subflows/brief/runs/draft/1/run.json", "{}");
    write(dir, "subflows/brief/flowgit.local.json", "{}");

    const loaded = loadFlow(dir);
    const without = flowFiles(loaded, { withOutputs: false });
    expect(without).toEqual(["flow.json", "subflows/brief/flow.json", "subflows/brief/prompts/draft.md", "subflows/brief/scripts/check.mjs"]);

    const withOutputs = flowFiles(loaded, { withOutputs: true });
    expect(withOutputs).toEqual(expect.arrayContaining([...without, "brief.md", "subflows/brief/brief.md", "subflows/brief/check.txt"]));
    expect(withOutputs).toHaveLength(without.length + 3);
  });
});
