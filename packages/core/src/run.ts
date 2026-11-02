import fs from "node:fs";
import type { LoadedFlow, RunRecord, Stage } from "./types.js";
import { requireStage, topoOrder } from "./graph.js";
import {
  getExecutor,
  HumanInputNeededError,
  type InputArtifact,
  type RunOptions,
} from "./executors/index.js";
import {
  hashOutputs,
  inputHash,
  inputRefs,
  latestOkRun,
  listRuns,
  loadFlowInputs,
  nextRunNumber,
  outputAbs,
  outputsHandEdited,
  resolveFlowInputs,
  restoreRun,
  snapshotOutputs,
  stageConfigHash,
  stageStatus,
  writeRunRecord,
} from "./runs.js";
import { isDirOutput, isTextType, listFiles, nowIso, truncate } from "./util.js";

export class UpstreamNotReadyError extends Error {
  constructor(
    public readonly stage: Stage,
    public readonly missing: string[],
  ) {
    super(`「${stage.name}」要先等这些阶段跑完 / Stage "${stage.id}" needs these stages to run first: ${missing.join(", ")}`);
    this.name = "UpstreamNotReadyError";
  }
}

function collectInputs(loaded: LoadedFlow, stage: Stage): InputArtifact[] {
  const artifacts: InputArtifact[] = [];
  for (const dep of stage.inputs ?? []) {
    const up = requireStage(loaded.flow, dep);
    for (const output of up.outputs) {
      const absPath = outputAbs(loaded.dir, output);
      const exists = fs.existsSync(absPath);
      const isDir = exists && fs.statSync(absPath).isDirectory();
      const a: InputArtifact = { stage: dep, stageName: up.name, output, absPath, exists, isDir };
      if (exists && isDir) a.files = listFiles(absPath);
      else if (exists && (isDirOutput(output) === false) && isTextType(output.type, output.path)) {
        a.text = fs.readFileSync(absPath, "utf8");
      }
      artifacts.push(a);
    }
  }
  return artifacts;
}

/**
 * Record the current outputs of a stage as a new version without executing
 * anything. Used when someone edited the outputs by hand, so the edit is kept
 * in the history instead of being overwritten.
 */
export function recordManualEdit(loaded: LoadedFlow, stageId: string, flowInputs: Record<string, unknown>): RunRecord {
  const { dir, flow } = loaded;
  const stage = requireStage(flow, stageId);
  const n = nextRunNumber(dir, stageId);
  const now = nowIso();
  const refs = inputRefs(dir, flow, stage);
  const outputs = hashOutputs(dir, stage);
  snapshotOutputs(dir, stage, n);
  const record: RunRecord = {
    stage: stageId,
    n,
    status: "ok",
    executor: "manual",
    startedAt: now,
    finishedAt: now,
    inputHash: inputHash(refs, flowInputs, stageConfigHash(dir, stage)),
    inputs: refs,
    flowInputs,
    outputs,
    log: "recorded a manual edit of the outputs",
  };
  writeRunRecord(dir, record);
  return record;
}

/**
 * Put the outputs of version `n` back in place, like restoreRun, without losing
 * a hand edit: outputs that match no saved version are first recorded as a
 * `manual` version (`kept`). Outputs that equal some version, such as an earlier
 * restore, are not recorded again.
 */
export function restoreStage(loaded: LoadedFlow, stageId: string, n: number): { run: RunRecord; kept?: RunRecord } {
  const { dir, flow } = loaded;
  const stage = requireStage(flow, stageId);
  const okRuns = listRuns(dir, stageId).filter((r) => r.status === "ok");
  let kept: RunRecord | undefined;
  // Only once the target is known to be restorable; restoreRun reports a bad n.
  if (okRuns.some((r) => r.n === n) && outputsHandEdited(dir, stage, okRuns)) {
    kept = recordManualEdit(loaded, stageId, resolveFlowInputs(dir, flow));
  }
  const run = restoreRun(dir, flow, stageId, n);
  return kept ? { run, kept } : { run };
}

/**
 * Run one stage: check upstream, execute, verify outputs, snapshot them as
 * runs/<stage>/<n>/ and write run.json. A failed execution is recorded too.
 * A human stage that is still waiting throws HumanInputNeededError and records nothing.
 */
export async function runStage(loaded: LoadedFlow, stageId: string, options: RunOptions = {}): Promise<RunRecord> {
  const { dir, flow } = loaded;
  const stage = requireStage(flow, stageId);
  const emit = options.onEvent ?? (() => {});
  const flowInputs = loadFlowInputs(dir, flow, options.inputs);
  const executor = getExecutor(stage.executor.type);

  const missingUpstream = (stage.inputs ?? []).filter((dep) => {
    if (!latestOkRun(dir, dep)) return true;
    return requireStage(flow, dep).outputs.some((o) => !fs.existsSync(outputAbs(dir, o)));
  });
  if (missingUpstream.length) throw new UpstreamNotReadyError(stage, missingUpstream);

  // never lose a hand edit: save it as its own version before re-running
  if (outputsHandEdited(dir, stage)) {
    const kept = recordManualEdit(loaded, stageId, flowInputs);
    emit({ type: "stage:log", stage, line: `你的手动修改已存为 v${kept.n} / your manual edit was saved as v${kept.n}` });
  }

  const inputs = collectInputs(loaded, stage);
  const refs = inputRefs(dir, flow, stage);
  const hash = inputHash(refs, flowInputs, stageConfigHash(dir, stage));
  const n = nextRunNumber(dir, stageId);
  const logLines: string[] = [];
  const startedAt = nowIso();
  emit({ type: "stage:start", stage });
  const ctx = {
    loaded,
    stage,
    inputs,
    flowInputs,
    options,
    log: (line: string) => {
      logLines.push(line);
      emit({ type: "stage:log", stage, line });
    },
  };
  try {
    const result = await executor.run(ctx);
    const outputs = hashOutputs(dir, stage);
    snapshotOutputs(dir, stage, n);
    const record: RunRecord = {
      stage: stageId,
      n,
      status: "ok",
      executor: stage.executor.type,
      startedAt,
      finishedAt: nowIso(),
      inputHash: hash,
      inputs: refs,
      flowInputs,
      outputs,
      params: result.params,
      log: truncate(logLines.join("\n"), 20_000),
    };
    writeRunRecord(dir, record);
    emit({ type: "stage:done", stage, n, record });
    return record;
  } catch (err) {
    const error = err as Error;
    if (error instanceof HumanInputNeededError) throw error;
    const record: RunRecord = {
      stage: stageId,
      n,
      status: "error",
      executor: stage.executor.type,
      startedAt,
      finishedAt: nowIso(),
      inputHash: hash,
      inputs: refs,
      flowInputs,
      outputs: [],
      log: truncate(logLines.join("\n"), 20_000),
      error: error.message,
    };
    writeRunRecord(dir, record);
    emit({ type: "stage:error", stage, error });
    throw error;
  }
}

/**
 * Run every stage in dependency order. Stages that are already ok are skipped
 * unless options.force is set. Stops at the first human stage that is waiting.
 */
export async function runAll(loaded: LoadedFlow, options: RunOptions = {}): Promise<RunRecord[]> {
  const emit = options.onEvent ?? (() => {});
  const flowInputs = loadFlowInputs(loaded.dir, loaded.flow, options.inputs);
  const records: RunRecord[] = [];
  for (const sid of topoOrder(loaded.flow)) {
    const status = stageStatus(loaded, sid, flowInputs);
    if (!options.force && status.state === "ok") {
      emit({ type: "stage:skip", stage: status.stage, reason: "已是最新 / up to date" });
      continue;
    }
    if (!options.force && status.state === "edited") {
      // the person changed this stage's outputs: keep their version, move on downstream
      const kept = recordManualEdit(loaded, sid, flowInputs);
      emit({ type: "stage:skip", stage: status.stage, reason: `保留了你的手动修改，存为 v${kept.n} / kept your manual edit as v${kept.n}` });
      records.push(kept);
      continue;
    }
    records.push(await runStage(loaded, sid, options));
  }
  return records;
}
