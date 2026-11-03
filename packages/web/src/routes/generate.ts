import { publishFlowChanged } from "./events.js";
import { type HandlerCtx, readJsonObject, sendJson } from "./shared.js";
import { findFlowFile, generateFlow, type GeneratePreview, isSafeRelative, writeGeneratedFlow } from "@flowgit/core";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";

/**
 * Generate a flow from one sentence. The first call returns a dry run and keeps the files
 * on the server; a second call with that id writes them. `confirm: true` without an id
 * generates and writes in one step. Nothing is written over an existing flow.
 */
export async function postGenerate(req: http.IncomingMessage, res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const body = await readJsonObject(req);
  const confirm = body.confirm === true;
  if (confirm && typeof body.id === "string" && body.id) {
    const pending = ctx.pendingGenerate;
    if (!pending || pending.id !== body.id) {
      sendJson(res, 400, { error: "预演已经过期，请重新生成 / that preview expired; generate it again" });
      return;
    }
    const exists = flowAlreadyThere(pending.dir);
    if (exists) {
      sendJson(res, 400, { error: existsMessage(exists) });
      return;
    }
    try {
      writeGeneratedFlow(pending.dir, pending.preview);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    ctx.pendingGenerate = undefined;
    publishFlowChanged(ctx);
    sendJson(res, 200, publicGenerate(pending.preview, true));
    return;
  }

  const description = typeof body.description === "string" ? body.description : "";
  if (body.language !== undefined && body.language !== "zh" && body.language !== "en") {
    sendJson(res, 400, { error: `语言只能是 zh 或 en，收到 "${String(body.language)}" / language must be zh or en, got "${String(body.language)}"` });
    return;
  }
  const language = body.language === "zh" || body.language === "en" ? body.language : undefined;
  let dir = ctx.dir;
  if (typeof body.dir === "string" && body.dir.trim()) {
    const child = resolveChildDir(ctx.dir, body.dir);
    if ("error" in child) {
      sendJson(res, 400, { error: child.error });
      return;
    }
    dir = child.dir;
  }
  const result = await generateFlow(description, {
    dir,
    ...(typeof body.model === "string" && body.model.trim() ? { model: body.model.trim() } : {}),
    ...(language ? { language } : {}),
    ...(body.md === true ? { md: true } : {}),
    write: false,
  });
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors.join("\n"), errors: result.errors });
    return;
  }
  if (confirm) {
    const exists = flowAlreadyThere(dir);
    if (exists) {
      sendJson(res, 400, { error: existsMessage(exists) });
      return;
    }
    try {
      writeGeneratedFlow(dir, result);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    ctx.pendingGenerate = undefined;
    publishFlowChanged(ctx);
    sendJson(res, 200, publicGenerate(result, true));
    return;
  }
  const id = crypto.randomBytes(16).toString("hex");
  ctx.pendingGenerate = { id, dir, preview: result };
  sendJson(res, 200, { ...publicGenerate(result, false), id, exists: Boolean(flowAlreadyThere(dir)) });
}

function publicGenerate(preview: GeneratePreview, written: boolean) {
  return {
    ok: true as const,
    written,
    flowFile: preview.flowFile,
    name: preview.flow.name,
    files: preview.files.map((file) => file.path),
    plan: preview.plan,
    runsCommands: preview.runsCommands,
    modelCalls: preview.modelCalls,
  };
}

/** A path under the board directory, or a bilingual error when it would escape. */
function resolveChildDir(root: string, rel: string): { dir: string } | { error: string } {
  const cleaned = rel.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const outside = "文件夹必须在看板目录里面 / the folder must stay inside the board directory";
  if (!cleaned || !isSafeRelative(cleaned)) return { error: outside };
  const abs = path.resolve(root, cleaned);
  const back = path.relative(root, abs);
  if (!back || back.startsWith("..") || path.isAbsolute(back)) return { error: outside };
  return { dir: abs };
}

/** The existing flow file, or the bilingual error when both flow.json and flow.md are present. */
function flowAlreadyThere(dir: string): string | undefined {
  try {
    return findFlowFile(dir);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function existsMessage(found: string): string {
  return found.includes(" / ") ? found : `${found} 已存在，没有覆盖 / already exists; nothing was overwritten`;
}
