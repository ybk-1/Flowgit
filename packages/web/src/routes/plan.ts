import { coreHttpError, type HandlerCtx, HttpError, sendJson } from "./shared.js";
import { loadFlow, MissingInputsError, planModelCalls, planRunAll, type PlanStep } from "@flowgit/core";
import http from "node:http";

export function optionalModel(url: URL): string | undefined {
  const raw = url.searchParams.get("model");
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/** Dry run of `run all`. Nothing is executed; `modelCalls` ignores canned replies. */
export function servePlan(res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  const model = optionalModel(url);
  const loaded = loadFlow(ctx.dir);
  let steps: PlanStep[];
  try {
    steps = planRunAll(loaded, model ? { model } : {});
  } catch (err) {
    if (err instanceof MissingInputsError) {
      throw new HttpError(400, `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}`);
    }
    throw coreHttpError(err);
  }
  sendJson(res, 200, {
    steps: steps.map((step) => ({
      id: step.stage.id,
      name: step.stage.name,
      action: step.action,
      detail: step.detail ?? null,
      callsModel: step.callsModel,
    })),
    modelCalls: planModelCalls(steps),
  });
}
