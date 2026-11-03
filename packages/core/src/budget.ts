import type { Stage } from "./types.js";

/**
 * Thrown when a run is stopped before a stage that would call a model because
 * this run has already used more tokens than `--max-tokens`. Finished versions
 * stay on disk; the stage that was not started has no new run.
 */
export class TokenBudgetError extends Error {
  readonly used: number;
  readonly max: number;
  readonly stageId: string;
  readonly stageName: string;

  constructor(used: number, max: number, stage: Pick<Stage, "id" | "name">) {
    super(
      `已用 token 超过预算（已用 ${used}，上限 ${max}），停在「${stage.name}」之前。已完成的版本都保留。 / Token budget exceeded (used ${used}, limit ${max}); stopped before "${stage.name}". Finished versions are kept.`,
    );
    this.name = "TokenBudgetError";
    this.used = used;
    this.max = max;
    this.stageId = stage.id;
    this.stageName = stage.name;
  }
}
