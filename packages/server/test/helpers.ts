import { SELF } from "cloudflare:test";

export const ORIGIN = "https://flowgit.test";

export interface Person {
  token: string;
  id: string;
  name: string;
}

/** Sign in with the local-only test login. */
export async function login(subject: string, invite?: string): Promise<Person> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ subject, name: subject, invite, kind: "cli" }),
  });
  if (res.status !== 200) throw new Error(`login ${subject}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string; user: { id: string; name: string } };
  return { token: body.token, id: body.user.id, name: body.user.name };
}

export async function api(person: Person | undefined, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const init: RequestInit = { method, headers: { ...(person ? { Authorization: `Bearer ${person.token}` } : {}), ...headers } };
  if (body !== undefined) {
    if (body instanceof Uint8Array || typeof body === "string") init.body = body;
    else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

export async function ok<T = Record<string, unknown>>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await res;
  const text = await r.text();
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** The admin (ADMINS = "test:admin" in wrangler.jsonc) and a workspace they own. */
export async function adminWithWorkspace(name = "Team"): Promise<{ admin: Person; ws: string }> {
  const admin = await login("admin");
  const { workspace } = await ok<{ workspace: { id: string } }>(api(admin, "POST", "/api/workspaces", { name }), 201);
  return { admin, ws: workspace.id };
}

/** A new person who joins `ws` with `role` through a workspace invite. */
export async function member(owner: Person, ws: string, subject: string, role: "editor" | "viewer" | "owner"): Promise<Person> {
  const { code } = await ok<{ code: string }>(api(owner, "POST", `/api/workspaces/${ws}/invites`, { role }), 201);
  return login(subject, code);
}

export function b64(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** A tiny flow: one human stage writing notes.md. */
export function tinyFlow(): Record<string, string> {
  const flow = {
    name: "Tiny",
    format: "flowgit",
    version: "0.1",
    id: "tiny",
    stages: [{ id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ path: "notes.md", type: "text/markdown" }] }],
  };
  return { "flow.json": b64(JSON.stringify(flow, null, 2)) };
}
