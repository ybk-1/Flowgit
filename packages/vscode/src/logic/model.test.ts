import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_INSTALL_HINT } from "./cli.js";
import { loadFlowViews } from "./model.js";

describe("loadFlowViews", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it("asks the CLI with separate arguments when the flow path and stage id contain spaces", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-vscode-"));
    roots.push(root);
    const flowDir = path.join(root, "my flow");
    fs.mkdirSync(path.join(flowDir, "prompts"), { recursive: true });
    fs.writeFileSync(
      path.join(flowDir, "flow.json"),
      JSON.stringify({
        name: "Demo",
        stages: [
          { id: "draft", name: "Draft", inputs: ["notes"], executor: { type: "llm", prompt: "prompts/my draft.md" }, outputs: [{ type: "text/markdown", path: "report.md" }] },
          { id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "notes.md" }] },
        ],
      }),
    );
    const calls: { command: string; args: string[]; cwd: string }[] = [];
    const cli = path.join(root, "My Programs", "flowgit");
    const views = await loadFlowViews({
      roots: [root],
      cli: { ok: true, path: cli, source: "setting" },
      run: async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return {
          code: 0,
          stdout: JSON.stringify({
            flow: { name: "Demo", dir: flowDir },
            missingInputs: ["topic"],
            stages: [
              { id: "draft", name: "Draft", executor: "llm", state: "stale", runs: 1, latest: { n: 3, status: "ok" }, current: 3, missingUpstream: [], outputs: [{ path: "report.md", type: "text/markdown" }] },
              { id: "notes", name: "Notes", executor: "human", state: "ok", runs: 1, latest: { n: 1, status: "ok" }, current: 1, missingUpstream: [], outputs: [{ path: "notes.md", type: "text/markdown" }] },
            ],
          }),
          stderr: "",
        };
      },
    });
    expect(calls).toEqual([{ command: cli, args: ["-C", flowDir, "status", "--json"], cwd: flowDir }]);
    expect(views).toHaveLength(1);
    expect(views[0]?.missingInputs).toEqual(["topic"]);
    expect(views[0]?.stages.map((stage) => stage.id)).toEqual(["notes", "draft"]);
    expect(views[0]?.stages.find((stage) => stage.id === "draft")).toMatchObject({ state: "stale", latest: 3, prompt: "prompts/my draft.md" });
  });

  it("does not run the CLI when it is missing, and still lists stages", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-vscode-"));
    roots.push(root);
    const flowDir = path.join(root, "my flow");
    fs.mkdirSync(flowDir, { recursive: true });
    fs.writeFileSync(
      path.join(flowDir, "flow.json"),
      JSON.stringify({
        stages: [{ id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ path: "notes.md" }] }],
      }),
    );
    let called = false;
    const views = await loadFlowViews({
      roots: [root],
      cli: { ok: false, reason: "not-found", hint: CLI_INSTALL_HINT },
      run: async () => {
        called = true;
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    expect(called).toBe(false);
    expect(views[0]?.problem).toBe("cli-missing");
    expect(views[0]?.stages.map((stage) => stage.id)).toEqual(["notes"]);
  });
});
