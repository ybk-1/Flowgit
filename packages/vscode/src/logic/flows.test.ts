import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findFlowsOnDisk, looksLikeFlowMd, pickFlowFile } from "./flows.js";

describe("pickFlowFile", () => {
  it("keeps a lone flow.json or flow.md", () => {
    expect(pickFlowFile(["README.md", "flow.json"])).toBe("flow.json");
    expect(pickFlowFile(["flow.md"])).toBe("flow.md");
    expect(pickFlowFile(["README.md"])).toBeUndefined();
  });

  it("ignores a flow.md that is not a flow when flow.json is there", () => {
    expect(looksLikeFlowMd("# graph\n")).toBe(false);
    expect(pickFlowFile(["flow.json", "flow.md"], "# graph\n")).toBe("flow.json");
    expect(looksLikeFlowMd("---\r\nformat: flowgit\r\n")).toBe(true);
  });

  it("reports both real flow files", () => {
    expect(pickFlowFile(["flow.md", "flow.json"], "---\nformat: flowgit\n")).toBe("both");
  });
});

describe("findFlowsOnDisk", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it("skips node_modules, .git, runs and .flowgit, including a directory name with spaces", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-vscode-"));
    roots.push(root);
    const flowDir = path.join(root, "my flow");
    fs.mkdirSync(flowDir, { recursive: true });
    fs.writeFileSync(path.join(flowDir, "flow.json"), "{}\n");
    for (const skipped of ["node_modules", ".git", ".flowgit"]) {
      fs.mkdirSync(path.join(root, skipped, "inner"), { recursive: true });
      fs.writeFileSync(path.join(root, skipped, "inner", "flow.json"), "{}\n");
    }
    fs.mkdirSync(path.join(flowDir, "runs", "draft", "1"), { recursive: true });
    fs.writeFileSync(path.join(flowDir, "runs", "draft", "1", "flow.json"), "{}\n");
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "nested", "flow.md"), "---\r\nformat: flowgit\r\n---\r\n");

    const found = findFlowsOnDisk([root]);
    const rel = found.map((flow) => path.relative(root, flow.file ?? flow.dir));
    expect(rel).toEqual([path.join("my flow", "flow.json"), path.join("nested", "flow.md")]);
    expect(found.every((flow) => !flow.conflict)).toBe(true);
  });
});
