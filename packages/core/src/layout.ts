import { topoOrder } from "./graph.js";
import type { ExecutorType, Flow, StageState, StageStatus } from "./types.js";

/** One stage in the board graph. `type` is the executor type. */
export interface FlowLayoutNode {
  id: string;
  name: string;
  type: ExecutorType;
  state: StageState;
  /** Column. 0 is the leftmost column; a stage sits one past its deepest upstream. */
  layer: number;
  /** Row inside that column. Unique within the layer. */
  row: number;
}

/** A dependency arrow, upstream → downstream, as declared in `flow.json`. */
export interface FlowLayoutEdge {
  from: string;
  to: string;
}

/** Body of `GET /api/graph`. The board draws this; it does not recompute the layout. */
export interface FlowLayout {
  nodes: FlowLayoutNode[];
  edges: FlowLayoutEdge[];
}

/**
 * Place stages in columns for the board graph.
 * Layer comes from `topoOrder`: a stage's layer is one more than the highest
 * layer among its upstreams (0 when it has none). Rows follow that same order
 * and do not repeat inside a layer. An input that is not a stage is ignored.
 * `statuses` supply `state` (same source as `flowgit graph --status`); a stage
 * with no status is `never-run`.
 */
export function layoutFlow(flow: Flow, statuses: StageStatus[]): FlowLayout {
  const order = topoOrder(flow);
  const stages = new Map(flow.stages.map((stage) => [stage.id, stage]));
  const stateOf = new Map(statuses.map((status) => [status.stage.id, status.state]));
  const layerOf = new Map<string, number>();

  for (const id of order) {
    let highest = -1;
    for (const input of stages.get(id)?.inputs ?? []) {
      const layer = layerOf.get(input);
      if (layer !== undefined && layer > highest) highest = layer;
    }
    layerOf.set(id, highest + 1);
  }

  const nextRow = new Map<number, number>();
  const nodes: FlowLayoutNode[] = [];
  for (const id of order) {
    const stage = stages.get(id);
    if (!stage) continue;
    const layer = layerOf.get(id) ?? 0;
    const row = nextRow.get(layer) ?? 0;
    nextRow.set(layer, row + 1);
    nodes.push({
      id,
      name: stage.name,
      type: stage.executor.type,
      state: stateOf.get(id) ?? "never-run",
      layer,
      row,
    });
  }

  const known = new Set(order);
  const edges: FlowLayoutEdge[] = [];
  for (const stage of flow.stages) {
    for (const input of stage.inputs ?? []) {
      if (!known.has(input) || !known.has(stage.id)) continue;
      edges.push({ from: input, to: stage.id });
    }
  }
  return { nodes, edges };
}
