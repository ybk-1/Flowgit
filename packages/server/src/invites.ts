import { audit } from "./audit.js";
import type { Env } from "./env.js";
import { forbidden, HttpError, newId, notFound, randomBase32, sha256Hex } from "./http.js";
import { addMember, requireRole, type Role } from "./workspaces.js";

/**
 * Invite codes. A sign-up code (no workspace) lets one new person create an account; only
 * admins make them. A workspace invite adds the person to a workspace with a role, and also
 * lets a new person sign up (the beta is invite-only). Codes are stored as SHA-256 hashes.
 */
export const INVITE_DAYS = 7;
/** Invites a non-admin may create in 30 days, so the beta can't be opened up by one person. */
export const INVITES_PER_MONTH = 20;
const DAY = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface InviteRow {
  id: string;
  workspace_id: string | null;
  role: Role | null;
  created_by: string;
  created_at: number;
  expires_at: number;
  max_uses: number;
  uses: number;
  revoked_at: number | null;
}

function newCode(): string {
  const raw = randomBase32(20, CODE_ALPHABET);
  return `FG-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15)}`;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const admins = adminList(env);
  if (!admins.length) return false;
  const { results } = await env.DB.prepare("SELECT provider, subject FROM identities WHERE user_id = ?").bind(userId).all<{ provider: string; subject: string }>();
  return results.some((row) => admins.includes(`${row.provider}:${row.subject}`));
}

export function adminList(env: Env): string[] {
  return (env.ADMINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createInvite(
  env: Env,
  creatorId: string,
  options: { workspaceId?: string; role?: Role; maxUses?: number; days?: number },
): Promise<{ id: string; code: string; expiresAt: number }> {
  const admin = await isAdmin(env, creatorId);
  if (options.workspaceId) await requireRole(env, options.workspaceId, creatorId, "owner");
  else if (!admin) throw forbidden();
  if (!admin) {
    const since = Date.now() - 30 * DAY;
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND created_at > ?").bind(creatorId, since).first<{ n: number }>();
    if ((row?.n ?? 0) >= INVITES_PER_MONTH) {
      throw new HttpError(429, `测试版每人 30 天最多发 ${INVITES_PER_MONTH} 个邀请 / at most ${INVITES_PER_MONTH} invites per person per 30 days in the beta`);
    }
  }
  const maxUses = Math.min(Math.max(Math.floor(options.maxUses ?? 1), 1), admin ? 100 : 1);
  const days = Math.min(Math.max(Math.floor(options.days ?? INVITE_DAYS), 1), 30);
  const code = newCode();
  const id = newId("inv");
  const now = Date.now();
  const expiresAt = now + days * DAY;
  await env.DB.prepare(
    "INSERT INTO invites (id, code_hash, workspace_id, role, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, await sha256Hex(code), options.workspaceId ?? null, options.workspaceId ? (options.role ?? "editor") : null, creatorId, now, expiresAt, maxUses)
    .run();
  await audit(env, { userId: creatorId, workspaceId: options.workspaceId, action: "invite.create", detail: { invite: id, role: options.role ?? null, maxUses, days } });
  return { id, code, expiresAt };
}

/** A usable invite for this code, or undefined (unknown, used up, expired or revoked). */
export async function findInvite(env: Env, code: string): Promise<InviteRow | undefined> {
  if (!code || code.length > 64) return undefined;
  const row = await env.DB.prepare("SELECT * FROM invites WHERE code_hash = ?").bind(await sha256Hex(normalizeCode(code))).first<InviteRow>();
  if (!row || row.revoked_at || row.expires_at <= Date.now() || row.uses >= row.max_uses) return undefined;
  return row;
}

/** Count one use, atomically; false when someone else took the last use first. */
export async function useInvite(env: Env, invite: InviteRow): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked_at IS NULL AND expires_at > ?")
    .bind(invite.id, Date.now())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** A signed-in person uses a workspace invite to join. */
export async function acceptInvite(env: Env, userId: string, code: string): Promise<{ workspaceId: string; role: Role }> {
  const invite = await findInvite(env, code);
  if (!invite) throw new HttpError(404, "邀请码无效、已过期或已用完 / the invite code is unknown, expired or used up");
  if (!invite.workspace_id || !invite.role) throw new HttpError(400, "这是注册用的邀请码，你已经有账号了 / this is a sign-up code, and you already have an account");
  if (!(await useInvite(env, invite))) throw new HttpError(409, "邀请码刚刚被用完 / the invite code was just used up");
  const role = await addMember(env, invite.workspace_id, userId, invite.role);
  await audit(env, { userId, workspaceId: invite.workspace_id, action: "invite.accept", detail: { invite: invite.id, role } });
  return { workspaceId: invite.workspace_id, role };
}

export async function listInvites(env: Env, userId: string, workspaceId?: string) {
  if (workspaceId) await requireRole(env, workspaceId, userId, "owner");
  else if (!(await isAdmin(env, userId))) throw forbidden();
  const { results } = await env.DB.prepare(
    `SELECT id, workspace_id, role, created_by, created_at, expires_at, max_uses, uses, revoked_at FROM invites
     WHERE ${workspaceId ? "workspace_id = ?" : "workspace_id IS NULL"} ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(...(workspaceId ? [workspaceId] : []))
    .all();
  return results;
}

export async function revokeInvite(env: Env, userId: string, inviteId: string): Promise<void> {
  const invite = await env.DB.prepare("SELECT * FROM invites WHERE id = ?").bind(inviteId).first<InviteRow>();
  if (!invite) throw notFound("这个邀请 / invite");
  if (invite.workspace_id) await requireRole(env, invite.workspace_id, userId, "owner");
  else if (!(await isAdmin(env, userId))) throw forbidden();
  await env.DB.prepare("UPDATE invites SET revoked_at = ? WHERE id = ?").bind(Date.now(), inviteId).run();
  await audit(env, { userId, workspaceId: invite.workspace_id, action: "invite.revoke", detail: { invite: inviteId } });
}
