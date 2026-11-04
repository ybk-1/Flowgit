import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFlow, runStage } from "@flowgit/core";
import { cloudOrigin } from "./cloud/origin.js";
import { credentialsPath, readCredentialFile, cloudSession } from "./cloud/credentials.js";
import { failure } from "./cloud/http.js";
import { pollDeviceToken } from "./cloud/device.js";
import { hashFile, ignoredSyncPath, listLocalFiles, packCreate, sha256Buffer } from "./cloud/files.js";
import { baseAfterPull, chooseWorkspace, classifyPull, cloudChanges, hashMap, parseCloneTarget, planPush } from "./cloud/sync.js";
import { readLink } from "./cloud/link.js";
import { frameResult } from "./cloud/frames.js";
import { executeLogin, executeWhoami } from "./commands/login.js";
import { executePush } from "./commands/push.js";
import { executePull } from "./commands/pull.js";
import { executeCloudRun } from "./commands/cloud.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix = "flowgit-cloud-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const flowText = {
  format: "flowgit",
  version: "0.1",
  name: "Tiny",
  stages: [{ id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "notes.md" }] }],
};

function writeTiny(dir: string, notes = "one"): void {
  fs.writeFileSync(path.join(dir, "flow.json"), `${JSON.stringify(flowText, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "notes.md"), notes);
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "config"), "secret");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "pkg.js"), "nope");
  fs.writeFileSync(path.join(dir, "flowgit.local.json"), "{\"inputs\":{}}\n");
  fs.mkdirSync(path.join(dir, "runs", "notes", "1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "runs", "notes", "1", "run.json"), "{}\n");
}

describe("cloud origin", () => {
  it("keeps only the origin and refuses insecure hosts", () => {
    expect(cloudOrigin(undefined, {})).toBe("https://flowgit.dev");
    expect(cloudOrigin("https://flowgit.dev/api/me?x=1", {})).toBe("https://flowgit.dev");
    expect(cloudOrigin("http://127.0.0.1:8787/app", {})).toBe("http://127.0.0.1:8787");
    expect(cloudOrigin("http://localhost:8787", {})).toBe("http://localhost:8787");
    expect(cloudOrigin(undefined, { FLOWGIT_CLOUD_URL: "https://staging.flowgit.dev/api" })).toBe("https://staging.flowgit.dev");
    expect(() => cloudOrigin("http://example.com", {})).toThrow(/https:\/\/[\s\S]*localhost/);
    expect(() => cloudOrigin("http://192.168.0.1:8787", {})).toThrow(/127\.0\.0\.1/);
  });
});

describe("sync plans", () => {
  it("skips unsynced paths and classifies a three-way pull", () => {
    const dir = tmp();
    writeTiny(dir);
    const listed = listLocalFiles(dir).map((file) => file.path);
    expect(listed).toContain("flow.json");
    expect(listed).toContain("runs/notes/1/run.json");
    expect(listed.some((rel) => rel.startsWith(".git/") || rel.startsWith("node_modules/") || rel === "flowgit.local.json")).toBe(false);
    expect(ignoredSyncPath(".flowgit-blobs/abc")).toBe(true);

    const base = hashMap([{ path: "a.txt", sha256: "a" }, { path: "runs/notes/1/run.json", sha256: "r" }]);
    const local = hashMap([{ path: "a.txt", sha256: "a" }, { path: "runs/notes/1/run.json", sha256: "r" }, { path: "only-local.txt", sha256: "l" }]);
    const cloud = hashMap([{ path: "a.txt", sha256: "b" }, { path: "runs/notes/1/run.json", sha256: "other" }, { path: "new.txt", sha256: "n" }]);
    const ops = classifyPull(local, cloud, base);
    expect(ops).toContainEqual({ path: "a.txt", kind: "download" });
    expect(ops).toContainEqual({ path: "new.txt", kind: "download" });
    expect(ops).toContainEqual({ path: "runs/notes/1/run.json", kind: "conflict" });
    expect(ops.some((op) => op.path === "only-local.txt")).toBe(false);

    const both = hashMap([{ path: "a.txt", sha256: "local" }]);
    const remote = hashMap([{ path: "a.txt", sha256: "cloud" }]);
    expect(classifyPull(both, remote, base).filter((op) => op.path === "a.txt")).toEqual([{ path: "a.txt", kind: "conflict" }]);
    expect(cloudChanges(remote, hashMap([{ path: "a.txt", sha256: "a" }]))).toEqual(["a.txt"]);
    expect(planPush(hashMap([{ path: "a.txt", sha256: "local" }, { path: "b.txt", sha256: "b" }]), hashMap([{ path: "a.txt", sha256: "a" }, { path: "gone.txt", sha256: "g" }]))).toEqual({
      upload: ["a.txt", "b.txt"],
      remove: ["gone.txt"],
    });
    const choices = new Map<string, "local" | "cloud">([["a.txt", "local"]]);
    expect(baseAfterPull(both, remote, hashMap([{ path: "a.txt", sha256: "a" }]), choices)["a.txt"]).toBe("cloud");
  });

  it("parses clone targets and chooses a workspace", async () => {
    const originOf = (server: string) => cloudOrigin(server, {});
    expect(parseCloneTarget("https://flowgit.dev/app/?flow=flw_1", "https://flowgit.dev", originOf)).toEqual({ origin: "https://flowgit.dev", flowId: "flw_1" });
    expect(parseCloneTarget("https://flowgit.dev/app/board.html?flow=cloud-flw_2", "https://flowgit.dev", originOf).flowId).toBe("flw_2");
    expect(parseCloneTarget("flw_3", "https://flowgit.dev", originOf).origin).toBe("https://flowgit.dev");
    expect(() => parseCloneTarget("http://example.com/app/?flow=flw_1", "https://flowgit.dev", originOf)).toThrow(/https/);
    await expect(chooseWorkspace({ workspaces: [{ id: "ws_1", name: "A" }], tty: false, ask: async () => "" })).resolves.toBe("ws_1");
    await expect(chooseWorkspace({ workspaces: [{ id: "ws_1", name: "A" }, { id: "ws_2", name: "B" }], tty: false, ask: async () => "" })).rejects.toThrow(/--workspace/);
    await expect(chooseWorkspace({ workspaces: [], tty: true, ask: async () => "" })).rejects.toThrow(/工作区/);
  });

  it("refuses a file over 50 MB and keeps a create under the estimate", () => {
    expect(() => packCreate([{ path: "flow.json", bytes: 10, sha256: "a" }, { path: "big.bin", bytes: 50 * 1024 * 1024 + 1, sha256: "b" }])).toThrow(/50 MB/);
    const packed = packCreate([{ path: "flow.json", bytes: 20, sha256: "a" }, { path: "b.txt", bytes: 20, sha256: "b" }]);
    expect(packed.create.sort()).toEqual(["b.txt", "flow.json"]);
    expect(packed.rest).toEqual([]);
  });
});

describe("device sign-in", () => {
  it("waits out authorization_pending, slows down on 429, and never logs the token", async () => {
    const home = tmp("flowgit-home-");
    const env = { FLOWGIT_HOME: home };
    const sleeps: number[] = [];
    let polls = 0;
    const token = "bearer-secret-value";
    const device = "device-secret-value";
    const lines: string[] = [];
    const opened: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/api/auth/device" && init?.method === "POST") {
        return jsonResponse(200, {
          device_code: device,
          user_code: "ABCD-EFGH",
          verification_uri: "http://127.0.0.1:9/api/auth/device/verify",
          verification_uri_complete: "http://127.0.0.1:9/api/auth/device/verify?code=ABCD-EFGH",
          expires_in: 60,
          interval: 5,
        });
      }
      if (url.pathname === "/api/auth/device/token") {
        polls += 1;
        if (polls === 1) return jsonResponse(400, { error: "还在等你在网页上确认 / waiting", code: "authorization_pending" });
        if (polls === 2) return jsonResponse(429, { error: "慢一点 / slow down" }, { "retry-after": "12" });
        return jsonResponse(200, { token, token_type: "bearer", expires_at: Date.now() + 60_000, expires_in: 60 });
      }
      if (url.pathname === "/api/me") return jsonResponse(200, { user: { id: "usr_1", name: "Ada" } });
      return jsonResponse(404, { error: "没有这个接口 / not found" });
    };
    const code = await executeLogin({
      server: "http://127.0.0.1:9",
      env,
      log: (line) => lines.push(line),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      open: (url) => opened.push(url),
      fetchImpl,
    });
    expect(code).toBe(0);
    expect(opened).toEqual(["http://127.0.0.1:9/api/auth/device/verify?code=ABCD-EFGH"]);
    expect(sleeps[0]).toBe(5000);
    expect(sleeps[2]).toBeGreaterThanOrEqual(12_000);
    const text = lines.join("\n");
    expect(text).toContain("ABCD-EFGH");
    expect(text).not.toContain(token);
    expect(text).not.toContain(device);
    const file = credentialsPath(env);
    expect(fs.readFileSync(file, "utf8")).toContain("usr_1");
    expect(fs.readFileSync(file, "utf8")).not.toContain("flow.json");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(cloudSession("http://127.0.0.1:9", { ...env, FLOWGIT_TOKEN: "env-token" }).token).toBe("env-token");
    expect(cloudSession("http://127.0.0.1:9", { ...env, FLOWGIT_TOKEN: "env-token" }).fromEnv).toBe(true);
  });

  it("fails on expired_token without echoing the device code", async () => {
    await expect(
      pollDeviceToken({
        origin: "http://127.0.0.1:9",
        deviceCode: "device-secret-value",
        intervalSec: 1,
        expiresInSec: 30,
        sleep: async () => {},
        fetchImpl: async () => jsonResponse(400, { error: "登录码过期了，请重新运行 flowgit login / the code expired; run flowgit login again", code: "expired_token" }),
      }),
    ).rejects.toThrow(/flowgit login/);
  });

  it("whoami on 401 says to log in again", async () => {
    const home = tmp("flowgit-home-");
    await expect(
      executeWhoami({
        server: "http://127.0.0.1:9",
        env: { FLOWGIT_HOME: home, FLOWGIT_TOKEN: "env-token" },
        log: () => {},
        fetchImpl: async () => jsonResponse(401, { error: "请先登录 / sign in first" }),
      }),
    ).rejects.toThrow(/flowgit login/);
    expect(fs.existsSync(credentialsPath({ FLOWGIT_HOME: home }))).toBe(false);
  });
});

describe("run frames", () => {
  it("stops on run:end and tells the person to run a computer stage locally", () => {
    const computer = frameResult(JSON.stringify({ id: 1, event: "run:end", data: { ok: true, waiting: { kind: "computer", stage: "check", name: "检查" } } }));
    expect(computer.exit).toBe(2);
    expect(computer.lines.join("\n")).toMatch(/电脑[\s\S]*push/);
    expect(frameResult(JSON.stringify({ id: 2, event: "stage:log", data: { stage: "draft", line: "hello" } })).lines).toEqual(["hello"]);
    expect(frameResult("pong").lines).toEqual([]);
    const locked = failure({
      status: 409,
      bytes: new TextEncoder().encode(JSON.stringify({ error: "锁住了 / locked", code: "locked", editor: { name: "Bo", id: "usr_2" } })),
      headers: new Headers(),
    });
    expect(locked.message).toContain("Bo (usr_2)");
    expect(locked.message).toContain("没有重试");
    expect(locked.code).toBe("locked");
    const unavailable = failure({ status: 501, bytes: new TextEncoder().encode("{}"), headers: new Headers() });
    expect(unavailable.message).toBe("云端还不能运行 / the cloud cannot run this yet");
  });
});

describe("push and pull against a fake cloud", () => {
  function fakeCloud() {
    const files = new Map<string, Buffer>();
    let flowId = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const bodyBytes = async () => {
        const body = init?.body;
        if (!body) return new Uint8Array();
        if (body instanceof Uint8Array) return body;
        if (typeof body === "string") return new TextEncoder().encode(body);
        return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
      };
      if (method === "GET" && url.pathname === "/api/workspaces") return jsonResponse(200, { workspaces: [{ id: "ws_1", name: "One" }] });
      if (method === "POST" && url.pathname === "/api/workspaces/ws_1/flows") {
        const payload = JSON.parse(new TextDecoder().decode(await bodyBytes())) as { files: Record<string, string> };
        flowId = "flw_1";
        for (const [rel, b64] of Object.entries(payload.files)) files.set(rel, Buffer.from(b64, "base64"));
        return jsonResponse(201, { flow: { id: flowId, workspace_id: "ws_1", name: "Tiny" } });
      }
      if (method === "GET" && url.pathname === `/api/flows/${flowId}/files`) {
        return jsonResponse(200, { files: [...files].map(([rel, buf]) => ({ path: rel, size: buf.length, sha256: sha256Buffer(buf) })) });
      }
      if (url.pathname === `/api/flows/${flowId}/raw` && method === "PUT") {
        const rel = url.searchParams.get("path") ?? "";
        const buf = Buffer.from(await bodyBytes());
        files.set(rel, buf);
        return jsonResponse(200, { ok: true, path: rel, sha256: sha256Buffer(buf) });
      }
      if (url.pathname === `/api/flows/${flowId}/raw` && method === "GET") {
        const rel = url.searchParams.get("path") ?? "";
        const buf = files.get(rel);
        if (!buf) return jsonResponse(404, { error: "没有这个文件 / no such file" });
        return new Response(buf, { status: 200 });
      }
      if (url.pathname === `/api/flows/${flowId}/raw` && method === "DELETE") {
        files.delete(url.searchParams.get("path") ?? "");
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(500, { error: `意外的请求 / unexpected ${method} ${url.pathname}` });
    };
    return { fetchImpl, files, id: () => flowId };
  }

  it("pushes, pulls a cloud edit, keeps a hand edit, and lists a conflict", async () => {
    const home = tmp("flowgit-home-");
    const dir = tmp("flowgit-flow-");
    writeTiny(dir, "notes-v1\n");
    const cloud = fakeCloud();
    const env = { FLOWGIT_HOME: home, FLOWGIT_TOKEN: "env-token" };
    const logs: string[] = [];
    expect(await executePush({ dir, server: "http://127.0.0.1:9", env, tty: false, log: (line) => logs.push(line), fetchImpl: cloud.fetchImpl })).toBe(0);
    const link = JSON.parse(fs.readFileSync(path.join(dir, ".flowgit", "cloud.json"), "utf8")) as { server: string; workspace: string; flow: string };
    expect(link).toEqual({ server: "http://127.0.0.1:9", workspace: "ws_1", flow: "flw_1" });
    expect(JSON.stringify(link)).not.toContain("env-token");
    expect(fs.readFileSync(path.join(dir, ".flowgit", "cloud-base.json"), "utf8")).not.toContain("env-token");
    expect(cloud.files.has(".git/config")).toBe(false);
    expect(cloud.files.has("flowgit.local.json")).toBe(false);
    expect(cloud.files.get("notes.md")?.toString()).toBe("notes-v1\n");

    cloud.files.set("prompts/draft.md", Buffer.from("from-cloud\n"));
    expect(await executePull({ dir, server: "http://127.0.0.1:9", env, tty: false, log: () => {}, fetchImpl: cloud.fetchImpl })).toBe(0);
    expect(fs.readFileSync(path.join(dir, "prompts", "draft.md"), "utf8")).toBe("from-cloud\n");

    await runStage(loadFlow(dir), "notes", { from: [path.join(dir, "notes.md")] });
    fs.writeFileSync(path.join(dir, "notes.md"), "hand-edit\n");
    expect(await executePull({ dir, server: "http://127.0.0.1:9", env, tty: false, log: (line) => logs.push(line), fetchImpl: cloud.fetchImpl })).toBe(0);
    expect(fs.readFileSync(path.join(dir, "notes.md"), "utf8")).toBe("hand-edit\n");
    const runFiles = listLocalFiles(dir).map((file) => file.path).filter((rel) => /^runs\/notes\/\d+\/run\.json$/.test(rel));
    const manuals = runFiles.filter((rel) => fs.readFileSync(path.join(dir, rel), "utf8").includes('"executor": "manual"'));
    expect(manuals.length).toBeGreaterThan(0);

    cloud.files.set("notes.md", Buffer.from("cloud-edit\n"));
    const conflict: string[] = [];
    const code = await executePull({ dir, server: "http://127.0.0.1:9", env, tty: false, log: (line) => conflict.push(line), fetchImpl: cloud.fetchImpl });
    expect(code).toBe(1);
    expect(conflict.join("\n")).toContain("notes.md");
    expect(fs.readFileSync(path.join(dir, "notes.md"), "utf8")).toBe("hand-edit\n");
    expect(logs.join("\n")).not.toContain("env-token");
  });

  it("refuses a push when the cloud changed", async () => {
    const home = tmp("flowgit-home-");
    const dir = tmp("flowgit-flow-");
    writeTiny(dir, "notes-v1\n");
    const cloud = fakeCloud();
    const env = { FLOWGIT_HOME: home, FLOWGIT_TOKEN: "env-token" };
    await executePush({ dir, server: "http://127.0.0.1:9", env, tty: false, log: () => {}, fetchImpl: cloud.fetchImpl });
    cloud.files.set("notes.md", Buffer.from("someone-else\n"));
    await expect(executePush({ dir, server: "http://127.0.0.1:9", env, tty: false, log: () => {}, fetchImpl: cloud.fetchImpl })).rejects.toThrow(/flowgit pull/);
    expect(readLink(dir)?.flow).toBe("flw_1");
    expect(readCredentialFile(env).servers).toEqual({});
  });
});

describe("cloud run", () => {
  it("prints a bilingual message and fails when the server answers 501", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".flowgit"));
    fs.writeFileSync(path.join(dir, ".flowgit", "cloud.json"), JSON.stringify({ server: "http://127.0.0.1:9", workspace: "ws_1", flow: "flw_1" }));
    const lines: string[] = [];
    await expect(
      executeCloudRun({
        dir,
        server: "http://127.0.0.1:9",
        env: { FLOWGIT_TOKEN: "env-token" },
        log: (line) => lines.push(line),
        fetchImpl: async () => jsonResponse(501, { error: "云端运行还没接上 / cloud runs are not wired up yet" }),
      }),
    ).rejects.toThrow("云端运行还没接上 / cloud runs are not wired up yet");
    expect(lines.join("\n")).not.toContain("env-token");
  });

  it("does not confirm a copied flow by itself", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".flowgit"));
    fs.writeFileSync(path.join(dir, ".flowgit", "cloud.json"), JSON.stringify({ server: "http://127.0.0.1:9", workspace: "ws_1", flow: "flw_1" }));
    await expect(
      executeCloudRun({
        dir,
        server: "http://127.0.0.1:9",
        env: { FLOWGIT_TOKEN: "env-token" },
        log: () => {},
        fetchImpl: async () => jsonResponse(409, { error: "先确认 / confirm first", trust: { reason: "new" } }),
      }),
    ).rejects.toThrow(/不会跳过确认|does not skip/);
  });
});

describe("file hashes", () => {
  it("hashes the bytes on disk", () => {
    const dir = tmp();
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "abc");
    expect(hashFile(file).sha256).toBe(sha256Buffer(Buffer.from("abc")));
  });
});
