import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { flowAccess } from "../flows.js";
import { HttpError } from "../http.js";
import { requireRole } from "../workspaces.js";
import { mcpEnabled, mcpUrl, revokeGrant } from "./oauth.js";

/**
 * Turning a flow's MCP URL on and off, seeing who connected, revoking, and the call log.
 * Off by default; only the flow's workspace owners switch it. Turning it off revokes every grant.
 */

interface GrantView {
  id: string;
  user_id: string;
  user_name: string;
  client: string;
  created_at: number;
  last_used_at: number | null;
}

async function grantsOf(env: Env, flowId: string, onlyUser?: string): Promise<GrantView[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.user_id, u.name AS user_name, c.name AS client, g.created_at, g.last_used_at
       FROM mcp_grants g JOIN users u ON u.id = g.user_id JOIN mcp_clients c ON c.id = g.client_id
     WHERE g.flow_id = ? AND g.revoked_at IS NULL ${onlyUser ? "AND g.user_id = ?" : ""} ORDER BY g.created_at DESC`,
  )
    .bind(...(onlyUser ? [flowId, onlyUser] : [flowId]))
    .all<GrantView>();
  return results;
}

/** GET /api/flows/:flow/mcp: owners see every connection, others their own. */
export async function mcpSettings(env: Env, origin: string, flowId: string, userId: string) {
  const { flow, role } = await flowAccess(env, flowId, userId, "viewer");
  return {
    enabled: await mcpEnabled(env, flow.id),
    url: mcpUrl(origin, flow.id),
    grants: await grantsOf(env, flow.id, role === "owner" ? undefined : userId),
  };
}

/** PUT /api/flows/:flow/mcp { enabled }. */
export async function setMcpEnabled(env: Env, origin: string, flowId: string, userId: string, enabled: unknown) {
  if (typeof enabled !== "boolean") throw new HttpError(400, "enabled 必须是 true 或 false / enabled must be true or false");
  const { flow } = await flowAccess(env, flowId, userId, "owner");
  if (enabled) {
    await env.DB.prepare("INSERT INTO mcp_flows (flow_id, enabled_by, enabled_at) VALUES (?, ?, ?) ON CONFLICT (flow_id) DO NOTHING").bind(flow.id, userId, Date.now()).run();
  } else {
    await env.DB.prepare("DELETE FROM mcp_flows WHERE flow_id = ?").bind(flow.id).run();
    for (const grant of await grantsOf(env, flow.id)) await revokeGrant(env, grant.id);
  }
  await audit(env, { userId, workspaceId: flow.workspace_id, flowId: flow.id, action: enabled ? "mcp.enable" : "mcp.disable" });
  return { enabled, url: mcpUrl(origin, flow.id) };
}

/** DELETE /api/flows/:flow/mcp/grants/:grant: the flow's owners, or the person who connected. */
export async function revokeMcpGrant(env: Env, flowId: string, userId: string, grantId: string): Promise<void> {
  const { flow, role } = await flowAccess(env, flowId, userId, "viewer");
  const grant = await env.DB.prepare("SELECT user_id FROM mcp_grants WHERE id = ? AND flow_id = ? AND revoked_at IS NULL").bind(grantId, flow.id).first<{ user_id: string }>();
  if (!grant || (role !== "owner" && grant.user_id !== userId)) throw new HttpError(404, "没有这个连接 / connection not found");
  await revokeGrant(env, grantId);
  await audit(env, { userId, workspaceId: flow.workspace_id, flowId: flow.id, action: "mcp.revoke", detail: { grant: grantId } });
}

/** GET /api/workspaces/:ws/mcp-calls: owners only, newest first. */
export async function mcpCalls(env: Env, workspaceId: string, userId: string, before?: number) {
  await requireRole(env, workspaceId, userId, "owner");
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.created_at, m.flow_id, m.user_id, u.name AS user_name, m.client, m.tool, m.run_id, m.tokens, m.ok
       FROM mcp_calls m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? AND m.created_at < ? ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
  )
    .bind(workspaceId, before ?? Number.MAX_SAFE_INTEGER)
    .all<{ ok: number }>();
  return results.map((row) => ({ ...row, ok: row.ok === 1 }));
}
