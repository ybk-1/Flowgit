import { describe, expect, it } from "vitest";
import { adminWithWorkspace, api, login, member, ok, tinyFlow } from "./helpers.js";

async function flowIn(owner: Awaited<ReturnType<typeof login>>, ws: string): Promise<string> {
  const { flow } = await ok<{ flow: { id: string } }>(api(owner, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: tinyFlow() }), 201);
  return flow.id;
}

describe("workspaces, members and invites", () => {
  it("adds a second account as an editor through an invite", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "editor", "editor");
    const { workspaces } = await ok<{ workspaces: { id: string; role: string }[] }>(api(editor, "GET", "/api/workspaces"));
    expect(workspaces).toEqual([expect.objectContaining({ id: ws, role: "editor" })]);
    const { members } = await ok<{ members: { id: string; role: string }[] }>(api(admin, "GET", `/api/workspaces/${ws}/members`));
    expect(members.map((m) => m.role).sort()).toEqual(["editor", "owner"]);
  });

  it("lets someone with an account join with a workspace invite, once", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const { code: signup } = await ok<{ code: string }>(api(admin, "POST", "/api/invites", {}), 201);
    const person = await login("person", signup);
    expect((await api(person, "GET", `/api/workspaces/${ws}`)).status).toBe(404);
    const { code } = await ok<{ code: string }>(api(admin, "POST", `/api/workspaces/${ws}/invites`, { role: "viewer" }), 201);
    expect(await ok(api(person, "POST", "/api/invites/accept", { code }))).toEqual({ workspaceId: ws, role: "viewer" });
    expect((await ok<{ role: string }>(api(person, "GET", `/api/workspaces/${ws}`))).role).toBe("viewer");
    expect((await api(person, "POST", "/api/invites/accept", { code })).status).toBe(404);
    // A workspace invite never downgrades an owner.
    const again = await ok<{ code: string }>(api(admin, "POST", `/api/workspaces/${ws}/invites`, { role: "viewer" }), 201);
    await ok(api(admin, "POST", "/api/invites/accept", { code: again.code }));
    expect((await ok<{ role: string }>(api(admin, "GET", `/api/workspaces/${ws}`))).role).toBe("owner");
  });

  it("only owners invite, change roles and remove; the last owner stays", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "ed", "editor");
    const viewer = await member(admin, ws, "vi", "viewer");
    expect((await api(editor, "POST", `/api/workspaces/${ws}/invites`, { role: "owner" })).status).toBe(403);
    expect((await api(editor, "PATCH", `/api/workspaces/${ws}/members/${viewer.id}`, { role: "owner" })).status).toBe(403);
    expect((await api(viewer, "DELETE", `/api/workspaces/${ws}/members/${editor.id}`)).status).toBe(403);
    expect((await api(editor, "GET", `/api/workspaces/${ws}/audit`)).status).toBe(403);
    expect((await api(admin, "PATCH", `/api/workspaces/${ws}/members/${admin.id}`, { role: "editor" })).status).toBe(409);
    expect((await api(admin, "DELETE", `/api/workspaces/${ws}/members/${admin.id}`)).status).toBe(409);
    await ok(api(admin, "PATCH", `/api/workspaces/${ws}/members/${viewer.id}`, { role: "editor" }));
    // Anyone may leave.
    await ok(api(viewer, "DELETE", `/api/workspaces/${ws}/members/${viewer.id}`));
    expect((await api(viewer, "GET", `/api/workspaces/${ws}`)).status).toBe(404);
  });
});

describe("permissions on flows", () => {
  it("refuses writes by a signed-out person, a non-member and a viewer", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const flow = await flowIn(admin, ws);
    const viewer = await member(admin, ws, "viewer", "viewer");
    const outsider = await (async () => {
      const { code } = await ok<{ code: string }>(api(admin, "POST", "/api/invites", {}), 201);
      return login("outsider", code);
    })();

    const writes: [string, string, unknown?][] = [
      ["PUT", `/api/flows/${flow}/raw?path=notes.md`, "hi"],
      ["DELETE", `/api/flows/${flow}/raw?path=flow.json`],
      ["PUT", `/api/flows/${flow}/board/file?path=notes.md`, "hi"],
      ["PUT", `/api/flows/${flow}/board/inputs`, { values: {} }],
      ["POST", `/api/flows/${flow}/board/restore`, { stage: "notes", n: 1 }],
      ["POST", `/api/flows/${flow}/board/stage`, { id: "x", type: "human" }],
      ["PATCH", `/api/flows/${flow}`, { name: "renamed" }],
      ["DELETE", `/api/flows/${flow}`],
      ["POST", `/api/workspaces/${ws}/flows`, { name: "n", files: tinyFlow() }],
    ];
    for (const [method, path, body] of writes) {
      expect((await api(undefined, method, path, body)).status, `${method} ${path} signed out`).toBe(401);
      expect((await api(outsider, method, path, body)).status, `${method} ${path} outsider`).toBe(404);
      expect((await api(viewer, method, path, body)).status, `${method} ${path} viewer`).toBe(403);
    }
    // Reads: viewer yes, outsider no.
    for (const path of [`/api/flows/${flow}/board/flow`, `/api/flows/${flow}/files`, `/api/flows/${flow}/raw?path=flow.json`, `/api/workspaces/${ws}/flows`]) {
      expect((await api(viewer, "GET", path)).status, path).toBe(200);
      expect((await api(outsider, "GET", path)).status, path).toBe(404);
      expect((await api(undefined, "GET", path)).status, path).toBe(401);
    }
    // Only the owner deletes a flow.
    const editor = await member(admin, ws, "editor", "editor");
    expect((await api(editor, "DELETE", `/api/flows/${flow}`)).status).toBe(403);
    await ok(api(admin, "DELETE", `/api/flows/${flow}`));
    expect((await api(admin, "GET", `/api/flows/${flow}/board/flow`)).status).toBe(404);
  });
});
