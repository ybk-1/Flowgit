import { describe, expect, it } from "vitest";
import { flowToMermaid, type Flow, type StageStatus } from "./index.js";

const flow: Flow = {
  format: "flowgit",
  version: "0.1",
  name: "graph test",
  stages: [
    { id: "notes", name: "随手记", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "notes.md" }] },
    { id: "draft", name: 'Draft "v1" <b>', inputs: ["notes"], executor: { type: "llm", prompt: "p.md" }, outputs: [{ type: "text/markdown", path: "draft.md" }] },
    // "end" is a Mermaid keyword: node ids must not use stage ids
    { id: "end", name: "C# check", inputs: ["notes", "draft"], executor: { type: "script", run: "node check.mjs" }, outputs: [{ type: "text/plain", path: "check.txt" }] },
  ],
};

describe("flowToMermaid", () => {
  it("draws stages and edges, with names escaped", () => {
    expect(flowToMermaid(flow)).toBe(
      [
        "flowchart LR",
        '  s1["随手记<br/>human"]',
        '  s2["Draft #quot;v1#quot; #lt;b#gt;<br/>llm"]',
        '  s3["C#35; check<br/>script"]',
        "  s1 --> s2",
        "  s1 --> s3",
        "  s2 --> s3",
      ].join("\n"),
    );
  });

  it("colors stages by state, defining only the classes it uses", () => {
    const statuses = (["ok", "stale", "stale"] as const).map((state, i) => ({ stage: flow.stages[i], state, runs: 1, missingUpstream: [] }) satisfies StageStatus);
    const out = flowToMermaid(flow, statuses);
    expect(out).toContain('  s1["随手记<br/>human · ✓ ok"]');
    expect(out).toContain('  s3["C#35; check<br/>script · ↻ stale"]');
    expect(out).toContain("  class s1 ok");
    expect(out).toContain("  class s2,s3 stale");
    expect(out.match(/classDef/g)).toHaveLength(2);
    expect(out).not.toContain("neverRun");
  });
});
