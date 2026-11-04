import { env, SELF } from "cloudflare:test";
import { listRuns, loadFlow, runStage } from "@flowgit/core";
import { describe, expect, it } from "vitest";
import { createMemoryHost, withFlowHost } from "../src/storage/context-host.js";
import { LARGE_BYTES } from "../src/storage/flow-store.js";
import { adminWithWorkspace, api, b64, member, ok, ORIGIN, tinyFlow } from "./helpers.js";

/** A tiny flow with two versions of notes.md in runs/, made with core like `flowgit run` would. */
async function flowWithHistory(): Promise<Record<string, string>> {
  const files = tinyFlow();
  const host = createMemoryHost({ cwd: "/f", home: "/home", files: { "/f/flow.json": atob(files["flow.json"]!) } });
  return withFlowHost(host, async () => {
    host.writeFile("/f/notes.md", "first\n");
    await runStage(loadFlow("/f"), "notes");
    host.writeFile("/f/notes.md", "second\n");
    await runStage(loadFlow("/f"), "notes");
    expect(listRuns("/f", "notes").length).toBeGreaterThanOrEqual(2);
    const out: Record<string, string> = {};
    for (const abs of host.files()) out[abs.slice(3)] = b64(host.readFile(abs));
    return out;
  });
}

async function setup() {
  const { admin, ws } = await adminWithWorkspace();
  const editor = await member(admin, ws, "editor", "editor");
  const { flow } = await ok<{ flow: { id: string } }>(api(editor, "POST", `/api/workspaces/${ws}/flows`, { name: "Tiny", files: await flowWithHistory() }), 201);
  return { admin, editor, ws, flow: flow.id };
}

describe("flows in the cloud", () => {
  it("puts a bundled template in the cloud and shows its board", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const { templates } = await ok<{ templates: { id: string }[] }>(api(admin, "GET", "/api/templates"));
    expect(templates.map((t) => t.id)).toContain("weekly-report");
    const { flow } = await ok<{ flow: { id: string; name: string } }>(api(admin, "POST", `/api/workspaces/${ws}/flows`, { template: "weekly-report" }), 201);
    expect(flow.name).toBe("weekly-report");
    const board = await ok<{ stages: { id: string }[] }>(api(admin, "GET", `/api/flows/${flow.id}/board/flow`));
    expect(board.stages.map((s) => s.id)).toEqual(["notes", "draft", "check"]);
    const graph = await ok<{ nodes: unknown[] }>(api(admin, "GET", `/api/flows/${flow.id}/board/graph`));
    expect(graph.nodes).toHaveLength(3);
    const { flows } = await ok<{ flows: { id: string; bytes: number }[] }>(api(admin, "GET", `/api/workspaces/${ws}/flows`));
    expect(flows[0]!.bytes).toBeGreaterThan(1000);
    expect((await api(admin, "POST", `/api/workspaces/${ws}/flows`, { template: "../etc" })).status).toBe(404);
    expect((await api(admin, "POST", `/api/workspaces/${ws}/flows`, { files: { "notes.md": b64("x") } })).status).toBe(400);
  });

  it("reads and writes files, keeps them in R2, and logs the write", async () => {
    const { admin, editor, flow } = await setup();
    await ok(api(editor, "PUT", `/api/flows/${flow}/board/file?path=notes.md`, "third\n"));
    expect(await (await api(editor, "GET", `/api/flows/${flow}/board/file?path=notes.md`)).text()).toBe("third\n");
    expect(await (await env.FILES.get(`flows/${flow}/notes.md`))!.text()).toBe("third\n");
    await ok(api(editor, "PUT", `/api/flows/${flow}/raw?path=extra/data.txt`, "raw"));
    expect(await (await api(editor, "GET", `/api/flows/${flow}/raw?path=extra/data.txt`)).text()).toBe("raw");
    const { files } = await ok<{ files: { path: string; sha256: string }[] }>(api(editor, "GET", `/api/flows/${flow}/files`));
    expect(files.map((f) => f.path)).toContain("extra/data.txt");
    await ok(api(editor, "DELETE", `/api/flows/${flow}/raw?path=extra`));
    expect(await env.FILES.get(`flows/${flow}/extra/data.txt`)).toBeNull();
    const ws = (await ok<{ flow: { workspace_id: string } }>(api(admin, "GET", `/api/flows/${flow}`))).flow.workspace_id;
    const { entries } = await ok<{ entries: { action: string; user_id: string; detail: { path: string } }[] }>(api(admin, "GET", `/api/workspaces/${ws}/audit`));
    expect(entries).toContainEqual(expect.objectContaining({ action: "file.write", user_id: editor.id, detail: { path: "notes.md" } }));
  });

  it("survives the room being evicted: files reload from R2", async () => {
    const { editor, flow } = await setup();
    await ok(api(editor, "PUT", `/api/flows/${flow}/board/file?path=notes.md`, "kept\n"));
    const { evictAllDurableObjects } = await import("cloudflare:test");
    await evictAllDurableObjects();
    expect(await (await api(editor, "GET", `/api/flows/${flow}/board/file?path=notes.md`)).text()).toBe("kept\n");
  });

  it("lists versions, diffs them and restores one", async () => {
    const { editor, flow } = await setup();
    const { runs } = await ok<{ runs: { n: number }[] }>(api(editor, "GET", `/api/flows/${flow}/board/runs?stage=notes`));
    const ns = runs.map((r) => r.n).sort((a, b) => a - b);
    expect(ns.length).toBeGreaterThanOrEqual(2);
    const diff = await ok<Record<string, unknown>>(api(editor, "GET", `/api/flows/${flow}/board/diff?stage=notes&a=${ns[0]}&b=${ns[ns.length - 1]}`));
    expect(JSON.stringify(diff)).toContain("first");
    expect(JSON.stringify(diff)).toContain("second");
    await ok(api(editor, "POST", `/api/flows/${flow}/board/restore`, { stage: "notes", n: ns[0] }));
    expect(await (await api(editor, "GET", `/api/flows/${flow}/board/file?path=notes.md`)).text()).toBe("first\n");
  });

  it("keeps large files out of memory and serves them back whole", async () => {
    const { editor, flow } = await setup();
    const big = new Uint8Array(LARGE_BYTES + 1000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    await ok(api(editor, "PUT", `/api/flows/${flow}/raw?path=media/clip.bin`, big));
    const back = new Uint8Array(await (await api(editor, "GET", `/api/flows/${flow}/raw?path=media/clip.bin`)).arrayBuffer());
    expect(back.length).toBe(big.length);
    expect(back[12345]).toBe(big[12345]);
    // The file key holds a short stub; the bytes live once, content-addressed.
    const stub = await env.FILES.get(`flows/${flow}/media/clip.bin`);
    expect(stub!.size).toBeLessThan(200);
    const blobs = await env.FILES.list({ prefix: `flows/${flow}/.flowgit-blobs/` });
    expect(blobs.objects).toHaveLength(1);
    const { files } = await ok<{ files: { path: string; size: number }[] }>(api(editor, "GET", `/api/flows/${flow}/files`));
    expect(files.find((f) => f.path === "media/clip.bin")!.size).toBe(big.length);
  });

  it("refuses bad paths, oversized uploads and cloud runs (for now)", async () => {
    const { editor, flow } = await setup();
    for (const path of ["../x", "/etc/passwd", ".flowgit-blobs/x", ".git/config", "a\\b", "C:/x"]) {
      expect((await api(editor, "PUT", `/api/flows/${flow}/raw?path=${encodeURIComponent(path)}`, "x")).status, path).toBe(400);
    }
    const huge = new Uint8Array(50 * 1024 * 1024 + 1);
    expect((await api(editor, "PUT", `/api/flows/${flow}/raw?path=huge.bin`, huge)).status).toBe(413);
    expect((await api(editor, "POST", `/api/flows/${flow}/board/run`, { stage: "notes" })).status).toBe(501);
    expect((await api(editor, "POST", `/api/flows/${flow}/board/trust`, { fingerprint: "x" })).status).toBe(501);
  });

  it("tells everyone who has the flow open when a file changes", async () => {
    const { admin, editor, flow } = await setup();
    const res = await SELF.fetch(`${ORIGIN}/api/flows/${flow}/events`, { headers: { Upgrade: "websocket", Authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const events: { event: string }[] = [];
    const changed = new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        const frame = JSON.parse(String(msg.data)) as { event: string };
        events.push(frame);
        if (frame.event === "flow:changed") resolve();
      });
    });
    ws.accept();
    await ok(api(editor, "PUT", `/api/flows/${flow}/board/file?path=notes.md`, "live\n"));
    await changed;
    expect(events.map((e) => e.event)).toContain("flow:changed");
    ws.close();
    // A cookie upgrade from another site is refused.
    const hijack = await SELF.fetch(`${ORIGIN}/api/flows/${flow}/events`, {
      headers: { Upgrade: "websocket", Cookie: `__Host-flowgit_session=${admin.token}`, Origin: "https://evil.example" },
    });
    expect(hijack.status).toBe(403);
  });
});
