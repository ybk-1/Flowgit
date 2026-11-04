import { describe, expect, it } from "vitest";
import { buildFlowView } from "./model.js";
import { parseFlowDocument } from "./outline.js";
import { parseStatusJson, StatusParseError } from "./status.js";
import { orderByTopo, topoIds } from "./topo.js";

const statusText = `{
  "flow": { "name": "周报", "version": "0.1", "dir": "/tmp/my flow" },
  "missingInputs": ["name"],
  "stages": [
    {
      "id": "draft",
      "name": "草稿",
      "executor": "llm",
      "state": "waiting-upstream",
      "runs": 0,
      "latest": null,
      "current": null,
      "missingUpstream": ["notes"],
      "outputs": [{ "type": "text/markdown", "path": "report.md", "description": "extra" }]
    },
    {
      "id": "notes",
      "name": "随手记",
      "executor": "human",
      "state": "never-run",
      "runs": 0,
      "latest": null,
      "current": null,
      "missingUpstream": [],
      "outputs": [{ "type": "text/markdown", "path": "notes.md" }]
    }
  ]
}`;

describe("parseStatusJson", () => {
  it("reads states, missing inputs and outputs from status --json", () => {
    const report = parseStatusJson(statusText.replace(/\n/g, "\r\n"));
    expect(report.flow.name).toBe("周报");
    expect(report.missingInputs).toEqual(["name"]);
    expect(report.stages.map((stage) => stage.state)).toEqual(["waiting-upstream", "never-run"]);
    expect(report.stages[0]?.outputs[0]).toEqual({ path: "report.md", type: "text/markdown" });
    expect(report.stages[1]?.latest).toBeNull();
  });

  it("keeps ok, stale, edited and error, and a latest version", () => {
    const report = parseStatusJson(
      JSON.stringify({
        flow: { name: "Demo" },
        stages: [
          { id: "a", name: "A", state: "ok", runs: 2, latest: { n: 2, status: "ok" }, current: 2, outputs: [] },
          { id: "b", name: "B", state: "stale", runs: 1, latest: { n: 1, status: "ok" }, current: 1, outputs: [] },
          { id: "c", name: "C", state: "edited", runs: 1, latest: { n: 1, status: "ok" }, current: null, outputs: [] },
          { id: "d", name: "D", state: "error", runs: 1, latest: { n: 1, status: "error" }, current: null, outputs: [] },
        ],
      }),
    );
    expect(report.stages.map((stage) => [stage.state, stage.latest?.n])).toEqual([
      ["ok", 2],
      ["stale", 1],
      ["edited", 1],
      ["error", 1],
    ]);
  });

  it("rejects output that is not JSON", () => {
    expect(() => parseStatusJson("")).toThrow(StatusParseError);
    expect(() => parseStatusJson("not json")).toThrow(StatusParseError);
  });
});

describe("topo order", () => {
  it("lists a downstream stage after its upstream, keeping file order for ties", () => {
    expect(topoIds([{ id: "draft", inputs: ["notes"] }, { id: "notes" }, { id: "side" }])).toEqual(["notes", "side", "draft"]);
  });

  it("keeps file order when the graph has a cycle", () => {
    const stages = [{ id: "a" }, { id: "b" }];
    expect(orderByTopo(stages, (stage) => (stage.id === "a" ? ["b"] : ["a"])).map((stage) => stage.id)).toEqual(["a", "b"]);
  });

  it("reorders status --json into topoOrder using the flow file", () => {
    const outline = parseFlowDocument(
      JSON.stringify({
        name: "周报",
        stages: [
          { id: "draft", name: "草稿", inputs: ["notes"], executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ path: "report.md" }] },
          { id: "notes", name: "随手记", executor: { type: "human" }, outputs: [{ path: "notes.md" }] },
        ],
      }),
      "flow.json",
    );
    const view = buildFlowView({
      dir: "/tmp/my flow",
      file: "/tmp/my flow/flow.json",
      outline,
      status: parseStatusJson(statusText),
    });
    expect(view.missingInputs).toEqual(["name"]);
    expect(view.stages.map((stage) => stage.id)).toEqual(["notes", "draft"]);
    expect(view.stages.map((stage) => stage.state)).toEqual(["never-run", "waiting-upstream"]);
    expect(view.stages.find((stage) => stage.id === "draft")?.prompt).toBe("prompts/draft.md");
  });
});
