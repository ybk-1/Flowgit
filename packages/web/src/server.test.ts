import { spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFlow, resolveFlowInputs, statusAll } from "@flowgit/core";
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

function httpCall(
  port: number,
  method: string,
  reqPath: string,
  body?: string | Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: reqPath,
        method,
        headers: {
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function httpGet(port: number, reqPath: string, headers: Record<string, string> = {}) {
  return httpCall(port, "GET", reqPath, undefined, headers);
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
        instructions?: string;
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
    expect(body.stages[0].outputs[0]).toMatchObject({ path: "script.md", type: "text/markdown", directory: false, text: true });
    expect(body.stages[1].outputs[0]).toMatchObject({ path: "storyboard.json", directory: false, text: true });
    expect(body.stages[2].outputs[0]).toMatchObject({ path: "assets", directory: true, text: false });
    expect(body.stages[2].instructions).toContain("assets/");
    expect(body.stages[4].outputs[0]).toMatchObject({ path: "final.mp4", directory: false, text: false });
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

  it("rejects edits and uploads that omit the token", async () => {
    const put = await httpCall(server.port, "PUT", "/api/file?path=script.md", "x");
    expect(put.status).toBe(401);
    const wrong = await httpCall(server.port, "PUT", "/api/file?path=script.md", "x", { "X-Flowgit-Token": "nope" });
    expect(wrong.status).toBe(401);
    const upload = await httpCall(server.port, "POST", "/api/upload?stage=assets&name=a.txt", "hi");
    expect(upload.status).toBe(401);
  });

  it("returns 403 when writing a path that is not a declared output file", async () => {
    const flowFile = path.join(flowDir, "flow.json");
    const before = fs.readFileSync(flowFile);
    const flowJson = await httpCall(server.port, "PUT", "/api/file?path=flow.json", "nope", authed());
    expect(flowJson.status).toBe(403);
    expect(fs.readFileSync(flowFile)).toEqual(before);

    const snap = await httpCall(server.port, "PUT", "/api/file?path=runs/script/1/outputs/script.md", "nope", authed());
    expect(snap.status).toBe(403);
    const dir = await httpCall(server.port, "PUT", "/api/file?path=assets", "nope", authed());
    expect(dir.status).toBe(403);
    const inside = await httpCall(server.port, "PUT", "/api/file?path=assets/cat.txt", "nope", authed());
    expect(inside.status).toBe(403);
    const prompt = await httpCall(server.port, "PUT", "/api/file?path=prompts/script.md", "nope", authed());
    expect(prompt.status).toBe(403);
  });

  it("returns 400 for invalid JSON and does not save it", async () => {
    const file = path.join(flowDir, "storyboard.json");
    const before = fs.readFileSync(file);
    const res = await httpCall(server.port, "PUT", "/api/file?path=storyboard.json", "{not json", authed());
    expect(res.status).toBe(400);
    expect(res.body).toMatch(/JSON/);
    expect(fs.readFileSync(file)).toEqual(before);
    const loaded = loadFlow(flowDir);
    const storyboard = statusAll(loaded, resolveFlowInputs(loaded.dir, loaded.flow)).find((s) => s.stage.id === "storyboard");
    expect(storyboard?.state).toBe("ok");
    expect(fs.readdirSync(flowDir).filter((name) => name.includes("flowgit-tmp"))).toEqual([]);
  });

  it("saves valid JSON and refuses uploads that are not a human directory", async () => {
    const file = path.join(flowDir, "storyboard.json");
    const next = `${JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), note: "board" }, null, 2)}\n`;
    const saved = await httpCall(server.port, "PUT", "/api/file?path=storyboard.json", next, authed());
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe(next);
    const refused = await httpCall(server.port, "POST", "/api/upload?stage=script&name=x.txt", "no", authed());
    expect(refused.status).toBe(403);
    expect(fs.existsSync(path.join(flowDir, "x.txt"))).toBe(false);
  });

  it("uploads a file into assets/", async () => {
    const bytes = Buffer.from([0, 255, 10, 13, 0x68, 0x69]);
    const res = await httpCall(
      server.port,
      "POST",
      `/api/upload?stage=assets&name=${encodeURIComponent("clip.bin")}`,
      bytes,
      authed(),
    );
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(flowDir, "assets", "clip.bin"))).toEqual(bytes);
    const listed = await httpGet(server.port, "/api/file?path=assets", authed());
    expect(JSON.parse(listed.body).files).toContain("clip.bin");
  });

  it("returns 400 when the upload file name contains ../", async () => {
    const res = await httpCall(
      server.port,
      "POST",
      `/api/upload?stage=assets&name=${encodeURIComponent("../evil.txt")}`,
      "pwn",
      authed(),
    );
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(flowDir, "evil.txt"))).toBe(false);
    expect(fs.existsSync(path.join(work, "evil.txt"))).toBe(false);
    const nested = await httpCall(
      server.port,
      "POST",
      `/api/upload?stage=assets&name=${encodeURIComponent("nested/evil.txt")}`,
      "pwn",
      authed(),
    );
    expect(nested.status).toBe(400);
  });

  it("editing script.md makes statusAll report edited", async () => {
    const snapshot = fs.readFileSync(path.join(flowDir, "runs/script/1/outputs/script.md"));
    const next = "手工改过的脚本\n";
    const res = await httpCall(server.port, "PUT", "/api/file?path=script.md", next, authed());
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(flowDir, "script.md"), "utf8")).toBe(next);
    expect(fs.readFileSync(path.join(flowDir, "runs/script/1/outputs/script.md"))).toEqual(snapshot);
    const loaded = loadFlow(flowDir);
    const script = statusAll(loaded, resolveFlowInputs(loaded.dir, loaded.flow)).find((s) => s.stage.id === "script");
    expect(script?.state).toBe("edited");
    const board = JSON.parse((await httpGet(server.port, "/api/flow", authed())).body) as {
      stages: Array<{ id: string; state: string }>;
    };
    expect(board.stages.find((s) => s.id === "script")?.state).toBe("edited");
    const page = await httpGet(server.port, "/app.js");
    expect(page.status).toBe(200);
    expect(page.body).toContain("保存 Save");
    expect(page.body).toContain("已手动修改");
    expect(page.body).toContain("Before this stage next runs, the edit is saved as its own version and is not lost.");
  });

  it("rejects run, inputs, and the event stream without a token", async () => {
    const run = await httpCall(server.port, "POST", "/api/run", JSON.stringify({ stage: "all" }), {
      "Content-Type": "application/json",
    });
    expect(run.status).toBe(401);
    const inputs = await httpGet(server.port, "/api/inputs");
    expect(inputs.status).toBe(401);
    const put = await httpCall(server.port, "PUT", "/api/inputs", JSON.stringify({ language: "en" }), {
      "Content-Type": "application/json",
    });
    expect(put.status).toBe(401);
    const events = await httpGet(server.port, "/api/events");
    expect(events.status).toBe(401);
    const wrong = await httpGet(server.port, "/api/events?token=nope");
    expect(wrong.status).toBe(401);
  });

  it("GET /api/inputs lists enum choices and required fields", async () => {
    const res = await httpGet(server.port, "/api/inputs", authed());
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      inputs: Array<{ name: string; type: string; required: boolean; enum?: string[]; value: unknown; description?: string }>;
    };
    const topic = body.inputs.find((item) => item.name === "topic");
    const language = body.inputs.find((item) => item.name === "language");
    const duration = body.inputs.find((item) => item.name === "duration");
    expect(topic).toMatchObject({ type: "string", required: true, value: "为什么猫喜欢纸箱" });
    expect(language).toMatchObject({ required: false, value: "zh" });
    expect(language?.enum).toEqual(["zh", "en"]);
    expect(duration).toMatchObject({ type: "number", required: false, value: 30 });
    expect(topic?.description).toContain("主题");
  });

  it("PUT /api/inputs with language=fr returns 400 and does not save", async () => {
    const local = path.join(flowDir, "flowgit.local.json");
    const before = fs.readFileSync(local, "utf8");
    const res = await httpCall(server.port, "PUT", "/api/inputs", JSON.stringify({ language: "fr" }), authed({ "Content-Type": "application/json" }));
    expect(res.status).toBe(400);
    expect(res.body).toMatch(/zh/);
    expect(res.body).toMatch(/en/);
    expect(fs.readFileSync(local, "utf8")).toBe(before);
    const unknown = await httpCall(server.port, "PUT", "/api/inputs", JSON.stringify({ nope: "x" }), authed({ "Content-Type": "application/json" }));
    expect(unknown.status).toBe(400);
    expect(fs.readFileSync(local, "utf8")).toBe(before);
  });

  it("offers run controls, a model field, and the human upload", async () => {
    const page = await httpGet(server.port, "/");
    const app = await httpGet(server.port, "/app.js");
    expect(page.body).toContain("全部运行 Run all");
    expect(page.body).toContain("保存输入 Save inputs");
    expect(app.body).toContain("运行这一步 Run");
    expect(app.body).toContain("全部运行 Run all");
    expect(app.body).toContain('stage.state === "waiting-upstream"');
    expect(app.body).toContain("stage.instructions");
    expect(app.body).toContain("上传文件 / Upload a file");
    expect(app.body).toContain("provider/model");
    expect(app.body).toContain("必填 required");
    expect(app.body).toContain("/api/events?token=");
  });
});

interface SseEvent {
  event: string;
  data: string;
}

function openEvents(port: number, token: string): Promise<{
  events: SseEvent[];
  waitFor(type: string, timeoutMs?: number): Promise<SseEvent>;
  close(): void;
}> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/events?token=${encodeURIComponent(token)}`,
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        if ((res.statusCode ?? 0) !== 200) {
          res.resume();
          reject(new Error(`event stream status ${res.statusCode}`));
          return;
        }
        const events: SseEvent[] = [];
        const waiters: Array<{ type: string; after: number; resolve: (event: SseEvent) => void; timer: NodeJS.Timeout }> = [];
        let buf = "";
        const push = (event: SseEvent) => {
          events.push(event);
          const index = events.length - 1;
          for (const waiter of [...waiters]) {
            if (waiter.type !== event.event || index < waiter.after) continue;
            clearTimeout(waiter.timer);
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(event);
          }
        };
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk.replace(/\r/g, "");
          let split = buf.indexOf("\n\n");
          while (split >= 0) {
            const raw = buf.slice(0, split);
            buf = buf.slice(split + 2);
            split = buf.indexOf("\n\n");
            if (!raw || raw.startsWith(":")) continue;
            let event = "message";
            const data: string[] = [];
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            }
            if (data.length) push({ event, data: data.join("\n") });
          }
        });
        resolve({
          events,
          waitFor(type: string, timeoutMs = 20_000, after = 0) {
            const existing = events.find((event, index) => index >= after && event.event === type);
            if (existing) return Promise.resolve(existing);
            return new Promise((resWait, rejWait) => {
              const timer = setTimeout(
                () => rejWait(new Error(`timed out waiting for ${type}; saw ${events.map((event) => event.event).join(",") || "(nothing)"}`)),
                timeoutMs,
              );
              waiters.push({ type, after, resolve: resWait, timer });
            });
          },
          close() {
            req.destroy();
          },
        });
      },
    );
    req.on("error", reject);
  });
}

describe("run and inputs on the board", () => {
  const previousMock = process.env.FLOWGIT_LLM_MOCK_DIR;

  afterAll(() => {
    if (previousMock === undefined) delete process.env.FLOWGIT_LLM_MOCK_DIR;
    else process.env.FLOWGIT_LLM_MOCK_DIR = previousMock;
  });

  it("POST /api/run all streams stage:done and run:end, then stops at assets", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-run-"));
    const flowDir = path.join(work, "video");
    const init = flowgit(["init", flowDir]);
    expect(init.status, init.stderr).toBe(0);
    const board = await startBoard({ dir: flowDir, port: 0, open: false });
    process.env.FLOWGIT_LLM_MOCK_DIR = templateReplies;
    const authed = (extra: Record<string, string> = {}) => ({ "X-Flowgit-Token": board.token, ...extra });
    const jsonHeaders = authed({ "Content-Type": "application/json" });
    try {
      const missing = await httpCall(board.port, "PUT", "/api/inputs", JSON.stringify({ language: "en" }), jsonHeaders);
      expect(missing.status).toBe(400);
      const saved = await httpCall(
        board.port,
        "PUT",
        "/api/inputs",
        JSON.stringify({ topic: "为什么猫喜欢纸箱", language: "en" }),
        jsonHeaders,
      );
      expect(saved.status).toBe(200);
      const stored = JSON.parse(fs.readFileSync(path.join(flowDir, "flowgit.local.json"), "utf8")) as {
        inputs: Record<string, unknown>;
      };
      expect(stored.inputs).toMatchObject({ topic: "为什么猫喜欢纸箱", language: "en" });
      const listed = JSON.parse((await httpGet(board.port, "/api/inputs", authed())).body) as {
        inputs: Array<{ name: string; value: unknown; enum?: string[] }>;
      };
      expect(listed.inputs.find((item) => item.name === "language")).toMatchObject({ value: "en", enum: ["zh", "en"] });

      const live = await openEvents(board.port, board.token);
      const post = await httpCall(board.port, "POST", "/api/run", JSON.stringify({ stage: "all" }), jsonHeaders);
      expect(post.status, post.body).toBe(200);
      const end = await live.waitFor("run:end");
      const done = live.events.filter((event) => event.event === "stage:done").map((event) => JSON.parse(event.data).stage);
      expect(done).toEqual(["script", "storyboard"]);
      expect(live.events.at(-1)?.event).toBe("run:end");
      const ended = JSON.parse(end.data) as { ok: boolean; waiting?: { stage: string; missing: string[]; instructions?: string } };
      expect(ended.ok).toBe(true);
      expect(ended.waiting?.stage).toBe("assets");
      expect(ended.waiting?.missing).toContain("assets");
      expect(ended.waiting?.instructions).toContain("assets/");
      const flow = JSON.parse((await httpGet(board.port, "/api/flow", authed())).body) as {
        stages: Array<{ id: string; state: string; instructions?: string }>;
      };
      expect(flow.stages.map((stage) => stage.state)).toEqual(["ok", "ok", "never-run", "waiting-upstream", "waiting-upstream"]);
      expect(flow.stages.find((stage) => stage.id === "assets")?.instructions).toContain("assets/");

      const late = await openEvents(board.port, board.token);
      await late.waitFor("run:end");
      expect(late.events.filter((event) => event.event === "stage:done").map((event) => JSON.parse(event.data).stage)).toEqual([
        "script",
        "storyboard",
      ]);
      const cursor = live.events.length;
      const again = await httpCall(
        board.port,
        "POST",
        "/api/run",
        JSON.stringify({ stage: "script", model: "ollama/board-model" }),
        jsonHeaders,
      );
      expect(again.status, again.body).toBe(200);
      await live.waitFor("run:end", 20_000, cursor);
      const lines = live.events
        .slice(cursor)
        .filter((event) => event.event === "stage:log")
        .map((event) => JSON.parse(event.data).line as string);
      expect(lines.some((line) => line.includes("ollama/board-model"))).toBe(true);
      live.close();
      late.close();
    } finally {
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it("returns 409 when a second run starts while one is in progress", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-busy-"));
    fs.writeFileSync(
      path.join(work, "flow.json"),
      JSON.stringify(
        {
          format: "flowgit",
          version: "0.1",
          name: "slow",
          stages: [
            {
              id: "slow",
              name: "慢",
              executor: { type: "script", run: "node slow.cjs" },
              outputs: [{ type: "text/plain", path: "out.txt" }],
            },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(work, "slow.cjs"),
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync("started", "1");',
        "const deadline = Date.now() + 15000;",
        'while (!fs.existsSync("go")) {',
        "  if (Date.now() > deadline) process.exit(2);",
        "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);",
        "}",
        'fs.writeFileSync("out.txt", "ok\\n");',
        "",
      ].join("\n"),
    );
    const board = await startBoard({ dir: work, port: 0, open: false });
    const headers = { "X-Flowgit-Token": board.token, "Content-Type": "application/json" };
    const body = JSON.stringify({ stage: "slow" });
    const first = httpCall(board.port, "POST", "/api/run", body, headers);
    try {
      const started = path.join(work, "started");
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(started)) {
        if (Date.now() > deadline) throw new Error("slow stage did not start");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const second = await httpCall(board.port, "POST", "/api/run", body, headers);
      expect(second.status).toBe(409);
      expect(second.body).toMatch(/已有运行在进行/);
      fs.writeFileSync(path.join(work, "go"), "1");
      const done = await first;
      expect(done.status, done.body).toBe(200);
      expect(fs.readFileSync(path.join(work, "out.txt"), "utf8")).toBe("ok\n");
      const third = await httpCall(board.port, "POST", "/api/run", body, headers);
      expect(third.status, third.body).toBe(200);
    } finally {
      fs.writeFileSync(path.join(work, "go"), "1");
      await first.catch(() => undefined);
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});
