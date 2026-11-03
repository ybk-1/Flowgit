import { CSP, type HandlerCtx, headerString, outside, pathProblem, sendJson, type SseFrame, tokenMatches } from "./shared.js";
import { type Flow, loadFlow, outputRel } from "@flowgit/core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export function publish(ctx: HandlerCtx, event: string, data: unknown, remember = true): void {
  const frame: SseFrame = { id: ++ctx.nextEventId, event, data: JSON.stringify(data) };
  // `flow:changed` is a nudge to reload, not part of the run log a late client replays.
  if (remember) ctx.history.push(frame);
  const text = formatFrame(frame);
  for (const client of [...ctx.clients]) {
    if (!writeSse(client, text)) ctx.clients.delete(client);
  }
}

/** Filesystem events are merged so a save's temp file and rename become one update. */
export const WATCH_DEBOUNCE_MS = 300;

export function publishFlowChanged(ctx: HandlerCtx): void {
  publish(ctx, "flow:changed", {}, false);
}

export function scheduleFlowChanged(ctx: HandlerCtx): void {
  if (!ctx.watching) return;
  if (ctx.changeTimer) clearTimeout(ctx.changeTimer);
  ctx.changeTimer = setTimeout(() => {
    ctx.changeTimer = undefined;
    if (!ctx.watching) return;
    publishFlowChanged(ctx);
  }, WATCH_DEBOUNCE_MS);
}

/**
 * Watch the flow directory. `recursive: true` is used where Node supports it
 * (Windows, macOS, Linux). If that is unavailable or fails (on Linux it can run out of
 * inotify watches), watch the flow directory and the parent of each stage output instead.
 * Never throws: a board that can't watch still works.
 */
export function watchFlow(ctx: HandlerCtx): void {
  ctx.watching = true;
  try {
    ctx.watchers.push(listenDir(ctx, ctx.dir, true));
    return;
  } catch {
    // fall through to the narrower watch
  }
  const seen = new Set<string>();
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(ctx.dir);
  } catch {
    return;
  }
  for (const dir of [path.resolve(ctx.dir), ...outputParentDirs(ctx.dir)]) {
    let real: string;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (seen.has(real) || outside(rootReal, real)) continue;
    seen.add(real);
    try {
      ctx.watchers.push(listenDir(ctx, real, false));
    } catch {
      // A directory that cannot be watched is skipped; explicit pushes still run.
    }
  }
}

export function listenDir(ctx: HandlerCtx, dir: string, recursive: boolean): fs.FSWatcher {
  const watcher = fs.watch(dir, { recursive }, (_event, filename) => {
    onFlowWatch(ctx, dir, filename);
  });
  watcher.on("error", () => {
    // Keep the board up. Saves, uploads, runs, restores and input writes still push.
  });
  return watcher;
}

export function onFlowWatch(ctx: HandlerCtx, watchedDir: string, filename: string | Buffer | null): void {
  if (!ctx.watching || isIgnoredWatch(ctx.dir, watchedDir, filename)) return;
  scheduleFlowChanged(ctx);
}

/** Temp files, and anything under `runs/`, `node_modules/`, `.git/` or `.flowgit/`. A nameless event is ignored so those trees cannot leak through. */
export function isIgnoredWatch(flowDir: string, watchedDir: string, filename: string | Buffer | null): boolean {
  if (filename == null) return true;
  const raw = filename.toString();
  if (!raw) return true;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(watchedDir, raw);
  const rel = path.relative(path.resolve(flowDir), abs);
  if (rel === "" || rel === ".") return false;
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return true;
  return ignoredRelative(rel.split(path.sep).join("/"));
}

export function ignoredRelative(rel: string): boolean {
  const parts = rel.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0) return false;
  const top = parts[0];
  if (top === "runs" || top === "node_modules" || top === ".git" || top === ".flowgit") return true;
  if (parts.some((part) => part === "node_modules" || part === ".git")) return true;
  const base = parts[parts.length - 1] ?? "";
  return base.startsWith(".flowgit-tmp-");
}

export function outputParentDirs(dir: string): string[] {
  let flow: Flow;
  try {
    flow = loadFlow(dir).flow;
  } catch {
    return [];
  }
  const root = path.resolve(dir);
  const parents: string[] = [];
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      const rel = outputRel(output);
      if (pathProblem(rel)) continue;
      const parent = path.resolve(root, path.posix.dirname(rel));
      if (outside(root, parent)) continue;
      parents.push(parent);
    }
  }
  return parents;
}

export async function stopWatching(ctx: HandlerCtx): Promise<void> {
  ctx.watching = false;
  if (ctx.changeTimer) {
    clearTimeout(ctx.changeTimer);
    ctx.changeTimer = undefined;
  }
  const watchers = ctx.watchers.splice(0, ctx.watchers.length);
  await Promise.all(
    watchers.map(async (watcher) => {
      try {
        await watcher.close();
      } catch {
        // already closed
      }
    }),
  );
}

export function formatFrame(frame: SseFrame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${frame.data}\n\n`;
}

export function writeSse(res: http.ServerResponse, text: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(text);
    return true;
  } catch {
    return false;
  }
}

/** Token is `?token=`, not the X-Flowgit-Token header. */
export function serveEvents(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): void {
  if (!tokenMatches(url.searchParams.get("token") ?? undefined, ctx.token)) {
    sendJson(res, 401, { error: "未授权：缺少或错误的令牌 / unauthorized: missing or invalid token" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
    "X-Accel-Buffering": "no",
  });
  res.socket?.setNoDelay(true);
  const last = Number(headerString(req, "last-event-id") ?? "0");
  const after = Number.isFinite(last) ? last : 0;
  writeSse(res, ": connected\n\n");
  for (const frame of ctx.history) {
    if (frame.id > after) writeSse(res, formatFrame(frame));
  }
  ctx.clients.add(res);
  const drop = () => {
    ctx.clients.delete(res);
  };
  req.on("close", drop);
  res.on("error", drop);
}
