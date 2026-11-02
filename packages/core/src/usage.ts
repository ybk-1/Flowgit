import { usageTokens } from "./executors/llm.js";
import { listRuns } from "./runs.js";
import type { LoadedFlow, RunRecord } from "./types.js";

/** Input and output tokens, and how many runs recorded them. */
export interface TokenTotals {
  input: number;
  output: number;
  /** Runs whose `run.json` recorded token usage. A run with no usage adds nothing. */
  calls: number;
}

/** Token totals for one stage, summed across every version. */
export interface StageUsage extends TokenTotals {
  id: string;
  name: string;
}

/**
 * What `flowgit log` shows when no stage is given: every run, newest first,
 * plus the tokens recorded in each stage's `run.json` files.
 */
export interface FlowLog {
  runs: RunRecord[];
  /** One row per stage, in flow order, including stages that used no tokens. */
  stages: StageUsage[];
  total: TokenTotals;
}

function addUsage(row: TokenTotals, run: RunRecord): void {
  const tokens = usageTokens(run.params?.usage as Record<string, unknown> | undefined);
  if (!tokens) return;
  row.input += tokens.input;
  row.output += tokens.output;
  row.calls += 1;
}

export function flowLog(loaded: LoadedFlow): FlowLog {
  const byStage = loaded.flow.stages.map((stage) => ({ stage, runs: listRuns(loaded.dir, stage.id) }));
  const runs = byStage.flatMap((item) => item.runs).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const stages: StageUsage[] = [];
  const total: TokenTotals = { input: 0, output: 0, calls: 0 };
  for (const item of byStage) {
    const row: StageUsage = { id: item.stage.id, name: item.stage.name, input: 0, output: 0, calls: 0 };
    for (const run of item.runs) addUsage(row, run);
    total.input += row.input;
    total.output += row.output;
    total.calls += row.calls;
    stages.push(row);
  }
  return { runs, stages, total };
}
