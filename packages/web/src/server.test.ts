import { spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBoard, type BoardServer } from "./server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "..", "cli", "dist", "index.js");
const templateReplies = path.join(here, "..", "..", "cli", "templates", "short-video", "demo-replies");

function flowgit(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

function httpGet(
  port: number,
  reqPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: reqPath, method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("read-only board", () => {
  let work: string;
  let flowDir: string;
  let server: BoardServer;

  beforeAll(async () => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-"));
    flowDir = path.join(work, "video");
    const init = flowgit(["init", flowDir]);
    expect(init.status, init.stderr).toBe(0);
    const set = flowgit(["-C", flowDir, "inputs", "set", "topic=为什么猫喜欢纸箱"]);
    expect(set.status, set.stderr).toBe(0);
    const run = flowgit(["-C", flowDir, "run", "all"], { FLOWGIT_LLM_MOCK_DIR: templateReplies });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(2);
    server = await startBoard({ dir: flowDir, port: 0, open: false });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  function authed(extra: Record<string, string> = {}) {
    return { "X-Flowgit-Token": server.token, ...extra };
  }

  it("GET /api/flow returns five stages with the states after a run up to assets", async () => {
    const res = await httpGet(server.port, "/api/flow", authed());
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      name: string;
      inputs: Record<string, unknown>;
      missingInputs: string[];
      stages: Array<{
        id: string;
        name: string;
        executor: string;
        state: string;
        runs: number;
        latest: { n: number; time: string; status: string } | null;
        outputs: Array<{ path: string; type: string }>;
      }>;
    };
    expect(body.name).toBe("短视频制作");
    expect(body.missingInputs).toEqual([]);
    expect(body.inputs.topic).toBe("为什么猫喜欢纸箱");
    expect(body.inputs.duration).toBe(30);
    expect(body.stages).toHaveLength(5);
    expect(body.stages.map((s) => s.id)).toEqual(["script", "storyboard", "assets", "edit", "export"]);
    expect(body.stages.map((s) => s.executor)).toEqual(["llm", "llm", "human", "script", "script"]);
    expect(body.stages.map((s) => s.state)).toEqual(["ok", "ok", "never-run", "waiting-upstream", "waiting-upstream"]);
    expect(body.stages.map((s) => s.runs)).toEqual([1, 1, 0, 0, 0]);
    expect(body.stages[0].latest).toMatchObject({ n: 1, status: "ok" });
    expect(body.stages[0].latest?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.stages[1].latest).toMatchObject({ n: 1, status: "ok" });
    expect(body.stages[2].latest).toBeNull();
    expect(body.stages[0].outputs.map((o) => o.path)).toEqual(["script.md"]);
    expect(body.stages[2].outputs.map((o) => o.path)).toEqual(["assets"]);
  });

  it("rejects /api/* without a token", async () => {
    const res = await httpGet(server.port, "/api/flow");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong Host", async () => {
    const res = await httpGet(server.port, "/api/flow", authed({ Host: "evil.example" }));
    expect(res.status).toBe(403);
  });

  it("rejects a path with ..", async () => {
    const res = await httpGet(server.port, `/api/file?path=${encodeURIComponent("../")}`, authed());
    expect(res.status).toBe(400);
    const abs = await httpGet(server.port, `/api/file?path=${encodeURIComponent("/etc/passwd")}`, authed());
    expect(abs.status).toBe(400);
    const drive = await httpGet(server.port, `/api/file?path=${encodeURIComponent("C:/Windows/win.ini")}`, authed());
    expect(drive.status).toBe(400);
  });

  it("rejects a path that is not a stage output or a run snapshot", async () => {
    const flowFile = await httpGet(server.port, "/api/file?path=flow.json", authed());
    expect(flowFile.status).toBe(404);
    const prompt = await httpGet(server.port, "/api/file?path=prompts/script.md", authed());
    expect(prompt.status).toBe(404);
    const runJson = await httpGet(server.port, "/api/file?path=runs/script/1/run.json", authed());
    expect(runJson.status).toBe(404);
  });

  it("serves a declared output and its snapshot, and lists a directory", async () => {
    const script = await httpGet(server.port, "/api/file?path=script.md", authed());
    expect(script.status).toBe(200);
    expect(script.body).toContain("纸箱");
    const snap = await httpGet(server.port, "/api/file?path=runs/script/1/outputs/script.md", authed());
    expect(snap.status).toBe(200);
    expect(snap.body).toContain("纸箱");
    fs.mkdirSync(path.join(flowDir, "assets"));
    fs.writeFileSync(path.join(flowDir, "assets", "cat.txt"), "meow");
    const dir = await httpGet(server.port, "/api/file?path=assets", authed());
    expect(dir.status).toBe(200);
    expect(dir.headers["x-flowgit-kind"]).toBe("directory");
    expect(JSON.parse(dir.body).files).toEqual(["cat.txt"]);
    const child = await httpGet(server.port, "/api/file?path=assets/cat.txt", authed());
    expect(child.status).toBe(200);
    expect(child.body).toBe("meow");
  });

  it("injects the token into the page and allows localhost", async () => {
    const page = await httpGet(server.port, "/");
    expect(page.status).toBe(200);
    expect(page.body).toContain(`name="flowgit-token" content="${server.token}"`);
    expect(page.body).not.toContain("__FLOWGIT_TOKEN__");
    const viaLocalhost = await httpGet(server.port, "/api/flow", authed({ Host: `localhost:${server.port}` }));
    expect(viaLocalhost.status).toBe(200);
  });

  it("reports missing required inputs without running", async () => {
    const bare = path.join(work, "bare");
    expect(flowgit(["init", bare]).status).toBe(0);
    const bareServer = await startBoard({ dir: bare, port: 0, open: false });
    try {
      const res = await httpGet(bareServer.port, "/api/flow", { "X-Flowgit-Token": bareServer.token });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body) as { missingInputs: string[]; stages: Array<{ state: string }> };
      expect(body.missingInputs).toContain("topic");
      expect(body.stages.map((s) => s.state)).toEqual([
        "never-run",
        "waiting-upstream",
        "waiting-upstream",
        "waiting-upstream",
        "waiting-upstream",
      ]);
    } finally {
      await bareServer.close();
    }
  });
});
