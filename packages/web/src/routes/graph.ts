import { layoutFlow, loadFlow, resolveFlowInputs, statusAll } from "@flowgit/core";

/** JSON body of GET /api/graph: columns from layoutFlow, states from statusAll. */
export function flowGraph(dir: string) {
  const loaded = loadFlow(dir);
  const inputs = resolveFlowInputs(loaded.dir, loaded.flow);
  return layoutFlow(loaded.flow, statusAll(loaded, inputs));
}
