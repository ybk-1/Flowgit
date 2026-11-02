import fs from "node:fs";
import path from "node:path";
import type { ExecutorService } from "../types.js";
import { isTextType, outputRel, wantsJson } from "../util.js";
import { proxyHint } from "./llm.js";
import type { ExecContext, ExecResult, InputArtifact, StageExecutor } from "./types.js";

const ENV_REF = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const MAX_UPSTREAM_BYTES = 1024 * 1024;

/** Environment variable names referenced as {{env.NAME}} in header values. */
export function headerEnvNames(headers: Record<string, string> | undefined): string[] {
  const names: string[] = [];
  for (const value of Object.values(headers ?? {})) {
    for (const match of value.matchAll(ENV_REF)) {
      if (!names.includes(match[1]!)) names.push(match[1]!);
    }
  }
  return names;
}

/** Fill {{env.NAME}} from the environment. Throws before any request if one is unset or empty. */
export function resolveHeaderTemplates(headers: Record<string, string> | undefined, env: NodeJS.ProcessEnv): Record<string, string> {
  const missing: string[] = [];
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    resolved[key] = value.replace(ENV_REF, (_all, name: string) => {
      const found = env[name];
      if (found === undefined || found === "") {
        if (!missing.includes(name)) missing.push(name);
        return "";
      }
      return found;
    });
  }
  if (missing.length) {
    throw new Error(`还没设置环境变量 ${missing.join(", ")} / Environment variable(s) not set: ${missing.join(", ")}`);
  }
  return resolved;
}

function upstreamText(inputs: InputArtifact[]): Record<string, Record<string, string>> {
  const upstream: Record<string, Record<string, string>> = {};
  for (const artifact of inputs) {
    if (!artifact.exists || artifact.isDir || !isTextType(artifact.output.type, artifact.output.path)) continue;
    if (fs.statSync(artifact.absPath).size > MAX_UPSTREAM_BYTES) continue;
    const bucket = upstream[artifact.stage] ?? {};
    bucket[outputRel(artifact.output)] = fs.readFileSync(artifact.absPath, "utf8");
    upstream[artifact.stage] = bucket;
  }
  return upstream;
}

export const serviceExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const ex = ctx.stage.executor as ExecutorService;
    if (ctx.stage.outputs.length !== 1) {
      throw new Error(`service 阶段只能有一个产物 / a service stage needs exactly one output ("${ctx.stage.id}" has ${ctx.stage.outputs.length})`);
    }
    let target: URL;
    try {
      target = new URL(ex.url);
    } catch {
      throw new Error(`服务地址不是合法的 URL / service url is not a valid URL: ${ex.url}`);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error(`服务只允许 http 和 https，收到 ${target.protocol} / service url must be http or https, got ${target.protocol}`);
    }
    const headers = resolveHeaderTemplates(ex.headers, ctx.options.env ?? process.env);
    const method = ex.method ?? "POST";
    const timeoutSec = ex.timeoutSec ?? 60;
    if (method === "GET") {
      for (const [key, value] of Object.entries(ctx.flowInputs)) {
        target.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
    }
    const started = Date.now();
    ctx.log(`调用 / calling ${method} ${ex.url}`);
    const signal = AbortSignal.timeout(timeoutSec * 1000);
    const body = method === "POST" ? JSON.stringify({ inputs: ctx.flowInputs, upstream: upstreamText(ctx.inputs) }) : undefined;
    let response: Response;
    let bytes: Buffer;
    try {
      // Redirects are followed by hand: a header can carry a key, so it never goes to another origin.
      let url = target;
      let verb: string = method;
      let payload = body;
      for (let hop = 0; ; hop++) {
        response = await fetch(url, {
          method: verb,
          headers: payload !== undefined ? { "content-type": "application/json", ...headers } : headers,
          body: payload,
          redirect: "manual",
          signal,
        });
        const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
        if (!location) break;
        // Like fetch: 303, and 301/302 after a POST, continue as a GET without the body.
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && verb === "POST")) {
          verb = "GET";
          payload = undefined;
        }
        const next = new URL(location, url);
        if (next.origin !== target.origin) {
          throw new Error(
            `服务要求跳转到另一个地址 ${next.origin}，为了不把请求头（可能有密钥）发过去，没有跟过去。确认可信后把 url 改成新地址 / the service redirected to another origin, ${next.origin}; it was not followed so the headers (which may hold a key) stay put. If you trust it, put the new address in url`,
          );
        }
        if (hop >= 5) throw new Error(`跳转太多次 / too many redirects`);
        url = next;
      }
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      const error = err as Error;
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new Error(`超时（${timeoutSec} 秒），已停止 / Timed out after ${timeoutSec}s and was stopped`);
      }
      if (error.message.includes(" / the service redirected") || error.message.includes("too many redirects")) throw error;
      const hint = proxyHint(ctx.options.env ?? process.env);
      const cause = (error as Error & { cause?: { message?: string } }).cause?.message;
      throw new Error(`调用服务失败 / service call failed: ${error.message}${cause ? ` (${cause})` : ""}${hint ? `\n${hint.join("\n")}` : ""}`);
    }
    if (!response.ok) {
      const preview = bytes.subarray(0, 500).toString("utf8");
      throw new Error(`服务返回 ${response.status} / service returned ${response.status}${preview ? `\n${preview}` : ""}`);
    }
    const output = ctx.stage.outputs[0]!;
    const abs = path.join(ctx.loaded.dir, outputRel(output));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (wantsJson(output.type, output.path)) {
      let data: unknown;
      try {
        data = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        throw new Error(`服务返回的不是 JSON / service response is not JSON`);
      }
      fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
    } else {
      fs.writeFileSync(abs, bytes);
    }
    ctx.log(`已写入 / wrote ${outputRel(output)} (${bytes.length} bytes, ${Date.now() - started} ms)`);
    return { params: { url: ex.url, method, timeoutSec, status: response.status, durationMs: Date.now() - started } };
  },
};
