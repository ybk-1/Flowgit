import { audit } from "./audit.js";
import type { Env } from "./env.js";
import { HttpError, newId, notFound } from "./http.js";
import { ROOM_FLOW, ROOM_USER } from "./rooms/room.js";
import { cleanPath, MAX_FILE_BYTES, MAX_FLOW_FILES, WORKSPACE_QUOTA_BYTES } from "./storage/flow-store.js";
import { atLeast, requireRole, type Role, roleIn } from "./workspaces.js";

export const MAX_FLOWS_PER_WORKSPACE = 200;

export interface FlowRow {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  bytes: number;
}

/** The flow and the caller's role, when the caller has at least `min` in its workspace. */
export async function flowAccess(env: Env, flowId: string, userId: string, min: Role): Promise<{ flow: FlowRow; role: Role }> {
  const flow = await env.DB.prepare("SELECT * FROM flows WHERE id = ?").bind(flowId).first<FlowRow>();
  if (!flow) throw notFound("这个流程 / flow");
  const role = await roleIn(env, flow.workspace_id, userId);
  if (!role) throw notFound("这个流程 / flow");
  if (!atLeast(role, min)) throw new HttpError(403, "没有权限 / not allowed");
  return { flow, role };
}

export async function listFlows(env: Env, workspaceId: string): Promise<FlowRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM flows WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspaceId).all<FlowRow>();
  return results;
}

export async function workspaceBytes(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM flows WHERE workspace_id = ?").bind(workspaceId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function requireSpace(env: Env, workspaceId: string, adding: number): Promise<void> {
  const used = await workspaceBytes(env, workspaceId);
  if (used + adding > WORKSPACE_QUOTA_BYTES) {
    const gb = WORKSPACE_QUOTA_BYTES / 1024 / 1024 / 1024;
    throw new HttpError(413, `工作区的空间用完了（测试版上限 ${gb} GB）/ the workspace is out of space (${gb} GB in the beta)`);
  }
}

export function room(env: Env, flowId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(flowId));
}

/** A request to the flow's room, with the headers the room trusts. */
export function roomRequest(flowId: string, userId: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set(ROOM_FLOW, flowId);
  headers.set(ROOM_USER, userId);
  return new Request(`https://room${path}`, { ...init, headers });
}

/** Template ids and file maps come from the Worker's static assets (templates/<id>.json). */
export async function templateFiles(env: Env, id: string): Promise<Record<string, string>> {
  if (!/^[a-z0-9-]{1,60}$/.test(id) || !env.ASSETS) throw notFound("这个模板 / template");
  const res = await env.ASSETS.fetch(new Request(`https://assets/templates/${id}.json`));
  if (!res.ok) throw notFound("这个模板 / template");
  return ((await res.json()) as { files: Record<string, string> }).files;
}

/** Check a { path: base64 } map before anything is stored. */
export function checkFiles(files: unknown): { files: Record<string, string>; bytes: number } {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new HttpError(400, "files 必须是 { 路径: base64 } / files must be { path: base64 }");
  const out: Record<string, string> = {};
  let bytes = 0;
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length > MAX_FLOW_FILES) throw new HttpError(413, `一个流程最多 ${MAX_FLOW_FILES} 个文件 / a flow can have at most ${MAX_FLOW_FILES} files`);
  for (const [raw, value] of entries) {
    const rel = cleanPath(raw);
    if (!rel || typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new HttpError(400, `文件不合法 / invalid file: ${raw}`);
    const size = Math.floor((value.length * 3) / 4);
    bytes += size;
    if (size > MAX_FILE_BYTES || bytes > MAX_FILE_BYTES) throw new HttpError(413, "一次最多上传 50 MB，更大的文件请创建后再单独上传 / at most 50 MB at once; upload larger files one by one after creating the flow");
    out[rel] = value;
  }
  if (!out["flow.json"] && !out["flow.md"]) throw new HttpError(400, "根目录要有 flow.json 或 flow.md / the root needs a flow.json or flow.md");
  return { files: out, bytes };
}

export async function createFlow(env: Env, userId: string, workspaceId: string, name: string, files: Record<string, string>, bytes: number): Promise<FlowRow> {
  await requireRole(env, workspaceId, userId, "editor");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM flows WHERE workspace_id = ?").bind(workspaceId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_FLOWS_PER_WORKSPACE) {
    throw new HttpError(429, `测试版每个工作区最多 ${MAX_FLOWS_PER_WORKSPACE} 个流程 / at most ${MAX_FLOWS_PER_WORKSPACE} flows per workspace in the beta`);
  }
  await requireSpace(env, workspaceId, bytes);
  const now = Date.now();
  const flow: FlowRow = { id: newId("flw"), workspace_id: workspaceId, name, created_by: userId, created_at: now, updated_at: now, bytes };
  await env.DB.prepare("INSERT INTO flows (id, workspace_id, name, created_by, created_at, updated_at, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(flow.id, workspaceId, name, userId, now, now, bytes)
    .run();
  const res = await room(env, flow.id).fetch(roomRequest(flow.id, userId, "/init", { method: "POST", body: JSON.stringify({ files }) }));
  if (!res.ok) {
    await env.DB.prepare("DELETE FROM flows WHERE id = ?").bind(flow.id).run();
    await room(env, flow.id).fetch(roomRequest(flow.id, userId, "/destroy", { method: "POST" }));
    return Promise.reject(new HttpError(res.status, ((await res.json()) as { error?: string }).error ?? "建流程失败 / could not create the flow"));
  }
  await audit(env, { userId, workspaceId, flowId: flow.id, action: "flow.create", detail: { name, files: Object.keys(files).length } });
  return flow;
}

export async function deleteFlow(env: Env, userId: string, flowId: string): Promise<void> {
  const { flow } = await flowAccess(env, flowId, userId, "owner");
  await room(env, flowId).fetch(roomRequest(flowId, userId, "/destroy", { method: "POST" }));
  await env.DB.prepare("DELETE FROM flows WHERE id = ?").bind(flowId).run();
  await audit(env, { userId, workspaceId: flow.workspace_id, flowId, action: "flow.delete", detail: { name: flow.name } });
}

export async function renameFlow(env: Env, userId: string, flowId: string, name: string): Promise<void> {
  const { flow } = await flowAccess(env, flowId, userId, "editor");
  await env.DB.prepare("UPDATE flows SET name = ?, updated_at = ? WHERE id = ?").bind(name, Date.now(), flowId).run();
  await audit(env, { userId, workspaceId: flow.workspace_id, flowId, action: "flow.rename", detail: { from: flow.name, to: name } });
}
