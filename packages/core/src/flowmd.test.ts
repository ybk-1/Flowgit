import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  findFlowFile,
  loadFlow,
  parseFlowMd,
  readFlowFile,
  renderFlowMd,
  validateFlow,
  writeFlowFile,
  type Flow,
} from "./index.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every flow (flow.json or flow.md) in examples/ and the bundled templates. */
function allFlows(): string[] {
  const roots = [path.join(repoDir, "examples"), path.join(repoDir, "packages/cli/templates")];
  return roots.flatMap((root) =>
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name))
      .filter((dir) => findFlowFile(dir)),
  );
}

const WEEKLY = `---
format: flowgit
version: "0.1"
id: weekly-report
language: zh
tags: [starter, writing]
inputs:
  name:
    type: string
    required: true
---

# 周报

把一周随手记下的事情整理成周报。

第二段说明。

## 随手记 {#notes}

把这周做的事随手写下来。

\`\`\`flowgit
executor:
  type: human
  instructions: 写进 notes.md
outputs:
  - { type: text/markdown, path: notes.md }
\`\`\`

## 周报草稿 {#draft}

\`\`\`flowgit
inputs: [notes]
executor: { type: llm, prompt: prompts/draft.md, effort: low }
outputs:
  - { type: text/markdown, path: report.md }
\`\`\`

下面这段代码不是配置，只是说明的一部分：

\`\`\`js
// ## not a heading
\`\`\`
`;

describe("parseFlowMd", () => {
  it("reads frontmatter, title, prose and one flowgit block per stage", () => {
    const flow = parseFlowMd(WEEKLY) as unknown as Flow;
    expect(flow.name).toBe("周报");
    expect(flow.description).toBe("把一周随手记下的事情整理成周报。\n\n第二段说明。");
    expect(flow.version).toBe("0.1");
    expect(flow.tags).toEqual(["starter", "writing"]);
    expect(flow.stages.map((s) => s.id)).toEqual(["notes", "draft"]);
    expect(flow.stages[0]).toEqual({
      id: "notes",
      name: "随手记",
      description: "把这周做的事随手写下来。",
      executor: { type: "human", instructions: "写进 notes.md" },
      outputs: [{ type: "text/markdown", path: "notes.md" }],
    });
    expect(flow.stages[1]!.inputs).toEqual(["notes"]);
    expect(flow.stages[1]!.description).toBe("下面这段代码不是配置，只是说明的一部分：\n\n```js\n// ## not a heading\n```");
    expect(validateFlow(flow).filter((i) => i.level === "error")).toEqual([]);
  });

  it("accepts Windows line endings and a BOM", () => {
    const flow = parseFlowMd(`﻿${WEEKLY.replace(/\n/g, "\r\n")}`) as unknown as Flow;
    expect(flow.stages).toHaveLength(2);
    expect(flow.stages[0]!.executor).toEqual({ type: "human", instructions: "写进 notes.md" });
  });

  it("lets every field live in the YAML instead", () => {
    const flow = parseFlowMd(`---
format: flowgit
version: "0.1"
name: 只用 YAML
---

## {#a}

\`\`\`flowgit
name: 第一步
description: 说明
executor: { type: human }
outputs: [{ type: text/plain, path: a.txt }]
\`\`\`
`) as unknown as Flow;
    expect(flow.name).toBe("只用 YAML");
    expect(flow.stages[0]).toMatchObject({ id: "a", name: "第一步", description: "说明" });
  });

  it.each([
    ["no frontmatter", "# 名字\n", /YAML frontmatter/],
    ["unclosed frontmatter", "---\nformat: flowgit\n", /closing ---/],
    ["stages in frontmatter", "---\nstages: []\n---\n", /not in the frontmatter/],
    ["bad YAML", "---\nformat: [\n---\n", /line 2|line 3/],
    ["name twice", "---\nname: a\n---\n# b\n", /"name" twice/],
    ["no flowgit block", "---\nformat: flowgit\n---\n## A {#a}\n\n说明\n", /needs a ```flowgit block/],
    ["two flowgit blocks", "---\nformat: flowgit\n---\n## A {#a}\n```flowgit\n{}\n```\n```flowgit\n{}\n```\n", /two flowgit blocks/],
    ["id twice", "---\nformat: flowgit\n---\n## A {#a}\n```flowgit\nid: b\n```\n", /"id" twice/],
    ["second title", "---\nformat: flowgit\n---\n# A\n## S {#s}\n```flowgit\n{}\n```\n# B\n", /only one "# Flow name"/],
    ["unclosed fence", "---\nformat: flowgit\n---\n## A {#a}\n```flowgit\n{}\n", /never closed/],
  ])("rejects %s", (_label, text, message) => {
    expect(() => parseFlowMd(text)).toThrow(message);
  });

  it("reports the line of a YAML error inside a stage", () => {
    const text = "---\nformat: flowgit\n---\n\n## A {#a}\n\n```flowgit\nexecutor: [\n```\n";
    expect(() => parseFlowMd(text)).toThrow(/第 \d+ 行 \/ line \d+/);
  });
});

describe("renderFlowMd", () => {
  for (const dir of allFlows()) {
    it(`round-trips ${path.relative(repoDir, dir)}`, () => {
      const flow = loadFlow(dir).flow;
      const md = renderFlowMd(flow);
      expect(parseFlowMd(md)).toEqual(flow);
      expect(renderFlowMd(parseFlowMd(md) as unknown as Flow)).toBe(md);
    });
  }

  it("moves text that would not read back as a heading or prose into the YAML", () => {
    const flow = {
      format: "flowgit",
      version: "0.1",
      name: "C#",
      description: "## 看起来像标题\n```",
      stages: [
        {
          id: "a",
          name: "名字 {#x}",
          description: " 前面有空格",
          executor: { type: "human" },
          outputs: [{ type: "text/plain", path: "a.txt" }],
        },
      ],
    } as unknown as Flow;
    const md = renderFlowMd(flow);
    expect(md).not.toContain("# C#");
    expect(parseFlowMd(md)).toEqual(flow);
  });
});

describe("flow.md on disk", () => {
  let dir = "";
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads like flow.json, and both at once is an error", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-md-"));
    fs.writeFileSync(path.join(dir, "flow.md"), WEEKLY);
    fs.mkdirSync(path.join(dir, "prompts"));
    fs.writeFileSync(path.join(dir, "prompts/draft.md"), "写周报");
    const loaded = loadFlow(dir);
    expect(loaded.file).toBe(path.join(dir, "flow.md"));
    expect(loaded.flow.stages).toHaveLength(2);

    writeFlowFile(path.join(dir, "flow.json"), loaded.flow);
    expect(() => loadFlow(dir)).toThrow(/both flow.json and flow.md/);
    expect(readFlowFile(path.join(dir, "flow.json"))).toEqual(loaded.flow);
  });

  it("keeps using flow.json when the flow.md next to it is not a flow (an old graph --out flow.md)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-md-"));
    const flow = parseFlowMd(WEEKLY) as unknown as Flow;
    flow.stages = flow.stages.slice(0, 1);
    writeFlowFile(path.join(dir, "flow.json"), flow);
    fs.writeFileSync(path.join(dir, "flow.md"), "```mermaid\nflowchart LR\n```\n");
    expect(findFlowFile(dir)).toBe(path.join(dir, "flow.json"));
  });

  it("does not allow a stage output named like the flow file", () => {
    const flow = parseFlowMd(WEEKLY) as unknown as Flow;
    flow.stages[0]!.outputs = [{ type: "text/markdown", path: "flow.md" }];
    expect(validateFlow(flow).map((i) => i.message).join("\n")).toMatch(/that name is the flow file/);
  });
});
