import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { runTransport } from "../src/rooms/room.js";
import { MONTHLY_TOKEN_QUOTA, monthOf } from "../src/runs/usage.js";
import { adminWithWorkspace, api, b64, member, ok, ORIGIN, type Person } from "./helpers.js";

/** notes (a person) → draft (a model; canned reply in demo-replies/) → check (a script: needs a computer). */
function reportFlow(extra: Record<string, unknown> = {}): Record<string, string> {
  const flow = {
    format: "flowgit",
    version: "0.1",
    id: "report",
    name: "Report",
    inputs: { name: { type: "string", default: "Cyrus" } },
    stages: [
      { id: "notes", name: "Notes", executor: { type: "human", instructions: "Write notes.md" }, outputs: [{ path: "notes.md", type: "text/markdown" }] },
      { id: "draft", name: "Draft", inputs: ["notes"], executor: { type: "llm", prompt: "prompts/draft.md" }, outputs: [{ path: "report.md", type: "text/markdown" }] },
      { id: "check", name: "Check", inputs: ["draft"], executor: { type: "script", run: "node check.mjs" }, outputs: [{ path: "check.json", type: "application/json" }] },
    ],
    ...extra,
  };
  return {
    "flow.json": b64(JSON.stringify(flow, null, 2)),
    "prompts/draft.md": b64("Turn these notes into a report:\n\n{{notes}}\n"),
    "demo-replies/draft.md": b64("# Report\n\nDone this week: things.\n"),
    "check.mjs": b64("console.log('ok')\n"),
  };
}

/** One service stage that sends a workspace key in a header. */
function keyFlow(url = "https://api.example.test/echo"): Record<string, string> {
  const flow = {
    format: "flowgit",
    version: "0.1",
    id: "keys",
    name: "Keys",
    stages: [
      {
        id: "call",
        name: "Call",
        executor: { type: "service", url, method: "POST", headers: { Authorization: "Bearer {{env.EXAMPLE_API_KEY}}" } },
        outputs: [{ path: "answer.json", type: "application/json" }],
      },
    ],
  };
  return { "flow.json": b64(JSON.stringify(flow, null, 2)) };
}

async function newFlow(person: Person, ws: string, files: Record<string, string>, name = "Flow"): Promise<string> {
  const { flow } = await ok<{ flow: { id: string } }>(api(person, "POST", `/api/workspaces/${ws}/flows`, { name, files }), 201);
  return flow.id;
}

interface RunView {
  id: string;
  state: string;
  stage: string;
  waiting: { stage: string; kind: string; missing: string[] } | null;
}

async function current(person: Person, flow: string): Promise<RunView | null> {
  return (await ok<{ run: RunView | null }>(api(person, "GET", `/api/flows/${flow}/run`))).run;
}

async function until<T>(what: string, fn: () => Promise<T | undefined | null | false>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function rawText(person: Person, flow: string, path: string): Promise<string | undefined> {
  const res = await api(person, "GET", `/api/flows/${flow}/raw?path=${encodeURIComponent(path)}`);
  if (res.status === 404) return undefined;
  return new TextDecoder().decode(await res.arrayBuffer());
}

/** Open the flow's socket and keep every frame. */
async function listen(person: Person, flow: string): Promise<{ frames: { event: string; data: Record<string, unknown> }[]; close: () => void }> {
  const res = await SELF.fetch(`${ORIGIN}/api/flows/${flow}/events`, { headers: { Upgrade: "websocket", Authorization: `Bearer ${person.token}` } });
  const ws = res.webSocket!;
  const frames: { event: string; data: Record<string, unknown> }[] = [];
  ws.accept();
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.startsWith("{")) frames.push(JSON.parse(event.data));
  });
  return { frames, close: () => ws.close() };
}

afterEach(() => {
  runTransport.fetch = undefined;
});

describe("cloud runs", () => {
  it("waits for a person, goes on after the upload, and hands a script stage to a computer", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "runner", "editor");
    const viewer = await member(admin, ws, "watcher", "viewer");
    const flow = await newFlow(editor, ws, reportFlow());
    const socket = await listen(viewer, flow);

    // Viewers can't run.
    expect((await api(viewer, "POST", `/api/flows/${flow}/board/run`, { stage: "all" })).status).toBe(403);

    const first = await ok<{ ok: boolean; waiting: { stage: string; kind: string; missing: string[]; instructions: string }; run: RunView }>(
      api(editor, "POST", `/api/flows/${flow}/board/run`, { stage: "all" }),
    );
    expect(first.waiting).toMatchObject({ stage: "notes", kind: "human", missing: ["notes.md"], instructions: "Write notes.md" });
    expect((await current(viewer, flow))?.state).toBe("waiting");

    // The lock: one run per flow.
    const busy = await api(editor, "POST", `/api/flows/${flow}/board/run`, { stage: "draft" });
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { run: RunView }).run.id).toBe(first.run.id);
    // Waiting is not running: the person can still save the file the run waits for, and that resumes it.
    await ok(api(editor, "PUT", `/api/flows/${flow}/board/file?path=notes.md`, "- shipped the cloud\n"));

    const atCheck = await until("the run to reach check", async () => {
      const run = await current(editor, flow);
      return run?.waiting?.stage === "check" ? run : undefined;
    });
    expect(atCheck.waiting).toMatchObject({ stage: "check", kind: "computer" });
    expect(await rawText(editor, flow, "report.md")).toBe("# Report\n\nDone this week: things.\n");
    expect(await rawText(editor, flow, "runs/draft/1/run.json")).toContain('"status": "ok"');

    // The log streamed to everyone with the flow open, in the local board's event names.
    const events = socket.frames.map((frame) => frame.event);
    expect(events).toEqual(expect.arrayContaining(["run:start", "run:end", "stage:start", "stage:done", "run:continue"]));
    expect(socket.frames.find((frame) => frame.event === "stage:done")?.data).toMatchObject({ stage: "notes", n: 1 });

    // A computer runs check and pushes its files; then the run goes on and finds it done.
    await withComputerRun(editor, flow);
    await ok(api(editor, "POST", `/api/flows/${flow}/runs/${first.run.id}/continue`));
    await until("the run to finish", async () => (await current(editor, flow)) === null);
    const { run } = await ok<{ run: { state: string; error: string | null } }>(api(editor, "GET", `/api/flows/${flow}/runs/${first.run.id}`));
    expect(run).toMatchObject({ state: "done", error: null });

    // In-app notifications for the person who started it.
    const { notifications } = await ok<{ notifications: { kind: string }[] }>(api(editor, "GET", "/api/notifications"));
    expect(notifications.map((n) => n.kind)).toEqual(expect.arrayContaining(["run.waiting", "run.computer", "run.done"]));
    expect((await ok<{ notifications: unknown[] }>(api(viewer, "GET", "/api/notifications"))).notifications).toHaveLength(0);
    socket.close();
  });

  it("answers at once with detach, and cancels a waiting run", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const flow = await newFlow(admin, ws, reportFlow());
    const started = await ok<{ run: RunView }>(api(admin, "POST", `/api/flows/${flow}/runs`, { stage: "notes", detach: true }), 202);
    expect(started.run.state).toBe("running");
    await until("the run to wait", async () => (await current(admin, flow))?.state === "waiting");
    await ok(api(admin, "POST", `/api/flows/${flow}/runs/${started.run.id}/cancel`));
    expect(await current(admin, flow)).toBeNull();
    const { run } = await ok<{ run: { state: string } }>(api(admin, "GET", `/api/flows/${flow}/runs/${started.run.id}`));
    expect(run.state).toBe("cancelled");
    // The lock is free again.
    const again = await ok<{ waiting: { stage: string } }>(api(admin, "POST", `/api/flows/${flow}/board/run`, { stage: "notes" }));
    expect(again.waiting.stage).toBe("notes");
    const { runs } = await ok<{ runs: { state: string }[] }>(api(admin, "GET", `/api/flows/${flow}/runs`));
    expect(runs.map((r) => r.state)).toEqual(["waiting", "cancelled"]);
  });

  it("refuses a new run once the month's tokens are used up", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const flow = await newFlow(admin, ws, reportFlow());
    await env.DB.prepare("INSERT INTO usage (workspace_id, month, tokens, runs) VALUES (?, ?, ?, 0)").bind(ws, monthOf(), MONTHLY_TOKEN_QUOTA).run();
    const res = await api(admin, "POST", `/api/flows/${flow}/board/run`, { stage: "all" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain("token");
    expect(await current(admin, flow)).toBeNull();
    const { usage } = await ok<{ usage: { tokens: number; tokenQuota: number } }>(api(admin, "GET", `/api/workspaces/${ws}/usage`));
    expect(usage.tokens).toBe(usage.tokenQuota);
  });

  it("keeps a copied flow from running until someone confirms it, and remembers that in D1", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const flow = await newFlow(admin, ws, reportFlow({ forkedFrom: { source: "https://github.com/someone/flows" } }));
    const refused = await api(admin, "POST", `/api/flows/${flow}/board/run`, { stage: "all" });
    expect(refused.status).toBe(409);
    const { trust } = (await refused.json()) as { trust: { fingerprint: string; actions: unknown[] } };
    expect(trust.actions.length).toBeGreaterThan(0);
    expect(await current(admin, flow)).toBeNull();
    await ok(api(admin, "POST", `/api/flows/${flow}/board/trust`, { fingerprint: trust.fingerprint }));
    expect(await env.DB.prepare("SELECT fingerprint FROM trust WHERE flow_id = ?").bind(flow).first("fingerprint")).toBe(trust.fingerprint);
    // A fresh room (after a restart) still knows.
    await resetRoom(flow);
    const run = await ok<{ waiting: { stage: string } }>(api(admin, "POST", `/api/flows/${flow}/board/run`, { stage: "all" }));
    expect(run.waiting.stage).toBe("notes");
  });
});

describe("cloud runs, permissions and restarts", () => {
  it("checks roles on every run route", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const viewer = await member(admin, ws, "looker", "viewer");
    const { admin: stranger } = await adminWithWorkspace("Elsewhere");
    void stranger;
    const outsider = await (await import("./helpers.js")).login("outsider-runs", (await ok<{ code: string }>(api(admin, "POST", "/api/invites", {}), 201)).code);
    const flow = await newFlow(admin, ws, reportFlow());
    const started = await ok<{ run: RunView }>(api(admin, "POST", `/api/flows/${flow}/runs`, { stage: "notes", detach: true }), 202);
    for (const [method, path] of [
      ["GET", `/api/flows/${flow}/runs`],
      ["GET", `/api/flows/${flow}/run`],
      ["GET", `/api/flows/${flow}/runs/${started.run.id}`],
      ["POST", `/api/flows/${flow}/runs/${started.run.id}/cancel`],
      ["POST", `/api/flows/${flow}/runs`],
      ["GET", `/api/workspaces/${ws}/keys`],
      ["GET", `/api/workspaces/${ws}/usage`],
    ] as const) {
      expect((await api(outsider, method, path, method === "POST" ? {} : undefined)).status, `${method} ${path}`).toBe(404);
    }
    expect((await api(viewer, "GET", `/api/flows/${flow}/runs`)).status).toBe(200);
    expect((await api(viewer, "POST", `/api/flows/${flow}/runs/${started.run.id}/cancel`)).status).toBe(403);
    expect((await api(viewer, "POST", `/api/flows/${flow}/runs/${started.run.id}/continue`)).status).toBe(403);
    expect((await api(viewer, "GET", `/api/workspaces/${ws}/keys`)).status).toBe(403);
    expect((await api(undefined, "GET", `/api/flows/${flow}/runs`)).status).toBe(401);
  });

  it("keeps a waiting run across a room restart and resumes it from the files", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const flow = await newFlow(admin, ws, reportFlow());
    const first = await ok<{ waiting: { stage: string }; run: RunView }>(api(admin, "POST", `/api/flows/${flow}/board/run`, { stage: "all" }));
    expect(first.waiting.stage).toBe("notes");
    await resetRoom(flow);
    expect((await current(admin, flow))?.id).toBe(first.run.id);
    await ok(api(admin, "PUT", `/api/flows/${flow}/raw?path=notes.md`, "- notes\n"));
    // Any write that completes the waiting stage resumes the run (the CLI's push too).
    const resumed = await until("the run to reach check", async () => {
      const run = await current(admin, flow);
      return run?.waiting?.stage === "check" ? run : undefined;
    });
    expect(resumed.id).toBe(first.run.id);
    expect(resumed.waiting).toMatchObject({ stage: "check", kind: "computer" });
    // Continuing without the computer's files: it waits there again.
    const again = await ok<{ waiting: { stage: string } }>(api(admin, "POST", `/api/flows/${flow}/board/run`, { stage: "all" }));
    expect(again.waiting.stage).toBe("check");
    expect(await rawText(admin, flow, "report.md")).toContain("# Report");
  });
});

describe("the key vault", () => {
  const SECRET = "sk-test-0123456789abcdefSECRET";

  it("is write-only, decrypts only into a run, logs each use, and stops working once deleted", async () => {
    const { admin, ws } = await adminWithWorkspace();
    const editor = await member(admin, ws, "keyuser", "editor");
    // Only owners store keys; editors see names and the last four characters.
    expect((await api(editor, "PUT", `/api/workspaces/${ws}/keys/EXAMPLE_API_KEY`, { value: SECRET })).status).toBe(403);
    expect((await api(admin, "PUT", `/api/workspaces/${ws}/keys/lowercase`, { value: SECRET })).status).toBe(400);
    expect((await api(admin, "PUT", `/api/workspaces/${ws}/keys/FLOWGIT_HOME`, { value: SECRET })).status).toBe(400);
    const stored = await ok<{ key: { name: string; last4: string } }>(api(admin, "PUT", `/api/workspaces/${ws}/keys/EXAMPLE_API_KEY`, { value: SECRET }));
    expect(stored.key).toEqual({ name: "EXAMPLE_API_KEY", last4: "CRET" });
    const listed = await api(editor, "GET", `/api/workspaces/${ws}/keys`);
    const listedText = await listed.text();
    expect(listedText).toContain("EXAMPLE_API_KEY");
    expect(listedText).not.toContain(SECRET);
    const row = await env.DB.prepare("SELECT ciphertext FROM vault_keys WHERE workspace_id = ?").bind(ws).first<{ ciphertext: string }>();
    expect(row!.ciphertext).not.toContain(SECRET);
    expect(atob(row!.ciphertext)).not.toContain(SECRET);

    // The service stage reads it from the run's environment.
    const seen: string[] = [];
    runTransport.fetch = async (input, init) => {
      seen.push(new Headers(init?.headers).get("Authorization") ?? "");
      return new Response(JSON.stringify({ answer: 42 }), { headers: { "Content-Type": "application/json" } });
    };
    const flow = await newFlow(editor, ws, keyFlow());
    const socket = await listen(editor, flow);
    await ok(api(editor, "POST", `/api/flows/${flow}/board/run`, { stage: "call" }));
    expect(seen).toEqual([`Bearer ${SECRET}`]);
    expect(await rawText(editor, flow, "answer.json")).toContain("42");

    const { uses } = await ok<{ uses: { name: string; stage: string; flow_id: string }[] }>(api(admin, "GET", `/api/workspaces/${ws}/key-uses`));
    expect(uses).toEqual([expect.objectContaining({ name: "EXAMPLE_API_KEY", stage: "call", flow_id: flow })]);
    expect((await api(editor, "GET", `/api/workspaces/${ws}/key-uses`)).status).toBe(403);

    // No key anywhere: files in R2, run.json, logs, the socket, D1.
    await expectNoSecret(SECRET, flow, socket.frames);

    // Deleted: the next run can't use it, at once.
    await ok(api(admin, "DELETE", `/api/workspaces/${ws}/keys/EXAMPLE_API_KEY`));
    seen.length = 0;
    const failed = await api(editor, "POST", `/api/flows/${flow}/board/run`, { stage: "call" });
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { error: string }).error).toContain("EXAMPLE_API_KEY");
    expect(seen).toEqual([]);
    socket.close();
  });
});

/** As if the desktop app ran the check stage and pushed its files (run.json as core writes it). */
async function withComputerRun(person: Person, flow: string): Promise<void> {
  const { createMemoryHost, withFlowHost } = await import("../src/storage/context-host.js");
  const { loadFlow, runStage } = await import("@flowgit/core");
  const files = await ok<{ files: { path: string }[] }>(api(person, "GET", `/api/flows/${flow}/files`));
  const host = createMemoryHost({
    cwd: "/pc",
    home: "/home",
    exec: async () => {
      host.writeFile("/pc/check.json", '{"ok":true}\n');
      return { code: 0, output: "ok\n" };
    },
  });
  for (const file of files.files) {
    const data = new Uint8Array(await (await api(person, "GET", `/api/flows/${flow}/raw?path=${encodeURIComponent(file.path)}`)).arrayBuffer());
    host.mkdir(host.path.dirname(`/pc/${file.path}`), { recursive: true });
    host.writeFile(`/pc/${file.path}`, data);
  }
  const before = new Set(host.files());
  const snapshot = new Map([...before].map((abs) => [abs, host.readFile(abs)]));
  await withFlowHost(host, async () => {
    await runStage(loadFlow("/pc"), "check");
  });
  for (const abs of host.files()) {
    const data = host.readFile(abs);
    const old = snapshot.get(abs);
    if (old && old.length === data.length && old.every((byte, i) => byte === data[i])) continue;
    await ok(api(person, "PUT", `/api/flows/${flow}/raw?path=${encodeURIComponent(abs.slice(4))}`, data));
  }
}

async function resetRoom(flow: string): Promise<void> {
  const { evictAllDurableObjects } = await import("cloudflare:test");
  void flow;
  await evictAllDurableObjects();
}

async function expectNoSecret(secret: string, flow: string, frames: unknown[]): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: `flows/${flow}/`, cursor });
    for (const object of page.objects) {
      const body = await env.FILES.get(object.key);
      expect(new TextDecoder().decode(await body!.arrayBuffer()), object.key).not.toContain(secret);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  expect(JSON.stringify(frames)).not.toContain(secret);
  for (const table of ["runs", "audit", "notifications", "key_uses", "usage", "trust", "vault_keys"]) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    expect(JSON.stringify(results), table).not.toContain(secret);
  }
}
