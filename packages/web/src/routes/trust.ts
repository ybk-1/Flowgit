import { coreHttpError, type HandlerCtx, HttpError, readJsonObject, sendJson } from "./shared.js";
import { type FlowAction, loadFlow, TrustChangedError, trustFlow, type TrustState } from "@flowgit/core";
import http from "node:http";

/** What the page shows before it asks to confirm a copied flow. */
export function trustPayload(state: TrustState): { reason: string; source: string | null; fingerprint: string; actions: FlowAction[] } {
  return { reason: state.reason, source: state.source ?? null, fingerprint: state.fingerprint, actions: state.actions };
}

/**
 * Confirm a copied flow, like `flowgit trust`. The body carries the fingerprint of the list
 * the person was shown; if the flow changed since, nothing is recorded and the new list comes back.
 */
export async function postTrust(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  if (typeof body.fingerprint !== "string" || !body.fingerprint) throw new HttpError(400, "缺少 fingerprint / missing fingerprint");
  const loaded = loadFlow(ctx.dir);
  try {
    const state = trustFlow(loaded, body.fingerprint);
    sendJson(res, 200, { ok: true, reason: state.reason });
  } catch (err) {
    if (err instanceof TrustChangedError) {
      sendJson(res, 409, { error: err.message, trust: trustPayload(err.state) });
      return;
    }
    throw coreHttpError(err);
  }
}
