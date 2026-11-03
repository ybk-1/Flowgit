export interface TopoNode {
  id: string;
  inputs?: string[];
}

/**
 * Kahn's algorithm. Ties keep file order, matching `@flowgit/core`'s `topoOrder`.
 * Throws when the graph has a cycle.
 */
export function topoIds(stages: TopoNode[]): string[] {
  const ids = stages.map((stage) => stage.id);
  const known = new Set(ids);
  const done = new Set<string>();
  const result: string[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const stage of stages) {
      if (done.has(stage.id)) continue;
      const deps = stage.inputs ?? [];
      if (deps.every((dep) => done.has(dep) || !known.has(dep))) {
        result.push(stage.id);
        done.add(stage.id);
        progressed = true;
      }
    }
  }
  if (result.length !== stages.length) {
    const stuck = ids.filter((id) => !done.has(id));
    throw new Error(`cycle: ${stuck.join(", ")}`);
  }
  return result;
}

export function orderByTopo<T extends { id: string }>(stages: T[], inputsOf: (stage: T) => string[]): T[] {
  try {
    const ids = topoIds(stages.map((stage) => ({ id: stage.id, inputs: inputsOf(stage) })));
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    return ids.map((id) => byId.get(id)!);
  } catch {
    return stages.slice();
  }
}
