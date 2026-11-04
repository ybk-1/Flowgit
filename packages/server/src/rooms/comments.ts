import type { Env } from "../env.js";
import { HttpError, json, newId, readJson, str } from "../http.js";
import { notify } from "../notify/notify.js";
import { cleanPath } from "../storage/flow-store.js";
import { type Collab, type PublicUser, memberRole, socketUser } from "./locks.js";

/**
 * Comments live in D1 only. The text is not written into the flow directory,
 * and callers record the audit line with the path and never the text.
 * https://developers.cloudflare.com/d1/
 */

export interface CommentView {
  id: string;
  path: string;
  start: number | null;
  end: number | null;
  quote: string | null;
  body: string;
  created_at: number;
  resolved_at: number | null;
  user: PublicUser;
}

interface CommentRow {
  id: string;
  path: string;
  start: number | null;
  end: number | null;
  quote: string | null;
  body: string;
  created_at: number;
  resolved_at: number | null;
  user_id: string;
  user_name: string;
  user_avatar: string | null;
}

const SELECT = `SELECT c.id, c.path, c.start, c.end, c.quote, c.body, c.created_at, c.resolved_at,
  c.user_id, u.name AS user_name, u.avatar_url AS user_avatar
  FROM comments c JOIN users u ON u.id = c.user_id`;

function view(row: CommentRow): CommentView {
  return {
    id: row.id,
    path: row.path,
    start: row.start,
    end: row.end,
    quote: row.quote,
    body: row.body,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    user: { id: row.user_id, name: row.user_name, avatar_url: row.user_avatar ?? null },
  };
}

export async function listComments(env: Env, flowId: string): Promise<CommentView[]> {
  const { results } = await env.DB.prepare(`${SELECT} WHERE c.flow_id = ? ORDER BY c.created_at DESC LIMIT 500`).bind(flowId).all<CommentRow>();
  return results.map(view).reverse();
}

async function one(env: Env, flowId: string, id: string): Promise<CommentView | null> {
  const row = await env.DB.prepare(`${SELECT} WHERE c.flow_id = ? AND c.id = ?`).bind(flowId, id).first<CommentRow>();
  return row ? view(row) : null;
}

function optionalInt(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new HttpError(400, `${key} 必须是非负整数 / ${key} must be a non-negative integer`);
  }
  return value;
}

function commentId(pathname: string): string | null {
  const prefix = "/comments/";
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : null;
}

/** POST, PATCH and DELETE /comments. The worker checked the session; the role is read again here. */
export async function handleComments(room: Collab, request: Request, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const role = await memberRole(room.env, room.flowId, room.userId);
  if (!role) throw new HttpError(404, "没有这个流程 / flow not found");
  const id = commentId(url.pathname);
  if (method === "POST" && url.pathname === "/comments") {
    if (role === "viewer") throw new HttpError(403, "没有权限 / not allowed");
    const comment = await createComment(room, await readJson(request, 16 * 1024), room.userId);
    room.broadcast("comment:added", { comment });
    return json(201, { comment });
  }
  if (method === "PATCH" && id) {
    if (role === "viewer") throw new HttpError(403, "没有权限 / not allowed");
    const body = await readJson(request, 1024);
    if (body.resolved !== true) throw new HttpError(400, "只能标为已解决 / only resolving is supported");
    const comment = await resolveComment(room.env, room.flowId, id, room.userId);
    room.broadcast("comment:updated", { comment });
    return json(200, { comment });
  }
  if (method === "DELETE" && id) {
    const existing = await one(room.env, room.flowId, id);
    if (!existing) throw new HttpError(404, "没有这条评论 / comment not found");
    if (existing.user.id !== room.userId && role !== "owner") throw new HttpError(403, "没有权限 / not allowed");
    await room.env.DB.prepare("DELETE FROM comments WHERE id = ? AND flow_id = ?").bind(id, room.flowId).run();
    const comment = { id, path: existing.path, deleted: true };
    room.broadcast("comment:updated", { comment });
    return json(200, { ok: true, comment });
  }
  throw new HttpError(405, "不支持这个方法 / method not allowed");
}

async function createComment(room: Collab, body: Record<string, unknown>, userId: string): Promise<CommentView> {
  const path = cleanPath(typeof body.path === "string" ? body.path : "");
  if (!path) throw new HttpError(400, "路径不合法 / invalid path");
  const text = str(body, "body", 4000);
  if (!text) throw new HttpError(400, "评论是空的 / empty comment");
  const quote = body.quote == null || body.quote === "" ? null : (str(body, "quote", 500) ?? null);
  const start = optionalInt(body, "start");
  const end = optionalInt(body, "end");
  if (start != null && end != null && end < start) throw new HttpError(400, "范围不合法 / invalid range");
  const id = newId("cmt");
  const now = Date.now();
  await room.env.DB.prepare(
    "INSERT INTO comments (id, flow_id, user_id, path, start, end, quote, body, created_at, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
  )
    .bind(id, room.flowId, userId, path, start, end, quote, text, now)
    .run();
  const comment = await one(room.env, room.flowId, id);
  if (!comment) throw new HttpError(500, "评论没有写上 / the comment was not stored");
  await mention(room, comment, text);
  return comment;
}

async function resolveComment(env: Env, flowId: string, id: string, userId: string): Promise<CommentView> {
  const existing = await one(env, flowId, id);
  if (!existing) throw new HttpError(404, "没有这条评论 / comment not found");
  if (existing.resolved_at == null) {
    await env.DB.prepare("UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ? AND flow_id = ? AND resolved_at IS NULL")
      .bind(Date.now(), userId, id, flowId)
      .run();
  }
  const comment = await one(env, flowId, id);
  if (!comment) throw new HttpError(404, "没有这条评论 / comment not found");
  return comment;
}

/**
 * `@name` (a member's exact name, longest first) or `@userId`.
 * The notification and the `mention` frame name the file, never the comment text.
 */
async function mention(room: Collab, comment: CommentView, text: string): Promise<void> {
  const flow = await room.env.DB.prepare("SELECT workspace_id FROM flows WHERE id = ?").bind(room.flowId).first<{ workspace_id: string }>();
  if (!flow) return;
  const { results } = await room.env.DB.prepare("SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?")
    .bind(flow.workspace_id)
    .all<{ id: string; name: string }>();
  const ids = new Set<string>();
  let rest = text;
  for (const member of [...results].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${member.name}`;
    if (!member.name || !rest.includes(needle)) continue;
    ids.add(member.id);
    rest = rest.split(needle).join(" ");
  }
  for (const member of results) {
    if (text.includes(`@${member.id}`)) ids.add(member.id);
  }
  ids.delete(comment.user.id);
  for (const userId of ids) {
    try {
      await notify(room.env, {
        userId,
        workspaceId: flow.workspace_id,
        flowId: room.flowId,
        kind: "comment.mention",
        title: `${comment.user.name} 提到了你 / ${comment.user.name} mentioned you`,
        body: `在 ${comment.path} / on ${comment.path}`,
        url: `/app/?flow=${encodeURIComponent(room.flowId)}`,
      });
    } catch (err) {
      console.error("mention notify failed", err instanceof Error ? err.message : err);
    }
    const data = { commentId: comment.id, flowId: room.flowId, path: comment.path, by: comment.user };
    for (const ws of room.sockets()) {
      if (socketUser(room, ws) === userId) room.send(ws, "mention", data);
    }
  }
}
