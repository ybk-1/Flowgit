import { locateFile, mediaType } from "./files.js";
import { CSP, type HandlerCtx, headerString, outside, pathProblem, pipeFile, placeInside, realRoot, send, sendJson } from "./shared.js";
import { findOnPath, hashPath, isDirOutput, isSafeRelative, loadFlow, type Output, outputRel } from "@flowgit/core";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const THUMB_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

export const THUMB_VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

export const THUMB_AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);

export type ThumbKind = "image" | "video" | "audio" | "other";

/** In-flight frame grabs, so two cards asking for the same video share one ffmpeg run. */
export const frameJobs = new Map<string, Promise<boolean>>();

export function thumbKind(output: Output): ThumbKind {
  if (isDirOutput(output)) return "other";
  const type = output.type.toLowerCase();
  const ext = path.posix.extname(outputRel(output)).toLowerCase();
  if (type.startsWith("image/") || THUMB_IMAGE_EXT.has(ext)) return "image";
  if (type.startsWith("audio/") || (THUMB_AUDIO_EXT.has(ext) && !type.startsWith("video/"))) return "audio";
  if (type.startsWith("video/") || THUMB_VIDEO_EXT.has(ext)) return "video";
  return "other";
}

export function isSvgOutput(rel: string, declared?: string): boolean {
  const type = (declared ?? "").toLowerCase();
  return type.includes("svg") || path.posix.extname(rel).toLowerCase() === ".svg";
}

/**
 * GET /api/thumb?stage=&output=
 * Images are the file itself. Video becomes a cached frame. Audio is a duration.
 * Text, JSON and directories are previewed by the page through /api/file.
 */
export async function serveThumb(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): Promise<void> {
  const stageId = url.searchParams.get("stage");
  const outputParam = url.searchParams.get("output");
  if (stageId === null || stageId === "" || outputParam === null || outputParam === "") {
    sendJson(res, 400, { error: "缺少参数 / missing stage or output" });
    return;
  }
  // Same path rules as the file route: `..`, absolute paths, and empty segments stay out.
  if (!isSafeRelative(stageId) || !isSafeRelative(outputParam) || pathProblem(stageId) || pathProblem(outputParam)) {
    sendJson(res, 403, { error: "路径不合法 / invalid path" });
    return;
  }
  if (!/^\d+$/.test(outputParam)) {
    sendJson(res, 400, { error: "产物序号不合法 / invalid output index" });
    return;
  }
  const index = Number(outputParam);
  const flow = loadFlow(ctx.dir).flow;
  const stage = flow.stages.find((item) => item.id === stageId);
  if (!stage) {
    sendJson(res, 404, { error: "找不到阶段 / stage not found" });
    return;
  }
  const output = stage.outputs[index];
  if (!output) {
    sendJson(res, 404, { error: "找不到产物 / output not found" });
    return;
  }
  const rel = outputRel(output);
  if (pathProblem(rel)) {
    sendJson(res, 403, { error: "路径不合法 / invalid path" });
    return;
  }
  const kind = thumbKind(output);
  if (kind === "other") {
    send(res, 204, "", {});
    return;
  }
  const located = locateFile(ctx.dir, rel);
  if (!located.ok) {
    const status = located.status === 400 ? 403 : located.status;
    const error = status === 403 ? "路径不合法 / invalid path" : "找不到文件 / not found";
    sendJson(res, status, { error });
    return;
  }
  if (located.stat.isDirectory()) {
    send(res, 204, "", {});
    return;
  }
  if (kind === "image") {
    const etag = `"${hashPath(located.abs).sha256}"`;
    sendThumbFile(req, res, located.abs, mediaType(located.rel, output.type), etag, isSvgOutput(located.rel, output.type));
    return;
  }
  if (kind === "audio") {
    sendJson(res, 200, { duration: probeDuration(located.abs) });
    return;
  }
  await serveVideoFrame(req, res, ctx.dir, located.abs);
}

export function probeDuration(abs: string): number | null {
  const ffprobe = findOnPath("ffprobe");
  if (!ffprobe) return null;
  const result = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", abs], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const seconds = Number((result.stdout ?? "").trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

export async function serveVideoFrame(req: http.IncomingMessage, res: http.ServerResponse, dir: string, abs: string): Promise<void> {
  const root = realRoot(dir);
  if (!root) {
    sendJson(res, 403, { error: "路径不合法 / invalid path" });
    return;
  }
  const hash = hashPath(abs).sha256;
  const dest = placeInside(root, path.resolve(root, ".flowgit", "thumbs", `${hash}.jpg`));
  if (!dest) {
    sendJson(res, 403, { error: "路径不合法 / invalid path" });
    return;
  }
  const cached = readableInside(root, dest);
  if (cached) {
    sendThumbFile(req, res, cached, "image/jpeg", `"${hash}"`, false);
    return;
  }
  const ffmpeg = findOnPath("ffmpeg");
  if (!ffmpeg) {
    send(res, 204, "", {});
    return;
  }
  const wrote = await grabFrame(ffmpeg, abs, dest, root);
  const frame = wrote ? readableInside(root, dest) : null;
  if (!frame) {
    send(res, 204, "", {});
    return;
  }
  sendThumbFile(req, res, frame, "image/jpeg", `"${hash}"`, false);
}

/** A regular file that still sits inside `root` once links are followed. */
export function readableInside(root: string, abs: string): string | null {
  if (!fs.existsSync(abs)) return null;
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (outside(root, real) || !fs.statSync(real).isFile() || fs.statSync(real).size === 0) return null;
  return real;
}

export function grabFrame(ffmpeg: string, input: string, dest: string, root: string): Promise<boolean> {
  const running = frameJobs.get(dest);
  if (running) return running;
  const job = Promise.resolve().then(() => writeFrame(ffmpeg, input, dest, root));
  frameJobs.set(dest, job);
  void job.finally(() => {
    if (frameJobs.get(dest) === job) frameJobs.delete(dest);
  });
  return job;
}

/** One frame at 1 second, stored as `.flowgit/thumbs/<sha256 of the video>.jpg`. */
export function writeFrame(ffmpeg: string, input: string, dest: string, root: string): boolean {
  if (readableInside(root, dest)) return true;
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  let realParent: string;
  try {
    realParent = fs.realpathSync(parent);
  } catch {
    return false;
  }
  if (outside(root, realParent)) return false;
  const finalDest = path.join(realParent, path.basename(dest));
  if (outside(root, finalDest) || path.basename(finalDest) !== path.basename(dest)) return false;
  if (readableInside(root, finalDest)) return true;
  // ffmpeg picks the container from the extension, so the temp file has to end in .jpg.
  const part = path.join(realParent, `${path.basename(dest, ".jpg")}.part.jpg`);
  if (outside(root, part) || path.basename(part) !== `${path.basename(dest, ".jpg")}.part.jpg`) return false;
  fs.rmSync(part, { force: true });
  const result = spawnSync(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", input, "-frames:v", "1", "-q:v", "3", part],
    { encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
  if (result.status !== 0 || !fs.existsSync(part) || fs.statSync(part).size === 0) {
    fs.rmSync(part, { force: true });
    return false;
  }
  try {
    fs.renameSync(part, finalDest);
  } catch {
    fs.rmSync(part, { force: true });
    return false;
  }
  return Boolean(readableInside(root, finalDest));
}

export function sendThumbFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  abs: string,
  type: string,
  etag: string,
  sandbox: boolean,
): void {
  const size = fs.statSync(abs).size;
  const headers: http.OutgoingHttpHeaders = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": sandbox ? "sandbox" : CSP,
    "Cache-Control": "no-store",
    ETag: etag,
    "Content-Type": type,
    "X-Flowgit-Kind": "file",
    "Content-Length": size,
  };
  if (headerString(req, "if-none-match") === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(req.method === "HEAD" ? 200 : 200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  pipeFile(abs, res);
}
