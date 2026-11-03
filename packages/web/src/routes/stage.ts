import { publishFlowChanged } from "./events.js";
import { type HandlerCtx, HttpError, readJsonObject, sendJson } from "./shared.js";
import { type AddableStageType, addStage, type AddStageSpec, type AgentName, findFlowFile, type Flow, FLOW_FILE, FLOW_MD_FILE, type Output, promptSkeleton, readFlowFile, removeStage, validateFlow, type ValidationIssue, writeFlowFile } from "@flowgit/core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

/** Same executors `flowgit stage add` can create. */
export const ADDABLE_TYPES: readonly AddableStageType[] = ["human", "llm", "script", "agent"];

export const AGENT_NAMES: readonly AgentName[] = ["claude-code", "codex", "cursor", "gemini", "custom"];

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} 必须是字符串 / ${key} must be a string`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseOutputs(value: unknown): Output[] {
  if (!Array.isArray(value)) throw new HttpError(400, "outputs 必须是数组 / outputs must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `outputs[${index}] 必须是对象 / outputs[${index}] must be an object`);
    }
    const output = item as Record<string, unknown>;
    if (typeof output.path !== "string" || !output.path.trim()) {
      throw new HttpError(400, `outputs[${index}] 缺少 path / outputs[${index}] is missing path`);
    }
    if (typeof output.type !== "string" || !output.type.trim()) {
      throw new HttpError(400, `outputs[${index}] 缺少 type / outputs[${index}] is missing type`);
    }
    const next: Output = { type: output.type.trim(), path: output.path.trim() };
    if (output.id !== undefined) {
      if (typeof output.id !== "string" || !output.id.trim()) {
        throw new HttpError(400, `outputs[${index}].id 必须是字符串 / outputs[${index}].id must be a string`);
      }
      next.id = output.id.trim();
    }
    if (output.description !== undefined) {
      if (typeof output.description !== "string") {
        throw new HttpError(400, `outputs[${index}].description 必须是字符串 / outputs[${index}].description must be a string`);
      }
      next.description = output.description;
    }
    if (output.schema !== undefined) {
      if (typeof output.schema !== "string" || !output.schema.trim()) {
        throw new HttpError(400, `outputs[${index}].schema 必须是字符串 / outputs[${index}].schema must be a string`);
      }
      next.schema = output.schema.trim();
    }
    return next;
  });
}

/** Body is an `addStage` spec: id, type, and optional name, after, inputs, outputs, prompt, run, agent. */
export function parseAddSpec(body: Record<string, unknown>): AddStageSpec {
  if (typeof body.id !== "string" || !body.id.trim()) throw new HttpError(400, "缺少阶段 id / missing stage id");
  if (typeof body.type !== "string" || !ADDABLE_TYPES.includes(body.type as AddableStageType)) {
    throw new HttpError(
      400,
      `type 只能是 human、llm、script、agent，收到 "${String(body.type)}" / type must be human, llm, script or agent, got "${String(body.type)}"`,
    );
  }
  const spec: AddStageSpec = { id: body.id.trim(), type: body.type as AddableStageType };
  const name = optionalString(body, "name");
  if (name) spec.name = name;
  const after = optionalString(body, "after");
  if (after) spec.after = after;
  if (body.inputs !== undefined) {
    if (!Array.isArray(body.inputs) || body.inputs.some((item) => typeof item !== "string" || !item.trim())) {
      throw new HttpError(400, "inputs 必须是阶段 id 的数组 / inputs must be an array of stage ids");
    }
    spec.inputs = body.inputs.map((item) => (item as string).trim());
  }
  if (body.outputs !== undefined) spec.outputs = parseOutputs(body.outputs);
  const prompt = optionalString(body, "prompt");
  if (prompt) spec.prompt = prompt;
  const run = optionalString(body, "run");
  if (run) spec.run = run;
  if (body.agent !== undefined && body.agent !== null && body.agent !== "") {
    if (typeof body.agent !== "string" || !AGENT_NAMES.includes(body.agent as AgentName)) {
      throw new HttpError(
        400,
        `agent 只能是 ${AGENT_NAMES.join("、")}，收到 "${String(body.agent)}" / agent must be one of ${AGENT_NAMES.join(", ")}, got "${String(body.agent)}"`,
      );
    }
    spec.agent = body.agent as AgentName;
  }
  return spec;
}

export function readFlowSource(dir: string): { file: string; flow: Flow } {
  let file: string | undefined;
  let data: unknown;
  try {
    file = findFlowFile(dir);
    if (!file) throw new HttpError(404, `${dir} 里没有 ${FLOW_FILE} 或 ${FLOW_MD_FILE} / No ${FLOW_FILE} or ${FLOW_MD_FILE} in ${dir}`);
    data = readFlowFile(file);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray((data as Flow).stages)) {
    throw new HttpError(400, `${path.basename(file)} 不是一个流程 / ${path.basename(file)} is not a flow`);
  }
  return { file, flow: data as Flow };
}

export function rejectIssues(res: http.ServerResponse, issues: ValidationIssue[]): void {
  const listed = issues.map((issue) => ({ path: issue.path || "/", message: issue.message }));
  sendJson(res, 400, {
    error: listed.map((issue) => `${issue.path}: ${issue.message}`).join("\n"),
    issues: listed,
  });
}

/**
 * Insert a stage the way `flowgit stage add` does: `addStage`, then `validateFlow`.
 * A missing default prompt for llm/agent is created after validation passes.
 * Nothing is written when validation fails. Runs and output files are never deleted.
 */
export async function postStage(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const spec = parseAddSpec(await readJsonObject(req));
  const { file, flow } = readFlowSource(ctx.dir);
  let next: Flow;
  try {
    next = addStage(flow, spec);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message, issues: [{ path: "/", message }] });
    return;
  }
  const creating = !spec.prompt && (spec.type === "llm" || spec.type === "agent") ? `prompts/${spec.id}.md` : undefined;
  const promptAbs = creating ? path.join(ctx.dir, creating) : undefined;
  const willCreate = Boolean(creating && promptAbs && !fs.existsSync(promptAbs));
  const errors = validateFlow(next, { dir: ctx.dir }).filter((issue) => {
    if (issue.level !== "error") return false;
    return !(willCreate && creating && issue.path.endsWith("/executor/prompt") && issue.message.includes(creating));
  });
  if (errors.length) {
    rejectIssues(res, errors);
    return;
  }
  let created: string | undefined;
  try {
    if (willCreate && creating && promptAbs) {
      fs.mkdirSync(path.dirname(promptAbs), { recursive: true });
      const inputKey = Object.keys(flow.inputs ?? {})[0] ?? "name";
      fs.writeFileSync(promptAbs, promptSkeleton(spec.id, inputKey), { flag: "wx" });
      created = promptAbs;
    }
    writeFlowFile(file, next);
  } catch (err) {
    if (created) fs.rmSync(created, { force: true });
    throw err;
  }
  publishFlowChanged(ctx);
  sendJson(res, 200, { ok: true, id: spec.id, ...(created && creating ? { prompt: creating } : {}) });
}

/**
 * Remove a stage the way `flowgit stage rm` does. Dependents without `force=1` are a 409
 * that names them. Output files and `runs/` are left on disk.
 */
export async function deleteStage(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): Promise<void> {
  req.resume();
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id) throw new HttpError(400, "缺少阶段 id / missing stage id");
  const force = url.searchParams.get("force") === "1";
  const { file, flow } = readFlowSource(ctx.dir);
  const dependents = flow.stages.filter((stage) => (stage.inputs ?? []).includes(id)).map((stage) => stage.id);
  let next: Flow;
  try {
    next = removeStage(flow, id, { force });
  } catch (err) {
    if (!force && dependents.length) {
      sendJson(res, 409, {
        error: `这些阶段还把 "${id}" 当作输入：${dependents.join(", ")} / These stages still use "${id}" as an input: ${dependents.join(", ")}`,
        dependents,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const missing = message.includes("没有阶段") || message.includes("No stage");
    throw new HttpError(missing ? 404 : 400, message);
  }
  const errors = validateFlow(next, { dir: ctx.dir }).filter((issue) => issue.level === "error");
  if (errors.length) {
    rejectIssues(res, errors);
    return;
  }
  writeFlowFile(file, next);
  publishFlowChanged(ctx);
  sendJson(res, 200, { ok: true, id });
}
