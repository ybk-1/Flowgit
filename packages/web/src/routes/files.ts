import { publishFlowChanged } from "./events.js";
import { type HandlerCtx, HttpError, normalizePosix, outside, pathProblem, placeInside, realRoot, sendJson, sendStream } from "./shared.js";
import { type Flow, isDirOutput, listFiles, loadFlow, type Output, outputRel } from "@flowgit/core";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const EXT_TYPE: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/plain; charset=utf-8",
};

/** `application/json` and `*+json`. Extension alone does not count. */
export function isJsonMime(type: string): boolean {
  const value = type.toLowerCase();
  return value === "application/json" || value.endsWith("+json");
}

export function invalidUploadName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || name === "." || name === "..") return true;
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) return true;
  if (/[\u0000-\u001f\u007f]/.test(name)) return true;
  if (path.basename(name) !== name) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  return false;
}

export function declaredFileOutput(flow: Flow, rel: string): Output | undefined {
  const norm = normalizePosix(rel);
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      if (isDirOutput(output)) continue;
      if (outputRel(output) === norm) return output;
    }
  }
  return undefined;
}

export function resolveDeclaredFile(
  dir: string,
  rawPath: string | null,
): { ok: true; abs: string; rel: string; output: Output } | { ok: false; status: 400 | 403 } {
  if (rawPath === null || pathProblem(rawPath)) return { ok: false, status: 400 };
  const requested = normalizePosix(rawPath);
  if (!requested || pathProblem(requested)) return { ok: false, status: 400 };
  const root = realRoot(dir);
  if (!root) return { ok: false, status: 400 };
  const abs = placeInside(root, path.resolve(root, requested));
  if (!abs) return { ok: false, status: 400 };
  const output = declaredFileOutput(loadFlow(dir).flow, requested);
  if (!output) return { ok: false, status: 403 };
  return { ok: true, abs, rel: requested, output };
}

export function humanDirOutput(dir: string, stageId: string): { ok: true; abs: string; rel: string } | { ok: false; status: 400 | 403 | 404 } {
  const loaded = loadFlow(dir);
  const stage = loaded.flow.stages.find((item) => item.id === stageId);
  if (!stage) return { ok: false, status: 404 };
  if (stage.executor.type !== "human") return { ok: false, status: 403 };
  const dirs = stage.outputs.filter((output) => isDirOutput(output));
  const dirOutput = dirs[0];
  if (dirs.length !== 1 || !dirOutput) return dirs.length === 0 ? { ok: false, status: 403 } : { ok: false, status: 400 };
  const rel = outputRel(dirOutput);
  if (pathProblem(rel)) return { ok: false, status: 400 };
  const root = realRoot(dir);
  if (!root) return { ok: false, status: 400 };
  const abs = placeInside(root, path.resolve(root, rel));
  if (!abs) return { ok: false, status: 400 };
  return { ok: true, abs, rel };
}

export async function ensureDir(abs: string, rootReal: string): Promise<string> {
  if (!fs.existsSync(abs)) await fs.promises.mkdir(abs, { recursive: true });
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new HttpError(400, "打不开文件夹 / could not open the directory");
  }
  if (outside(rootReal, real) || !fs.statSync(real).isDirectory()) {
    throw new HttpError(403, "只能上传到人工阶段的文件夹产物 / uploads only go into a human stage's directory output");
  }
  return real;
}

export function tempPath(dir: string): string {
  return path.join(dir, `.flowgit-tmp-${crypto.randomBytes(16).toString("hex")}`);
}

/** Stream the request to a new file. The caller renames it into place. */
export async function streamToFile(req: http.IncomingMessage, tmp: string): Promise<void> {
  await pipeline(req, fs.createWriteStream(tmp, { flags: "wx" }));
  const fh = await fs.promises.open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Rename `tmp` over `dest`. A crash leaves the previous file or the temp file, never a half-written dest. */
export async function replaceFile(tmp: string, dest: string): Promise<void> {
  try {
    await fs.promises.rename(tmp, dest);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;
  }
  const backup = `${tmp}.bak`;
  await fs.promises.rename(dest, backup);
  try {
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rename(backup, dest).catch(() => {});
    throw err;
  }
  await fs.promises.rm(backup, { force: true });
}

export async function putFlowFile(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, rawPath: string | null): Promise<void> {
  const target = resolveDeclaredFile(ctx.dir, rawPath);
  if (!target.ok) {
    req.resume();
    const error =
      target.status === 400
        ? "路径不合法 / invalid path"
        : "只能修改阶段声明的产物文件 / only a stage's declared output file can be changed";
    sendJson(res, target.status, { error });
    return;
  }
  if (fs.existsSync(target.abs) && fs.statSync(target.abs).isDirectory()) {
    req.resume();
    sendJson(res, 403, { error: "只能修改阶段声明的产物文件 / only a stage's declared output file can be changed" });
    return;
  }
  await fs.promises.mkdir(path.dirname(target.abs), { recursive: true });
  const tmp = tempPath(path.dirname(target.abs));
  try {
    await streamToFile(req, tmp);
    if (isJsonMime(target.output.type)) {
      const text = await fs.promises.readFile(tmp, "utf8");
      try {
        JSON.parse(text);
      } catch {
        await fs.promises.rm(tmp, { force: true });
        sendJson(res, 400, { error: "JSON 不合法，没有保存 / invalid JSON, not saved" });
        return;
      }
    }
    await replaceFile(tmp, target.abs);
    publishFlowChanged(ctx);
    sendJson(res, 200, { ok: true, path: target.rel });
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

export async function uploadFlowFile(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, url: URL): Promise<void> {
  const rawName = url.searchParams.get("name");
  if (rawName === null || invalidUploadName(rawName)) {
    req.resume();
    sendJson(res, 400, { error: "文件名不合法 / invalid file name" });
    return;
  }
  const name = rawName;
  const stageId = url.searchParams.get("stage");
  if (!stageId) {
    req.resume();
    sendJson(res, 400, { error: "缺少阶段 / missing stage" });
    return;
  }
  const located = humanDirOutput(ctx.dir, stageId);
  if (!located.ok) {
    req.resume();
    const error =
      located.status === 404
        ? "找不到阶段 / stage not found"
        : located.status === 400
          ? "路径不合法 / invalid path"
          : "只能上传到人工阶段的文件夹产物 / uploads only go into a human stage's directory output";
    sendJson(res, located.status, { error });
    return;
  }
  const root = realRoot(ctx.dir);
  if (!root) {
    req.resume();
    sendJson(res, 400, { error: "路径不合法 / invalid path" });
    return;
  }
  let dirAbs: string;
  try {
    dirAbs = await ensureDir(located.abs, root);
  } catch (err) {
    req.resume();
    throw err;
  }
  const dest = path.join(dirAbs, name);
  if (path.basename(dest) !== name || outside(root, dest)) {
    req.resume();
    sendJson(res, 400, { error: "文件名不合法 / invalid file name" });
    return;
  }
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    req.resume();
    sendJson(res, 400, { error: "已有同名文件夹 / a directory with that name already exists" });
    return;
  }
  const tmp = tempPath(dirAbs);
  try {
    await streamToFile(req, tmp);
    await replaceFile(tmp, dest);
    publishFlowChanged(ctx);
    sendJson(res, 200, { ok: true, path: `${located.rel}/${name}` });
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

export function serveFlowFile(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx, rawPath: string | null): void {
  const located = locateFile(ctx.dir, rawPath);
  if (!located.ok) {
    const error = located.status === 400 ? "路径不合法 / invalid path" : "找不到文件 / not found";
    sendJson(res, located.status, { error });
    return;
  }
  if (located.stat.isDirectory()) {
    sendJson(res, 200, { files: listFiles(located.abs) }, { "X-Flowgit-Kind": "directory" });
    return;
  }
  const type = mediaType(located.rel, declaredType(located.flow, located.rel));
  sendStream(req, res, located.abs, located.stat.size, type);
}

export interface LocatedFile {
  ok: true;
  flow: Flow;
  abs: string;
  rel: string;
  stat: fs.Stats;
}

export function locateFile(dir: string, rawPath: string | null): LocatedFile | { ok: false; status: 400 | 404 } {
  if (rawPath === null || pathProblem(rawPath)) return { ok: false, status: 400 };
  const requested = normalizePosix(rawPath);
  if (!requested || pathProblem(requested)) return { ok: false, status: 400 };
  const flow = loadFlow(dir).flow;
  if (!isAllowed(flow, requested)) return { ok: false, status: 404 };

  const root = path.resolve(dir);
  const abs = path.resolve(root, requested);
  if (outside(root, abs)) return { ok: false, status: 400 };
  if (!fs.existsSync(abs)) return { ok: false, status: 404 };

  let rootReal: string;
  let real: string;
  try {
    rootReal = fs.realpathSync(root);
    real = fs.realpathSync(abs);
  } catch {
    return { ok: false, status: 404 };
  }
  if (outside(rootReal, real)) return { ok: false, status: 404 };
  const rel = path.relative(rootReal, real).split(path.sep).join("/");
  // A symlink may point at another file inside the flow. Only follow it when
  // the target is itself a declared output or a run snapshot.
  if (!isAllowed(flow, rel)) return { ok: false, status: 404 };
  return { ok: true, flow, abs: real, rel, stat: fs.statSync(real) };
}

/** Stage outputs (including files inside a directory output) and runs/<stage>/<n>/outputs/. */
export function isAllowed(flow: Flow, rel: string): boolean {
  const norm = normalizePosix(rel);
  if (!norm || norm.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      if (matchesOutput(output, norm)) return true;
    }
  }
  const snap = /^runs\/([^/]+)\/(\d+)\/outputs(?:\/(.*))?$/.exec(norm);
  if (!snap) return false;
  if (!flow.stages.some((stage) => stage.id === snap[1])) return false;
  const rest = snap[3];
  if (rest === undefined) return true;
  return rest.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function matchesOutput(output: Output, norm: string): boolean {
  const base = outputRel(output);
  if (norm === base) return true;
  return isDirOutput(output) && norm.startsWith(`${base}/`);
}

export function declaredType(flow: Flow, rel: string): string | undefined {
  const norm = normalizePosix(rel);
  for (const stage of flow.stages) {
    for (const output of stage.outputs) {
      if (outputRel(output) === norm) return output.type;
    }
  }
  const snap = /^runs\/([^/]+)\/\d+\/outputs\/(.+)$/.exec(norm);
  if (!snap) return undefined;
  const stage = flow.stages.find((item) => item.id === snap[1]);
  if (!stage) return undefined;
  for (const output of stage.outputs) {
    if (outputRel(output) === snap[2]) return output.type;
  }
  return undefined;
}

export function mediaType(rel: string, declared?: string): string {
  if (declared) {
    const value = declared.toLowerCase();
    if (value === "application/json" || value.endsWith("+json")) return "application/json; charset=utf-8";
    // Never serve an output as a page: HTML (and anything else markup-like) comes back as plain text.
    if (value.startsWith("text/html") || value.includes("xml")) return "text/plain; charset=utf-8";
    if (value.startsWith("text/")) return value.includes("charset") ? value : `${value}; charset=utf-8`;
    if (value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/")) return value;
  }
  return EXT_TYPE[path.posix.extname(rel).toLowerCase()] ?? "application/octet-stream";
}
