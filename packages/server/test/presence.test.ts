import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { adminWithWorkspace, api, member, ok, ORIGIN, tinyFlow, type Person } from "./helpers.js";

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
      if (raw === "pong") frames.push({ id: 0, event: "pong", data: {} });
      else frames.push(JSON.parse(raw) as Frame);
    });
    return {
      ws,
      frames,
      send(message: unknown) {
        ws.send(JSON.stringify(message));
      },
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

async function flowOf(editor: Person, ws: string): Promise<string> {
  const { flow } = await ok<{ flow: { id: string } }>(api(editor, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: tinyFlow() }), 201);
  return flow.id;
}

describe("presence", () => {
  it("lets two people see each other, and never sends an email", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "ada", "editor");
    const viewer = await member(admin, ws, "bao", "viewer");
    await env.DB.prepare("UPDATE users SET email = ?, avatar_url = ?, name = ? WHERE id = ?").bind("ada-secret@example.test", "https://cdn.example/ada.png", "Ada", editor.id).run();
    await env.DB.prepare("UPDATE users SET email = ?, name = ? WHERE id = ?").bind("bao-secret@example.test", "Bao", viewer.id).run();
    const flow = await flowOf(editor, ws);
    const ada = await openSocket(editor, flow);
    const bao = await openSocket(viewer, flow);
    sockets.push(ada, bao);
    ada.send({ type: "presence", stage: "notes" });
    bao.send({ type: "presence", stage: null });
    await ada.until((frame) => frame.event === "presence:update" && JSON.stringify(frame.data).includes(viewer.id));
    await bao.until((frame) => frame.event === "presence:update" && JSON.stringify(frame.data).includes(editor.id));
    const people = (ada.frames.filter((frame) => frame.event === "presence:update").at(-1)?.data.people ?? []) as {
      id: string;
      name: string;
      avatar_url: string | null;
      stage: string | null;
      email?: string;
    }[];
    expect(people.map((person) => person.id).sort()).toEqual([editor.id, viewer.id].sort());
    expect(people.find((person) => person.id === editor.id)).toMatchObject({ name: "Ada", avatar_url: "https://cdn.example/ada.png", stage: "notes" });
    expect(people.find((person) => person.id === viewer.id)).toMatchObject({ name: "Bao", avatar_url: null, stage: null });
    for (const person of people) expect(person).not.toHaveProperty("email");
    const dumped = JSON.stringify([...ada.frames, ...bao.frames]);
    expect(dumped).not.toContain("ada-secret@example.test");
    expect(dumped).not.toContain("bao-secret@example.test");
    expect(dumped).not.toContain('"email"');
  });

  it("answers an unknown or oversized frame with an error and stays open", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "ada", "editor");
    const flow = await flowOf(editor, ws);
    const ada = await openSocket(editor, flow);
    sockets.push(ada);
    ada.send({ type: "nope" });
    ada.ws.send("x".repeat(5000));
    await ada.until((frame) => frame.data.code === "too_large");
    expect(ada.frames.filter((frame) => frame.event === "error").map((frame) => frame.data.code)).toEqual(["bad_message", "too_large"]);
    ada.ws.send("ping");
    await ada.until((frame) => frame.event === "pong");
  });

  it("still broadcasts flow:changed when a file is saved", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "ada", "editor");
    const flow = await flowOf(editor, ws);
    const ada = await openSocket(editor, flow);
    sockets.push(ada);
    ada.send({ type: "presence", stage: "notes" });
    await ok(api(editor, "PUT", `/api/flows/${flow}/board/file?path=notes.md`, "live\n"));
    await ada.until((frame) => frame.event === "flow:changed");
    expect(ada.frames.some((frame) => frame.event === "presence:update")).toBe(true);
  });
});
