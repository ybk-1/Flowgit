import { publishFlowChanged } from "./events.js";
import { type BoardInputField } from "./flow.js";
import { type HandlerCtx, readJsonObject, sendJson } from "./shared.js";
import { type FlowInput, loadFlow, loadFlowInputs, MissingInputsError, resolveFlowInputs, saveFlowInputs } from "@flowgit/core";
import http from "node:http";

export function boardInputs(dir: string): { inputs: BoardInputField[] } {
  const loaded = loadFlow(dir);
  const values = resolveFlowInputs(loaded.dir, loaded.flow);
  const inputs = Object.entries(loaded.flow.inputs ?? {}).map(([name, def]) => inputField(name, def, values[name]));
  return { inputs };
}

export function inputField(name: string, def: FlowInput, value: unknown): BoardInputField {
  const field: BoardInputField = {
    name,
    type: def.type,
    required: def.required === true,
    value: value === undefined ? null : value,
  };
  if (def.description) field.description = def.description;
  if (def.enum) field.enum = def.enum;
  if (def.default !== undefined) field.default = def.default;
  return field;
}

export async function putInputs(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  const loaded = loadFlow(ctx.dir);
  const defs = loaded.flow.inputs ?? {};
  const unknown = Object.keys(body).filter((key) => !Object.hasOwn(defs, key));
  if (unknown.length) {
    sendJson(res, 400, { error: `没有这个输入 / unknown input(s): ${unknown.join(", ")}` });
    return;
  }
  try {
    // Same checks as a run: required inputs are set, enum values are allowed.
    loadFlowInputs(loaded.dir, loaded.flow, body);
  } catch (err) {
    if (err instanceof MissingInputsError) {
      sendJson(res, 400, { error: `缺少流程输入 / missing flow inputs: ${err.missing.join(", ")}` });
      return;
    }
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  saveFlowInputs(loaded.dir, body);
  publishFlowChanged(ctx);
  sendJson(res, 200, { ok: true, inputs: resolveFlowInputs(loaded.dir, loaded.flow) });
}
