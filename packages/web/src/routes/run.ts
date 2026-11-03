import { publish, publishFlowChanged } from "./events.js";
import { type HandlerCtx, HttpError, readJsonObject, sendJson } from "./shared.js";
import { trustPayload } from "./trust.js";
import { HumanInputNeededError, TokenBudgetError, loadFlow, MissingInputsError, runAll, type RunEvent, runStage, TrustNeededError, trustState, UpstreamNotReadyError } from "@flowgit/core";
import http from "node:http";

export function parseRunBody(body: Record<string, unknown>): { stage: string; model?: string } {
  if (typeof body.stage !== "string" || !body.stage.trim()) {
    throw new HttpError(400, "缺少阶段 / missing stage");
  }
  let model: string | undefined;
  if (body.model !== undefined && body.model !== null && body.model !== "") {
    if (typeof body.model !== "string") throw new HttpError(400, "model 必须是字符串 / model must be a string");
    const trimmed = body.model.trim();
    if (trimmed) model = trimmed;
  }
  return { stage: body.stage.trim(), model };
}

export async function postRun(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  const { stage, model } = parseRunBody(body);
  const loaded = loadFlow(ctx.dir);
  if (stage !== "all" && !loaded.flow.stages.some((item) => item.id === stage)) {
    sendJson(res, 404, { error: `没有这个阶段 / unknown stage: ${stage}` });
    return;
  }
  if (ctx.running) {
    sendJson(res, 409, { error: "已有运行在进行 / a run is already in progress" });
    return;
  }
  // A flow copied from a Git URL runs only after the person has seen what it does.
  const trust = trustState(loaded);
  if (trust.needed) {
    sendJson(res, 409, { error: new TrustNeededError(loaded, trust).message, trust: trustPayload(trust) });
    return;
  }
  ctx.running = true;
  ctx.history = [];
  const options = {
    ...(model ? { model } : {}),
    onEvent: (event: RunEvent) => publishRunEvent(ctx, event),
  };
  try {
    try {
      if (stage === "all") await runAll(loaded, options);
      else await runStage(loaded, stage, options);
      const payload = { ok: true as const };
      publish(ctx, "run:end", payload);
      sendJson(res, 200, payload);
    } catch (err) {
      if (err instanceof TokenBudgetError) {
        const payload = { ok: true as const, budget: err.message };
        publish(ctx, "run:end", payload);
        sendJson(res, 200, payload);
        return;
      }
      if (err instanceof HumanInputNeededError) {
        const payload = {
          ok: true as const,
          waiting: {
            stage: err.stage.id,
            name: err.stage.name,
            missing: err.missing,
            ...(err.instructions ? { instructions: err.instructions } : {}),
          },
        };
        publish(ctx, "run:end", payload);
        sendJson(res, 200, payload);
        return;
      }
      const failure = runFailure(err);
      publish(ctx, "run:end", { ok: false, error: failure.error });
      sendJson(res, failure.status, { error: failure.error });
    }
  } finally {
    ctx.running = false;
    publishFlowChanged(ctx);
  }
}

export function runFailure(err: unknown): { status: number; error: string } {
  if (err instanceof MissingInputsError) {
    return { status: 400, error: `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}` };
  }
  if (err instanceof UpstreamNotReadyError) return { status: 400, error: err.message };
  if (err instanceof HttpError) return { status: err.status, error: err.message };
  return { status: 500, error: err instanceof Error ? err.message : String(err) };
}

export function publishRunEvent(ctx: HandlerCtx, event: RunEvent): void {
  const stage = event.stage.id;
  const name = event.stage.name;
  switch (event.type) {
    case "stage:start":
      publish(ctx, event.type, { stage, name, executor: event.stage.executor.type });
      return;
    case "stage:skip":
      publish(ctx, event.type, { stage, name, reason: event.reason });
      return;
    case "stage:log":
      publish(ctx, event.type, { stage, line: event.line });
      return;
    case "stage:done":
      publish(ctx, event.type, { stage, name, n: event.n });
      return;
    case "stage:error":
      publish(ctx, event.type, { stage, name, error: event.error.message });
      return;
  }
}
