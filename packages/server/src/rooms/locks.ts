import type { Stage } from "@flowgit/core";
import type { Env } from "../env.js";
import { HttpError } from "../http.js";
import { cleanPath } from "../storage/flow-store.js";
import type { Role } from "../workspaces.js";

/**
 * Stage locks for one flow room.
 *
 * A lock is stored on the holding WebSocket's attachment and dies with that
 * socket. Hibernation keeps the attachment; nothing here calls `alarm()`.
 * https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 *
 * `lockClock` is the time source so tests can expire a lock without waiting.
 */

/** How long a lock lasts without a heartbeat. The client beats every 30s while editing. */
export const LOCK_TTL_MS = 2 * 60 * 1000;

/** One lock that covers PUT flow and PUT inputs. */
export const WHOLE_FLOW = "*";

/** Client frames larger than this are rejected and the socket stays open. */
export const MAX_LIVE_BYTES = 4096;

export const lockClock: { now: () => number } = { now: () => Date.now() };

/** What a socket remembers across hibernation. No email, no comment text. */
export interface LiveAttachment {
  stage: string | null;
  at: number;
  locks: { stage: string; expiresAt: number }[];
}

/** A person as the board may see them. Email is never part of this. */
export interface PublicUser {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** What the room gives the live modules. The room itself stays a thin hook. */
export interface Collab {
  env: Env;
  flowId: string;
  /** Writer of an HTTP request (`X-Flowgit-User`). Empty when the caller is a socket. */
  userId: string;
  sockets(): WebSocket[];
  tags(ws: WebSocket): string[];
  send(ws: WebSocket, event: string, data: unknown): void;
  broadcast(event: string, data: unknown): void;
  stages(): Stage[];
}

const STAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function validLockStage(stage: unknown): stage is string {
  return stage === WHOLE_FLOW || (typeof stage === "string" && STAGE_ID.test(stage));
}

export function socketUser(room: Collab, ws: WebSocket): string {
  return room.tags(ws)[0] || "";
}

export function readAttachment(ws: WebSocket): LiveAttachment {
  const raw = ws.deserializeAttachment() as Partial<LiveAttachment> | null | undefined;
  const locks = Array.isArray(raw?.locks)
    ? raw.locks.filter((lock) => lock && typeof lock.stage === "string" && typeof lock.expiresAt === "number")
    : [];
  return {
    stage: typeof raw?.stage === "string" && raw.stage ? raw.stage : null,
    at: typeof raw?.at === "number" ? raw.at : 0,
    locks,
  };
}

export function writeAttachment(ws: WebSocket, next: LiveAttachment): void {
  ws.serializeAttachment({ stage: next.stage, at: next.at, locks: next.locks.map((lock) => ({ stage: lock.stage, expiresAt: lock.expiresAt })) });
}

export function noteStage(ws: WebSocket, stage: string | null): void {
  const next = readAttachment(ws);
  next.stage = stage;
  next.at = lockClock.now();
  writeAttachment(ws, next);
}

/** Drop one lock on this socket. Returns whether anything changed. */
export function dropLock(ws: WebSocket, stage: string): boolean {
  const next = readAttachment(ws);
  const locks = next.locks.filter((lock) => lock.stage !== stage);
  if (locks.length === next.locks.length) return false;
  next.locks = locks;
  writeAttachment(ws, next);
  return true;
}

/**
 * Push this socket's live locks out by `LOCK_TTL_MS`. Expired ones fall off.
 * Returns whether the attachment changed (including a lazy expiry).
 */
export function extendLocks(ws: WebSocket, now = lockClock.now()): boolean {
  const next = readAttachment(ws);
  const live = next.locks.filter((lock) => lock.expiresAt > now);
  if (!live.length) {
    if (!next.locks.length) return false;
    next.locks = [];
    writeAttachment(ws, next);
    return true;
  }
  for (const lock of live) lock.expiresAt = now + LOCK_TTL_MS;
  next.locks = live;
  writeAttachment(ws, next);
  return true;
}

export interface HeldLock {
  userId: string;
  stage: string;
  expiresAt: number;
}

export function heldLocks(room: Collab, except: WebSocket | undefined, now: number): HeldLock[] {
  const rows: HeldLock[] = [];
  for (const ws of room.sockets()) {
    if (ws === except) continue;
    const userId = socketUser(room, ws);
    if (!userId || userId === "anonymous") continue;
    for (const lock of readAttachment(ws).locks) {
      if (lock.expiresAt > now) rows.push({ userId, stage: lock.stage, expiresAt: lock.expiresAt });
    }
  }
  return rows;
}

export function watching(room: Collab, except?: WebSocket): { userId: string; stage: string | null }[] {
  const best = new Map<string, { stage: string | null; at: number }>();
  for (const ws of room.sockets()) {
    if (ws === except) continue;
    const userId = socketUser(room, ws);
    if (!userId || userId === "anonymous") continue;
    const att = readAttachment(ws);
    const prev = best.get(userId);
    if (!prev) best.set(userId, { stage: att.stage, at: att.at });
    else if (att.stage && (prev.stage == null || att.at >= prev.at)) best.set(userId, { stage: att.stage, at: att.at });
  }
  return [...best.entries()].map(([userId, info]) => ({ userId, stage: info.stage }));
}

/** flows → workspace → members. The client does not get to claim a role. */
export async function memberRole(env: Env, flowId: string, userId: string): Promise<Role | null> {
  if (!flowId || !userId) return null;
  const flow = await env.DB.prepare("SELECT workspace_id FROM flows WHERE id = ?").bind(flowId).first<{ workspace_id: string }>();
  if (!flow) return null;
  const row = await env.DB.prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?").bind(flow.workspace_id, userId).first<{ role: Role }>();
  return row?.role ?? null;
}

export async function loadProfiles(env: Env, ids: string[]): Promise<Map<string, PublicUser>> {
  const unique = [...new Set(ids)].filter((id) => STAGE_ID.test(id) || /^[A-Za-z0-9_-]{1,80}$/.test(id));
  const map = new Map<string, PublicUser>();
  if (!unique.length) return map;
  const marks = unique.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(`SELECT id, name, avatar_url FROM users WHERE id IN (${marks})`).bind(...unique).all<{
    id: string;
    name: string;
    avatar_url: string | null;
  }>();
  for (const row of results) map.set(row.id, { id: row.id, name: row.name, avatar_url: row.avatar_url ?? null });
  return map;
}

function promptOf(stage: Stage): string | undefined {
  const executor = stage.executor as { prompt?: unknown };
  return typeof executor.prompt === "string" ? executor.prompt : undefined;
}

/** Output paths and the prompt file a stage names. Directory outputs match by prefix. */
export function pathsOf(stage: Stage): string[] {
  const paths: string[] = [];
  for (const output of stage.outputs ?? []) {
    if (!output.path) continue;
    const directory = output.path.endsWith("/") || output.type === "dir" || output.type.startsWith("dir/");
    paths.push(directory && !output.path.endsWith("/") ? `${output.path}/` : output.path);
  }
  const prompt = promptOf(stage);
  if (prompt && !prompt.includes("..") && !prompt.includes("\\") && !prompt.startsWith("/") && !prompt.includes("://")) paths.push(prompt);
  return paths;
}

/** The stage that owns a relative path, or null when none of them do. */
export function stageForPath(stages: Stage[], rel: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const stage of stages) {
    for (const path of pathsOf(stage)) {
      const hit = path.endsWith("/") ? rel.startsWith(path) : rel === path;
      if (hit && (!best || path.length > best.len)) best = { id: stage.id, len: path.length };
    }
  }
  return best?.id ?? null;
}

/**
 * Which lock a write needs.
 * `null` means this request is not guarded (a read, a run, or a path we can't pin to a stage).
 * `WHOLE_FLOW` is the one lock for PUT flow and PUT inputs, and for flow.json / flow.md / flowgit.local.json.
 */
export async function writeTarget(room: Collab, request: Request, url: URL): Promise<string | null> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return null;
  if (url.pathname === "/raw") return targetForPath(room, method, url.searchParams.get("path"));
  if (!url.pathname.startsWith("/board/")) return null;
  const route = url.pathname.slice("/board/".length);
  if (method === "PUT" && route === "file") return targetForPath(room, method, url.searchParams.get("path"));
  if (method === "POST" && route === "upload") return stageId(url.searchParams.get("stage"));
  if (method === "DELETE" && route === "stage") return stageId(url.searchParams.get("id"));
  if (method === "PUT" && (route === "flow" || route === "inputs")) return WHOLE_FLOW;
  if (method === "POST" && route === "stage") return WHOLE_FLOW;
  if ((method === "PUT" && route === "stage") || (method === "POST" && route === "restore")) {
    const text = await peekText(request);
    const key = method === "PUT" ? "id" : "stage";
    const id = jsonField(text, key);
    return stageId(id);
  }
  return null;
}

function stageId(raw: string | null): string | null {
  if (!raw || !STAGE_ID.test(raw)) return null;
  return raw;
}

function targetForPath(room: Collab, method: string, raw: string | null): string | null {
  if (method !== "PUT" && method !== "DELETE") return null;
  const rel = cleanPath(raw);
  if (!rel) return null;
  if (rel === "flow.json" || rel === "flow.md" || rel === "flowgit.local.json") return WHOLE_FLOW;
  return stageForPath(room.stages(), rel);
}

/** The first slice of a JSON body, so a large upload is never buffered just to find an id. */
async function peekText(request: Request): Promise<string> {
  const clone = request.clone();
  const reader = clone.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < 8192) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value);
      size += value.byteLength;
    }
  } catch {
    return "";
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    buf.set(part, at);
    at += part.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function jsonField(text: string, key: string): string | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (value && typeof value[key] === "string") return value[key];
  } catch {
    // The body may be longer than the peek; the id is still at the front.
  }
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]+)"`).exec(text);
  return match?.[1] ?? null;
}

/**
 * Someone else holds this stage, or the whole-flow lock overlaps it.
 * A whole-flow write (`*`) also loses to any stage lock someone else holds,
 * because that write rewrites the flow those locks are about.
 */
export function conflicting(room: Collab, target: string, userId: string, now = lockClock.now()): HeldLock | null {
  for (const held of heldLocks(room, undefined, now)) {
    if (held.userId === userId) continue;
    if (held.stage === target || held.stage === WHOLE_FLOW || target === WHOLE_FLOW) return held;
  }
  return null;
}

async function describe(room: Collab, held: HeldLock): Promise<{ stage: string; user: { id: string; name: string } }> {
  const profiles = await loadProfiles(room.env, [held.userId]);
  return { stage: held.stage, user: { id: held.userId, name: profiles.get(held.userId)?.name || "…" } };
}

export type LockError = { error: string; code: "forbidden" | "locked" | "bad_message"; lock?: { stage: string; user: { id: string; name: string } } };

/**
 * Take `stage` for this socket. One person holds one lock; a second socket of
 * the same person moves it here. A different person gets `locked` and stays connected.
 */
export async function takeLock(room: Collab, ws: WebSocket, stage: unknown): Promise<{ ok: true } | { ok: false; body: LockError }> {
  if (!validLockStage(stage)) return { ok: false, body: { error: "不认识这条消息 / unknown message", code: "bad_message" } };
  const userId = socketUser(room, ws);
  const role = await memberRole(room.env, room.flowId, userId);
  if (role !== "editor" && role !== "owner") {
    return { ok: false, body: { error: "没有权限锁住这一阶段 / not allowed to lock this stage", code: "forbidden" } };
  }
  const now = lockClock.now();
  const hit = conflicting(room, stage, userId, now);
  if (hit) {
    return {
      ok: false,
      body: { error: "这一阶段正在被别人编辑 / someone else is editing this stage", code: "locked", lock: await describe(room, hit) },
    };
  }
  for (const other of room.sockets()) {
    if (socketUser(room, other) !== userId) continue;
    const next = readAttachment(other);
    next.locks = other === ws ? [{ stage, expiresAt: now + LOCK_TTL_MS }] : [];
    writeAttachment(other, next);
  }
  return { ok: true };
}

/**
 * Before a non-GET board write or a raw PUT/DELETE. The run lock answers 409
 * with no `code`; this one uses `code: "locked"` so the two stay distinct.
 * The writer is `X-Flowgit-User` on `room.userId`, never a field from the body.
 */
export async function assertWritable(room: Collab, request: Request, url: URL): Promise<void> {
  const target = await writeTarget(room, request, url);
  if (!target) return;
  const hit = conflicting(room, target, room.userId);
  if (!hit) return;
  const lock = await describe(room, hit);
  const whole = target === WHOLE_FLOW;
  throw new HttpError(409, whole ? "整个流程正在被别人编辑 / someone else is editing this flow" : "这一阶段正在被别人编辑 / someone else is editing this stage", {
    code: "locked",
    lock,
  });
}
