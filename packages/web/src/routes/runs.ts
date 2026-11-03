import { publishFlowChanged } from "./events.js";
import { coreHttpError, type HandlerCtx, HttpError, readJsonObject, sendJson } from "./shared.js";
import { diffRuns, listRuns, loadFlow, requireStage, restoreStage } from "@flowgit/core";
import http from "node:http";

/** Positive run number from a query string. `v1` and `0` are rejected. */
export function parseVersion(raw: string | null): number {
  if (raw === null || raw === "") throw new HttpError(400, "缺少版本 / missing version");
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new HttpError(400, `版本号必须是正整数，收到 "${raw}" / version must be a positive integer, got "${raw}"`);
  }
  return Number(raw);
}

export function serveRuns(res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  const stage = url.searchParams.get("stage")?.trim() ?? "";
  if (!stage) throw new HttpError(400, "缺少阶段 / missing stage");
  const loaded = loadFlow(ctx.dir);
  try {
    requireStage(loaded.flow, stage);
  } catch (err) {
    throw coreHttpError(err);
  }
  sendJson(res, 200, { runs: listRuns(loaded.dir, stage) });
}

/** `b` omitted, or empty, compares version `a` with the current files. */
export function serveDiff(res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  const stage = url.searchParams.get("stage")?.trim() ?? "";
  if (!stage) throw new HttpError(400, "缺少阶段 / missing stage");
  const a = parseVersion(url.searchParams.get("a"));
  const rawB = url.searchParams.get("b");
  const b = rawB === null || rawB === "" ? undefined : parseVersion(rawB);
  const loaded = loadFlow(ctx.dir);
  try {
    sendJson(res, 200, diffRuns(loaded.dir, loaded.flow, stage, a, b));
  } catch (err) {
    throw coreHttpError(err);
  }
}

export async function postRestore(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  if (typeof body.stage !== "string" || !body.stage.trim()) throw new HttpError(400, "缺少阶段 / missing stage");
  if (typeof body.n !== "number" || !Number.isInteger(body.n) || body.n < 1) {
    throw new HttpError(400, "版本号必须是正整数 / version must be a positive integer");
  }
  const loaded = loadFlow(ctx.dir);
  try {
    const { run, kept } = restoreStage(loaded, body.stage.trim(), body.n);
    publishFlowChanged(ctx);
    sendJson(res, 200, { ok: true, stage: run.stage, n: run.n, ...(kept ? { kept: kept.n } : {}) });
  } catch (err) {
    throw coreHttpError(err);
  }
}
