import { spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFlow, parseFlowMd, promptSkeleton, renderFlowMd, resolveFlowInputs, statusAll, type Flow } from "@flowgit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBoard, type BoardServer } from "./server.js";

delete process.env.FLOWGIT_TTS_API_KEY;

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "..", "cli", "dist", "index.js");
const templateReplies = path.join(here, "..", "..", "cli", "templates", "short-video", "demo-replies");

function flowgit(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FLOWGIT_TTS_API_KEY: "", ...env },
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

  it("GET /api/flow returns six stages with the states after a run up to assets", async () => {
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
    expect(body.stages).toHaveLength(6);
    expect(body.stages.map((s) => s.id)).toEqual(["script", "voice", "storyboard", "assets", "edit", "export"]);
    expect(body.stages.map((s) => s.executor)).toEqual(["llm", "script", "llm", "human", "script", "script"]);
    expect(body.stages.map((s) => s.state)).toEqual(["ok", "ok", "ok", "never-run", "waiting-upstream", "waiting-upstream"]);
    expect(body.stages.map((s) => s.runs)).toEqual([1, 1, 1, 0, 0, 0]);
    const byId = Object.fromEntries(body.stages.map((s) => [s.id, s]));
    expect(byId.script.latest).toMatchObject({ n: 1, status: "ok" });
    expect(byId.script.latest?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(byId.storyboard.latest).toMatchObject({ n: 1, status: "ok" });
    expect(byId.assets.latest).toBeNull();
    expect(byId.script.outputs.map((o) => o.path)).toEqual(["script.md"]);
    expect(byId.assets.outputs.map((o) => o.path)).toEqual(["assets"]);
    expect(byId.script.outputs[0]).toMatchObject({ path: "script.md", type: "text/markdown", directory: false, text: true });
    expect(byId.storyboard.outputs[0]).toMatchObject({ path: "storyboard.json", directory: false, text: true });
    expect(byId.assets.outputs[0]).toMatchObject({ path: "assets", directory: true, text: false });
    expect(byId.assets.instructions).toContain("assets/");
    expect(byId.voice.outputs[0]).toMatchObject({ path: "voice", directory: true, text: false });
    expect(byId.export.outputs[0]).toMatchObject({ path: "final.mp4", directory: false, text: false });
  });

  it("rejects /api/* without a token", async () => {
    const res = await httpGet(server.port, "/api/flow");
    expect(res.status).toBe(401);
  });

  it("GET /api/graph requires a token, and nodes and edges match flow.json", async () => {
    const denied = await httpGet(server.port, "/api/graph");
    expect(denied.status).toBe(401);
    const wrong = await httpGet(server.port, "/api/graph", { "X-Flowgit-Token": "not-the-token" });
    expect(wrong.status).toBe(401);

    const res = await httpGet(server.port, "/api/graph", authed());
    expect(res.status).toBe(200);
    const graph = JSON.parse(res.body) as {
      nodes: Array<{ id: string; name: string; type: string; state: string; layer: number; row: number }>;
      edges: Array<{ from: string; to: string }>;
    };
    const file = JSON.parse(fs.readFileSync(path.join(flowDir, "flow.json"), "utf8")) as {
      stages: Array<{ id: string; name: string; inputs?: string[]; executor: { type: string } }>;
    };
    const flowRes = await httpGet(server.port, "/api/flow", authed());
    const flowBody = JSON.parse(flowRes.body) as { stages: Array<{ id: string; state: string }> };

    expect(graph.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type }))).toEqual(
      file.stages.map((stage) => ({ id: stage.id, name: stage.name, type: stage.executor.type })),
    );
    expect(graph.edges).toEqual(file.stages.flatMap((stage) => (stage.inputs ?? []).map((from) => ({ from, to: stage.id }))));
    expect(graph.nodes.map((node) => node.state)).toEqual(flowBody.stages.map((stage) => stage.state));
    expect(Object.fromEntries(graph.nodes.map((node) => [node.id, node.layer]))).toEqual({
      script: 0,
      voice: 1,
      storyboard: 1,
      assets: 2,
      edit: 3,
      export: 4,
    });
    const rows = new Map<number, Set<number>>();
    for (const node of graph.nodes) {
      const used = rows.get(node.layer) ?? new Set<number>();
      expect(used.has(node.row)).toBe(false);
      used.add(node.row);
      rows.set(node.layer, used);
    }
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

  it("puts the token in the page only for the link with ?token=, and allows localhost", async () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/?token=${server.token}`);
    const page = await httpGet(server.port, `/?token=${server.token}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain(`name="flowgit-token" content="${server.token}"`);
    expect(page.body).not.toContain("__FLOWGIT_TOKEN__");
    // Another account or program that can reach 127.0.0.1 gets a page without the token.
    for (const bare of ["/", "/index.html", "/?token=wrong", `/?token=${server.token.slice(1)}`]) {
      const locked = await httpGet(server.port, bare);
      expect(locked.status, bare).toBe(401);
      expect(locked.body).not.toContain(server.token);
      expect(locked.body).toContain("?token=");
    }
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
    const add = await httpCall(server.port, "POST", "/api/stage", JSON.stringify({ id: "extra", type: "human" }), {
      "Content-Type": "application/json",
    });
    expect(add.status).toBe(401);
    const del = await httpCall(server.port, "DELETE", "/api/stage?id=script");
    expect(del.status).toBe(401);
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
    // Names an object already has (constructor, __proto__) are not inputs either.
    for (const body of ['{"constructor":"x"}', '{"__proto__":{"topic":"x"}}', '{"toString":"x"}']) {
      const res = await httpCall(server.port, "PUT", "/api/inputs", body, authed({ "Content-Type": "application/json" }));
      expect(res.status, body).toBe(400);
      expect(res.body).toContain("unknown input");
    }
    expect(fs.readFileSync(local, "utf8")).toBe(before);
  });

  it("offers run controls, a model field, and the human upload", async () => {
    const page = await httpGet(server.port, `/?token=${server.token}`);
    const app = await httpGet(server.port, "/app.js");
    expect(page.body).toContain("全部运行 Run all");
    expect(page.body).toContain("保存输入 Save inputs");
    expect(page.body).toContain("新增阶段 / Add stage");
    expect(page.body).toContain("删除阶段 / Remove stage");
    expect(page.body).toContain("一起断开依赖 / detach downstream");
    expect(app.body).toContain("删除阶段 / Remove stage");
    expect(app.body).toContain('"/api/stage"');
    expect(app.body).toContain("运行这一步 Run");
    expect(app.body).toContain("全部运行 Run all");
    expect(app.body).toContain('stage.state === "waiting-upstream"');
    expect(app.body).toContain("stage.instructions");
    expect(app.body).toContain("上传文件 / Upload a file");
    expect(app.body).toContain("provider/model");
    expect(app.body).toContain("必填 required");
    expect(app.body).toContain("/api/events?token=");
    expect(app.body).toContain('type === "flow:changed"');
    expect(app.body).toContain("实时更新已断开，改为每 3 秒刷新 / live updates lost, refreshing every 3 seconds");
    expect(app.body).toContain("setInterval(refresh, 3000)");
    expect(page.body).toContain("实时更新 / live updates");
    expect(page.body).toContain("卡片 / Cards");
    expect(page.body).toContain("流程图 / Graph");
    expect(page.body).toContain("预演 / Preview");
    expect(page.body).toContain("模型用量合计 / total model usage");
    expect(app.body).toContain('"/api/graph"');
    expect(app.body).toContain('"/api/plan"');
    expect(app.body).toContain('"/api/usage"');
    expect(app.body).toContain("最多调用 ");
    expect(app.body).toContain("at most ");
    expect(app.body).toContain("这次最多调用 ");
    expect(app.body).toContain("This run makes at most ");
    expect(app.body).toContain("model calls. Continue?");
    expect(app.body).toContain("跳过 / skipped");
    expect(app.body).toContain("等你 / wait for you");
    expect(app.body).toContain("不能运行 / cannot run");
    expect(app.body).toContain("window.confirm");
    expect(app.body).toContain("localStorage.getItem");
    expect(app.body).toContain("localStorage.setItem");
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
      expect(done).toEqual(["script", "voice", "storyboard"]);
      expect(live.events.filter((event) => event.event !== "flow:changed").at(-1)?.event).toBe("run:end");
      const ended = JSON.parse(end.data) as { ok: boolean; waiting?: { stage: string; missing: string[]; instructions?: string } };
      expect(ended.ok).toBe(true);
      expect(ended.waiting?.stage).toBe("assets");
      expect(ended.waiting?.missing).toContain("assets");
      expect(ended.waiting?.instructions).toContain("assets/");
      const flow = JSON.parse((await httpGet(board.port, "/api/flow", authed())).body) as {
        stages: Array<{ id: string; state: string; instructions?: string }>;
      };
      expect(flow.stages.map((stage) => stage.state)).toEqual(["ok", "ok", "ok", "never-run", "waiting-upstream", "waiting-upstream"]);
      expect(flow.stages.find((stage) => stage.id === "assets")?.instructions).toContain("assets/");

      const late = await openEvents(board.port, board.token);
      await late.waitFor("run:end");
      expect(late.events.filter((event) => event.event === "stage:done").map((event) => JSON.parse(event.data).stage)).toEqual([
        "script",
        "voice",
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
      const edit = await httpCall(board.port, "PUT", "/api/file?path=out.txt", "hand edit\n", {
        "X-Flowgit-Token": board.token,
        "Content-Type": "text/plain",
      });
      expect(edit.status).toBe(409);
      expect(edit.body).toMatch(/正在运行/);
      const flowFile = path.join(work, "flow.json");
      const beforeFlow = fs.readFileSync(flowFile);
      const addDuring = await httpCall(
        board.port,
        "POST",
        "/api/stage",
        JSON.stringify({ id: "extra", type: "human" }),
        headers,
      );
      expect(addDuring.status).toBe(409);
      expect(addDuring.body).toMatch(/正在运行/);
      const deleteDuring = await httpCall(board.port, "DELETE", "/api/stage?id=slow", undefined, {
        "X-Flowgit-Token": board.token,
      });
      expect(deleteDuring.status).toBe(409);
      expect(deleteDuring.body).toMatch(/正在运行/);
      expect(fs.readFileSync(flowFile)).toEqual(beforeFlow);
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

describe("history, diff, and restore on the board", () => {
  it("diffs v1 against v2, restores v1, and rejects a missing token", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-history-"));
    fs.writeFileSync(
      path.join(work, "flow.json"),
      JSON.stringify(
        {
          format: "flowgit",
          version: "0.1",
          name: "history",
          stages: [
            {
              id: "write",
              name: "写",
              executor: { type: "script", run: "node write.cjs" },
              outputs: [{ type: "text/plain", path: "note.txt" }],
            },
            {
              id: "copy",
              name: "抄",
              inputs: ["write"],
              executor: { type: "script", run: "node copy.cjs" },
              outputs: [{ type: "text/plain", path: "copy.txt" }],
            },
          ],
        },
        null,
        2,
      ),
    );
    // run.json is written after the script, so the second run sees v1 and writes different text.
    fs.writeFileSync(
      path.join(work, "write.cjs"),
      [
        'const fs = require("node:fs");',
        'const text = fs.existsSync("runs/write/1/run.json") ? "two\\n" : "one\\n";',
        'fs.writeFileSync("note.txt", text);',
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(work, "copy.cjs"),
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync("copy.txt", fs.readFileSync("note.txt"));',
        "",
      ].join("\n"),
    );
    const board = await startBoard({ dir: work, port: 0, open: false });
    const authed = (extra: Record<string, string> = {}) => ({ "X-Flowgit-Token": board.token, ...extra });
    const jsonHeaders = authed({ "Content-Type": "application/json" });
    const run = (stage: string) => httpCall(board.port, "POST", "/api/run", JSON.stringify({ stage }), jsonHeaders);
    try {
      const noDiff = await httpGet(board.port, "/api/diff?stage=write&a=1&b=2");
      expect(noDiff.status).toBe(401);
      const noRuns = await httpGet(board.port, "/api/runs?stage=write");
      expect(noRuns.status).toBe(401);
      const noRestore = await httpCall(board.port, "POST", "/api/restore", JSON.stringify({ stage: "write", n: 1 }), {
        "Content-Type": "application/json",
      });
      expect(noRestore.status).toBe(401);
      const badHost = await httpGet(board.port, "/api/diff?stage=write&a=1&b=2", authed({ Host: "evil.example" }));
      expect(badHost.status).toBe(403);

      expect((await run("write")).status).toBe(200);
      expect((await run("write")).status).toBe(200);
      expect((await run("copy")).status).toBe(200);
      expect(fs.readFileSync(path.join(work, "note.txt"), "utf8")).toBe("two\n");
      expect(fs.readFileSync(path.join(work, "copy.txt"), "utf8")).toBe("two\n");

      const listed = JSON.parse((await httpGet(board.port, "/api/runs?stage=write", authed())).body) as {
        runs: Array<{ n: number; status: string; executor: string }>;
      };
      expect(listed.runs.map((item) => item.n)).toEqual([1, 2]);
      expect(listed.runs.every((item) => item.status === "ok" && item.executor === "script")).toBe(true);

      const diff = await httpGet(board.port, "/api/diff?stage=write&a=1&b=2", authed());
      expect(diff.status).toBe(200);
      const body = JSON.parse(diff.body) as {
        stage: string;
        a: number;
        b: number | null;
        outputs: Array<{ path: string; kind: string; same: boolean; diff?: string }>;
      };
      expect(body).toMatchObject({ stage: "write", a: 1, b: 2 });
      const note = body.outputs.find((output) => output.path === "note.txt");
      expect(note).toMatchObject({ kind: "text", same: false });
      expect(note?.diff).toMatch(/^-one$/m);
      expect(note?.diff).toMatch(/^\+two$/m);

      const againstCurrent = JSON.parse((await httpGet(board.port, "/api/diff?stage=write&a=1", authed())).body) as {
        b: number | null;
        outputs: Array<{ diff?: string }>;
      };
      expect(againstCurrent.b).toBeNull();
      expect(againstCurrent.outputs[0]?.diff).toMatch(/^\+two$/m);

      const snap = fs.readFileSync(path.join(work, "runs", "write", "1", "outputs", "note.txt"), "utf8");
      expect(snap).toBe("one\n");
      const restored = await httpCall(board.port, "POST", "/api/restore", JSON.stringify({ stage: "write", n: 1 }), jsonHeaders);
      expect(restored.status, restored.body).toBe(200);
      expect(fs.readFileSync(path.join(work, "note.txt"), "utf8")).toBe(snap);
      const flow = JSON.parse((await httpGet(board.port, "/api/flow", authed())).body) as {
        stages: Array<{ id: string; state: string }>;
      };
      expect(flow.stages.find((stage) => stage.id === "copy")?.state).toBe("stale");

      const appJs = await httpGet(board.port, "/app.js");
      expect(appJs.status).toBe(200);
      expect(appJs.body).toContain("历史 History");
      expect(appJs.body).toContain("对比 Compare");
      expect(appJs.body).toContain("回退到这个版本 Restore");
      expect(appJs.body).toContain("手动修改 manual edit");
      expect(appJs.body).toContain("/api/diff");
      expect(appJs.body).toContain("/api/restore");
      const css = await httpGet(board.port, "/style.css");
      expect(css.body).toContain(".diff-add");
      expect(css.body).toContain(".diff-del");
    } finally {
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handlesNamed(name: string): number {
  const get = (process as unknown as { _getActiveHandles?: () => Array<{ constructor?: { name?: string } }> })._getActiveHandles;
  if (!get) return 0;
  return get().filter((handle) => handle?.constructor?.name === name).length;
}

describe("live board updates", () => {
  it("pushes flow:changed when an output changes, and nothing for node_modules", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-live-"));
    fs.writeFileSync(
      path.join(work, "flow.json"),
      JSON.stringify(
        {
          format: "flowgit",
          version: "0.1",
          name: "live",
          stages: [
            {
              id: "write",
              name: "写",
              executor: { type: "human" },
              outputs: [{ type: "text/plain", path: "note.txt" }],
            },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(work, "note.txt"), "one\n");
    const watchersBefore = handlesNamed("FSWatcher");
    const board = await startBoard({ dir: work, port: 0, open: false });
    let watchersDuring = 0;
    let live: Awaited<ReturnType<typeof openEvents>> | undefined;
    try {
      watchersDuring = handlesNamed("FSWatcher");
      expect(watchersDuring).toBeGreaterThan(watchersBefore);
      live = await openEvents(board.port, board.token);
      // A watch can emit once as it starts. Wait that out, then change the output.
      await delay(400);
      const cursor = live.events.length;
      fs.writeFileSync(path.join(work, "note.txt"), "two\n");
      const changed = await live.waitFor("flow:changed", 2000, cursor);
      expect(JSON.parse(changed.data)).toEqual({});
      // Absorb a second debounce from the same write before the ignore check.
      await delay(700);
      const seen = live.events.length;
      fs.mkdirSync(path.join(work, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(work, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
      fs.mkdirSync(path.join(work, "runs", "write"), { recursive: true });
      fs.writeFileSync(path.join(work, "runs", "write", "note.json"), "{}\n");
      fs.mkdirSync(path.join(work, ".git"), { recursive: true });
      fs.writeFileSync(path.join(work, ".git", "config"), "[core]\n");
      fs.writeFileSync(path.join(work, ".flowgit-tmp-abc"), "tmp");
      await delay(500);
      expect(live.events.slice(seen).filter((event) => event.event === "flow:changed")).toEqual([]);
    } finally {
      live?.close();
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
    await delay(50);
    expect(handlesNamed("FSWatcher")).toBeLessThan(watchersDuring);
  }, 20_000);
});

describe("add and remove stages on the board", () => {
  function writeFlow(dir: string, flow: unknown): string {
    const text = `${JSON.stringify(flow, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, "flow.json"), text);
    return text;
  }

  function human(id: string, name: string, inputs?: string[]) {
    return {
      id,
      name,
      ...(inputs ? { inputs } : {}),
      executor: { type: "human", instructions: `写 ${id}.md / write ${id}.md` },
      outputs: [{ type: "text/markdown", path: `${id}.md` }],
    };
  }

  it("adds an llm stage to flow.json, creates the prompt, and rejects a duplicate id", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-add-"));
    const flowFile = path.join(work, "flow.json");
    writeFlow(work, {
      format: "flowgit",
      version: "0.1",
      name: "stages",
      description: "keep me",
      inputs: { topic: { type: "string", required: true } },
      stages: [human("notes", "笔记")],
    });
    const board = await startBoard({ dir: work, port: 0, open: false });
    const headers = { "X-Flowgit-Token": board.token, "Content-Type": "application/json" };
    const live = await openEvents(board.port, board.token);
    try {
      const before = fs.readFileSync(flowFile);
      const denied = await httpCall(board.port, "POST", "/api/stage", JSON.stringify({ id: "polish", type: "llm" }), {
        "Content-Type": "application/json",
      });
      expect(denied.status).toBe(401);
      expect(fs.readFileSync(flowFile)).toEqual(before);

      const cursor = live.events.length;
      const added = await httpCall(
        board.port,
        "POST",
        "/api/stage",
        JSON.stringify({ id: "polish", type: "llm", name: "润色", after: "notes" }),
        headers,
      );
      expect(added.status, added.body).toBe(200);
      expect(JSON.parse(added.body)).toMatchObject({ ok: true, id: "polish", prompt: "prompts/polish.md" });
      await live.waitFor("flow:changed", 2000, cursor);

      const prompt = path.join(work, "prompts", "polish.md");
      expect(fs.readFileSync(prompt, "utf8")).toBe(promptSkeleton("polish", "topic"));
      const text = fs.readFileSync(flowFile, "utf8");
      expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
      const saved = JSON.parse(text) as {
        description?: string;
        stages: Array<{ id: string; name?: string; inputs?: string[]; executor?: { type?: string; prompt?: string }; outputs?: Array<{ path: string }> }>;
      };
      expect(saved.description).toBe("keep me");
      expect(saved.stages.map((stage) => stage.id)).toEqual(["notes", "polish"]);
      expect(saved.stages[1]).toMatchObject({
        name: "润色",
        inputs: ["notes"],
        executor: { type: "llm", prompt: "prompts/polish.md" },
        outputs: [{ type: "text/markdown", path: "polish.md" }],
      });
      expect(Object.keys(saved.stages[0] ?? {})).toEqual(["id", "name", "executor", "outputs"]);

      const duplicate = await httpCall(board.port, "POST", "/api/stage", JSON.stringify({ id: "notes", type: "human" }), headers);
      expect(duplicate.status).toBe(400);
      expect(duplicate.body).toContain("已经有阶段");
      expect(duplicate.body).toContain("already exists");
      expect(fs.readFileSync(flowFile, "utf8")).toBe(text);
      expect(fs.existsSync(path.join(work, "prompts", "notes.md"))).toBe(false);

      fs.writeFileSync(prompt, "KEEP\n");
      const removed = await httpCall(board.port, "DELETE", "/api/stage?id=polish", undefined, {
        "X-Flowgit-Token": board.token,
      });
      expect(removed.status, removed.body).toBe(200);
      const again = await httpCall(
        board.port,
        "POST",
        "/api/stage",
        JSON.stringify({ id: "polish", type: "llm", name: "润色", after: "notes" }),
        headers,
      );
      expect(again.status, again.body).toBe(200);
      expect(JSON.parse(again.body).prompt).toBeUndefined();
      expect(fs.readFileSync(prompt, "utf8")).toBe("KEEP\n");

      const agent = await httpCall(
        board.port,
        "POST",
        "/api/stage",
        JSON.stringify({ id: "page", type: "agent", after: "polish" }),
        headers,
      );
      expect(agent.status, agent.body).toBe(200);
      expect(fs.readFileSync(path.join(work, "prompts", "page.md"), "utf8")).toBe(promptSkeleton("page", "topic"));
      const withAgent = JSON.parse(fs.readFileSync(flowFile, "utf8")) as { stages: Array<{ id: string }> };
      expect(withAgent.stages.map((stage) => stage.id)).toEqual(["notes", "polish", "page"]);
    } finally {
      live.close();
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("keeps a flow.md flow as flow.md when a stage is added or removed", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-add-md-"));
    const mdFile = path.join(work, "flow.md");
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "markdown",
      description: "写成 Markdown 的流程 / a flow written as Markdown",
      stages: [human("notes", "笔记") as Flow["stages"][number]],
    };
    fs.writeFileSync(mdFile, renderFlowMd(flow));
    const board = await startBoard({ dir: work, port: 0, open: false });
    const headers = { "X-Flowgit-Token": board.token, "Content-Type": "application/json" };
    try {
      const added = await httpCall(board.port, "POST", "/api/stage", JSON.stringify({ id: "draft", type: "human", after: "notes" }), headers);
      expect(added.status, added.body).toBe(200);
      expect(fs.existsSync(path.join(work, "flow.json"))).toBe(false);
      const text = fs.readFileSync(mdFile, "utf8");
      const saved = parseFlowMd(text) as unknown as Flow;
      expect(text).toBe(renderFlowMd(saved));
      expect(saved.description).toBe(flow.description);
      expect(saved.stages.map((stage) => stage.id)).toEqual(["notes", "draft"]);
      expect(loadFlow(work).file).toBe(mdFile);

      const removed = await httpCall(board.port, "DELETE", "/api/stage?id=draft", undefined, { "X-Flowgit-Token": board.token });
      expect(removed.status, removed.body).toBe(200);
      expect(fs.existsSync(path.join(work, "flow.json"))).toBe(false);
      expect((parseFlowMd(fs.readFileSync(mdFile, "utf8")) as unknown as Flow).stages.map((stage) => stage.id)).toEqual(["notes"]);
    } finally {
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("returns 400 with a bilingual list and writes nothing", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-add-bad-"));
    const flowFile = path.join(work, "flow.json");
    const before = writeFlow(work, {
      format: "flowgit",
      version: "0.1",
      name: "stages",
      inputs: { topic: { type: "string", required: true } },
      stages: [human("notes", "笔记")],
    });
    const board = await startBoard({ dir: work, port: 0, open: false });
    const headers = { "X-Flowgit-Token": board.token, "Content-Type": "application/json" };
    try {
      const res = await httpCall(
        board.port,
        "POST",
        "/api/stage",
        JSON.stringify({ id: "extra", type: "human", inputs: ["missing"] }),
        headers,
      );
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body) as { error: string; issues: Array<{ path: string; message: string }> };
      expect(body.issues.length).toBeGreaterThan(0);
      expect(body.error).toContain("没有这个阶段");
      expect(body.error).toContain("unknown stage");
      expect(body.issues.some((issue) => issue.message.includes("没有这个阶段") && issue.message.includes("unknown stage"))).toBe(true);
      expect(fs.readFileSync(flowFile, "utf8")).toBe(before);
      expect(fs.existsSync(path.join(work, "prompts"))).toBe(false);
    } finally {
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("refuses to remove a stage with dependents unless force=1, and leaves files in place", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-rm-"));
    const flowFile = path.join(work, "flow.json");
    const before = writeFlow(work, {
      format: "flowgit",
      version: "0.1",
      name: "remove",
      stages: [
        human("notes", "笔记"),
        human("draft", "草稿", ["notes"]),
        {
          id: "check",
          name: "检查",
          inputs: ["notes", "draft"],
          executor: { type: "script", run: "node check.cjs" },
          outputs: [{ type: "text/plain", path: "check.txt" }],
        },
      ],
    });
    fs.writeFileSync(path.join(work, "draft.md"), "keep draft\n");
    const runFile = path.join(work, "runs", "draft", "1", "run.json");
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    fs.writeFileSync(runFile, "{}\n");
    const board = await startBoard({ dir: work, port: 0, open: false });
    const token = { "X-Flowgit-Token": board.token };
    try {
      const denied = await httpCall(board.port, "DELETE", "/api/stage?id=draft");
      expect(denied.status).toBe(401);
      expect(fs.readFileSync(flowFile, "utf8")).toBe(before);

      const blocked = await httpCall(board.port, "DELETE", "/api/stage?id=draft", undefined, token);
      expect(blocked.status).toBe(409);
      const body = JSON.parse(blocked.body) as { error: string; dependents: string[] };
      expect(body.dependents).toEqual(["check"]);
      expect(body.error).toContain("check");
      expect(body.error).toContain("draft");
      expect(fs.readFileSync(flowFile, "utf8")).toBe(before);
      expect(fs.readFileSync(path.join(work, "draft.md"), "utf8")).toBe("keep draft\n");
      expect(fs.readFileSync(runFile, "utf8")).toBe("{}\n");

      const removed = await httpCall(board.port, "DELETE", "/api/stage?id=draft&force=1", undefined, token);
      expect(removed.status, removed.body).toBe(200);
      const text = fs.readFileSync(flowFile, "utf8");
      expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
      const saved = JSON.parse(text) as { stages: Array<{ id: string; inputs?: string[] }> };
      expect(saved.stages.map((stage) => stage.id)).toEqual(["notes", "check"]);
      expect(saved.stages.find((stage) => stage.id === "check")?.inputs).toEqual(["notes"]);
      expect(saved.stages.find((stage) => stage.id === "draft")).toBeUndefined();
      expect(fs.readFileSync(path.join(work, "draft.md"), "utf8")).toBe("keep draft\n");
      expect(fs.readFileSync(runFile, "utf8")).toBe("{}\n");
    } finally {
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("plan and usage on the board", () => {
  function writeRun(dir: string, stage: string, n: number, record: Record<string, unknown>): void {
    const file = path.join(dir, "runs", stage, String(n), "run.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record));
  }

  it("GET /api/plan waits on a human stage with no outputs and marks later stages not-reached", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-plan-"));
    const flow = {
      format: "flowgit",
      version: "0.1",
      name: "preview",
      stages: [
        {
          id: "notes",
          name: "笔记",
          executor: { type: "human" },
          outputs: [{ type: "text/plain", path: "notes.md" }],
        },
        {
          id: "draft",
          name: "草稿",
          inputs: ["notes"],
          executor: { type: "script", run: "true" },
          outputs: [{ type: "text/plain", path: "draft.txt" }],
        },
        {
          id: "check",
          name: "检查",
          inputs: ["draft"],
          executor: { type: "script", run: "true" },
          outputs: [{ type: "text/plain", path: "check.txt" }],
        },
      ],
    };
    fs.writeFileSync(path.join(work, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
    writeRun(work, "notes", 1, {
      stage: "notes",
      n: 1,
      finishedAt: "2026-11-01T10:00:00.000Z",
      params: { usage: { input_tokens: 10, output_tokens: 4 } },
    });
    writeRun(work, "notes", 2, { stage: "notes", n: 2, finishedAt: "2026-11-03T10:00:00.000Z" });
    writeRun(work, "draft", 1, {
      stage: "draft",
      n: 1,
      finishedAt: "2026-11-02T10:00:00.000Z",
      params: { usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
    });
    const board = await startBoard({ dir: work, port: 0, open: false });
    const authed = { "X-Flowgit-Token": board.token };
    try {
      expect((await httpGet(board.port, "/api/plan")).status).toBe(401);
      expect((await httpGet(board.port, "/api/usage")).status).toBe(401);
      expect((await httpGet(board.port, "/api/plan", { "X-Flowgit-Token": "nope" })).status).toBe(401);
      expect((await httpGet(board.port, "/api/usage", { "X-Flowgit-Token": "nope" })).status).toBe(401);

      const plan = await httpGet(board.port, "/api/plan", authed);
      expect(plan.status, plan.body).toBe(200);
      const body = JSON.parse(plan.body) as {
        steps: Array<{ id: string; name: string; action: string; detail: string | null; callsModel: boolean }>;
        modelCalls: number;
      };
      expect(body.steps.map((step) => step.action)).toEqual(["wait", "not-reached", "not-reached"]);
      expect(body.steps[0]).toMatchObject({ id: "notes", name: "笔记", action: "wait", callsModel: false });
      expect(body.steps[0]?.detail).toContain("notes.md");
      expect(body.steps[1]).toMatchObject({ id: "draft", action: "not-reached", detail: null, callsModel: false });
      expect(body.steps[2]).toMatchObject({ id: "check", action: "not-reached", detail: null, callsModel: false });
      expect(body.modelCalls).toBe(0);
      expect(fs.existsSync(path.join(work, "notes.md"))).toBe(false);

      const usage = await httpGet(board.port, "/api/usage", authed);
      expect(usage.status, usage.body).toBe(200);
      const used = JSON.parse(usage.body) as {
        stages: Array<{ id: string; name: string; input: number; output: number; calls: number }>;
        total: { input: number; output: number; calls: number };
      };
      expect(used.stages).toEqual([
        { id: "notes", name: "笔记", input: 10, output: 4, calls: 1 },
        { id: "draft", name: "草稿", input: 7, output: 3, calls: 1 },
        { id: "check", name: "检查", input: 0, output: 0, calls: 0 },
      ]);
      expect(used.total).toEqual({ input: 17, output: 7, calls: 2 });
    } finally {
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("does not count FLOWGIT_LLM_MOCK_DIR replies as model calls", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-web-plan-mock-"));
    fs.writeFileSync(path.join(work, "prompt.md"), "hi\n");
    fs.writeFileSync(
      path.join(work, "flow.json"),
      `${JSON.stringify(
        {
          format: "flowgit",
          version: "0.1",
          name: "mock",
          stages: [
            {
              id: "draft",
              name: "草稿",
              executor: { type: "llm", prompt: "prompt.md" },
              outputs: [{ type: "text/markdown", path: "draft.md" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const board = await startBoard({ dir: work, port: 0, open: false });
    const authed = { "X-Flowgit-Token": board.token };
    const previous = process.env.FLOWGIT_LLM_MOCK_DIR;
    try {
      delete process.env.FLOWGIT_LLM_MOCK_DIR;
      const live = await httpGet(board.port, "/api/plan?model=glm/glm-5.3", authed);
      expect(live.status, live.body).toBe(200);
      const liveBody = JSON.parse(live.body) as { steps: Array<{ action: string; detail: string | null; callsModel: boolean }>; modelCalls: number };
      expect(liveBody.modelCalls).toBe(1);
      expect(liveBody.steps[0]).toMatchObject({ action: "run", callsModel: true });
      expect(liveBody.steps[0]?.detail).toContain("glm/glm-5.3");

      process.env.FLOWGIT_LLM_MOCK_DIR = templateReplies;
      const canned = await httpGet(board.port, "/api/plan?model=glm/glm-5.3", authed);
      expect(canned.status, canned.body).toBe(200);
      const cannedBody = JSON.parse(canned.body) as { steps: Array<{ action: string; detail: string | null; callsModel: boolean }>; modelCalls: number };
      expect(cannedBody.modelCalls).toBe(0);
      expect(cannedBody.steps[0]).toMatchObject({ action: "run", callsModel: false });
      expect(cannedBody.steps[0]?.detail).toContain("canned");
      expect(fs.existsSync(path.join(work, "draft.md"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.FLOWGIT_LLM_MOCK_DIR;
      else process.env.FLOWGIT_LLM_MOCK_DIR = previous;
      await board.close();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
