import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/http.js";
import { adminWithWorkspace, api, b64, login, member, ok, tinyFlow } from "./helpers.js";

function sharedFlow(): Record<string, string> {
  return {
    ...tinyFlow(),
    "notes.md": b64("written by the stage"),
    "runs/notes/1/run.json": b64('{"status":"ok"}'),
    "flowgit.local.json": b64('{"inputs":{"topic":"local"}}'),
  };
}

describe("sharing", () => {
  it("creates a one-time token, refuses a viewer, and 404s after revoke", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const viewer = await member(admin, ws, "viewer", "viewer");
    const { flow } = await ok<{ flow: { id: string } }>(api(admin, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: sharedFlow() }), 201);

    expect((await api(viewer, "POST", `/api/flows/${flow.id}/shares`)).status).toBe(403);

    const created = await ok<{ id: string; url: string }>(api(admin, "POST", `/api/flows/${flow.id}/shares`), 201);
    const token = new URL(created.url, "https://flowgit.test").searchParams.get("share");
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThanOrEqual(22);
    expect(created.url).toBe(`/app/?share=${token}`);
    const hash = await sha256Hex(token!);
    const stored = await env.DB.prepare("SELECT token_hash FROM shares WHERE id = ?").bind(created.id).first<{ token_hash: string }>();
    expect(stored!.token_hash).toBe(hash);
    expect(stored!.token_hash).not.toBe(token);

    const listed = await ok<{ shares: { id: string }[] }>(api(admin, "GET", `/api/flows/${flow.id}/shares`));
    expect(listed.shares.map((share) => share.id)).toContain(created.id);
    expect(JSON.stringify(listed)).not.toContain(token!);

    const pub = await ok<{ name: string }>(api(undefined, "GET", `/api/share/${token}`));
    expect(pub.name).toBe("Tiny");
    expect(await (await api(undefined, "GET", `/api/share/${token}/board/flow`)).text()).toContain("notes");
    expect(await (await api(undefined, "GET", `/api/share/${token}/board/file?path=notes.md`)).text()).toContain("written by the stage");
    expect((await api(undefined, "GET", `/api/share/${token}/board/inputs`)).status).toBe(403);
    expect((await api(undefined, "GET", `/api/share/${token}/board/usage`)).status).toBe(403);
    expect((await api(undefined, "GET", `/api/share/${token}/board/plan`)).status).toBe(403);
    expect((await api(undefined, "GET", `/api/share/${token}/board/file?path=flowgit.local.json`)).status).toBe(403);
    expect((await api(undefined, "POST", `/api/share/${token}/board/flow`, {})).status).toBe(405);
    expect((await api(undefined, "PUT", `/api/share/${token}/board/file?path=notes.md`, "x")).status).toBe(405);

    await ok(api(admin, "DELETE", `/api/flows/${flow.id}/shares/${created.id}`));
    expect((await api(undefined, "GET", `/api/share/${token}`)).status).toBe(404);
    expect((await api(undefined, "GET", `/api/share/${token}/board/flow`)).status).toBe(404);

    const audit = await ok<{ entries: { action: string; detail: unknown }[] }>(api(admin, "GET", `/api/workspaces/${ws}/audit`));
    const text = JSON.stringify(audit);
    expect(text).toContain("share.create");
    expect(text).toContain("share.revoke");
    expect(text).not.toContain(token!);
  });

  it("copies into another workspace with forkedFrom and without runs", async () => {
    const { admin, ws } = await adminWithWorkspace("Source");
    const { flow } = await ok<{ flow: { id: string } }>(api(admin, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: sharedFlow() }), 201);
    const { url } = await ok<{ url: string }>(api(admin, "POST", `/api/flows/${flow.id}/shares`), 201);
    const token = new URL(url, "https://flowgit.test").searchParams.get("share")!;

    const { code } = await ok<{ code: string }>(api(admin, "POST", "/api/invites", {}), 201);
    const guest = await login("guest", code);
    const { workspace } = await ok<{ workspace: { id: string } }>(api(guest, "POST", "/api/workspaces", { name: "Mine" }), 201);
    const viewer = await member(admin, ws, "looker", "viewer");
    expect((await api(viewer, "POST", `/api/share/${token}/copy`, { workspace: ws })).status).toBe(403);

    const copied = await ok<{ flow: { id: string } }>(api(guest, "POST", `/api/share/${token}/copy`, { workspace: workspace.id, name: "Copy" }), 201);
    const raw = await (await api(guest, "GET", `/api/flows/${copied.flow.id}/raw?path=flow.json`)).text();
    const parsed = JSON.parse(raw) as { forkedFrom?: { source?: string } };
    expect(parsed.forkedFrom?.source).toBe(`flowgit:${flow.id}`);
    expect(raw).not.toContain(token);
    const { files } = await ok<{ files: { path: string }[] }>(api(guest, "GET", `/api/flows/${copied.flow.id}/files`));
    const paths = files.map((file) => file.path);
    expect(paths.some((path) => path.startsWith("runs/"))).toBe(false);
    expect(paths).not.toContain("notes.md");
    expect(paths).not.toContain("flowgit.local.json");

    const audit = await ok<{ entries: { action: string }[] }>(api(guest, "GET", `/api/workspaces/${workspace.id}/audit`));
    expect(JSON.stringify(audit)).toContain("share.copy");
    expect(JSON.stringify(audit)).not.toContain(token);
  });
});
