import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { adminWithWorkspace, api, member, ok, ORIGIN, tinyFlow, type Person } from "./helpers.js";

const BODY_SECRET = "BODY_SECRET_comment_text";
const QUOTE_SECRET = "QUOTE_SECRET_comment_text";

interface Frame {
  id: number;
  event: string;
  data: Record<string, unknown>;
}

function openSocket(person: Person, flow: string) {
  return (async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/flows/${flow}/events`, {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${person.token}` },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error("no socket");
    const frames: Frame[] = [];
    ws.accept();
    ws.addEventListener("message", (event) => {
      const raw = String(event.data);
      frames.push(JSON.parse(raw) as Frame);
    });
    return {
      ws,
      frames,
      async until(pred: (frame: Frame) => boolean) {
        const start = Date.now();
        for (;;) {
          if (frames.some(pred)) return;
          if (Date.now() - start > 4000) throw new Error(`timeout: ${frames.map((frame) => frame.event).join(",")}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      },
    };
  })();
}

type Socket = Awaited<ReturnType<typeof openSocket>>;
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets) {
    try {
      socket.ws.close();
    } catch {
      // already closed
    }
  }
  sockets.length = 0;
});

describe("comments", () => {
  it("lets editors comment, tells a mentioned person, and keeps the text out of the flow and the audit log", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const ada = await member(admin, ws, "ada", "editor");
    const bao = await member(admin, ws, "bao", "viewer");
    const cy = await member(admin, ws, "cy", "editor");
    await env.DB.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").bind("Ada", "ada-secret@example.test", ada.id).run();
    await env.DB.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").bind("Bao", "bao-secret@example.test", bao.id).run();
    const { flow } = await ok<{ flow: { id: string } }>(api(ada, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: tinyFlow() }), 201);
    const adaSock = await openSocket(ada, flow.id);
    const baoSock = await openSocket(bao, flow.id);
    sockets.push(adaSock, baoSock);
    expect((await api(bao, "POST", `/api/flows/${flow.id}/comments`, { path: "notes.md", body: "no" })).status).toBe(403);
    expect((await api(ada, "POST", `/api/flows/${flow.id}/comments`, { path: "../x", body: "no" })).status).toBe(400);
    expect((await api(ada, "POST", `/api/flows/${flow.id}/comments`, { path: "notes.md", body: "  " })).status).toBe(400);
    const created = await ok<{ comment: { id: string; path: string; body: string; quote: string; user: { id: string; name: string; email?: string } } }>(
      api(ada, "POST", `/api/flows/${flow.id}/comments`, {
        path: "notes.md",
        start: 0,
        end: 2,
        quote: QUOTE_SECRET,
        body: `@Bao please look ${BODY_SECRET}`,
      }),
      201,
    );
    expect(created.comment.user).toEqual({ id: ada.id, name: "Ada", avatar_url: null });
    expect(created.comment).not.toHaveProperty("email");
    await baoSock.until((frame) => frame.event === "mention");
    await adaSock.until((frame) => frame.event === "comment:added");
    const mention = baoSock.frames.find((frame) => frame.event === "mention");
    expect(mention?.data).toMatchObject({ path: "notes.md", flowId: flow.id, by: { id: ada.id, name: "Ada" } });
    expect(JSON.stringify(mention?.data)).not.toContain(BODY_SECRET);
    expect(JSON.stringify(mention?.data)).not.toContain(QUOTE_SECRET);
    expect(adaSock.frames.some((frame) => frame.event === "mention")).toBe(false);
    const listed = await ok<{ comments: { id: string; body: string }[] }>(api(bao, "GET", `/api/flows/${flow.id}/comments`));
    expect(listed.comments.map((comment) => comment.id)).toEqual([created.comment.id]);
    expect(JSON.stringify(listed)).not.toContain("bao-secret@example.test");
    const notes = await env.DB.prepare(
      "SELECT id, kind, title, body, url FROM notifications WHERE user_id = ? AND kind = 'comment.mention'",
    )
      .bind(bao.id)
      .all<{ id: string; kind: string; title: string; body: string; url: string }>();
    expect(notes.results).toHaveLength(1);
    expect(JSON.stringify(notes.results)).not.toContain(BODY_SECRET);
    expect(JSON.stringify(notes.results)).not.toContain(QUOTE_SECRET);
    expect(notes.results[0]?.body).toContain("notes.md");
    const adaNotes = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'comment.mention'").bind(ada.id).first<{ n: number }>();
    expect(adaNotes?.n ?? 0).toBe(0);
    const { entries } = await ok<{ entries: { action: string; detail: { path?: string } | null }[] }>(api(admin, "GET", `/api/workspaces/${ws}/audit`));
    const added = entries.find((entry) => entry.action === "comment.add");
    expect(added?.detail).toEqual({ path: "notes.md" });
    expect(JSON.stringify(entries)).not.toContain(BODY_SECRET);
    expect(JSON.stringify(entries)).not.toContain(QUOTE_SECRET);
    const { files } = await ok<{ files: { path: string }[] }>(api(ada, "GET", `/api/flows/${flow.id}/files`));
    expect(files.some((file) => file.path.includes("comment"))).toBe(false);
    const raw = await (await api(ada, "GET", `/api/flows/${flow.id}/raw?path=flow.json`)).text();
    const note = await (await api(ada, "GET", `/api/flows/${flow.id}/board/file?path=notes.md`)).text();
    expect(raw + note).not.toContain(BODY_SECRET);
    expect((await api(bao, "PATCH", `/api/flows/${flow.id}/comments/${created.comment.id}`, { resolved: true })).status).toBe(403);
    const resolved = await ok<{ comment: { resolved_at: number } }>(api(ada, "PATCH", `/api/flows/${flow.id}/comments/${created.comment.id}`, { resolved: true }));
    expect(resolved.comment.resolved_at).toBeGreaterThan(0);
    await baoSock.until((frame) => frame.event === "comment:updated");
    expect((await api(cy, "DELETE", `/api/flows/${flow.id}/comments/${created.comment.id}`)).status).toBe(403);
    await ok(api(ada, "DELETE", `/api/flows/${flow.id}/comments/${created.comment.id}`));
    expect((await ok<{ comments: unknown[] }>(api(bao, "GET", `/api/flows/${flow.id}/comments`))).comments).toEqual([]);
    const again = await ok<{ comment: { id: string } }>(api(ada, "POST", `/api/flows/${flow.id}/comments`, { path: "notes.md", body: "second" }), 201);
    await ok(api(admin, "DELETE", `/api/flows/${flow.id}/comments/${again.comment.id}`));
    await env.DB.prepare("UPDATE members SET role = 'viewer' WHERE user_id = ?").bind(ada.id).run();
    const asViewer = await ok<{ comment: { id: string } }>(api(cy, "POST", `/api/flows/${flow.id}/comments`, { path: "notes.md", body: "cy wrote" }), 201);
    await ok(api(cy, "DELETE", `/api/flows/${flow.id}/comments/${asViewer.comment.id}`));
    const outsider = await member(admin, await (await ok<{ workspace: { id: string } }>(api(admin, "POST", "/api/workspaces", { name: "Other" }), 201)).workspace.id, "nope", "owner");
    expect((await api(outsider, "GET", `/api/flows/${flow.id}/comments`)).status).toBe(404);
  });
});
