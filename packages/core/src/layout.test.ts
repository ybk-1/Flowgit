import { describe, expect, it } from "vitest";
import { layoutFlow, type Flow, type Stage, type StageStatus } from "./index.js";

function stage(id: string, inputs?: string[], type: Stage["executor"]["type"] = "human"): Stage {
  const executor: Stage["executor"] =
    type === "llm"
      ? { type: "llm", prompt: `${id}.md` }
      : type === "script"
        ? { type: "script", run: "node ok.mjs" }
        : type === "agent"
          ? { type: "agent", agent: "cursor", prompt: `${id}.md` }
          : { type: "human" };
  return {
    id,
    name: id.toUpperCase(),
    inputs,
    executor,
    outputs: [{ type: "text/plain", path: `${id}.txt` }],
  };
}

function flowOf(stages: Stage[]): Flow {
  return { format: "flowgit", version: "0.1", name: "layout", stages };
}

function statuses(flow: Flow, states?: StageStatus["state"][]): StageStatus[] {
  return flow.stages.map((item, index) => ({
    stage: item,
    state: states?.[index] ?? "ok",
    runs: 1,
    missingUpstream: [],
  }));
}

function rowsAreUnique(nodes: { layer: number; row: number }[]): void {
  const seen = new Map<number, Set<number>>();
  for (const node of nodes) {
    const rows = seen.get(node.layer) ?? new Set<number>();
    expect(rows.has(node.row)).toBe(false);
    rows.add(node.row);
    seen.set(node.layer, rows);
  }
}

describe("layoutFlow", () => {
  it("lays a diamond out in layers 0, 1, 1, 2 with no repeated row in a layer", () => {
    // a → b, a → c, b → d, c → d
    const flow = flowOf([
      stage("a", undefined, "human"),
      stage("b", ["a"], "llm"),
      stage("c", ["a"], "script"),
      stage("d", ["b", "c"], "agent"),
    ]);
    const laid = layoutFlow(flow, statuses(flow, ["ok", "stale", "edited", "error"]));

    expect(laid.nodes.map((node) => [node.id, node.layer, node.row])).toEqual([
      ["a", 0, 0],
      ["b", 1, 0],
      ["c", 1, 1],
      ["d", 2, 0],
    ]);
    expect(laid.nodes.map((node) => node.layer)).toEqual([0, 1, 1, 2]);
    rowsAreUnique(laid.nodes);
    expect(laid.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type, state: node.state }))).toEqual([
      { id: "a", name: "A", type: "human", state: "ok" },
      { id: "b", name: "B", type: "llm", state: "stale" },
      { id: "c", name: "C", type: "script", state: "edited" },
      { id: "d", name: "D", type: "agent", state: "error" },
    ]);
    expect(laid.edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ]);
  });

  it("sets a stage's layer to one more than its highest upstream", () => {
    // a → b → c, a → d, e depends on both c (layer 2) and d (layer 1)
    const flow = flowOf([
      stage("a"),
      stage("b", ["a"]),
      stage("c", ["b"]),
      stage("d", ["a"]),
      stage("e", ["c", "d"]),
    ]);
    const laid = layoutFlow(flow, statuses(flow));
    expect(Object.fromEntries(laid.nodes.map((node) => [node.id, node.layer]))).toEqual({
      a: 0,
      b: 1,
      c: 2,
      d: 1,
      e: 3,
    });
    rowsAreUnique(laid.nodes);
    expect(laid.edges).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "d" },
      { from: "c", to: "e" },
      { from: "d", to: "e" },
    ]);
  });

  it("ignores an upstream id that is not a stage", () => {
    const flow = flowOf([stage("a", ["ghost"]), stage("b", ["a"])]);
    const laid = layoutFlow(flow, []);
    expect(laid.nodes.map((node) => [node.id, node.layer, node.state])).toEqual([
      ["a", 0, "never-run"],
      ["b", 1, "never-run"],
    ]);
    rowsAreUnique(laid.nodes);
    expect(laid.edges).toEqual([{ from: "a", to: "b" }]);
  });
});
