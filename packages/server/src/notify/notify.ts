import type { Env } from "../env.js";
import { HttpError, newId } from "../http.js";
import { type PushTarget, sendPush, type VapidKeys } from "./webpush.js";

/**
 * Notifications: a row in D1 for the in-app list, and a Web Push message to each browser or
 * device the person subscribed. Push only reaches the browsers' own push services (below), so a
 * stored endpoint can't make the server call anything else.
 */

/**
 * Push services of the browsers people use:
 * Chrome / Edge / Android (FCM), Firefox (Mozilla autopush), Safari (Apple), Windows (WNS).
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export const MAX_SUBSCRIPTIONS_PER_USER = 20;

export type NotificationKind = "run.waiting" | "run.computer" | "run.done" | "run.failed" | "comment.mention";

export interface NewNotification {
  userId: string;
  workspaceId?: string;
  flowId?: string;
  runId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
}

/** Test hook: replaces fetch for push requests. */
export const pushTransport: { fetch?: typeof fetch } = {};

export function vapidKeys(env: Env): VapidKeys | undefined {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return undefined;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:hello@flowgit.dev" };
}

export async function notify(env: Env, note: NewNotification): Promise<string> {
  const id = newId("ntf");
  await env.DB.prepare(
    "INSERT INTO notifications (id, user_id, workspace_id, flow_id, run_id, kind, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, note.userId, note.workspaceId ?? null, note.flowId ?? null, note.runId ?? null, note.kind, note.title.slice(0, 200), note.body.slice(0, 1000), note.url ?? null, Date.now())
    .run();
  const keys = vapidKeys(env);
  if (!keys) return id;
  const { results } = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").bind(note.userId).all<PushTarget & { id: string }>();
  // Small: no keys, no file contents. The service worker shows it and opens `url`.
  const payload = { id, kind: note.kind, title: note.title, body: note.body, url: note.url ?? null };
  await Promise.all(
    results.map(async (target) => {
      try {
        const status = await sendPush(target, payload, keys, pushTransport.fetch);
        if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(target.id).run();
      } catch (err) {
        console.error("push failed", err instanceof Error ? err.message : err);
      }
    }),
  );
  return id;
}

export async function listNotifications(env: Env, userId: string, before?: number, limit = 50) {
  const { results } = await env.DB.prepare(
    "SELECT id, workspace_id, flow_id, run_id, kind, title, body, url, created_at, read_at FROM notifications WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(userId, before ?? Number.MAX_SAFE_INTEGER, Math.min(Math.max(limit, 1), 200))
    .all();
  const unread = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(userId).first<{ n: number }>();
  return { notifications: results, unread: unread?.n ?? 0 };
}

/** Mark some (or, without ids, all) of the person's notifications read. */
export async function markRead(env: Env, userId: string, ids?: string[]): Promise<void> {
  const now = Date.now();
  if (!ids) {
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, userId).run();
    return;
  }
  if (!ids.length) return;
  await env.DB.batch(ids.slice(0, 200).map((id) => env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").bind(now, String(id), userId)));
}

/** Save a browser's PushSubscription (its toJSON(): endpoint and keys). */
export async function subscribe(env: Env, userId: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = (body.keys ?? {}) as Record<string, unknown>;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(400, "endpoint 不是网址 / endpoint is not a URL");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password || !PUSH_HOSTS.some((host) => host.test(url.hostname)) || endpoint.length > 1000) {
    throw new HttpError(400, "只接受浏览器自己的推送服务 / only browser push services are accepted");
  }
  const p256dh = typeof keys.p256dh === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) ? keys.p256dh : undefined;
  const auth = typeof keys.auth === "string" && /^[A-Za-z0-9_-]{16,32}$/.test(keys.auth) ? keys.auth : undefined;
  if (!p256dh || !auth) throw new HttpError(400, "缺少 keys.p256dh 或 keys.auth / missing keys.p256dh or keys.auth");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").bind(userId).first<{ n: number }>();
  const existing = await env.DB.prepare("SELECT id, user_id FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).first<{ id: string; user_id: string }>();
  if (!existing && (count?.n ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) throw new HttpError(429, `最多 ${MAX_SUBSCRIPTIONS_PER_USER} 个设备 / at most ${MAX_SUBSCRIPTIONS_PER_USER} devices`);
  const id = existing?.id ?? newId("push");
  // An endpoint belongs to one browser; whoever signs in there last gets its messages.
  await env.DB.prepare(
    "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth",
  )
    .bind(id, userId, endpoint, p256dh, auth, Date.now())
    .run();
  return { id };
}

export async function unsubscribe(env: Env, userId: string, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string") throw new HttpError(400, "缺少 endpoint / missing endpoint");
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, userId).run();
}
