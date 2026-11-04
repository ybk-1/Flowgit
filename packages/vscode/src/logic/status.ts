export class StatusParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusParseError";
  }
}

export interface StatusOutput {
  path: string;
  type?: string;
}

export interface StatusStage {
  id: string;
  name: string;
  executor?: string;
  state: string;
  runs: number;
  latest: { n: number; status?: string; finishedAt?: string } | null;
  current: number | null;
  missingUpstream: string[];
  outputs: StatusOutput[];
}

export interface StatusReport {
  flow: { name?: string; version?: string; dir?: string };
  missingInputs: string[];
  stages: StatusStage[];
}

/** Parse stdout of `flowgit status --json`. */
export function parseStatusJson(text: string): StatusReport {
  const trimmed = text.trim();
  if (!trimmed) throw new StatusParseError("empty status output");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new StatusParseError("status output is not JSON");
    try {
      raw = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new StatusParseError("status output is not JSON");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StatusParseError("status JSON is not an object");
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.stages)) throw new StatusParseError("status JSON has no stages");
  const flowRaw = body.flow;
  const flow =
    flowRaw && typeof flowRaw === "object" && !Array.isArray(flowRaw)
      ? {
          name: typeof (flowRaw as { name?: unknown }).name === "string" ? (flowRaw as { name: string }).name : undefined,
          version: typeof (flowRaw as { version?: unknown }).version === "string" ? (flowRaw as { version: string }).version : undefined,
          dir: typeof (flowRaw as { dir?: unknown }).dir === "string" ? (flowRaw as { dir: string }).dir : undefined,
        }
      : {};
  const missingInputs = Array.isArray(body.missingInputs) ? body.missingInputs.filter((item): item is string => typeof item === "string") : [];
  const stages = body.stages.map(parseStage);
  return { flow, missingInputs, stages };
}

function parseStage(value: unknown): StatusStage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StatusParseError("stage is not an object");
  const stage = value as Record<string, unknown>;
  if (typeof stage.id !== "string" || !stage.id) throw new StatusParseError("stage has no id");
  const name = typeof stage.name === "string" ? stage.name : stage.id;
  const latestRaw = stage.latest;
  let latest: StatusStage["latest"] = null;
  if (latestRaw && typeof latestRaw === "object" && !Array.isArray(latestRaw)) {
    const n = (latestRaw as { n?: unknown }).n;
    if (typeof n !== "number") throw new StatusParseError(`stage ${stage.id} latest.n is not a number`);
    latest = {
      n,
      status: typeof (latestRaw as { status?: unknown }).status === "string" ? (latestRaw as { status: string }).status : undefined,
      finishedAt: typeof (latestRaw as { finishedAt?: unknown }).finishedAt === "string" ? (latestRaw as { finishedAt: string }).finishedAt : undefined,
    };
  }
  const outputsRaw = Array.isArray(stage.outputs) ? stage.outputs : [];
  const outputs: StatusOutput[] = [];
  for (const item of outputsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const outputPath = (item as { path?: unknown }).path;
    if (typeof outputPath !== "string") continue;
    const type = (item as { type?: unknown }).type;
    outputs.push({ path: outputPath, type: typeof type === "string" ? type : undefined });
  }
  return {
    id: stage.id,
    name,
    executor: typeof stage.executor === "string" ? stage.executor : undefined,
    state: typeof stage.state === "string" ? stage.state : "never-run",
    runs: typeof stage.runs === "number" ? stage.runs : 0,
    latest,
    current: typeof stage.current === "number" ? stage.current : null,
    missingUpstream: Array.isArray(stage.missingUpstream) ? stage.missingUpstream.filter((item): item is string => typeof item === "string") : [],
    outputs,
  };
}
