import { type LoadedFlow, type McpRunOutcome, type McpToolBackend, type McpWaiting, recordsSince, saveFlowInputs, trustState } from "@flowgit/core";
import type { ActiveRun, StopAnswer } from "../rooms/room.js";

/**
 * The shared MCP tools (core's mcp-tools.ts) on a cloud flow: a run is an ordinary cloud run
 * (the room's run lock, Workflows, quotas, the key vault), and the tool answers once it stops.
 * Nothing runs on anyone's computer: a stage that needs one makes the run wait, like the board.
 */
export interface CloudMcpDeps {
  load(): LoadedFlow;
  /** The run holding the room's lock when the call came in. */
  active: ActiveRun | undefined;
  /** The room's beginRun, not detached. */
  begin(stage: string, inputs: Record<string, unknown>): Promise<StopAnswer>;
}

const BUSY = "已经有一次运行在进行，等它结束再试 / a run is already in progress; try again when it finishes";

function nextHint(waiting: McpWaiting): string {
  if (waiting.kind === "computer") {
    return (
      "这个阶段要在电脑上运行：用桌面应用或本机看板（flowgit board）运行它，再调用 run_flow / " +
      "This stage runs on a computer: run it with the desktop app or the local board (flowgit board), then call run_flow again"
    );
  }
  return (
    "用 run_stage 的 files 直接给内容，或在 Flowgit 网页里上传后再调用 run_flow / " +
    "Pass the text in run_stage's files, or upload the files in Flowgit and call run_flow again"
  );
}

/** A StopAnswer from the room as a tool outcome. */
export function outcomeOf(loaded: () => LoadedFlow, answer: StopAnswer): McpRunOutcome {
  const body = answer.body as {
    ok?: boolean;
    error?: string;
    budget?: string;
    trust?: unknown;
    waiting?: { stage: string; name: string; kind: "human" | "computer"; missing?: string[]; instructions?: string };
    run?: { startedAt?: string };
  };
  if (answer.status !== 200 || !body.ok) {
    return { status: "refused", message: body.error ?? `运行没有完成 / the run did not finish (${answer.status})`, ...(body.trust ? { data: { trust: body.trust } } : {}) };
  }
  if (body.budget !== undefined) return { status: "refused", message: body.budget || "这个月的 token 用完了 / this month's tokens are used up" };
  const records = body.run?.startedAt ? recordsSince(loaded(), body.run.startedAt) : [];
  if (body.waiting) {
    const w = body.waiting;
    return {
      status: "waiting",
      records,
      waiting: { stage: w.stage, name: w.name, kind: w.kind, missing: w.missing ?? [], ...(w.instructions ? { instructions: w.instructions } : {}) },
    };
  }
  return { status: "done", records };
}

/**
 * The cloud's MCP URL keeps no session, so inputs given to a run are saved with the flow
 * (flowgit.local.json), the same as filling them in on the board: status and later calls see them.
 */
function remember(loaded: LoadedFlow, inputs: Record<string, unknown>): void {
  const defs = loaded.flow.inputs ?? {};
  const known = Object.fromEntries(Object.entries(inputs).filter(([key]) => Object.hasOwn(defs, key)));
  if (Object.keys(known).length) saveFlowInputs(loaded.dir, known);
}

export function cloudMcpBackend(deps: CloudMcpDeps): McpToolBackend {
  return {
    localPaths: false,
    load: deps.load,
    inputs: (given) => ({ ...given }),
    nextHint,
    refuse: (loaded, stageId) => {
      const trust = trustState(loaded);
      if (trust.needed) {
        return {
          message:
            "这个流程是从别处复制来的，还没确认。先在 Flowgit 网页里打开它，看过它会做什么再确认 / " +
            "This flow was copied from elsewhere and hasn't been confirmed. Open it in Flowgit first, look at what it does, and confirm.",
          data: { source: trust.source ?? null, actions: trust.actions },
        };
      }
      const active = deps.active;
      if (!active) return undefined;
      if (active.state === "running") return { message: BUSY };
      // A waiting run goes on only for the run as a whole or for the stage it waits at, like the board's POST /api/run.
      const same = stageId === undefined || stageId === active.stage || stageId === active.waiting?.stage;
      return same ? undefined : { message: BUSY, data: { waiting: active.waiting ?? null } };
    },
    runFlow: async (loaded, inputs) => {
      remember(loaded, inputs);
      return outcomeOf(deps.load, await deps.begin("all", inputs));
    },
    runStage: async (loaded, stageId, inputs) => {
      remember(loaded, inputs);
      return outcomeOf(deps.load, await deps.begin(stageId, inputs));
    },
  };
}
