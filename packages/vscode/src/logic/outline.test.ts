import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openCandidates, parseFlowDocument } from "./outline.js";
import { pathInside } from "./paths.js";
import { repoRoot } from "./locate.js";

describe("parseFlowDocument", () => {
  it("reads flow.json with comments and a stage id that contains a space", () => {
    const text = `{
      // comment
      "name": "Demo",
      "stages": [
        {
          "id": "my stage",
          "name": "Draft",
          "inputs": ["notes"],
          "executor": { "type": "llm", "prompt": "prompts/my draft.md" },
          "outputs": [{ "type": "text/markdown", "path": "report.md" }],
        },
      ],
    }`;
    const outline = parseFlowDocument(text, "flow.json");
    expect(outline.name).toBe("Demo");
    expect(outline.stages).toEqual([
      {
        id: "my stage",
        name: "Draft",
        inputs: ["notes"],
        prompt: "prompts/my draft.md",
        executor: "llm",
        outputs: ["report.md"],
      },
    ]);
  });

  it("reads a flow.md, including the bundled service example", () => {
    const text = [
      "---",
      "format: flowgit",
      'version: "0.1"',
      "---",
      "",
      "# Demo",
      "",
      "## Draft {#draft}",
      "",
      "```flowgit",
      "inputs: [notes]",
      "executor: { type: llm, prompt: prompts/my draft.md }",
      "outputs:",
      "  - {type: text/markdown, path: report.md}",
      "```",
      "",
      "## Notes {#notes}",
      "",
      "```flowgit",
      "executor:",
      "  type: human",
      "outputs:",
      "  - { type: text/markdown, path: notes.md }",
      "```",
      "",
    ].join("\r\n");
    const outline = parseFlowDocument(text, "flow.md");
    expect(outline.name).toBe("Demo");
    expect(outline.stages.map((stage) => stage.id)).toEqual(["draft", "notes"]);
    expect(outline.stages[0]).toMatchObject({ inputs: ["notes"], prompt: "prompts/my draft.md", outputs: ["report.md"] });
    expect(outline.stages[1]).toMatchObject({ executor: "human", outputs: ["notes.md"] });

    const example = path.join(repoRoot(import.meta.url), "examples", "service-echo", "flow.md");
    const parsed = parseFlowDocument(fs.readFileSync(example, "utf8"), "flow.md");
    expect(parsed.stages.map((stage) => ({ id: stage.id, inputs: stage.inputs, outputs: stage.outputs }))).toEqual([
      { id: "note", inputs: [], outputs: ["note.md"] },
      { id: "echo", inputs: ["note"], outputs: ["echo.json"] },
    ]);
  });
});

describe("open targets", () => {
  it("opens the first output, then the prompt, then the flow file", () => {
    expect(openCandidates({ outputs: ["assets/"], prompt: "prompts/a.md" }, "flow.json")[0]).toEqual({ relative: "assets", kind: "output" });
    expect(openCandidates({ outputs: [], prompt: "prompts/my draft.md" }, "flow.json")[0]).toEqual({ relative: "prompts/my draft.md", kind: "prompt" });
    expect(openCandidates({ outputs: [] }, "flow.md")).toEqual([{ relative: "flow.md", kind: "flow" }]);
  });

  it("refuses a path that leaves the flow directory", () => {
    expect(pathInside("/tmp/my flow", "notes.md", path.posix)).toBe("/tmp/my flow/notes.md");
    expect(pathInside("/tmp/my flow", "../secret", path.posix)).toBeUndefined();
    expect(pathInside("C:\\My Flows", "notes.md", path.win32)).toBe(path.win32.join("C:\\My Flows", "notes.md"));
    expect(pathInside("C:\\My Flows", "..\\secret", path.win32)).toBeUndefined();
  });
});
