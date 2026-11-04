import { audit } from "./audit.js";
import type { Env } from "./env.js";
import { forbidden, HttpError, newId, notFound } from "./http.js";

export type Role = "owner" | "editor" | "viewer";
export const ROLES: Role[] = ["owner", "editor", "viewer"];
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const MAX_WORKSPACES_PER_USER = 10;

export interface Workspace {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

export async function roleIn(env: Env, workspaceId: string, userId: string): Promise<Role | undefined> {
  const row = await env.DB.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first<{ role: Role }>();
  return row?.role;
}

/**
 * The caller's role in the workspace when it is at least `min`. Non-members get 404 (so ids
 * can't be probed); members below `min` get 403.
 */
export async function requireRole(env: Env, workspaceId: string, userId: string, min: Role): Promise<Role> {
  const role = await roleIn(env, workspaceId, userId);
  if (!role) throw notFound("这个工作区 / workspace");
  if (!atLeast(role, min)) throw forbidden();
  return role;
}

export async function listWorkspaces(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, w.created_at, m.role,
       (SELECT COUNT(*) FROM members x WHERE x.workspace_id = w.id) AS members,
       (SELECT COUNT(*) FROM flows f WHERE f.workspace_id = w.id) AS flows
     FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created_at`,
  )
    .bind(userId)
    .all();
  return results;
}

export async function createWorkspace(env: Env, userId: string, name: string): Promise<Workspace> {
  const owned = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE user_id = ? AND role = 'owner'").bind(userId).first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_WORKSPACES_PER_USER) {
    throw new HttpError(429, `测试版每人最多 ${MAX_WORKSPACES_PER_USER} 个工作区 / at most ${MAX_WORKSPACES_PER_USER} workspaces per person in the beta`);
  }
  const workspace: Workspace = { id: newId("ws"), name, created_by: userId, created_at: Date.now() };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)").bind(workspace.id, name, userId, workspace.created_at),
    env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(workspace.id, userId, workspace.created_at),
  ]);
  await audit(env, { userId, workspaceId: workspace.id, action: "workspace.create", detail: { name } });
  return workspace;
}

export async function renameWorkspace(env: Env, userId: string, workspaceId: string, name: string): Promise<void> {
  await requireRole(env, workspaceId, userId, "owner");
  await env.DB.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(name, workspaceId).run();
  await audit(env, { userId, workspaceId, action: "workspace.rename", detail: { name } });
}

export async function listMembers(env: Env, workspaceId: string) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url, m.role, m.created_at,
       (SELECT group_concat(i.provider || ':' || COALESCE(i.login, ''), ' ') FROM identities i WHERE i.user_id = u.id) AS logins
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at`,
  )
    .bind(workspaceId)
    .all();
  return results;
}

async function ownerCount(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'").bind(workspaceId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Owners change roles; the last owner can't step down. */
export async function setMemberRole(env: Env, actorId: string, workspaceId: string, memberId: string, role: Role): Promise<void> {
  await requireRole(env, workspaceId, actorId, "owner");
  const current = await roleIn(env, workspaceId, memberId);
  if (!current) throw notFound("这个成员 / member");
  if (current === "owner" && role !== "owner" && (await ownerCount(env, workspaceId)) <= 1) {
    throw new HttpError(409, "工作区至少要有一个拥有者 / a workspace needs at least one owner");
  }
  await env.DB.prepare("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?").bind(role, workspaceId, memberId).run();
  await audit(env, { userId: actorId, workspaceId, action: "member.role", detail: { member: memberId, from: current, to: role } });
}

/** Owners remove anyone; anyone may leave. The last owner can't leave. */
export async function removeMember(env: Env, actorId: string, workspaceId: string, memberId: string): Promise<void> {
  if (actorId !== memberId) await requireRole(env, workspaceId, actorId, "owner");
  const current = await roleIn(env, workspaceId, memberId);
  if (!current) throw notFound("这个成员 / member");
  if (current === "owner" && (await ownerCount(env, workspaceId)) <= 1) {
    throw new HttpError(409, "工作区至少要有一个拥有者 / a workspace needs at least one owner");
  }
  await env.DB.prepare("DELETE FROM members WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, memberId).run();
  await audit(env, { userId: actorId, workspaceId, action: "member.remove", detail: { member: memberId } });
}

/** Add or upgrade a member (never downgrades an existing role). */
export async function addMember(env: Env, workspaceId: string, userId: string, role: Role): Promise<Role> {
  const current = await roleIn(env, workspaceId, userId);
  if (current && atLeast(current, role)) return current;
  await env.DB.prepare(
    "INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role",
  )
    .bind(workspaceId, userId, role, Date.now())
    .run();
  return role;
}
