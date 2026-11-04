import type { Env } from "../env.js";
import { notFound } from "../http.js";
import { type Auth, endSession } from "./session.js";

export interface SessionView {
  /** First 16 hex characters of the token hash. Never the token and never the full hash. */
  id: string;
  kind: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
  current: boolean;
}

interface SessionRow {
  token_hash: string;
  kind: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
}

/** The signed-in person's own sessions. `id` is a prefix of the hash so a row can be revoked without revealing it. */
export async function listSessions(env: Env, auth: Auth): Promise<{ sessions: SessionView[] }> {
  const { results } = await env.DB.prepare(
    "SELECT token_hash, kind, created_at, expires_at, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC",
  )
    .bind(auth.user.id, Date.now())
    .all<SessionRow>();
  return {
    sessions: results.map((row) => ({
      id: row.token_hash.slice(0, 16),
      kind: row.kind,
      created_at: row.created_at,
      expires_at: row.expires_at,
      user_agent: row.user_agent,
      current: row.token_hash === auth.tokenHash,
    })),
  };
}

/**
 * Revoke one of the caller's sessions by the 16-character id from `listSessions`.
 * Returns whether that session is the one making the request.
 */
export async function deleteOwnSession(env: Env, auth: Auth, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{16}$/.test(id)) throw notFound("这个会话 / session");
  const { results } = await env.DB.prepare("SELECT token_hash FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?")
    .bind(auth.user.id, id)
    .all<{ token_hash: string }>();
  if (results.length !== 1) throw notFound("这个会话 / session");
  const tokenHash = results[0]!.token_hash;
  await endSession(env, tokenHash);
  return tokenHash === auth.tokenHash;
}
