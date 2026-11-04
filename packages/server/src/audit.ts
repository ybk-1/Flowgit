import type { Env } from "./env.js";

export interface AuditEntry {
  userId?: string | null;
  workspaceId?: string | null;
  flowId?: string | null;
  /** e.g. "flow.create", "file.write", "member.role". */
  action: string;
  /** Small JSON: names, paths, roles. Never secrets or file contents. */
  detail?: Record<string, unknown>;
}

export async function audit(env: Env, entry: AuditEntry): Promise<void> {
  await env.DB.prepare("INSERT INTO audit (at, user_id, workspace_id, flow_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(Date.now(), entry.userId ?? null, entry.workspaceId ?? null, entry.flowId ?? null, entry.action, entry.detail ? JSON.stringify(entry.detail).slice(0, 2000) : null)
    .run();
}

export async function listAudit(env: Env, workspaceId: string, before?: number, limit = 100) {
  const { results } = await env.DB.prepare(
    "SELECT a.id, a.at, a.user_id, u.name AS user_name, a.flow_id, a.action, a.detail FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? AND a.at < ? ORDER BY a.at DESC, a.id DESC LIMIT ?",
  )
    .bind(workspaceId, before ?? Number.MAX_SAFE_INTEGER, Math.min(Math.max(limit, 1), 500))
    .all<{ detail: string | null }>();
  return results.map((row) => ({ ...row, detail: row.detail ? JSON.parse(row.detail) : null }));
}
