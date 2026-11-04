import { type LoadedFlow, listRuns, planRunAll, type RunRecord, type Stage } from "@flowgit/core";
// The web app decides the same thing for its handoff to the local board.
import { needsComputer } from "../../../app/src/handoff.js";

/**
 * What a cloud run does next. Each Workflows step does one stage, then asks again from the files
 * as they are now, so a run picks up where it stopped (after a restart, a retry, a person's
 * upload or a computer's run) without remembering anything but when it started.
 */
export type Next =
  | { kind: "done"; skipped: Stage[] }
  | { kind: "run"; stage: Stage; skipped: Stage[]; callsModel: boolean }
  | { kind: "keep"; stage: Stage; skipped: Stage[] }
  | { kind: "computer"; stage: Stage; skipped: Stage[] }
  | { kind: "fail"; stage: Stage; error: string; skipped: Stage[] };

/** A stage the cloud can't run itself: it starts programs on a computer. With a sandbox bound, script stages run there. */
export function needsComputerInCloud(stage: Stage, sandbox: boolean): boolean {
  if (sandbox && stage.executor.type === "script") return false;
  return needsComputer(stage.executor as { type: string; engine?: string });
}

/** This stage's latest real run (not a saved hand edit) that started at or after `since`. */
export function ranSince(loaded: LoadedFlow, stageId: string, since: string): RunRecord | undefined {
  const runs = listRuns(loaded.dir, stageId).filter((run) => run.executor !== "manual" && run.startedAt >= since);
  return runs[runs.length - 1];
}

export interface NextOptions {
  /** "all" or a stage id. */
  stage: string;
  model?: string;
  /** Flow inputs given with the run; the saved inputs fill in the rest. */
  inputs?: Record<string, unknown>;
  /** ISO time the run started. */
  since: string;
  sandbox?: boolean;
}

export function decideNext(loaded: LoadedFlow, options: NextOptions): Next {
  if (options.stage !== "all") {
    const stage = loaded.flow.stages.find((item) => item.id === options.stage);
    if (!stage) return { kind: "done", skipped: [] };
    const record = ranSince(loaded, stage.id, options.since);
    if (record?.status === "ok") return { kind: "done", skipped: [] };
    if (record) return { kind: "fail", stage, error: record.error ?? "失败 / failed", skipped: [] };
    if (needsComputerInCloud(stage, options.sandbox === true)) return { kind: "computer", stage, skipped: [] };
    return { kind: "run", stage, skipped: [], callsModel: stage.executor.type === "llm" };
  }
  const skipped: Stage[] = [];
  for (const step of planRunAll(loaded, { ...(options.model ? { model: options.model } : {}), ...(options.inputs ? { inputs: options.inputs } : {}) })) {
    const stage = step.stage;
    switch (step.action) {
      case "skip":
        skipped.push(stage);
        continue;
      case "keep-edit":
        return { kind: "keep", stage, skipped };
      case "cannot-run":
        return { kind: "fail", stage, error: step.detail ?? `${stage.id} 不能运行 / can't run`, skipped };
      case "not-reached":
        continue;
      case "run":
      case "wait": {
        // Ran in this run and still not up to date: it failed, and the run stops here like `run all`.
        const record = ranSince(loaded, stage.id, options.since);
        if (record && record.status !== "ok") return { kind: "fail", stage, error: record.error ?? "失败 / failed", skipped };
        // Ran fine in this run and out of date again (something upstream changed meanwhile): stop
        // rather than go round, and let a new run start from the files as they are.
        if (record) {
          return { kind: "fail", stage, error: `${stage.id} 这次已经跑过，但又过期了，请重新运行 / ${stage.id} already ran in this run and is out of date again; start a new run`, skipped };
        }
        if (needsComputerInCloud(stage, options.sandbox === true)) return { kind: "computer", stage, skipped };
        return { kind: "run", stage, skipped, callsModel: step.callsModel };
      }
    }
  }
  return { kind: "done", skipped };
}
