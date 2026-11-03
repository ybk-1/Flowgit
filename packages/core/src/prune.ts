import { host, path } from "./host/current.js";
import { requireStage } from "./graph.js";
import { outputAbs, runDir, runsDir } from "./runs.js";
import type { Flow, RunRecord, Stage } from "./types.js";
import { hashPath, outputRel } from "./util.js";

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;
/** status mentions prune only when runs/ is over this (500 MiB, labeled MB). */
const RUNS_HINT_BYTES = 500 * MB;

export interface PruneOptions {
  /** Newest versions to keep per stage. Default 5. Minimum 1. */
  keep?: number;
  /** Only this stage. Omit to prune every stage. */
  stage?: string;
}

export interface PruneEntry {
  stage: string;
  n: number;
  /** Bytes in runs/<stage>/<n>/, files only. */
  bytes: number;
}

export interface PrunePlan {
  /** Versions that would be deleted, in flow order then version order. */
  delete: PruneEntry[];
  /** Sum of `delete[].bytes`. */
  bytes: number;
}

function resolveKeep(keep: number | undefined): number {
  const n = keep ?? 5;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--keep 至少是 1，收到 ${String(keep)} / --keep must be at least 1, got ${String(keep)}`);
  }
  return n;
}

/** Bytes of files under abs. Symlinks are not followed. Missing path is 0. */
function pathBytes(abs: string): number {
  if (!host().exists(abs)) return 0;
  let total = 0;
  const walk = (current: string) => {
    const stat = host().lstat(current);
    if (stat.isSymbolicLink()) {
      total += stat.size;
      return;
    }
    if (stat.isDirectory()) {
      for (const name of host().readdir(current)) walk(path.join(current, name));
      return;
    }
    if (stat.isFile()) total += stat.size;
  };
  walk(abs);
  return total;
}

/** Human size with one decimal: KB, then MB, then GB. 1024-based. */
export function formatByteSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / KB).toFixed(1)} KB`;
}

/** Bytes under the flow's runs/ directory. */
export function runsDirBytes(dir: string): number {
  return pathBytes(runsDir(dir));
}

/**
 * Last line of `flowgit status` when runs/ is over 500 MB.
 * Undefined at or below that.
 */
export function runsPruneHint(bytes: number): string | undefined {
  if (bytes <= RUNS_HINT_BYTES) return undefined;
  const size = formatByteSize(bytes);
  return `runs/ 占用 ${size}，可以用 flowgit prune 清理 / runs/ uses ${size}; clean up with flowgit prune`;
}

/** Recorded runs, oldest first. The version number is the folder name, which is what `nextRunNumber` uses. */
function loadStageRuns(dir: string, stageId: string): RunRecord[] {
  const base = runsDir(dir, stageId);
  if (!host().exists(base)) return [];
  const runs: RunRecord[] = [];
  for (const name of host().readdir(base)) {
    if (!/^[1-9]\d*$/.test(name)) continue;
    const file = path.join(base, name, "run.json");
    if (!host().exists(file)) continue;
    try {
      const record = JSON.parse(host().readFile(file, "utf8")) as RunRecord;
      runs.push({ ...record, stage: stageId, n: Number(name) });
    } catch {
      // a half-written run is ignored, and its folder is left in place
    }
  }
  return runs.sort((a, b) => a.n - b.n);
}

/** sha256 of each current output, or undefined when any output is missing or the stage has none. */
function currentHashes(dir: string, stage: Stage): Map<string, string> | undefined {
  if (!stage.outputs.length) return undefined;
  const hashes = new Map<string, string>();
  for (const output of stage.outputs) {
    const abs = outputAbs(dir, output);
    if (!host().exists(abs)) return undefined;
    hashes.set(outputRel(output), hashPath(abs).sha256);
  }
  return hashes;
}

function matchesCurrent(run: RunRecord, hashes: Map<string, string>): boolean {
  if (run.status !== "ok") return false;
  for (const [rel, sha] of hashes) {
    if (run.outputs.find((item) => item.path === rel)?.sha256 !== sha) return false;
  }
  return true;
}

/** Absolute runs/<stage>/<n> that stays inside the flow directory, or undefined. */
function versionDir(dir: string, stageId: string, n: number): string | undefined {
  if (!Number.isInteger(n) || n < 1) return undefined;
  if (!/^[a-z][a-z0-9_-]*$/.test(stageId)) return undefined;
  const target = path.resolve(runDir(dir, stageId, n));
  const rel = path.relative(path.resolve(dir), target);
  const expected = path.join("runs", stageId, String(n));
  if (rel !== expected) return undefined;
  if (!host().exists(path.join(target, "run.json"))) return undefined;
  return target;
}

function keptNumbers(dir: string, stage: Stage, runs: RunRecord[], keep: number): Set<number> {
  const kept = new Set<number>();
  for (const run of runs.slice(-keep)) kept.add(run.n);
  for (const run of runs) if (run.executor === "manual") kept.add(run.n);
  const newestOk = [...runs].reverse().find((run) => run.status === "ok");
  if (newestOk) kept.add(newestOk.n);
  const hashes = currentHashes(dir, stage);
  if (hashes) {
    const match = [...runs].reverse().find((run) => matchesCurrent(run, hashes));
    if (match) kept.add(match.n);
  }
  return kept;
}

/**
 * Versions `prune` would delete. Keeps, per stage: the newest `keep` versions
 * (default 5), every manual version, the newest version whose outputs hash-match
 * the current files, and the newest successful version.
 */
export function planPrune(dir: string, flow: Flow, opts: PruneOptions = {}): PrunePlan {
  const keep = resolveKeep(opts.keep);
  const stages = opts.stage ? [requireStage(flow, opts.stage)] : flow.stages;
  const entries: PruneEntry[] = [];
  for (const stage of stages) {
    const runs = loadStageRuns(dir, stage.id);
    const kept = keptNumbers(dir, stage, runs, keep);
    for (const run of runs) {
      if (kept.has(run.n)) continue;
      const folder = versionDir(dir, stage.id, run.n);
      if (!folder) continue;
      entries.push({ stage: stage.id, n: run.n, bytes: pathBytes(folder) });
    }
  }
  return { delete: entries, bytes: entries.reduce((sum, item) => sum + item.bytes, 0) };
}

/** Delete the folders `planPrune` names. Version numbers are not reused; the folders are removed and nothing is renumbered. */
export function prune(dir: string, flow: Flow, opts: PruneOptions = {}): PrunePlan {
  const plan = planPrune(dir, flow, opts);
  for (const item of plan.delete) {
    const folder = versionDir(dir, item.stage, item.n);
    if (folder) host().rm(folder, { recursive: true, force: true });
  }
  return plan;
}
