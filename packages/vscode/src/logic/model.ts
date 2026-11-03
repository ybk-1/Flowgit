import fs from "node:fs";
import path from "node:path";
import type { CliResolution } from "./cli.js";
import { findFlowsOnDisk } from "./flows.js";
import type { OpenCandidate } from "./outline.js";
import { openCandidates, parseFlowDocument, type FlowOutline, type StageOutline } from "./outline.js";
import { parseStatusJson, type StatusReport, type StatusStage } from "./status.js";
import { taskLaunch } from "./tasks.js";
import { orderByTopo } from "./topo.js";

export type FlowProblem = "cli-missing" | "cli-setting" | "status-failed" | "conflict" | "unreadable";

export interface StageView {
  id: string;
  name: string;
  state?: string;
  executor?: string;
  outputs: string[];
  prompt?: string;
  inputs: string[];
  latest?: number;
  missingUpstream: string[];
}

export interface FlowView {
  dir: string;
  file: string;
  name: string;
  missingInputs: string[];
  conflict: boolean;
  problem?: FlowProblem;
  problemDetail?: string;
  stages: StageView[];
}

export interface CommandRunner {
  (command: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

export function buildFlowView(input: { dir: string; file: string; conflict?: boolean; outline?: FlowOutline; status?: StatusReport; problem?: FlowProblem; problemDetail?: string }): FlowView {
  const outline = input.outline ?? { stages: [] };
  const byOutline = new Map(outline.stages.map((stage) => [stage.id, stage]));
  const baseStages: StageView[] = input.status
    ? input.status.stages.map((stage) => stageView(stage, byOutline.get(stage.id)))
    : outline.stages.map((stage) => stageView(undefined, stage));
  const stages = orderByTopo(baseStages, (stage) => stage.inputs);
  const name = input.status?.flow.name || outline.name || path.basename(input.dir);
  return {
    dir: input.dir,
    file: input.file,
    name,
    missingInputs: input.status?.missingInputs ?? [],
    conflict: input.conflict ?? false,
    problem: input.problem,
    problemDetail: input.problemDetail,
    stages,
  };
}

function stageView(status: StatusStage | undefined, outline: StageOutline | undefined): StageView {
  const id = status?.id ?? outline?.id ?? "";
  return {
    id,
    name: status?.name || outline?.name || id,
    state: status?.state,
    executor: status?.executor ?? outline?.executor,
    outputs: status ? status.outputs.map((output) => output.path) : (outline?.outputs ?? []),
    prompt: outline?.prompt,
    inputs: outline?.inputs ?? [],
    latest: status?.latest?.n,
    missingUpstream: status?.missingUpstream ?? [],
  };
}

export function stageOpenCandidates(stage: StageView, flowFile: string): OpenCandidate[] {
  return openCandidates(stage, path.basename(flowFile));
}

export async function loadFlowViews(opts: { roots: string[]; cli: CliResolution; run: CommandRunner }): Promise<FlowView[]> {
  const found = findFlowsOnDisk(opts.roots);
  const views: FlowView[] = [];
  for (const flow of found) {
    views.push(await loadOne(flow, opts.cli, opts.run));
  }
  return views;
}

async function loadOne(flow: { dir: string; file?: string; conflict: boolean }, cli: CliResolution, run: CommandRunner): Promise<FlowView> {
  const file = flow.file ?? path.join(flow.dir, "flow.json");
  if (flow.conflict) {
    return buildFlowView({ dir: flow.dir, file, conflict: true, problem: "conflict" });
  }
  let outline: FlowOutline = { stages: [] };
  try {
    outline = parseFlowDocument(fs.readFileSync(file, "utf8"), path.basename(file));
  } catch (err) {
    return buildFlowView({
      dir: flow.dir,
      file,
      problem: "unreadable",
      problemDetail: err instanceof Error ? err.message : String(err),
    });
  }
  if (!cli.ok) {
    return buildFlowView({
      dir: flow.dir,
      file,
      outline,
      problem: cli.reason === "setting-missing" ? "cli-setting" : "cli-missing",
      problemDetail: cli.configured,
    });
  }
  const launch = taskLaunch(cli.path, flow.dir, { kind: "status" });
  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await run(launch.command, launch.args, launch.cwd);
  } catch (err) {
    return buildFlowView({
      dir: flow.dir,
      file,
      outline,
      problem: "status-failed",
      problemDetail: err instanceof Error ? err.message : String(err),
    });
  }
  if (result.code !== 0) {
    return buildFlowView({
      dir: flow.dir,
      file,
      outline,
      problem: "status-failed",
      problemDetail: (result.stderr || result.stdout).trim(),
    });
  }
  try {
    const status = parseStatusJson(result.stdout);
    return buildFlowView({ dir: flow.dir, file, outline, status });
  } catch (err) {
    return buildFlowView({
      dir: flow.dir,
      file,
      outline,
      problem: "status-failed",
      problemDetail: err instanceof Error ? err.message : String(err),
    });
  }
}
