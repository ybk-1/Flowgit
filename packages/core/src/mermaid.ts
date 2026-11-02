import type { Flow, Stage, StageState, StageStatus } from "./types.js";

/** Shown under the stage name. A Flowgit sub-flow is labeled sub-flow; other engines stay workflow. */
function executorLabel(stage: Stage): string {
  const ex = stage.executor;
  if (ex.type === "workflow" && ex.engine === "flowgit") return "sub-flow";
  return ex.type;
}

/** Mermaid entity codes, so a name with quotes or brackets cannot break the diagram. */
function mermaidText(s: string): string {
  return s.replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
}

/** Board order, with the same icons as `flowgit status`. Class names avoid hyphens. */
const STATE_STYLE: Record<StageState, { icon: string; cls: string; style: string }> = {
  ok: { icon: "✓", cls: "ok", style: "fill:#dcfce7,stroke:#16a34a,color:#14532d" },
  stale: { icon: "↻", cls: "stale", style: "fill:#fef3c7,stroke:#d97706,color:#78350f" },
  edited: { icon: "✎", cls: "edited", style: "fill:#cffafe,stroke:#0891b2,color:#164e63" },
  error: { icon: "✗", cls: "error", style: "fill:#fee2e2,stroke:#dc2626,color:#7f1d1d" },
  "never-run": { icon: "○", cls: "neverRun", style: "fill:#dbeafe,stroke:#2563eb,color:#1e3a8a" },
  "waiting-upstream": { icon: "…", cls: "waitingUpstream", style: "fill:#f3f4f6,stroke:#9ca3af,color:#4b5563,stroke-dasharray:4 3" },
};

/**
 * The flow as a Mermaid flowchart (GitHub, GitLab and Obsidian render it).
 * Each stage shows its name and executor; with `statuses` it is also colored
 * by its state. Node ids are s1, s2, … so stage ids never clash with Mermaid
 * keywords such as `end`.
 */
export function flowToMermaid(flow: Flow, statuses?: StageStatus[]): string {
  const node = new Map(flow.stages.map((s, i) => [s.id, `s${i + 1}`]));
  const state = new Map(statuses?.map((s) => [s.stage.id, s.state]));
  const lines = ["flowchart LR"];
  for (const s of flow.stages) {
    const st = state.get(s.id);
    const label = executorLabel(s);
    const detail = st ? `${label} · ${STATE_STYLE[st].icon} ${st}` : label;
    lines.push(`  ${node.get(s.id)}["${mermaidText(s.name)}<br/>${detail}"]`);
  }
  for (const s of flow.stages) {
    for (const up of s.inputs ?? []) {
      if (node.has(up)) lines.push(`  ${node.get(up)} --> ${node.get(s.id)}`);
    }
  }
  for (const [st, { cls, style }] of Object.entries(STATE_STYLE) as [StageState, (typeof STATE_STYLE)[StageState]][]) {
    const members = flow.stages.filter((s) => state.get(s.id) === st).map((s) => node.get(s.id));
    if (!members.length) continue;
    lines.push(`  classDef ${cls} ${style}`);
    lines.push(`  class ${members.join(",")} ${cls}`);
  }
  return lines.join("\n");
}
