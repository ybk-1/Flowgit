import fs from "node:fs";
import path from "node:path";
import type {
  Flow,
  FlowInput,
  LoadedFlow,
  Output,
  RunInputRef,
  RunOutputRecord,
  RunRecord,
  Stage,
  StageStatus,
} from "./types.js";
import { requireStage, topoOrder } from "./graph.js";
import { copyPath, hashPath, isDirOutput, outputRel, sha256String } from "./util.js";

export const RUNS_DIR = "runs";
export const LOCAL_FILE = "flowgit.local.json";
const RUN_FILE = "run.json";

export function runsDir(dir: string, stageId?: string): string {
  return stageId ? path.join(dir, RUNS_DIR, stageId) : path.join(dir, RUNS_DIR);
}

export function runDir(dir: string, stageId: string, n: number): string {
  return path.join(runsDir(dir, stageId), String(n));
}

export function outputAbs(dir: string, output: Output): string {
  return path.join(dir, outputRel(output));
}

/** All recorded runs of a stage, oldest first. */
export function listRuns(dir: string, stageId: string): RunRecord[] {
  const base = runsDir(dir, stageId);
  if (!fs.existsSync(base)) return [];
  const runs: RunRecord[] = [];
  for (const name of fs.readdirSync(base)) {
    if (!/^\d+$/.test(name)) continue;
    const file = path.join(base, name, RUN_FILE);
    if (!fs.existsSync(file)) continue;
    try {
      runs.push(JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord);
    } catch {
      // a half-written run is ignored rather than breaking the whole flow
    }
  }
  return runs.sort((a, b) => a.n - b.n);
}

export function latestRun(dir: string, stageId: string): RunRecord | undefined {
  const runs = listRuns(dir, stageId);
  return runs[runs.length - 1];
}

export function latestOkRun(dir: string, stageId: string): RunRecord | undefined {
  const runs = listRuns(dir, stageId).filter((r) => r.status === "ok");
  return runs[runs.length - 1];
}

export function nextRunNumber(dir: string, stageId: string): number {
  const base = runsDir(dir, stageId);
  if (!fs.existsSync(base)) return 1;
  let max = 0;
  for (const name of fs.readdirSync(base)) {
    if (/^\d+$/.test(name)) max = Math.max(max, Number(name));
  }
  return max + 1;
}

export class MissingOutputsError extends Error {
  constructor(
    public readonly stage: Stage,
    public readonly missing: string[],
  ) {
    super(`「${stage.name}」没有产出这些文件 / Stage "${stage.id}" did not produce: ${missing.join(", ")}`);
    this.name = "MissingOutputsError";
  }
}

/** Hash the current outputs of a stage as they stand in the flow directory. */
export function hashOutputs(dir: string, stage: Stage): RunOutputRecord[] {
  const missing: string[] = [];
  const records: RunOutputRecord[] = [];
  for (const out of stage.outputs) {
    const abs = outputAbs(dir, out);
    if (!fs.existsSync(abs)) {
      missing.push(out.path);
      continue;
    }
    const h = hashPath(abs);
    if (isDirOutput(out) && !h.isDir) {
      missing.push(`${out.path} (expected a directory)`);
      continue;
    }
    records.push({ path: outputRel(out), type: out.type, sha256: h.sha256, bytes: h.bytes, isDir: h.isDir });
  }
  if (missing.length) throw new MissingOutputsError(stage, missing);
  return records;
}

/** Current hashes of upstream artifacts (files that exist). */
export function inputRefs(dir: string, flow: Flow, stage: Stage): RunInputRef[] {
  const refs: RunInputRef[] = [];
  for (const dep of stage.inputs ?? []) {
    const up = requireStage(flow, dep);
    for (const out of up.outputs) {
      const abs = outputAbs(dir, out);
      if (!fs.existsSync(abs)) continue;
      refs.push({ stage: dep, path: outputRel(out), sha256: hashPath(abs).sha256 });
    }
  }
  return refs;
}

/** Words of a shell command that name a file in the flow directory, e.g. "scripts/render.mjs" in "node scripts/render.mjs". */
export function commandFiles(dir: string, command: string): string[] {
  const files: string[] = [];
  for (const word of command.split(/\s+/)) {
    const clean = word.replace(/^['"]|['"]$/g, "");
    if (!clean || clean.startsWith("-") || path.isAbsolute(clean) || clean.includes("..")) continue;
    const abs = path.join(dir, clean);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push(clean);
  }
  return files;
}

/**
 * Fingerprint of how a stage runs: its executor definition, plus the files it
 * uses (the llm/agent prompt file; for scripts and custom agents, any word of
 * the command that is a file in the flow directory, e.g. "node scripts/render.mjs").
 * Editing a prompt or a script therefore marks the stage stale.
 */
export function stageConfigHash(dir: string, stage: Stage): string {
  const files: string[] = [];
  const ex = stage.executor;
  if (ex.type === "llm" || ex.type === "agent") files.push(ex.prompt);
  if (ex.type === "script") files.push(...commandFiles(dir, ex.run));
  if (ex.type === "agent" && ex.agent === "custom" && ex.command) files.push(...commandFiles(dir, ex.command));
  const fileHashes = files.map((f) => {
    const abs = path.join(dir, f);
    return [f, fs.existsSync(abs) ? hashPath(abs).sha256 : null];
  });
  return sha256String(JSON.stringify({ executor: ex, files: fileHashes }));
}

export function inputHash(refs: RunInputRef[], flowInputs: Record<string, unknown>, configHash = ""): string {
  const stable = {
    config: configHash,
    refs: refs.map((r) => [r.stage, r.path, r.sha256]),
    flowInputs: Object.keys(flowInputs)
      .sort()
      .map((k) => [k, flowInputs[k]]),
  };
  return sha256String(JSON.stringify(stable));
}

/** Copy the stage's current outputs into runs/<stage>/<n>/outputs/. */
export function snapshotOutputs(dir: string, stage: Stage, n: number): void {
  const target = path.join(runDir(dir, stage.id, n), "outputs");
  for (const out of stage.outputs) {
    const rel = outputRel(out);
    copyPath(outputAbs(dir, out), path.join(target, rel));
  }
}

export function writeRunRecord(dir: string, record: RunRecord): string {
  const d = runDir(dir, record.stage, record.n);
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, RUN_FILE);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/** Copy the outputs of a past run back into the flow directory (回退). */
export function restoreRun(dir: string, flow: Flow, stageId: string, n: number): RunRecord {
  const stage = requireStage(flow, stageId);
  const run = listRuns(dir, stageId).find((r) => r.n === n);
  if (!run) throw new Error(`阶段 "${stageId}" 没有 v${n} / Stage "${stageId}" has no run #${n}`);
  if (run.status !== "ok") throw new Error(`"${stageId}" 的 v${n} 是失败的运行，没有可回退的产物 / Run #${n} of "${stageId}" failed; nothing to restore`);
  const src = path.join(runDir(dir, stageId, n), "outputs");
  for (const out of stage.outputs) {
    const rel = outputRel(out);
    const from = path.join(src, rel);
    if (!fs.existsSync(from)) throw new Error(`v${n} 里没有 ${rel} 的快照 / Run #${n} has no snapshot of ${rel}`);
    const to = outputAbs(dir, out);
    fs.rmSync(to, { recursive: true, force: true });
    copyPath(from, to);
  }
  return run;
}

/* ---------- flow inputs ---------- */

export class MissingInputsError extends Error {
  constructor(public readonly missing: string[]) {
    super(`缺少流程输入：${missing.join(", ")}。用 --input key=value 传入，或写进 ${LOCAL_FILE} / Missing required flow inputs: ${missing.join(", ")}. Pass --input key=value or add them to ${LOCAL_FILE}`);
    this.name = "MissingInputsError";
  }
}

/** Defaults, then flowgit.local.json, then overrides, with number/boolean coercion. No checks. */
export function resolveFlowInputs(
  dir: string,
  flow: Flow,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const defs = flow.inputs ?? {};
  for (const [k, def] of Object.entries(defs)) {
    if (def.default !== undefined) values[k] = def.default;
  }
  const localFile = path.join(dir, LOCAL_FILE);
  if (fs.existsSync(localFile)) {
    const local = JSON.parse(fs.readFileSync(localFile, "utf8")) as { inputs?: Record<string, unknown> };
    Object.assign(values, local.inputs ?? {});
  }
  Object.assign(values, overrides);
  for (const [k, def] of Object.entries(defs)) {
    if (k in values) values[k] = coerceFlowInput(def, values[k]);
  }
  return values;
}

/** "30" → 30 for number inputs and "true"/"false" → booleans; anything else is left as it is for the checks to report. */
export function coerceFlowInput(def: FlowInput, value: unknown): unknown {
  if (typeof value !== "string" || value === "") return value;
  if (def.type === "number" && Number.isFinite(Number(value))) return Number(value);
  if (def.type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

/** What is wrong with one flow input value (type and enum), or undefined. Bilingual. */
export function flowInputProblem(key: string, def: FlowInput, value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (def.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    return `输入 ${key} 要填数字 / Input "${key}" must be a number, got ${JSON.stringify(value)}`;
  }
  if (def.type === "boolean" && typeof value !== "boolean") {
    return `输入 ${key} 只能是 true 或 false / Input "${key}" must be true or false, got ${JSON.stringify(value)}`;
  }
  if (def.enum && !def.enum.includes(value)) {
    const allowed = def.enum.map((v) => JSON.stringify(v)).join(", ");
    return `输入 ${key} 只能是 ${allowed} / Input "${key}" must be one of ${allowed}, got ${JSON.stringify(value)}`;
  }
  return undefined;
}

/** resolveFlowInputs plus checks: required inputs are set and enum values are allowed. */
export function loadFlowInputs(
  dir: string,
  flow: Flow,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const values = resolveFlowInputs(dir, flow, overrides);
  const defs = flow.inputs ?? {};
  const missing = Object.entries(defs)
    .filter(([k, def]) => def.required && (values[k] === undefined || values[k] === ""))
    .map(([k]) => k);
  if (missing.length) throw new MissingInputsError(missing);
  for (const [k, def] of Object.entries(defs)) {
    const problem = flowInputProblem(k, def, values[k]);
    if (problem) throw new Error(problem);
  }
  return values;
}

export function saveFlowInputs(dir: string, inputs: Record<string, unknown>): void {
  const localFile = path.join(dir, LOCAL_FILE);
  const existing = fs.existsSync(localFile)
    ? (JSON.parse(fs.readFileSync(localFile, "utf8")) as Record<string, unknown>)
    : {};
  const merged = { ...existing, inputs: { ...((existing.inputs as Record<string, unknown>) ?? {}), ...inputs } };
  fs.writeFileSync(localFile, `${JSON.stringify(merged, null, 2)}\n`);
}

/* ---------- status ---------- */

/**
 * True when the stage's outputs on disk differ from what its latest successful
 * run produced, i.e. someone edited them by hand. Missing outputs do not count.
 */
export function outputsEdited(dir: string, stage: Stage, run: RunRecord | undefined = latestOkRun(dir, stage.id)): boolean {
  if (!run || run.status !== "ok") return false;
  return stage.outputs.some((o) => {
    const abs = outputAbs(dir, o);
    if (!fs.existsSync(abs)) return false;
    const rec = run.outputs.find((r) => r.path === outputRel(o));
    return !rec || rec.sha256 !== hashPath(abs).sha256;
  });
}

/** State of one stage judged on its own: its runs, its inputs and its outputs. */
function localStatus(loaded: LoadedFlow, stageId: string, flowInputs: Record<string, unknown>): StageStatus {
  const { dir, flow } = loaded;
  const stage = requireStage(flow, stageId);
  const runs = listRuns(dir, stageId);
  const latest = runs[runs.length - 1];
  const missingUpstream = (stage.inputs ?? []).filter((dep) => {
    const ok = latestOkRun(dir, dep);
    if (!ok) return true;
    return requireStage(flow, dep).outputs.some((o) => !fs.existsSync(outputAbs(dir, o)));
  });
  const base = { stage, latest, runs: runs.length, missingUpstream };
  if (!latest) return { ...base, state: missingUpstream.length ? "waiting-upstream" : "never-run" };
  if (latest.status === "error") return { ...base, state: "error" };
  if (missingUpstream.length) return { ...base, state: "waiting-upstream" };
  const current = inputHash(inputRefs(dir, flow, stage), flowInputs, stageConfigHash(dir, stage));
  if (current !== latest.inputHash) return { ...base, state: "stale" };
  if (outputsEdited(dir, stage, latest)) return { ...base, state: "edited" };
  return { ...base, state: "ok" };
}

/**
 * Status of every stage, in file order. A stage whose upstream is stale,
 * failed or waiting is itself stale (or waiting, if it never ran), so a
 * change shows all the way down the flow, not just one step.
 */
export function statusAll(loaded: LoadedFlow, flowInputs: Record<string, unknown>): StageStatus[] {
  const byId = new Map<string, StageStatus>();
  for (const id of topoOrder(loaded.flow)) {
    const st = localStatus(loaded, id, flowInputs);
    const blocked = (st.stage.inputs ?? []).some((dep) => {
      const up = byId.get(dep)?.state;
      return up === "stale" || up === "error" || up === "waiting-upstream" || up === "never-run";
    });
    if (blocked && (st.state === "ok" || st.state === "edited")) st.state = "stale";
    if (blocked && st.state === "never-run") st.state = "waiting-upstream";
    byId.set(id, st);
  }
  return loaded.flow.stages.map((s) => byId.get(s.id)!);
}

export function stageStatus(loaded: LoadedFlow, stageId: string, flowInputs: Record<string, unknown>): StageStatus {
  requireStage(loaded.flow, stageId);
  return statusAll(loaded, flowInputs).find((s) => s.stage.id === stageId)!;
}
