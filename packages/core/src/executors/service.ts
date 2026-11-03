import { host, path } from "../host/current.js";
import { proxyHint } from "../proxy-env.js";
import { errorStatus, isRetryableError, retryDelayMs, retryErrorLine, sleep, type RetryRecord } from "../retry.js";
import type { ExecutorService } from "../types.js";
import { bytesToText, isTextType, linkOutsideError, outputRel, wantsJson } from "../util.js";
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
    if (artifact.outside) throw linkOutsideError(outputRel(artifact.output));
    if (!artifact.exists || artifact.isDir || !isTextType(artifact.output.type, artifact.output.path)) continue;
    if (host().stat(artifact.absPath).size > MAX_UPSTREAM_BYTES) continue;
    const bucket = upstream[artifact.stage] ?? {};
    bucket[outputRel(artifact.output)] = host().readFile(artifact.absPath, "utf8");
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
    const headers = resolveHeaderTemplates(ex.headers, ctx.options.env ?? host().env);
    const method = ex.method ?? "POST";
    const timeoutSec = ex.timeoutSec ?? 60;
    if (method === "GET") {
      for (const [key, value] of Object.entries(ctx.flowInputs)) {
        target.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
    }
    const started = Date.now();
    ctx.log(`调用 / calling ${method} ${ex.url}`);
    const body = method === "POST" ? JSON.stringify({ inputs: ctx.flowInputs, upstream: upstreamText(ctx.inputs) }) : undefined;
    const retries = Math.max(0, ex.retries ?? 0);
    const retryLog: RetryRecord[] = [];
    const random = ctx.options.random ?? Math.random;
    const wait = ctx.options.sleep ?? sleep;
    const stamp = (err: unknown): never => {
      if (retryLog.length) {
        const error = err as Error & { params?: Record<string, unknown> };
        error.params = { ...(error.params ?? {}), url: ex.url, method, timeoutSec, retries: retryLog };
      }
      throw err;
    };

    let response!: Response;
    let bytes!: Uint8Array;
    for (let attempt = 0; ; attempt++) {
      try {
        const signal = AbortSignal.timeout(timeoutSec * 1000);
        // Redirects are followed by hand: a header can carry a key, so it never goes to another origin.
        let url = target;
        let verb: string = method;
        let payload = body;
        for (let hop = 0; ; hop++) {
          response = await host().fetch(url, {
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
            throw Object.assign(
              new Error(
                `服务要求跳转到另一个地址 ${next.origin}，为了不把请求头（可能有密钥）发过去，没有跟过去。确认可信后把 url 改成新地址 / the service redirected to another origin, ${next.origin}; it was not followed so the headers (which may hold a key) stay put. If you trust it, put the new address in url`,
              ),
              { retryable: false },
            );
          }
          if (hop >= 5) throw Object.assign(new Error(`跳转太多次 / too many redirects`), { retryable: false });
          url = next;
        }
        bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok) {
          const preview = bytesToText(bytes.subarray(0, 500));
          const status = response.status;
          throw Object.assign(new Error(`服务返回 ${status} / service returned ${status}${preview ? `\n${preview}` : ""}`), {
            status,
            retryable: status === 429 || status >= 500,
          });
        }
        break;
      } catch (err) {
        const error = err as Error & { retryable?: boolean; status?: number };
        let thrown: Error = error;
        if (error.retryable === undefined && error.status === undefined) {
          if (error.name === "TimeoutError" || error.name === "AbortError") {
            thrown = new Error(`超时（${timeoutSec} 秒），已停止 / Timed out after ${timeoutSec}s and was stopped`);
          } else if (!error.message.includes(" / the service redirected") && !error.message.includes("too many redirects")) {
            const hint = proxyHint(ctx.options.env ?? host().env, target.href);
            const cause = (error as Error & { cause?: { message?: string } }).cause?.message;
            thrown = Object.assign(
              new Error(`调用服务失败 / service call failed: ${error.message}${cause ? ` (${cause})` : ""}${hint ? `\n${hint.join("\n")}` : ""}`),
              { retryable: isRetryableError(error) },
            );
          }
        }
        if (attempt >= retries || !isRetryableError(thrown)) stamp(thrown);
        const n = attempt + 1;
        const delayMs = retryDelayMs(n, random());
        const status = errorStatus(thrown);
        const rec: RetryRecord = { n, ...(status !== undefined ? { status } : {}), error: retryErrorLine(thrown), delayMs };
        retryLog.push(rec);
        ctx.log(`第 ${n}/${retries} 次重试，${delayMs} ms 后 / retry ${n}/${retries} in ${delayMs} ms: ${rec.error}`);
        await wait(delayMs);
      }
    }

    const output = ctx.stage.outputs[0]!;
    const abs = path.join(ctx.loaded.dir, outputRel(output));
    host().mkdir(path.dirname(abs), { recursive: true });
    if (wantsJson(output.type, output.path)) {
      let data: unknown;
      try {
        data = JSON.parse(bytesToText(bytes)) as unknown;
      } catch {
        const error = Object.assign(new Error(`服务返回的不是 JSON / service response is not JSON`), {
          retryable: false as const,
          ...(retryLog.length ? { params: { url: ex.url, method, timeoutSec, retries: retryLog } } : {}),
        });
        throw error;
      }
      host().writeFile(abs, `${JSON.stringify(data, null, 2)}\n`);
    } else {
      host().writeFile(abs, bytes);
    }
    ctx.log(`已写入 / wrote ${outputRel(output)} (${bytes.length} bytes, ${Date.now() - started} ms)`);
    return {
      params: {
        url: ex.url,
        method,
        timeoutSec,
        status: response.status,
        ...(retryLog.length ? { retries: retryLog } : {}),
        durationMs: Date.now() - started,
      },
    };
  },
};
