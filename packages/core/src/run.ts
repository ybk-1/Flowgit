import { host } from "./host/current.js";
import type { LoadedFlow, RunRecord, Stage } from "./types.js";
import { requireStage, topoOrder } from "./graph.js";
import {
  getExecutor,
  HumanInputNeededError,
  usageTokens,
  type InputArtifact,
  type RunOptions,
} from "./executors/index.js";
import { TokenBudgetError } from "./budget.js";
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
import { schemaFailure, schemaProblems } from "./schema-check.js";
import { assertTrusted } from "./trust.js";
import { isDirOutput, isTextType, listFiles, nowIso, resolveConcurrency, resolveMaxTokens, staysInside, truncate } from "./util.js";

export { TokenBudgetError } from "./budget.js";

export class UpstreamNotReadyError extends Error {
  constructor(
    public readonly stage: Stage,
    public readonly missing: string[],
  ) {
    super(`「${stage.name}」要先等这些阶段跑完 / Stage "${stage.id}" needs these stages to run first: ${missing.join(", ")}`);
    this.name = "UpstreamNotReadyError";
  }
}

/** run.json's via and client, only when someone other than the CLI or the board asked for the run. */
function callerFields(options: RunOptions): Pick<RunRecord, "via" | "client"> {
  const caller = options.caller;
  if (!caller) return {};
  return caller.client ? { via: caller.via, client: caller.client } : { via: caller.via };
}

function collectInputs(loaded: LoadedFlow, stage: Stage): InputArtifact[] {
  const artifacts: InputArtifact[] = [];
  for (const dep of stage.inputs ?? []) {
    const up = requireStage(loaded.flow, dep);
    for (const output of up.outputs) {
      const absPath = outputAbs(loaded.dir, output);
      const exists = host().exists(absPath);
      const isDir = exists && host().stat(absPath).isDirectory();
      const a: InputArtifact = { stage: dep, stageName: up.name, output, absPath, exists, isDir };
      if (exists && isDir) a.files = listFiles(absPath);
      else if (exists && !staysInside(loaded.dir, absPath)) a.outside = true;
      else if (exists && (isDirOutput(output) === false) && isTextType(output.type, output.path)) {
        a.text = host().readFile(absPath, "utf8");
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
    inputHash: inputHash(refs, flowInputs, stageConfigHash(dir, stage, new Set(), flow)),
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
 * A copied flow that hasn't been confirmed here throws TrustNeededError before anything runs.
 */
export async function runStage(loaded: LoadedFlow, stageId: string, options: RunOptions = {}): Promise<RunRecord> {
  const { dir, flow } = loaded;
  const stage = requireStage(flow, stageId);
  const emit = options.onEvent ?? (() => {});
  const flowInputs = loadFlowInputs(dir, flow, options.inputs);
  // A sub-flow runs under its parent's confirmation, which already lists what the sub-flow does.
  if (!options.flowStack?.length) assertTrusted(loaded);
  const executor = getExecutor(stage.executor.type);

  const missingUpstream = (stage.inputs ?? []).filter((dep) => {
    if (!latestOkRun(dir, dep)) return true;
    return requireStage(flow, dep).outputs.some((o) => !host().exists(outputAbs(dir, o)));
  });
  if (missingUpstream.length) throw new UpstreamNotReadyError(stage, missingUpstream);

  // never lose a hand edit: save it as its own version before re-running
  if (outputsHandEdited(dir, stage)) {
    const kept = recordManualEdit(loaded, stageId, flowInputs);
    emit({ type: "stage:log", stage, line: `你的手动修改已存为 v${kept.n} / your manual edit was saved as v${kept.n}` });
  }

  const inputs = collectInputs(loaded, stage);
  const refs = inputRefs(dir, flow, stage);
  const hash = inputHash(refs, flowInputs, stageConfigHash(dir, stage, new Set(), flow));
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
    const problems = schemaProblems(dir, stage);
    if (problems.length) throw schemaFailure(problems);
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
      ...callerFields(options),
    };
    writeRunRecord(dir, record);
    emit({ type: "stage:done", stage, n, record });
    return record;
  } catch (err) {
    const error = err as Error;
    // A budget stop is the run's decision, not a failed attempt of this stage.
    if (error instanceof HumanInputNeededError || error instanceof TokenBudgetError) throw error;
    // An executor can attach params (e.g. model usage) to the error it throws.
    const params = (error as Error & { params?: Record<string, unknown> }).params;
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
      ...(params ? { params } : {}),
      log: truncate(logLines.join("\n"), 20_000),
      error: error.message,
      ...callerFields(options),
    };
    writeRunRecord(dir, record);
    emit({ type: "stage:error", stage, error, record });
    throw error;
  }
}

type StageOutcome = "ok" | "skip" | "kept" | "error" | "wait" | "budget";

/** An llm stage that will call a model. Canned replies (FLOWGIT_LLM_MOCK_DIR, and no injected llm) do not. */
function stageCallsModel(stage: Stage, options: RunOptions): boolean {
  if (stage.executor.type !== "llm") return false;
  if (options.llm) return true;
  return !host().env.FLOWGIT_LLM_MOCK_DIR;
}

function addTokens(ledger: { used: number }, params: Record<string, unknown> | undefined): void {
  const tokens = usageTokens(params?.usage as Record<string, unknown> | undefined);
  if (!tokens) return;
  ledger.used += tokens.input + tokens.output;
}

/**
 * Run every stage. Independent stages run at the same time, up to `concurrency`
 * (the option, else the flow's `concurrency`, else 2). Dependency order, staleness
 * and hand-edit protection match a one-by-one run. Stops scheduling further stages
 * when one fails, a person is waiting, or the token budget is already over.
 * A copied flow that hasn't been confirmed here throws TrustNeededError first.
 */
export async function runAll(loaded: LoadedFlow, options: RunOptions = {}): Promise<RunRecord[]> {
  const emit = options.onEvent ?? (() => {});
  const flowInputs = loadFlowInputs(loaded.dir, loaded.flow, options.inputs);
  // before anything runs, not halfway through
  if (!options.flowStack?.length) assertTrusted(loaded);
  const concurrency = resolveConcurrency(options.concurrency ?? loaded.flow.concurrency);
  const maxTokens = resolveMaxTokens(options.maxTokens);
  const ledger = options.tokenLedger ?? { used: 0 };
  const stageOptions: RunOptions = options.tokenLedger ? options : { ...options, tokenLedger: ledger };
  const order = topoOrder(loaded.flow);
  const pending = new Set(order);
  const done = new Map<string, StageOutcome>();
  const records: RunRecord[] = [];
  const inflight = new Map<string, Promise<void>>();
  let halt = false;
  let waitError: HumanInputNeededError | undefined;
  let failError: Error | undefined;
  let budgetError: TokenBudgetError | undefined;

  const ready = (): string[] => {
    const ids: string[] = [];
    for (const id of order) {
      if (!pending.has(id)) continue;
      const deps = requireStage(loaded.flow, id).inputs ?? [];
      if (!deps.every((dep) => done.has(dep))) continue;
      if (deps.some((dep) => done.get(dep) !== "ok" && done.get(dep) !== "skip" && done.get(dep) !== "kept")) continue;
      ids.push(id);
    }
    return ids;
  };

  const runOne = (id: string): Promise<void> => {
    const stage = requireStage(loaded.flow, id);
    return (async () => {
      try {
        const status = stageStatus(loaded, id, flowInputs);
        if (!options.force && status.state === "ok") {
          emit({ type: "stage:skip", stage, reason: "已是最新 / up to date" });
          done.set(id, "skip");
          return;
        }
        if (!options.force && status.state === "edited") {
          const kept = recordManualEdit(loaded, id, flowInputs);
          emit({ type: "stage:skip", stage, reason: `保留了你的手动修改，存为 v${kept.n} / kept your manual edit as v${kept.n}` });
          records.push(kept);
          done.set(id, "kept");
          return;
        }
        const record = await runStage(loaded, id, stageOptions);
        addTokens(ledger, record.params);
        records.push(record);
        done.set(id, "ok");
      } catch (err) {
        addTokens(ledger, (err as { params?: Record<string, unknown> }).params);
        if (err instanceof HumanInputNeededError) {
          done.set(id, "wait");
          waitError ??= err;
          halt = true;
          return;
        }
        if (err instanceof TokenBudgetError) {
          done.set(id, "budget");
          budgetError ??= err;
          halt = true;
          return;
        }
        done.set(id, "error");
        failError ??= err as Error;
        halt = true;
      }
    })();
  };

  while (pending.size > 0 || inflight.size > 0) {
    if (!halt) {
      for (const id of ready()) {
        if (inflight.size >= concurrency) break;
        const stage = requireStage(loaded.flow, id);
        if (maxTokens !== undefined && stageCallsModel(stage, stageOptions) && ledger.used > maxTokens) {
          budgetError = new TokenBudgetError(ledger.used, maxTokens, stage);
          done.set(id, "budget");
          pending.delete(id);
          halt = true;
          break;
        }
        pending.delete(id);
        const task = runOne(id).finally(() => {
          inflight.delete(id);
        });
        inflight.set(id, task);
      }
    }
    if (inflight.size === 0) break;
    await Promise.race(inflight.values());
  }

  if (waitError) throw waitError;
  if (failError) throw failError;
  if (budgetError) throw budgetError;
  if (pending.size) {
    throw new Error(
      `这些阶段没法开始：${[...pending].join(", ")} / these stages never became ready: ${[...pending].join(", ")}`,
    );
  }
  records.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  return records;
}
