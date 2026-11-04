import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/http.js";
import { api, login, ok, ORIGIN, type Person } from "./helpers.js";

async function signIn(subject: string, kind: "web" | "cli", invite?: string): Promise<Person> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ subject, name: subject, kind, invite }),
  });
  const body = await ok<{ token: string; user: { id: string; name: string } }>(res);
  return { token: body.token, id: body.user.id, name: body.user.name };
}

describe("sessions", () => {
  it("lists only the caller's sessions and revokes one by the hash prefix", async () => {
    const cli = await signIn("admin", "cli");
    const web = await signIn("admin", "web");
    const { code } = await ok<{ code: string }>(api(cli, "POST", "/api/invites", {}), 201);
    const stranger = await login("stranger", code);

    const listed = await ok<{ sessions: { id: string; kind: string; current: boolean; user_agent: string | null; created_at: number; expires_at: number }[] }>(
      api(web, "GET", "/api/auth/sessions"),
    );
    const hashes = (await env.DB.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").bind(web.id).all<{ token_hash: string }>()).results;
    const body = JSON.stringify(listed);
    for (const row of hashes) expect(body).not.toContain(row.token_hash);
    const webHash = await sha256Hex(web.token);
    const cliHash = await sha256Hex(cli.token);
    expect(listed.sessions.find((session) => session.current)).toMatchObject({ kind: "web", id: webHash.slice(0, 16) });
    const cliRow = listed.sessions.find((session) => session.id === cliHash.slice(0, 16));
    expect(cliRow).toMatchObject({ kind: "cli", current: false });
    expect(listed.sessions.every((session) => session.id.length === 16 && typeof session.created_at === "number" && typeof session.expires_at === "number")).toBe(true);

    expect((await api(stranger, "GET", "/api/auth/sessions")).status).toBe(200);
    const theirs = await ok<{ sessions: { id: string }[] }>(api(stranger, "GET", "/api/auth/sessions"));
    expect(theirs.sessions.map((session) => session.id)).not.toContain(cliRow!.id);
    expect((await api(stranger, "DELETE", `/api/auth/sessions/${cliRow!.id}`)).status).toBe(404);
    expect((await api(stranger, "DELETE", `/api/auth/sessions/${cliHash}`)).status).toBe(404);

    await ok(api(web, "DELETE", `/api/auth/sessions/${cliRow!.id}`));
    expect((await api(cli, "GET", "/api/me")).status).toBe(401);
    expect((await api(web, "GET", "/api/me")).status).toBe(200);
    const after = await ok<{ sessions: { id: string }[] }>(api(web, "GET", "/api/auth/sessions"));
    expect(after.sessions.map((session) => session.id)).not.toContain(cliRow!.id);
  });
});