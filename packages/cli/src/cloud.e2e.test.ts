import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the built CLI against the local cloud emulator.
 * Wrangler 4 flags, checked against `wrangler d1 migrations apply --help` and `wrangler dev --help`
 * in wrangler 4.157 (https://developers.cloudflare.com/workers/wrangler/commands/):
 * `d1 migrations apply <binding> --local --persist-to <dir>` then
 * `dev --port <port> --persist-to <dir> --var FLOWGIT_TEST_LOGIN:1`.
 * The binary is packages/server/node_modules/.bin/wrangler (wrangler.cmd on Windows).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const serverDir = path.join(here, "..", "..", "server");

let work = "";
let home = "";
let flowDir = "";
let origin = "";
let cookie = "";
let child: ChildProcess | undefined;
let logs = "";

/**
 * `.bin/wrangler` is a shell shim (and `wrangler.cmd` on Windows) onto `wrangler/bin/wrangler.js`.
 * Spawning that file with the current Node works on Windows without a shell, so paths with spaces stay intact.
 * On other platforms the `.bin/wrangler` shim is used directly.
 */
function wranglerLaunch(args: string[]): { command: string; args: string[]; shell: boolean } {
  const bin = path.join(serverDir, "node_modules", ".bin", "wrangler");
  if (process.platform === "win32") {
    return { command: process.execPath, args: [path.join(serverDir, "node_modules", "wrangler", "bin", "wrangler.js"), ...args], shell: false };
  }
  return { command: bin, args, shell: false };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function runWrangler(args: string[]): ChildProcess {
  const launch = wranglerLaunch(args);
  return spawn(launch.command, launch.args, {
    cwd: serverDir,
    detached: process.platform !== "win32",
    shell: launch.shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" },
  });
}

function stopWrangler(): void {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  child = undefined;
}

function flowgit(args: string[]): { code: number | null; out: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FLOWGIT_HOME: home, FLOWGIT_CLOUD_URL: "", FLOWGIT_TOKEN: "" },
  });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function waitForProviders(url: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`wrangler 退出了 / wrangler exited ${child.exitCode}\n${logs.slice(-4000)}`);
    try {
      const res = await fetch(`${url}/api/auth/providers`);
      if (res.status === 200) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`本机云端没有起来 / the local cloud did not start: ${last}\n${logs.slice(-4000)}`);
}

beforeAll(async () => {
  if (!fs.existsSync(cli)) throw new Error("先构建命令行 / build the CLI first: pnpm -r run build");
  if (!fs.existsSync(path.join(serverDir, "public"))) throw new Error("先构建云端静态文件 / build the server first: pnpm --filter @flowgit/server build");
  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-cloud-e2e-"));
  home = path.join(work, "home");
  flowDir = path.join(work, "weekly");
  const persist = path.join(work, "persist");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(persist, { recursive: true });
  const migrateLaunch = wranglerLaunch(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persist]);
  const migrate = spawnSync(migrateLaunch.command, migrateLaunch.args, {
    cwd: serverDir,
    encoding: "utf8",
    shell: migrateLaunch.shell,
    env: { ...process.env, CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" },
  });
  if (migrate.status !== 0) throw new Error(`迁移失败 / migrations failed\n${migrate.stdout}\n${migrate.stderr}`);
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  child = runWrangler(["dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist, "--var", "FLOWGIT_TEST_LOGIN:1"]);
  child.stdout?.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    logs += String(chunk);
  });
  await waitForProviders(origin);
}, 120_000);

afterAll(() => {
  stopWrangler();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

describe("flowgit cloud CLI against the local emulator", () => {
  it("signs in, pushes weekly-report, pulls an API edit, keeps a hand edit, and lists a conflict", async () => {
    const login = spawn(process.execPath, [cli, "login", "--server", origin], {
      env: { ...process.env, NO_COLOR: "1", FLOWGIT_HOME: home, FLOWGIT_CLOUD_URL: "", FLOWGIT_TOKEN: "" },
    });
    let loginOut = "";
    const loginExit = new Promise<number | null>((resolve) => login.on("exit", resolve));
    login.stdout?.on("data", (chunk) => {
      loginOut += String(chunk);
    });
    login.stderr?.on("data", (chunk) => {
      loginOut += String(chunk);
    });
    const userCode = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`没有打印登录码 / no user code\n${loginOut}`)), 20_000);
      const look = () => {
        const match = loginOut.match(/[A-Z]{4}-[A-Z]{4}/);
        if (!match) return;
        clearTimeout(timer);
        resolve(match[0]);
      };
      login.stdout?.on("data", look);
      login.stderr?.on("data", look);
      login.on("exit", () => {
        clearTimeout(timer);
        reject(new Error(`登录提前退出 / login exited early\n${loginOut}`));
      });
      look();
    });

    const testLogin = await fetch(`${origin}/api/auth/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ subject: "admin", name: "Ada", kind: "web" }),
    });
    expect(testLogin.status, await testLogin.text()).toBe(200);
    const setCookie = typeof testLogin.headers.getSetCookie === "function" ? testLogin.headers.getSetCookie() : [testLogin.headers.get("set-cookie") ?? ""];
    cookie = setCookie.map((line) => line.split(";")[0]).filter(Boolean).join("; ");
    expect(cookie).toContain("=");
    const verify = await fetch(`${origin}/api/auth/device/verify`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: userCode }),
    });
    expect(verify.status, await verify.text()).toBe(200);
    const loginCode = await loginExit;
    expect(loginCode, loginOut).toBe(0);
    expect(loginOut).toContain(userCode);

    const credFile = path.join(home, "credentials.json");
    const credText = fs.readFileSync(credFile, "utf8");
    const token = (JSON.parse(credText) as { servers: Record<string, { token: string }> }).servers[origin]?.token;
    expect(token).toBeTruthy();
    expect(loginOut).not.toContain(token!);
    if (process.platform !== "win32") expect(fs.statSync(credFile).mode & 0o777).toBe(0o600);

    const workspace = await fetch(`${origin}/api/workspaces`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "e2e" }),
    });
    expect(workspace.status, await workspace.clone().text()).toBe(201);

    const init = flowgit(["init", flowDir, "-t", "weekly-report"]);
    expect(init.code, init.out).toBe(0);
    fs.writeFileSync(path.join(work, "week.md"), "修了登录\n");
    const ran = flowgit(["-C", flowDir, "run", "notes", "--from", path.join(work, "week.md"), "--input", "name=Ada"]);
    expect(ran.code, ran.out).toBe(0);

    const pushed = flowgit(["-C", flowDir, "push", "--server", origin]);
    expect(pushed.code, pushed.out).toBe(0);
    expect(pushed.out).not.toContain(token!);
    const linkPath = path.join(flowDir, ".flowgit", "cloud.json");
    const linkText = fs.readFileSync(linkPath, "utf8");
    const link = JSON.parse(linkText) as { server: string; workspace: string; flow: string; token?: string };
    expect(Object.keys(link).sort()).toEqual(["flow", "server", "workspace"]);
    expect(linkText).not.toContain(token!);
    expect(link.server).toBe(origin);

    const marker = "cloud-draft-marker\n";
    const edited = await fetch(`${origin}/api/flows/${link.flow}/raw?path=${encodeURIComponent("prompts/draft.md")}`, {
      method: "PUT",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/octet-stream" },
      body: marker,
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const pulled = flowgit(["-C", flowDir, "pull", "--server", origin]);
    expect(pulled.code, pulled.out).toBe(0);
    expect(fs.readFileSync(path.join(flowDir, "prompts", "draft.md"), "utf8")).toBe(marker);
    expect(pulled.out).not.toContain(token!);

    fs.writeFileSync(path.join(flowDir, "notes.md"), "hand-edit\n");
    const kept = flowgit(["-C", flowDir, "pull", "--server", origin]);
    expect(kept.code, kept.out).toBe(0);
    expect(fs.readFileSync(path.join(flowDir, "notes.md"), "utf8")).toBe("hand-edit\n");
    const runDir = path.join(flowDir, "runs", "notes");
    const manuals = fs.readdirSync(runDir).filter((name) => {
      const file = path.join(runDir, name, "run.json");
      return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes('"executor": "manual"');
    });
    expect(manuals.length).toBeGreaterThan(0);

    const cloudNote = await fetch(`${origin}/api/flows/${link.flow}/raw?path=${encodeURIComponent("notes.md")}`, {
      method: "PUT",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/octet-stream" },
      body: "from-cloud\n",
    });
    expect(cloudNote.status, await cloudNote.clone().text()).toBe(200);
    const conflict = flowgit(["-C", flowDir, "pull", "--server", origin]);
    expect(conflict.code).not.toBe(0);
    expect(conflict.out).toContain("notes.md");
    expect(fs.readFileSync(path.join(flowDir, "notes.md"), "utf8")).toBe("hand-edit\n");
    expect(conflict.out).not.toContain(token!);
  }, 180_000);
});
