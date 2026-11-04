import type { Command } from "commander";
import { cloudOrigin, SERVER_OPTION } from "../cloud/origin.js";
import { cloudSession } from "../cloud/credentials.js";
import { cloudCall, errorBody, failure, responseJson } from "../cloud/http.js";
import { appUrl, readLink } from "../cloud/link.js";
import { frameResult, frameText } from "../cloud/frames.js";
import { c } from "../format.js";

/**
 * `flowgit cloud run`.
 * The log socket is Node's global WebSocket. Undici's second argument accepts headers,
 * which is how Authorization is sent on the handshake:
 * https://github.com/nodejs/undici/blob/main/docs/docs/api/WebSocket.md
 * Node 22 documents that global WebSocket as the undici implementation:
 * https://nodejs.org/docs/latest-v22.x/api/globals.html#class-websocket
 */

export interface CloudRunCommand {
  dir: string;
  stage?: string;
  model?: string;
  detach?: boolean;
  server?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
  /** Test hook. Default opens a WebSocket with an Authorization header. */
  connect?: (url: string, token: string) => WebSocket;
  sleep?: (ms: number) => Promise<void>;
}

interface StartedRun {
  ok?: boolean;
  run?: { id?: string };
  trust?: unknown;
  error?: string;
}

class SocketNotOpen extends Error {
  constructor() {
    super("日志连接没能带上登录令牌 / the log connection could not send the sign-in token");
    this.name = "SocketNotOpen";
  }
}

function eventsUrl(origin: string, flowId: string): string {
  return `${origin.replace(/^http/, "ws")}/api/flows/${encodeURIComponent(flowId)}/events`;
}

export function openEventsSocket(url: string, token: string): WebSocket {
  // WebSocketInit.headers is undici's extension. The DOM constructor only takes protocols.
  const Ctor = globalThis.WebSocket as unknown as new (url: string, init?: { headers?: Record<string, string> }) => WebSocket;
  return new Ctor(url, { headers: { Authorization: `Bearer ${token}` } });
}

function followSocket(ws: WebSocket, log: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let opened = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(code);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
      reject(err);
    };
    ws.addEventListener("open", () => {
      opened = true;
      try {
        ws.send("ping");
      } catch {
        // The server answers a text ping with a text pong. Missing it does not stop the log.
      }
    });
    ws.addEventListener("message", (ev) => {
      void frameText(ev.data).then((text) => {
        const effect = frameResult(text);
        for (const line of effect.lines) log(line);
        if (effect.exit !== undefined) finish(effect.exit);
      });
    });
    ws.addEventListener("error", () => {
      if (!opened) fail(new SocketNotOpen());
      else fail(new Error("日志连接断了 / the log connection failed"));
    });
    ws.addEventListener("close", () => {
      if (!opened) fail(new SocketNotOpen());
      else fail(new Error("日志连接在运行结束前断开了 / the log connection closed before the run ended"));
    });
  });
}

async function pollRun(args: {
  origin: string;
  token: string;
  flowId: string;
  runId: string;
  stage: string;
  log: (line: string) => void;
  fetchImpl?: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<number> {
  args.log("当前的 Node 不能在 WebSocket 握手里带上 Authorization，改为轮询看板的运行记录 / this Node cannot send Authorization on the WebSocket handshake, so the board's run list is polled");
  for (let i = 0; i < 3600; i++) {
    await args.sleep(1000);
    await cloudCall({
      origin: args.origin,
      token: args.token,
      method: "GET",
      path: `/api/flows/${encodeURIComponent(args.flowId)}/board/runs`,
      query: args.stage === "all" ? undefined : { stage: args.stage },
      fetchImpl: args.fetchImpl,
    }).catch(() => undefined);
    const result = await cloudCall({
      origin: args.origin,
      token: args.token,
      method: "GET",
      path: `/api/flows/${encodeURIComponent(args.flowId)}/runs/${encodeURIComponent(args.runId)}`,
      fetchImpl: args.fetchImpl,
    });
    if (result.status < 200 || result.status >= 300) throw failure(result);
    const body = responseJson(result) as { run?: { state?: string; error?: string | null; waiting?: { kind?: string; stage?: string; name?: string } | null } };
    const run = body.run;
    if (!run?.state || run.state === "running") continue;
    const effect = frameResult(JSON.stringify({ event: "run:end", data: { ok: run.state === "done", error: run.error ?? undefined, waiting: run.waiting ?? undefined } }));
    for (const line of effect.lines) args.log(line);
    return effect.exit ?? (run.state === "done" ? 0 : 1);
  }
  throw new Error("等运行等太久了 / timed out waiting for the run");
}

export async function executeCloudRun(args: CloudRunCommand): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const origin = cloudOrigin(args.server, env);
  const session = cloudSession(origin, env);
  const link = readLink(args.dir);
  if (!link) throw new Error("这个流程还没连上云端，先 flowgit push / this flow is not linked to the cloud yet; push first");
  if (link.server !== origin) throw new Error(`这个流程连着 ${link.server}，和这次的 ${origin} 不一样 / this flow is linked to ${link.server}, not ${origin}`);
  const stage = args.stage?.trim() || "all";
  const result = await cloudCall({
    origin,
    token: session.token,
    method: "POST",
    path: `/api/flows/${encodeURIComponent(link.flow)}/runs`,
    json: { stage, detach: true, ...(args.model ? { model: args.model } : {}) },
    fetchImpl: args.fetchImpl,
  });
  if (result.status === 409) {
    const body = errorBody(result);
    if (body.trust) {
      const why = typeof body.error === "string" ? body.error : "这个复制来的流程还没确认 / this copied flow has not been confirmed";
      throw new Error(`${why}\n先在网页上确认，再运行。这里不会跳过确认。 / Confirm it on the web, then run again. This command does not skip that confirmation.`);
    }
  }
  if (result.status < 200 || result.status >= 300) throw failure(result);
  const started = responseJson(result) as StartedRun;
  const runId = started.run?.id;
  if (!runId) throw new Error("云端没有返回运行编号 / the cloud did not return a run id");
  if (args.detach) {
    log(`${c.green("✓")} 已在云端开始运行 / started in the cloud: ${runId}`);
    log(`打开 / open: ${appUrl(origin, link.flow)}`);
    return 0;
  }
  log(`运行 / run: ${runId}`);
  const connect = args.connect ?? openEventsSocket;
  const poll = () =>
    pollRun({
      origin,
      token: session.token,
      flowId: link.flow,
      runId,
      stage,
      log,
      fetchImpl: args.fetchImpl,
      sleep: args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    });
  let socket: WebSocket;
  try {
    socket = connect(eventsUrl(origin, link.flow), session.token);
  } catch {
    return poll();
  }
  try {
    return await followSocket(socket, log);
  } catch (err) {
    if (!(err instanceof SocketNotOpen)) throw err;
    return poll();
  }
}

export function registerCloud(program: Command, dirOf: () => string, fail: (err: unknown) => never): void {
  const cloud = program.command("cloud").description("云端运行 / run in the cloud");
  cloud
    .command("run")
    .description("在云端运行并在命令行看日志 / run in the cloud and show the log here")
    .argument("[stage]", "阶段 id，省略则全部 / stage id, or every stage when omitted")
    .option("--model <model>", "这次运行用的模型 / model for this run")
    .option("--detach", "发起后就退出，并打印网页地址 / exit after starting, and print the web app address")
    .option(...SERVER_OPTION)
    .action(async (stage: string | undefined, opts: { model?: string; detach?: boolean; server?: string }) => {
      try {
        const code = await executeCloudRun({ dir: dirOf(), stage, model: opts.model, detach: opts.detach, server: opts.server });
        if (code) process.exitCode = code;
      } catch (err) {
        fail(err);
      }
    });
}
