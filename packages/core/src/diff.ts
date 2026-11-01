import fs from "node:fs";
import path from "node:path";
import { FILE_HEADERS_ONLY, createTwoFilesPatch } from "diff";
import type { Flow } from "./types.js";
import { requireStage } from "./graph.js";
import { runDir } from "./runs.js";
import { isDirOutput, isTextType, listFiles, outputRel, sha256File } from "./util.js";

// Line diffs use the "diff" package (BSD-3-Clause) so text and JSON outputs
// get a standard unified diff. https://github.com/kpdecker/jsdiff

export interface TextOutputDiff {
  path: string;
  type: string;
  kind: "text";
  same: boolean;
  /** Unified diff. Empty when the two sides match. */
  diff: string;
}

export interface BinaryOutputDiff {
  path: string;
  type: string;
  kind: "binary";
  same: boolean;
}

export interface DirOutputDiff {
  path: string;
  type: string;
  kind: "dir";
  same: boolean;
  /** Paths relative to the directory, using "/". */
  added: string[];
  removed: string[];
  changed: string[];
}

export type OutputDiff = TextOutputDiff | BinaryOutputDiff | DirOutputDiff;

export interface RunDiff {
  stage: string;
  a: number;
  /** null compares version `a` with the current files in the flow directory. */
  b: number | null;
  outputs: OutputDiff[];
}

function missingRun(stageId: string, n: number): Error {
  return new Error(`阶段 "${stageId}" 没有 v${n} / Stage "${stageId}" has no run #${n}`);
}

/** Root that holds one side's output files. A version lives under runs/<stage>/<n>/outputs/. */
function sideRoot(dir: string, stageId: string, n: number | null): string {
  if (n === null) return dir;
  const versionDir = runDir(dir, stageId, n);
  if (!fs.existsSync(versionDir)) throw missingRun(stageId, n);
  return path.join(versionDir, "outputs");
}

function readText(abs: string): string {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return "";
  return fs.readFileSync(abs, "utf8");
}

function fileHash(abs: string): string | null {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return sha256File(abs);
}

function dirHashes(abs: string): Map<string, string> {
  const hashes = new Map<string, string>();
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return hashes;
  for (const rel of listFiles(abs)) hashes.set(rel, sha256File(path.join(abs, rel)));
  return hashes;
}

function unifiedDiff(oldName: string, newName: string, oldText: string, newText: string): string {
  if (oldText === newText) return "";
  return createTwoFilesPatch(oldName, newName, oldText, newText, undefined, undefined, {
    context: 3,
    headerOptions: FILE_HEADERS_ONLY,
  });
}

/**
 * Compare snapshots runs/<stage>/<a>/outputs/ and runs/<stage>/<b>/outputs/.
 * Omit `b` to compare version `a` with the current files in the flow directory.
 * Text (including JSON) is a line unified diff; binaries are same-or-different by sha256;
 * directories list added, removed and changed files.
 */
export function diffRuns(dir: string, flow: Flow, stageId: string, a: number, b?: number): RunDiff {
  const stage = requireStage(flow, stageId);
  const aRoot = sideRoot(dir, stageId, a);
  const bRoot = sideRoot(dir, stageId, b === undefined ? null : b);
  const bLabel = b === undefined ? null : b;
  const outputs: OutputDiff[] = stage.outputs.map((output) => {
    const rel = outputRel(output);
    const left = path.join(aRoot, rel);
    const right = path.join(bRoot, rel);
    if (isDirOutput(output)) {
      const aFiles = dirHashes(left);
      const bFiles = dirHashes(right);
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];
      for (const name of bFiles.keys()) if (!aFiles.has(name)) added.push(name);
      for (const [name, hash] of aFiles) {
        const other = bFiles.get(name);
        if (other === undefined) removed.push(name);
        else if (other !== hash) changed.push(name);
      }
      const byName = (x: string, y: string) => x.localeCompare(y);
      added.sort(byName);
      removed.sort(byName);
      changed.sort(byName);
      return { path: rel, type: output.type, kind: "dir", same: added.length + removed.length + changed.length === 0, added, removed, changed };
    }
    if (isTextType(output.type, output.path)) {
      const oldName = `v${a}/${rel}`;
      const newName = `${bLabel === null ? "current" : `v${bLabel}`}/${rel}`;
      const oldText = readText(left);
      const newText = readText(right);
      const diff = unifiedDiff(oldName, newName, oldText, newText);
      return { path: rel, type: output.type, kind: "text", same: diff === "", diff };
    }
    const same = fileHash(left) === fileHash(right);
    return { path: rel, type: output.type, kind: "binary", same };
  });
  return { stage: stageId, a, b: bLabel, outputs };
}
