import type { McpToolResult } from "@flowgit/core";
import type { Env, RateLimit } from "../env.js";
import { flowAccess, room, roomRequest } from "../flows.js";
import { errorResponse, HttpError, readText } from "../http.js";
import { authorizationServer, authorizeGet, authorizePost, corsJson, mcpCaller, type McpCaller, preflight, protectedResource, register, revoke, token } from "./oauth.js";

/**
 * A flow's MCP URL, https://<host>/api/mcp/<flow id>, over the Streamable HTTP transport
 * (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http).
 * It is stateless: every POST carries one JSON-RPC message (or a batch, for 2025-03-26 clients)
 * and gets plain JSON back; there is no server-to-client stream, so GET and DELETE answer 405
 * and the cloud never asks the person through elicitation (a waiting stage says what it needs).
 * The tools are core's mcp-tools.ts, run inside the flow's room like any cloud run.
 */

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_VERSION = "0.1.0";

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });

async function roomMcp<T>(env: Env, caller: McpCaller, body: Record<string, unknown>): Promise<T> {
  const res = await room(env, caller.flowId).fetch(
    roomRequest(caller.flowId, caller.userId, "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  );
  const answer = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new HttpError(res.status, answer.error ?? `room ${res.status}`);
  return answer;
}

async function logCall(env: Env, caller: McpCaller, tool: string, answer: { result: McpToolResult; runId: string | null; tokens: number } | undefined): Promise<void> {
  const { flow } = await flowAccess(env, caller.flowId, caller.userId, "editor");
  await env.DB.prepare(
    "INSERT INTO mcp_calls (flow_id, workspace_id, user_id, grant_id, client, tool, run_id, tokens, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(caller.flowId, flow.workspace_id, caller.userId, caller.grantId, caller.client, tool.slice(0, 64), answer?.runId ?? null, answer?.tokens ?? 0, answer && !answer.result.isError ? 1 : 0, Date.now())
    .run();
}

async function answer(env: Env, caller: McpCaller, message: JsonRpcMessage): Promise<object | undefined> {
  const id = message.id ?? null;
  const notification = message.id === undefined;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // A client's response (to a request we never send) or something malformed.
    return notification ? undefined : rpcError(id, -32600, "Invalid Request");
  }
  if (notification) return undefined; // notifications/initialized, notifications/cancelled, ...
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const info = await roomMcp<{ name: string; instructions: string }>(env, caller, { op: "info" });
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "flowgit", title: `Flowgit: ${info.name}`, version: SERVER_VERSION },
        instructions: info.instructions,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list": {
      const info = await roomMcp<{ tools: unknown[] }>(env, caller, { op: "info" });
      return rpcResult(id, { tools: info.tools });
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      let got: { result: McpToolResult; runId: string | null; tokens: number } | undefined;
      try {
        got = await roomMcp(env, caller, { op: "call", name, args, client: caller.client });
      } finally {
        await logCall(env, caller, name, got);
      }
      return rpcResult(id, got!.result);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

async function mcpPost(request: Request, env: Env, flowId: string, limiter?: RateLimit): Promise<Response> {
  const version = request.headers.get("MCP-Protocol-Version");
  if (version && !PROTOCOL_VERSIONS.includes(version)) return corsJson(400, rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${version}`));
  const caller = await mcpCaller(request, env, flowId);
  if (caller instanceof Response) return caller;
  if (limiter && !(await limiter.limit({ key: `user:${caller.userId}` })).success) {
    return corsJson(429, rpcError(null, -32000, "请求太频繁，请稍后再试 / too many requests, try again shortly"));
  }
  let body: unknown;
  try {
    body = JSON.parse(await readText(request, 6 * 1024 * 1024));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return corsJson(400, rpcError(null, -32700, "Parse error"));
  }
  const handleOne = async (message: unknown) => {
    try {
      return await answer(env, caller, (message && typeof message === "object" ? message : {}) as JsonRpcMessage);
    } catch (err) {
      const id = ((message as JsonRpcMessage)?.id ?? null) as JsonRpcId;
      return rpcError(id, -32603, err instanceof Error ? err.message : String(err));
    }
  };
  if (Array.isArray(body)) {
    if (!body.length) return corsJson(400, rpcError(null, -32600, "Invalid Request"));
    const replies = (await Promise.all(body.map(handleOne))).filter(Boolean);
    return replies.length ? corsJson(200, replies) : corsJson(202, undefined);
  }
  const reply = await handleOne(body);
  return reply ? corsJson(200, reply) : corsJson(202, undefined);
}

const MCP_PATH = /^\/api\/mcp\/([A-Za-z0-9_-]{1,64})\/?$/;
const PRM_PATH = /^\/\.well-known\/oauth-protected-resource\/api\/mcp\/([A-Za-z0-9_-]{1,64})\/?$/;

/**
 * MCP, OAuth and their well-known documents. Undefined for any other path, which the main router
 * answers. These paths take MCP bearer tokens (or, for the consent page, the Flowgit session).
 */
export async function handleMcp(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const mine =
    MCP_PATH.test(path) ||
    PRM_PATH.test(path) ||
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-authorization-server" ||
    path.startsWith("/api/oauth/");
  if (!mine) return undefined;
  try {
    // The consent page is for people in this site only; everything else may be called from a browser-based MCP client.
    if (method === "OPTIONS" && path !== "/api/oauth/authorize") return preflight();
    const origin = url.origin;
    const flowMatch = MCP_PATH.exec(path);
    if (flowMatch) {
      if (method === "POST") return await mcpPost(request, env, flowMatch[1]!, env.API_LIMITER);
      return corsJson(405, rpcError(null, -32000, "Method not allowed: this server answers POST only"), { Allow: "POST, OPTIONS" });
    }
    const prm = PRM_PATH.exec(path);
    if (prm && method === "GET") return protectedResource(origin, prm[1]);
    if (path === "/.well-known/oauth-protected-resource" && method === "GET") return protectedResource(origin);
    if (path === "/.well-known/oauth-authorization-server" && method === "GET") return authorizationServer(origin);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const limited = async () => env.AUTH_LIMITER && !(await env.AUTH_LIMITER.limit({ key: `oauth:${ip}` })).success;
    if (path === "/api/oauth/register" && method === "POST") {
      if (await limited()) return corsJson(429, { error: "slow_down", error_description: "too many requests" });
      return await register(request, env);
    }
    if (path === "/api/oauth/authorize" && method === "GET") return await authorizeGet(request, env);
    if (path === "/api/oauth/authorize" && method === "POST") return await authorizePost(request, env);
    if (path === "/api/oauth/token" && method === "POST") {
      if (await limited()) return corsJson(429, { error: "slow_down", error_description: "too many requests" });
      return await token(request, env);
    }
    if (path === "/api/oauth/revoke" && method === "POST") return await revoke(request, env);
    return corsJson(404, { error: "没有这个接口 / not found" });
  } catch (err) {
    return errorResponse(err);
  }
}
