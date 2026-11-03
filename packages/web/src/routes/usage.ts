import { type HandlerCtx, sendJson } from "./shared.js";
import { flowLog, loadFlow } from "@flowgit/core";
import http from "node:http";

/** Per-stage and overall tokens, from the same totals as `flowgit log` with no stage. */
export function serveUsage(res: http.ServerResponse, ctx: HandlerCtx): void {
  const { stages, total } = flowLog(loadFlow(ctx.dir));
  sendJson(res, 200, { stages, total });
}
