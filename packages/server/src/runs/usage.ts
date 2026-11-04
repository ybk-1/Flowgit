import type { Env } from "../env.js";
import { HttpError } from "../http.js";

/** Model tokens a workspace may use per calendar month (UTC) in the beta, input plus output. */
export const MONTHLY_TOKEN_QUOTA = 2_000_000;
/** Cloud runs a workspace may start per month in the beta. */
export const MONTHLY_RUN_QUOTA = 1000;

export function monthOf(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

export interface Usage {
  month: string;
  tokens: number;
  runs: number;
  tokenQuota: number;
  runQuota: number;
}

export async function usageOf(env: Env, workspaceId: string, month = monthOf()): Promise<Usage> {
  const row = await env.DB.prepare("SELECT tokens, runs FROM usage WHERE workspace_id = ? AND month = ?").bind(workspaceId, month).first<{ tokens: number; runs: number }>();
  return { month, tokens: row?.tokens ?? 0, runs: row?.runs ?? 0, tokenQuota: MONTHLY_TOKEN_QUOTA, runQuota: MONTHLY_RUN_QUOTA };
}

/** Refuse a new run once this month's tokens or runs are used up. */
export async function requireQuota(env: Env, workspaceId: string): Promise<Usage> {
  const usage = await usageOf(env, workspaceId);
  if (usage.tokens >= usage.tokenQuota) {
    throw new HttpError(429, `这个月的 token 用完了（测试版每月 ${usage.tokenQuota}）/ this month's tokens are used up (${usage.tokenQuota} a month in the beta)`, { usage });
  }
  if (usage.runs >= usage.runQuota) {
    throw new HttpError(429, `这个月的运行次数用完了（测试版每月 ${usage.runQuota} 次）/ this month's runs are used up (${usage.runQuota} a month in the beta)`, { usage });
  }
  return usage;
}

export async function addUsage(env: Env, workspaceId: string, add: { tokens?: number; runs?: number }): Promise<void> {
  const tokens = Math.max(0, Math.floor(add.tokens ?? 0));
  const runs = Math.max(0, Math.floor(add.runs ?? 0));
  if (!tokens && !runs) return;
  await env.DB.prepare(
    "INSERT INTO usage (workspace_id, month, tokens, runs) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, month) DO UPDATE SET tokens = tokens + excluded.tokens, runs = runs + excluded.runs",
  )
    .bind(workspaceId, monthOf(), tokens, runs)
    .run();
}
