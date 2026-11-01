import type { Flow, Stage } from "./types.js";

export function stageById(flow: Flow, id: string): Stage | undefined {
  return flow.stages.find((s) => s.id === id);
}

export function requireStage(flow: Flow, id: string): Stage {
  const stage = stageById(flow, id);
  if (!stage) {
    const ids = flow.stages.map((s) => s.id).join(", ");
    throw new Error(`没有这个阶段 "${id}"，现有阶段：${ids} / Unknown stage "${id}". Stages: ${ids}`);
  }
  return stage;
}

/** Direct upstream stage ids of a stage. */
export function upstreamOf(flow: Flow, id: string): string[] {
  return requireStage(flow, id).inputs ?? [];
}

/** Direct downstream stage ids of a stage. */
export function downstreamOf(flow: Flow, id: string): string[] {
  return flow.stages.filter((s) => (s.inputs ?? []).includes(id)).map((s) => s.id);
}

/** All stages that transitively depend on `id`, in topological order. */
export function allDownstream(flow: Flow, id: string): string[] {
  const order = topoOrder(flow);
  const affected = new Set<string>();
  for (const sid of order) {
    const stage = requireStage(flow, sid);
    if ((stage.inputs ?? []).some((i) => i === id || affected.has(i))) {
      affected.add(sid);
    }
  }
  return order.filter((sid) => affected.has(sid));
}

/**
 * Topological order of stage ids (Kahn's algorithm). Ties keep file order so
 * the result matches how the author wrote the stages.
 * Throws if the graph has a cycle.
 */
export function topoOrder(flow: Flow): string[] {
  const ids = flow.stages.map((s) => s.id);
  const indegree = new Map<string, number>();
  for (const s of flow.stages) {
    indegree.set(s.id, (s.inputs ?? []).filter((i) => indegree.has(i) || ids.includes(i)).length);
  }
  const result: string[] = [];
  const done = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const s of flow.stages) {
      if (done.has(s.id)) continue;
      const deps = s.inputs ?? [];
      if (deps.every((d) => done.has(d) || !ids.includes(d))) {
        result.push(s.id);
        done.add(s.id);
        progressed = true;
      }
    }
  }
  if (result.length !== flow.stages.length) {
    const stuck = ids.filter((i) => !done.has(i)).join(", ");
    throw new Error(`阶段之间形成了环：${stuck} / Stages form a cycle: ${stuck}`);
  }
  return result;
}

/** Returns the stage ids involved in a cycle, or [] when the graph is acyclic. */
export function findCycle(flow: Flow): string[] {
  try {
    topoOrder(flow);
    return [];
  } catch {
    const ids = flow.stages.map((s) => s.id);
    const done = new Set<string>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const s of flow.stages) {
        if (done.has(s.id)) continue;
        if ((s.inputs ?? []).every((d) => done.has(d) || !ids.includes(d))) {
          done.add(s.id);
          progressed = true;
        }
      }
    }
    return ids.filter((i) => !done.has(i));
  }
}
