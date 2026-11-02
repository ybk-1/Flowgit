import { describe, expect, it } from "vitest";
import { flowActions, type Flow } from "./index.js";

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
      ],
    };
    expect(flowActions(flow)).toEqual([
      { stage: "render", kind: "script", detail: "node scripts/render.mjs" },
      { stage: "build", kind: "agent", detail: "claude-code --model x" },
      { stage: "own", kind: "agent", detail: "custom: my-agent {{promptFile}}" },
      { stage: "send", kind: "service", detail: "POST https://api.example.com/v1", env: ["EXAMPLE_TOKEN"] },
    ]);
  });
});
