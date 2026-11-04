import { SELF } from "cloudflare:test";
import { loadFlow, mcpTools } from "@flowgit/core";
import { describe, expect, it } from "vitest";
import { createMemoryHost, withFlowHost } from "../src/storage/context-host.js";
import { adminWithWorkspace, api, b64, member, ok, ORIGIN, type Person } from "./helpers.js";

/** notes (a person) → draft (a model; canned reply in demo-replies/). */
function flowFiles(): Record<string, string> {
  const flow = {
    format: "flowgit",
    version: "0.1",
    id: "notes-report",
    name: "Notes to report",
    inputs: { name: { type: "string", default: "Cyrus" } },
    stages: [
      { id: "notes", name: "Notes", executor: { type: "human", instructions: "Write notes.md" }, outputs: [{ path: "notes.md", type: "text/markdown" }] },
      { id: "draft", name: "Draft", inputs: ["notes"], executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ path: "report.md", type: "text/markdown" }] },
    ],
  };
  return {
    "flow.json": b64(JSON.stringify(flow, null, 2)),
    "prompts/draft.md": b64("Turn these notes into a report for {{name}}:\n\n{{notes}}\n"),
    "demo-replies/draft.md": b64("# Report\n\nAll good.\n"),
  };
}

async function newFlow(person: Person, ws: string): Promise<string> {
  const { flow } = await ok<{ flow: { id: string } }>(api(person, "POST", `/api/workspaces/${ws}/flows`, { name: "Report", files: flowFiles() }), 201);
  return flow.id;
}

const REDIRECT = "https://client.example/callback";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function registerClient(name = "Test Client"): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/** The consent dance as a client and a signed-in person would do it. Returns the code redirect. */
async function authorize(person: Person, clientId: string, flow: string | null, challenge: string, decision = "allow"): Promise<URL> {
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  if (flow) params.set("resource", `${ORIGIN}/api/mcp/${flow}`);
  const start = await SELF.fetch(`${ORIGIN}/api/oauth/authorize?${params}`, { redirect: "manual" });
  expect(start.status).toBe(302);
  const consentPath = start.headers.get("Location")!;
  const request = new URL(consentPath, ORIGIN).searchParams.get("request")!;
  const consent = await SELF.fetch(`${ORIGIN}${consentPath}`, { headers: { Authorization: `Bearer ${person.token}` } });
  const html = await consent.text();
  if (consent.status !== 200) throw new Error(`consent ${consent.status}: ${html}`);
  expect(html).toContain("Test Client");
  const chosen = /name="flow" value="([^"]+)"/.exec(html)?.[1] ?? /<option value="([^"]+)"/.exec(html)?.[1];
  const answer = await SELF.fetch(`${ORIGIN}/api/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { Authorization: `Bearer ${person.token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request, flow: chosen ?? "", decision }).toString(),
  });
  expect(answer.status, await answer.clone().text()).toBe(302);
  return new URL(answer.headers.get("Location")!);
}

async function tokenRequest(params: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Register, consent and swap the code: what Claude does when the URL is added. */
async function connect(person: Person, flow: string): Promise<{ clientId: string; tokens: Tokens }> {
  const clientId = await registerClient();
  const { verifier, challenge } = await pkce();
  const back = await authorize(person, clientId, flow, challenge);
  expect(back.searchParams.get("state")).toBe("xyz");
  expect(back.searchParams.get("iss")).toBe(ORIGIN);
  const code = back.searchParams.get("code")!;
  const res = await tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${ORIGIN}/api/mcp/${flow}` });
  expect(res.status).toBe(200);
  return { clientId, tokens: (await res.json()) as Tokens };
}

let rpcId = 0;
async function rpc(flow: string, accessToken: string | undefined, method: string, params: Record<string, unknown> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/mcp/${flow}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}

async function result<T = Record<string, unknown>>(res: Response | Promise<Response>): Promise<T> {
  const r = await res;
  const body = (await r.json()) as { result?: T; error?: { message: string } };
  if (r.status !== 200 || !body.result) throw new Error(`rpc ${r.status}: ${JSON.stringify(body)}`);
  return body.result;
}

/** A tool result's text, and the JSON after the first blank line (the same split as the local tests). */
async function call(flow: string, accessToken: string, name: string, args: Record<string, unknown> = {}) {
  const res = await result<{ content: { type: string; text: string }[]; isError?: boolean }>(rpc(flow, accessToken, "tools/call", { name, arguments: args }));
  const text = res.content.map((c) => c.text).join("");
  const at = text.indexOf("\n\n{");
  return { res, text, data: at >= 0 ? JSON.parse(text.slice(at + 2)) : undefined };
}

describe("remote MCP", () => {
  it("is off by default, points clients at OAuth, and refuses requests without a valid token", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "mcp-editor", "editor");
    const flow = await newFlow(editor, ws);

    const settings = await ok<{ enabled: boolean; url: string }>(api(editor, "GET", `/api/flows/${flow}/mcp`));
    expect(settings).toMatchObject({ enabled: false, url: `${ORIGIN}/api/mcp/${flow}` });
    // Only owners switch it on.
    expect((await api(editor, "PUT", `/api/flows/${flow}/mcp`, { enabled: true })).status).toBe(403);

    const bare = await rpc(flow, undefined, "tools/list");
    expect(bare.status).toBe(401);
    const challenge = bare.headers.get("WWW-Authenticate")!;
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp/${flow}"`);
    // A Flowgit session token is not an MCP token.
    expect((await rpc(flow, editor.token, "tools/list")).status).toBe(401);
    expect((await rpc(flow, "made-up", "tools/list")).headers.get("WWW-Authenticate")).toContain('error="invalid_token"');

    const prm = await ok<{ resource: string; authorization_servers: string[] }>(SELF.fetch(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp/${flow}`));
    expect(prm).toMatchObject({ resource: `${ORIGIN}/api/mcp/${flow}`, authorization_servers: [ORIGIN] });
    const as = await ok<Record<string, unknown>>(SELF.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`));
    expect(as).toMatchObject({ issuer: ORIGIN, code_challenge_methods_supported: ["S256"], registration_endpoint: `${ORIGIN}/api/oauth/register` });
    const pre = await SELF.fetch(`${ORIGIN}/api/mcp/${flow}`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect((await SELF.fetch(`${ORIGIN}/api/mcp/${flow}`)).status).toBe(405);

    // While off, the consent page says no.
    const clientId = await registerClient();
    const { challenge: pk } = await pkce();
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: pk, code_challenge_method: "S256", resource: `${ORIGIN}/api/mcp/${flow}` });
    const start = await SELF.fetch(`${ORIGIN}/api/oauth/authorize?${params}`, { redirect: "manual" });
    const consent = await SELF.fetch(`${ORIGIN}${start.headers.get("Location")}`, { headers: { Authorization: `Bearer ${editor.token}` } });
    expect(consent.status).toBe(403);

    // Unregistered redirect URIs and missing PKCE never get a code.
    const wrong = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://evil.example/cb", code_challenge: pk, code_challenge_method: "S256" });
    expect((await SELF.fetch(`${ORIGIN}/api/oauth/authorize?${wrong}`, { redirect: "manual" })).status).toBe(400);
    const plain = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: pk, code_challenge_method: "plain" });
    const refused = await SELF.fetch(`${ORIGIN}/api/oauth/authorize?${plain}`, { redirect: "manual" });
    expect(new URL(refused.headers.get("Location")!).searchParams.get("error")).toBe("invalid_request");
    // Registration refuses script-like redirect URIs.
    const bad = await SELF.fetch(`${ORIGIN}/api/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) });
    expect(bad.status).toBe(400);
  });

  it("signs in, consents, runs the flow like the local server, logs the calls, and stops at once when revoked", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "mcp-runner", "editor");
    const viewer = await member(admin, ws, "mcp-viewer", "viewer");
    const flow = await newFlow(editor, ws);
    await ok(api(admin, "PUT", `/api/flows/${flow}/mcp`, { enabled: true }));

    // Viewers can't hand the flow to an app.
    const clientForViewer = await registerClient();
    const { challenge: viewerChallenge } = await pkce();
    await expect(authorize(viewer, clientForViewer, flow, viewerChallenge)).rejects.toThrow(/consent 403/);

    const { clientId, tokens } = await connect(editor, flow);
    expect(tokens.expires_in).toBe(3600);

    const init = await result<{ protocolVersion: string; serverInfo: { name: string; title: string }; capabilities: Record<string, unknown> }>(
      rpc(flow, tokens.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }),
    );
    expect(init).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "flowgit", title: "Flowgit: Notes to report" }, capabilities: { tools: {} } });
    const note = await SELF.fetch(`${ORIGIN}/api/mcp/${flow}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);

    // The same tools as `flowgit serve --mcp` on the same files.
    const { tools } = await result<{ tools: unknown[] }>(rpc(flow, tokens.access_token, "tools/list"));
    const files = flowFiles();
    const host = createMemoryHost({ cwd: "/flow", home: "/home", platform: "cloud", env: {} });
    const local = await withFlowHost(host, () => {
      for (const [rel, data] of Object.entries(files)) {
        host.mkdir(host.path.dirname(`/flow/${rel}`), { recursive: true });
        host.writeFile(`/flow/${rel}`, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
      }
      return mcpTools(loadFlow("/flow"));
    });
    expect(tools).toEqual(JSON.parse(JSON.stringify(local)));

    // run_flow stops at the person, with paths but no server paths.
    const waiting = await call(flow, tokens.access_token, "run_flow", { name: "Ada" });
    expect(waiting.data.status, waiting.text).toBe("waiting");
    expect(waiting.data.waiting).toMatchObject({ stage: "notes", kind: "human", instructions: "Write notes.md", files: [{ path: "notes.md" }] });
    expect(waiting.data.waiting.files[0].absPath).toBeUndefined();
    expect(waiting.text).toContain("Stage \"notes\" is waiting for you: notes.md");

    // run_stage's files answer it, and the run goes on through the model stage.
    const done = await call(flow, tokens.access_token, "run_stage", { stage: "notes", files: { "notes.md": "- fed the cats\n" } });
    expect(done.data?.status, done.text).toBe("done");
    expect(done.data.run).toMatchObject({ stage: "notes", n: 1, executor: "human" });

    const out = await call(flow, tokens.access_token, "get_output", { stage: "draft" });
    expect(out.data.outputs).toEqual([{ stage: "draft", path: "report.md", type: "text/markdown", exists: true, bytes: 20, text: "# Report\n\nAll good.\n" }]);
    const status = await call(flow, tokens.access_token, "status");
    expect(status.data.stages.map((s: { state: string }) => s.state)).toEqual(["ok", "ok"]);
    expect(status.data.flow.dir).toBeUndefined();

    // A finished flow: nothing to do, outputs returned like the local server.
    const again = await call(flow, tokens.access_token, "run_flow", { name: "Ada" });
    expect(again.data).toMatchObject({ status: "done", ran: [] });
    expect(again.data.outputs[0]).toMatchObject({ stage: "draft", path: "report.md", text: "# Report\n\nAll good.\n" });

    // run.json and the runs table say the run came over MCP, from which client.
    const runJson = await (await api(editor, "GET", `/api/flows/${flow}/raw?path=runs/draft/1/run.json`)).text();
    expect(JSON.parse(runJson)).toMatchObject({ via: "mcp", client: "Test Client", flowInputs: { name: "Ada" } });
    const { runs } = await ok<{ runs: { via?: string }[] }>(api(editor, "GET", `/api/flows/${flow}/runs`));
    expect(runs.length).toBeGreaterThan(0);

    // Every call is logged for the owners: who, which client and tool.
    expect((await api(editor, "GET", `/api/workspaces/${ws}/mcp-calls`)).status).toBe(403);
    const { calls } = await ok<{ calls: { tool: string; client: string; user_id: string; ok: boolean; run_id: string | null }[] }>(api(admin, "GET", `/api/workspaces/${ws}/mcp-calls`));
    expect(calls.map((c) => c.tool).reverse()).toEqual(["run_flow", "run_stage", "get_output", "status", "run_flow"]);
    expect(calls.every((c) => c.client === "Test Client" && c.user_id === editor.id)).toBe(true);
    expect(calls.find((c) => c.tool === "run_stage")?.run_id).toMatch(/^run_/);

    // Refresh tokens are replaced on use.
    const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as Tokens;
    expect((await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId })).status).toBe(400);
    await result(rpc(flow, next.access_token, "ping"));

    // The person sees their connection and revokes it: the very next request is refused.
    const mine = await ok<{ grants: { id: string; client: string }[] }>(api(editor, "GET", `/api/flows/${flow}/mcp`));
    expect(mine.grants).toEqual([expect.objectContaining({ client: "Test Client" })]);
    await ok(api(editor, "DELETE", `/api/flows/${flow}/mcp/grants/${mine.grants[0]!.id}`));
    expect((await rpc(flow, next.access_token, "ping")).status).toBe(401);
    expect((await rpc(flow, tokens.access_token, "ping")).status).toBe(401);
    expect((await tokenRequest({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: clientId })).status).toBe(400);
  });

  it("refuses codes used twice or with the wrong verifier, and turning MCP off ends every connection", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "mcp-two", "editor");
    const flow = await newFlow(editor, ws);
    await ok(api(admin, "PUT", `/api/flows/${flow}/mcp`, { enabled: true }));

    const clientId = await registerClient();
    const { verifier, challenge } = await pkce();
    const back = await authorize(editor, clientId, flow, challenge);
    const code = back.searchParams.get("code")!;
    expect((await tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) })).status).toBe(400);
    // The failed try used the code up.
    expect((await tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier })).status).toBe(400);

    // Denying sends the person back with access_denied.
    const { challenge: c2 } = await pkce();
    const denied = await authorize(editor, clientId, flow, c2, "deny");
    expect(denied.searchParams.get("error")).toBe("access_denied");

    // Without `resource`, the person picks the flow on the consent page.
    const { tokens } = await (async () => {
      const { verifier: v3, challenge: c3 } = await pkce();
      const picked = await authorize(editor, clientId, null, c3);
      const res = await tokenRequest({ grant_type: "authorization_code", code: picked.searchParams.get("code")!, client_id: clientId, code_verifier: v3 });
      expect(res.status).toBe(200);
      return { tokens: (await res.json()) as Tokens };
    })();
    await result(rpc(flow, tokens.access_token, "ping"));
    // A token for one flow does nothing on another.
    const other = await newFlow(editor, ws);
    await ok(api(admin, "PUT", `/api/flows/${other}/mcp`, { enabled: true }));
    expect((await rpc(other, tokens.access_token, "ping")).status).toBe(401);

    await ok(api(admin, "PUT", `/api/flows/${flow}/mcp`, { enabled: false }));
    expect((await rpc(flow, tokens.access_token, "ping")).status).toBe(401);
    expect((await ok<{ grants: unknown[] }>(api(admin, "GET", `/api/flows/${flow}/mcp`))).grants).toEqual([]);
  });

  it("runs weekly-report over MCP: waits for the notes, writes the draft, and hands the script stage to a computer", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const { flow } = await ok<{ flow: { id: string } }>(api(admin, "POST", `/api/workspaces/${ws}/flows`, { template: "weekly-report" }), 201);
    await ok(api(admin, "PUT", `/api/flows/${flow.id}/mcp`, { enabled: true }));
    const { tokens } = await connect(admin, flow.id);

    const missing = await call(flow.id, tokens.access_token, "run_flow", {});
    expect(missing.res.isError).toBe(true);
    expect(missing.text).toContain("Missing flow inputs: name. Pass them as run_flow parameters or in run_stage's inputs");

    const waiting = await call(flow.id, tokens.access_token, "run_flow", { name: "Ada", language: "en" });
    expect(waiting.data.waiting).toMatchObject({ stage: "notes", kind: "human", files: [{ path: "notes.md" }] });
    const notes = await (await api(admin, "GET", `/api/flows/${flow.id}/raw?path=sample-notes.md`)).text();
    const atCheck = await call(flow.id, tokens.access_token, "run_stage", { stage: "notes", files: { "notes.md": notes } });
    expect(atCheck.data?.status, atCheck.text).toBe("waiting");
    expect(atCheck.data.waiting).toMatchObject({ stage: "check", kind: "computer" });
    expect(atCheck.data.waiting.next).toContain("flowgit board");

    const draft = await call(flow.id, tokens.access_token, "get_output", { stage: "draft" });
    expect(draft.data.outputs[0]).toMatchObject({ path: "report.md", exists: true });
    expect(draft.data.outputs[0].text.length).toBeGreaterThan(50);
    // The run waits for a computer; nobody else can start one meanwhile, but reading is fine.
    const busy = await call(flow.id, tokens.access_token, "run_stage", { stage: "draft" });
    expect(busy.res.isError).toBe(true);
    expect(busy.text).toContain("a run is already in progress");
    await ok(api(admin, "POST", `/api/flows/${flow.id}/runs/${(await ok<{ run: { id: string } }>(api(admin, "GET", `/api/flows/${flow.id}/run`))).run.id}/cancel`));
  });

  it("refuses a cross-site consent post made with the session cookie", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const flow = await newFlow(admin, ws);
    await ok(api(admin, "PUT", `/api/flows/${flow}/mcp`, { enabled: true }));
    const res = await SELF.fetch(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: `__Host-flowgit_session=${admin.token}`, Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: "mcr_whatever", flow, decision: "allow" }).toString(),
    });
    expect(res.status).toBe(403);
  });
});
