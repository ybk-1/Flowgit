import {
  type Collab,
  dropLock,
  extendLocks,
  heldLocks,
  loadProfiles,
  lockClock,
  MAX_LIVE_BYTES,
  memberRole,
  noteStage,
  socketUser,
  takeLock,
  validLockStage,
  watching,
  WHOLE_FLOW,
} from "./locks.js";

/**
 * Presence and the live-message dispatcher.
 * Frames are `{ id, event, data }` from the room. A message we don't understand
 * gets an `error` frame and the socket stays open.
 * https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */

/** Tell everyone who is here and which locks are still live. `except` is a socket that just closed. */
export async function publishLive(room: Collab, except?: WebSocket): Promise<void> {
  const now = lockClock.now();
  const watchers = watching(room, except);
  const locks = heldLocks(room, except, now);
  const profiles = await loadProfiles(room.env, [...watchers.map((item) => item.userId), ...locks.map((lock) => lock.userId)]);
  const people = watchers
    .filter((item) => profiles.has(item.userId))
    .map((item) => ({ ...profiles.get(item.userId)!, stage: item.stage }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const lockViews = locks.filter((lock) => profiles.has(lock.userId)).map((lock) => ({ stage: lock.stage, expiresAt: lock.expiresAt, user: profiles.get(lock.userId)! }));
  room.broadcast("presence:update", { people });
  room.broadcast("lock:update", { locks: lockViews });
}

export async function onLiveLeave(room: Collab, ws: WebSocket): Promise<void> {
  await publishLive(room, ws);
}

function tooBig(room: Collab, ws: WebSocket): void {
  room.send(ws, "error", { error: "消息太大 / message is too large", code: "too_large" });
}

function unknown(room: Collab, ws: WebSocket): void {
  room.send(ws, "error", { error: "不认识这条消息 / unknown message", code: "bad_message" });
}

/** `null` means "not on a stage". `undefined` means the value is not a stage id. */
function presenceStage(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value === WHOLE_FLOW || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value)) return undefined;
  return value;
}

/** `{ type: "presence" | "lock" | "unlock" | "heartbeat" }`. Ping is handled by the room before this. */
export async function onLiveMessage(room: Collab, ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  let text: string;
  if (typeof message === "string") {
    if (message.length > MAX_LIVE_BYTES) return tooBig(room, ws);
    text = message;
  } else {
    if (message.byteLength > MAX_LIVE_BYTES) return tooBig(room, ws);
    text = new TextDecoder().decode(message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unknown(room, ws);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return unknown(room, ws);
  const body = parsed as Record<string, unknown>;
  if (body.type === "presence") {
    const stage = presenceStage(body.stage);
    if (stage === undefined) return unknown(room, ws);
    const role = await memberRole(room.env, room.flowId, socketUser(room, ws));
    if (!role) {
      room.send(ws, "error", { error: "没有权限 / not allowed", code: "forbidden" });
      return;
    }
    noteStage(ws, stage);
    await publishLive(room);
    return;
  }
  if (body.type === "lock") {
    const result = await takeLock(room, ws, body.stage);
    if (!result.ok) {
      room.send(ws, "error", result.body);
      return;
    }
    await publishLive(room);
    return;
  }
  if (body.type === "unlock") {
    if (!validLockStage(body.stage)) return unknown(room, ws);
    dropLock(ws, body.stage);
    await publishLive(room);
    return;
  }
  if (body.type === "heartbeat") {
    if (extendLocks(ws)) await publishLive(room);
    return;
  }
  unknown(room, ws);
}
