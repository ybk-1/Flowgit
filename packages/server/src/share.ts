import { prepareFlow } from "../../app/src/import.js";
import { audit } from "./audit.js";
import type { Env } from "./env.js";
import { checkFiles, createFlow, flowAccess, room, roomRequest } from "./flows.js";
import { HttpError, newId, newToken, notFound, sha256Hex } from "./http.js";

/** Board routes a public share link may read. Writes, inputs, usage and plan stay closed. */
const SHARE_BOARD = new Set(["flow", "graph", "file", "thumb", "runs", "diff"]);

interface ShareHit {
  id: string;
  flow_id: string;
  name: string;
  workspace_id: string;
  revoked_at: number | null;
}

/** 32 bytes: 256 bits, above the 128-bit minimum. Only the SHA-256 is stored. */
function newShareToken(): string {
  return newToken();
}

async function findShare(env: Env, token: string): Promise<ShareHit> {
  if (!token || token.length > 200) throw notFound("这个分享 / share");
  const row = await env.DB.prepare(
    `SELECT s.id, s.flow_id, s.revoked_at, f.name, f.workspace_id
     FROM shares s JOIN flows f ON f.id = s.flow_id WHERE s.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<ShareHit>();
  if (!row || row.revoked_at) throw notFound("这个分享 / share");
  return row;
}

export async function createShare(env: Env, userId: string, flowId: string): Promise<{ id: string; url: string }> {
  const { flow } = await flowAccess(env, flowId, userId, "editor");
  const token = newShareToken();
  const id = newId("shr");
  await env.DB.prepare("INSERT INTO shares (id, flow_id, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, flow.id, await sha256Hex(token), userId, Date.now()).run();
  await audit(env, { userId, workspaceId: flow.workspace_id, flowId: flow.id, action: "share.create", detail: { share: id } });
  return { id, url: `/app/?share=${token}` };
}

/** Active shares, without tokens. */
export async function listShares(env: Env, userId: string, flowId: string): Promise<{ id: string; created_by: string; created_at: number }[]> {
  const { flow } = await flowAccess(env, flowId, userId, "editor");
  const { results } = await env.DB.prepare("SELECT id, created_by, created_at FROM shares WHERE flow_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
    .bind(flow.id)
    .all<{ id: string; created_by: string; created_at: number }>();
  return results;
}

export async function revokeShare(env: Env, userId: string, flowId: string, shareId: string): Promise<void> {
  const { flow } = await flowAccess(env, flowId, userId, "editor");
  const row = await env.DB.prepare("SELECT id, revoked_at FROM shares WHERE id = ? AND flow_id = ?").bind(shareId, flow.id).first<{ id: string; revoked_at: number | null }>();
  if (!row || row.revoked_at) throw notFound("这个分享 / share");
  await env.DB.prepare("UPDATE shares SET revoked_at = ? WHERE id = ?").bind(Date.now(), shareId).run();
  await audit(env, { userId, workspaceId: flow.workspace_id, flowId: flow.id, action: "share.revoke", detail: { share: shareId } });
}

export async function shareName(env: Env, token: string): Promise<{ name: string }> {
  const share = await findShare(env, token);
  return { name: share.name };
}

/** Read-only board routes for a share. The room sees the user header `share`. */
export async function shareBoard(env: Env, token: string, route: string, url: URL): Promise<Response> {
  if (!SHARE_BOARD.has(route)) throw new HttpError(403, "分享链接不能看这个 / a share link can't read this");
  if (route === "file") {
    const rel = url.searchParams.get("path") ?? "";
    if (rel.split("/").includes("flowgit.local.json")) throw new HttpError(403, "分享链接不能看这个文件 / a share link can't read this file");
  }
  const share = await findShare(env, token);
  return room(env, share.flow_id).fetch(roomRequest(share.flow_id, "share", `/board/${route}${url.search}`, { method: "GET" }));
}

async function readFlowFiles(env: Env, flowId: string): Promise<Record<string, Uint8Array>> {
  const listed = await room(env, flowId).fetch(roomRequest(flowId, "share", "/files"));
  if (!listed.ok) throw new HttpError(listed.status, "读不到流程文件 / could not read the flow");
  const body = (await listed.json()) as { files: { path: string }[] };
  const files: Record<string, Uint8Array> = {};
  for (const file of body.files) {
    const res = await room(env, flowId).fetch(roomRequest(flowId, "share", `/raw?path=${encodeURIComponent(file.path)}`));
    if (!res.ok) throw new HttpError(res.status, `读不到文件 / could not read the file: ${file.path}`);
    files[file.path] = new Uint8Array(await res.arrayBuffer());
  }
  return files;
}

function toBase64(data: Uint8Array): string {
  let bin = "";
  const size = 0x8000;
  for (let i = 0; i < data.length; i += size) bin += String.fromCharCode(...data.subarray(i, Math.min(i + size, data.length)));
  return btoa(bin);
}

/**
 * Copy a shared flow into a workspace the caller can edit.
 * `prepareFlow` drops outputs, `runs/` and local inputs, and records `forkedFrom`
 * as `flowgit:<source flow id>` — the share link itself is never the source.
 */
export async function copyShare(env: Env, userId: string, token: string, workspaceId: string, name?: string): Promise<{ id: string; name: string; workspace_id: string }> {
  const share = await findShare(env, token);
  const prepared = prepareFlow(await readFlowFiles(env, share.flow_id), { forked: { source: `flowgit:${share.flow_id}` } });
  const encoded: Record<string, string> = {};
  for (const [rel, data] of Object.entries(prepared.files)) encoded[rel] = toBase64(data);
  const checked = checkFiles(encoded);
  const flow = await createFlow(env, userId, workspaceId, name || prepared.flow.name || share.name, checked.files, checked.bytes);
  await audit(env, { userId, workspaceId, flowId: flow.id, action: "share.copy", detail: { from: share.flow_id, share: share.id } });
  return flow;
}
