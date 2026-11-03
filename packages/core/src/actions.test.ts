import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flowActions, type Flow } from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(dir: string, rel: string, value: unknown): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value));
}

describe("flowActions", () => {
  it("lists commands, agents and service calls, with the env vars a call sends", () => {
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "actions",
      stages: [
        { id: "draft", name: "draft", executor: { type: "llm", prompt: "p.md" }, outputs: [{ type: "text/markdown", path: "d.md" }] },
        { id: "render", name: "render", executor: { type: "script", run: "node scripts/render.mjs" }, outputs: [{ type: "video/mp4", path: "f.mp4" }] },
        { id: "build", name: "build", executor: { type: "agent", agent: "claude-code", prompt: "a.md", args: ["--model", "x"] }, outputs: [{ type: "dir", path: "site/" }] },
        { id: "own", name: "own", executor: { type: "agent", agent: "custom", prompt: "a.md", command: "my-agent {{promptFile}}" }, outputs: [{ type: "dir", path: "out/" }] },
        {
          id: "send",
          name: "send",
          executor: { type: "service", method: "POST", url: "https://api.example.com/v1", headers: { Authorization: "Bearer {{env.EXAMPLE_TOKEN}}" } },
          outputs: [{ type: "application/json", path: "r.json" }],
        },
        {
          id: "echo",
          name: "echo",
          executor: { type: "mcp", server: "echo", tool: "echo" },
          outputs: [{ type: "text/markdown", path: "echo.md" }],
        },
        {
          id: "remote",
          name: "remote",
          executor: { type: "mcp", server: "remote", tool: "search" },
          outputs: [{ type: "application/json", path: "search.json" }],
        },
      ],
      mcpServers: {
        echo: { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"], env: { API_KEY: "${EXAMPLE_TOKEN}" } },
        remote: { url: "https://example.com/mcp" },
      },
    };
    expect(flowActions(flow)).toEqual([
      { stage: "render", kind: "script", detail: "node scripts/render.mjs" },
      { stage: "build", kind: "agent", detail: "claude-code --model x" },
      { stage: "own", kind: "agent", detail: "custom: my-agent {{promptFile}}" },
      { stage: "send", kind: "service", detail: "POST https://api.example.com/v1", env: ["EXAMPLE_TOKEN"] },
      { stage: "echo", kind: "mcp", detail: "npx -y @modelcontextprotocol/server-everything", env: ["EXAMPLE_TOKEN"] },
      { stage: "remote", kind: "mcp", detail: "https://example.com/mcp" },
    ]);
  });

  it("lists a flowgit sub-flow and, with the flow directory, what runs inside it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-actions-"));
    dirs.push(dir);
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "parent",
      stages: [
        { id: "prep", name: "prep", executor: { type: "script", run: "node scripts/prep.mjs" }, outputs: [{ type: "text/plain", path: "prep.txt" }] },
        {
          id: "make",
          name: "make",
          executor: { type: "workflow", engine: "flowgit", file: "subflows/brief/flow.json", params: { copy: { "brief.md": "brief.md" } } },
          outputs: [{ type: "text/markdown", path: "brief.md" }],
        },
      ],
    };
    writeJson(dir, "flow.json", flow);
    writeJson(dir, "subflows/brief/flow.json", {
      format: "flowgit",
      version: "0.1",
      name: "brief",
      stages: [
        { id: "draft", name: "draft", executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ type: "text/markdown", path: "brief.md" }] },
        { id: "check", name: "check", executor: { type: "script", run: "node scripts/check.mjs" }, outputs: [{ type: "text/plain", path: "check.txt" }] },
        // Points back at itself: listed once, never entered again.
        { id: "again", name: "again", executor: { type: "workflow", engine: "flowgit", file: "flow.json" }, outputs: [{ type: "text/plain", path: "x.txt" }] },
      ],
    });

    const workflow = { stage: "make", kind: "workflow", detail: "子流程 / sub-flow subflows/brief/flow.json" };
    expect(flowActions(flow, dir)).toEqual([
      { stage: "prep", kind: "script", detail: "node scripts/prep.mjs" },
      workflow,
      { stage: "make/check", kind: "script", detail: "node scripts/check.mjs" },
      { stage: "make/again", kind: "workflow", detail: "子流程 / sub-flow flow.json" },
    ]);
    // Without the directory the sub-flow cannot be read, so only its stage is listed.
    expect(flowActions(flow)).toEqual([{ stage: "prep", kind: "script", detail: "node scripts/prep.mjs" }, workflow]);
  });
});
