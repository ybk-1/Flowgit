import { SELF } from "cloudflare:test";
import type { Stage } from "@flowgit/core";
import { afterEach, describe, expect, it } from "vitest";
import { LOCK_TTL_MS, lockClock, stageForPath, WHOLE_FLOW, writeTarget, type Collab } from "../src/rooms/locks.js";
import { adminWithWorkspace, api, b64, member, ok, ORIGIN, type Person } from "./helpers.js";

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
  lockClock.now = () => Date.now();
  for (const socket of sockets) {
    try {
      socket.ws.close();
    } catch {
      // already closed
    }
  }
  sockets.length = 0;
});

function sampleStages(): Stage[] {
  return [
    { id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ path: "notes.md", type: "text/markdown" }] },
    { id: "shots", name: "Shots", executor: { type: "human" }, outputs: [{ path: "shots/", type: "dir" }] },
    { id: "draft", name: "Draft", inputs: ["notes"], executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ path: "draft.md", type: "text/markdown" }] },
  ];
}

function promptFlow(): Record<string, string> {
  return {
    "flow.json": b64(JSON.stringify({ name: "Tiny", format: "flowgit", version: "0.1", stages: sampleStages() }, null, 2)),
    "prompts/draft.md": b64("Write the notes.\n"),
    "notes.md": b64("hi\n"),
  };
}

async function target(method: string, path: string, body?: string): Promise<string | null> {
  const room = { stages: () => sampleStages() } as Collab;
  const request = new Request(`https://room${path}`, {
    method,
    body,
    headers: body ? { "Content-Type": "application/json" } : {},
  });
  return writeTarget(room, request, new URL(request.url));
}

describe("locks", () => {
  it("maps a write to the stage it touches", async () => {
    const stages = sampleStages();
    expect(stageForPath(stages, "notes.md")).toBe("notes");
    expect(stageForPath(stages, "prompts/draft.md")).toBe("draft");
    expect(stageForPath(stages, "shots/001.png")).toBe("shots");
    expect(stageForPath(stages, "extra.txt")).toBeNull();
    expect(await target("PUT", "/board/file?path=notes.md")).toBe("notes");
    expect(await target("PUT", "/board/file?path=prompts/draft.md")).toBe("draft");
    expect(await target("PUT", "/raw?path=shots/001.png")).toBe("shots");
    expect(await target("PUT", "/raw?path=flow.json")).toBe(WHOLE_FLOW);
    expect(await target("PUT", "/raw?path=flowgit.local.json")).toBe(WHOLE_FLOW);
    expect(await target("PUT", "/board/inputs")).toBe(WHOLE_FLOW);
    expect(await target("PUT", "/board/flow")).toBe(WHOLE_FLOW);
    expect(await target("POST", "/board/stage")).toBe(WHOLE_FLOW);
    expect(await target("POST", "/board/upload?stage=notes")).toBe("notes");
    expect(await target("DELETE", "/board/stage?id=draft")).toBe("draft");
    expect(await target("PUT", "/board/stage", JSON.stringify({ id: "notes", name: "Notes" }))).toBe("notes");
    expect(await target("POST", "/board/restore", JSON.stringify({ stage: "draft", n: 1 }))).toBe("draft");
    expect(await target("POST", "/board/run", JSON.stringify({ stage: "notes" }))).toBeNull();
    expect(await target("GET", "/board/file?path=notes.md")).toBeNull();
  });

  it("refuses a viewer's lock and a second person's lock, and frees it when the socket closes", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const ada = await member(admin, ws, "ada", "editor");
    const bao = await member(admin, ws, "bao", "viewer");
    const cy = await member(admin, ws, "cy", "editor");
    const { flow } = await ok<{ flow: { id: string } }>(api(ada, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: promptFlow() }), 201);
    const adaSock = await openSocket(ada, flow.id);
    const baoSock = await openSocket(bao, flow.id);
    const cySock = await openSocket(cy, flow.id);
    sockets.push(adaSock, baoSock, cySock);
    baoSock.send({ type: "lock", stage: "notes" });
    await baoSock.until((frame) => frame.data.code === "forbidden");
    adaSock.send({ type: "lock", stage: "notes" });
    await cySock.until((frame) => frame.event === "lock:update" && JSON.stringify(frame.data).includes(ada.id));
    cySock.send({ type: "lock", stage: "notes" });
    await cySock.until((frame) => frame.data.code === "locked");
    const refused = cySock.frames.find((frame) => frame.data.code === "locked");
    expect(refused?.data.lock).toMatchObject({ stage: "notes", user: { id: ada.id, name: "ada" } });
    expect(refused?.data.lock).not.toHaveProperty("email");
    cySock.send({ type: "lock", stage: "draft" });
    await adaSock.until((frame) => frame.event === "lock:update" && JSON.stringify(frame.data).includes("draft"));
    const blocked = await api(cy, "PUT", `/api/flows/${flow.id}/board/file?path=notes.md`, "nope\n");
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { code: string; error: string; lock: { stage: string; user: { id: string; name: string } } };
    expect(body.code).toBe("locked");
    expect(body.lock).toEqual({ stage: "notes", user: { id: ada.id, name: "ada" } });
    expect(body.error).not.toContain("正在运行");
    await ok(api(ada, "PUT", `/api/flows/${flow.id}/board/file?path=notes.md`, "yes\n"));
    expect(await (await api(ada, "GET", `/api/flows/${flow.id}/board/file?path=notes.md`)).text()).toBe("yes\n");
    const promptBlocked = await api(ada, "PUT", `/api/flows/${flow.id}/board/file?path=prompts/draft.md`, "x");
    expect(promptBlocked.status).toBe(409);
    const inputsBlocked = await api(bao, "PUT", `/api/flows/${flow.id}/board/inputs`, {});
    expect(inputsBlocked.status).toBe(403);
    const inputsByCy = await api(cy, "PUT", `/api/flows/${flow.id}/board/inputs`, { values: {} });
    expect(inputsByCy.status).toBe(409);
    expect(((await inputsByCy.json()) as { code: string }).code).toBe("locked");
    adaSock.ws.close();
    await cySock.until((frame) => frame.event === "lock:update" && !JSON.stringify(frame.data).includes(ada.id));
    await ok(api(cy, "PUT", `/api/flows/${flow.id}/board/file?path=notes.md`, "after\n"));
    cySock.ws.send("ping");
    await cySock.until((frame) => frame.event === "pong");
  });

  it("expires a lock on the injected clock, unless a heartbeat extends it", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const ada = await member(admin, ws, "ada", "editor");
    const cy = await member(admin, ws, "cy", "editor");
    const { flow } = await ok<{ flow: { id: string } }>(api(ada, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: promptFlow() }), 201);
    let now = 1_700_000_000_000;
    lockClock.now = () => now;
    const adaSock = await openSocket(ada, flow.id);
    const cySock = await openSocket(cy, flow.id);
    sockets.push(adaSock, cySock);
    adaSock.send({ type: "lock", stage: "notes" });
    await cySock.until((frame) => frame.event === "lock:update" && JSON.stringify(frame.data).includes(ada.id));
    now += 30_000;
    adaSock.send({ type: "heartbeat" });
    await cySock.until((frame) => frame.event === "lock:update" && JSON.stringify(frame.data).includes(String(now + LOCK_TTL_MS)));
    now += LOCK_TTL_MS - 1000;
    const still = await api(cy, "PUT", `/api/flows/${flow.id}/board/file?path=notes.md`, "early\n");
    expect(still.status).toBe(409);
    now += 2000;
    await ok(api(cy, "PUT", `/api/flows/${flow.id}/board/file?path=notes.md`, "late\n"));
    cySock.send({ type: "lock", stage: "notes" });
    await adaSock.until((frame) => frame.event === "lock:update" && JSON.stringify(frame.data).includes(cy.id));
  });
});
