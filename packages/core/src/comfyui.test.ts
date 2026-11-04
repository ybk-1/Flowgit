import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHost, withHost } from "./host/index.js";
import {
  doctor,
  flowActions,
  flowToMermaid,
  listRuns,
  loadFlow,
  planRunAll,
  runStage,
  stageConfigHash,
  trustFlow,
  trustState,
  TrustNeededError,
  validateFlow,
  type Flow,
} from "./index.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const WORKFLOW = {
  "3": { class_type: "KSampler", inputs: { seed: 0, steps: 1, cfg: 1, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "your-checkpoint.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 64, height: 64, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "flowgit", images: ["8", 0] } },
};

interface Posted {
  client_id?: string;
  prompt?: { "3"?: { inputs: { seed?: number } }; "6"?: { inputs: { text?: string } } };
}

interface Media {
  filename: string;
  subfolder?: string;
  type?: string;
  bytes: Buffer;
  kind?: "images" | "gifs" | "videos";
}

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const close of closers.splice(0)) await close();
});

function write(dir: string, rel: string, content: string | Buffer): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function listen(handler: http.RequestListener): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const origin = `http://127.0.0.1:${address.port}`;
      const close = () =>
        new Promise<void>((done) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => done());
        });
      closers.push(close);
      resolve({ origin, close });
    });
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function comfy(origin: string, extra: Record<string, unknown> = {}): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "comfy",
    inputs: { scene: { type: "string", default: "dawn" } },
    stages: [
      {
        id: "note",
        name: "note",
        executor: { type: "human" },
        outputs: [{ type: "text/plain", path: "note.md" }],
      },
      {
        id: "scenes",
        name: "scenes",
        executor: { type: "human" },
        outputs: [{ type: "application/json", path: "scenes.json" }],
      },
      {
        id: "pictures",
        name: "pictures",
        inputs: ["note", "scenes"],
        executor: {
          type: "workflow",
          engine: "comfyui",
          file: "comfy/picture.json",
          params: { server: origin, timeoutSec: 5, ...extra },
        },
        outputs: [{ type: "dir", path: "pictures/" }],
      },
    ],
  };
}

interface Fake {
  origin: string;
  posts: Posted[];
  views: string[];
}

async function fakeComfy(opts: { media?: Media[]; mode?: "ok" | "node" | "exec" | "hang" | "500" | "hold"; failTimes?: number } = {}): Promise<Fake> {
  const posts: Posted[] = [];
  const views: string[] = [];
  const history = new Map<string, unknown>();
  let failuresLeft = opts.failTimes ?? (opts.mode === "500" ? 1 : 0);
  const media = opts.media ?? [{ filename: "ComfyUI_00001_.png", bytes: Buffer.from("png-1"), subfolder: "", type: "output" }];
  const server = await listen(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/system_stats") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ system: { os: "test", python_version: "3.12" }, devices: [] }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      if (opts.mode === "hang") return;
      const body = JSON.parse(await readBody(req)) as Posted;
      posts.push(body);
      if (opts.mode === "node") {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
            node_errors: { "6": { class_type: "CLIPTextEncode", errors: [{ type: "value_not_in_list", message: "Required input is missing", details: "text" }] } },
          }),
        );
        return;
      }
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        res.statusCode = 500;
        res.end("busy");
        return;
      }
      const id = `p${posts.length}`;
      const outputs: Record<string, Record<string, unknown[]>> = { "9": { images: [], gifs: [], videos: [] } };
      for (const file of media) {
        const kind = file.kind ?? "images";
        outputs["9"]![kind]!.push({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
      }
      history.set(
        id,
        opts.mode === "exec"
          ? {
              outputs: {},
              status: {
                status_str: "error",
                completed: true,
                messages: [["execution_error", { node_id: "3", node_type: "KSampler", exception_message: "CUDA out of memory", exception_type: "RuntimeError" }]],
              },
            }
          : { outputs, status: { status_str: "success", completed: true, messages: [] } },
      );
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ prompt_id: id, number: posts.length, node_errors: {} }));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/history/")) {
      if (opts.mode === "hold") {
        res.setHeader("content-type", "application/json");
        res.end("{}");
        return;
      }
      const id = decodeURIComponent(url.pathname.slice("/history/".length));
      const entry = history.get(id);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(entry ? { [id]: entry } : {}));
      return;
    }
    if (req.method === "GET" && url.pathname === "/view") {
      views.push(`${url.pathname}${url.search}`);
      const name = url.searchParams.get("filename") ?? "";
      const file = media.find((item) => item.filename === name) ?? media[0]!;
      res.end(file.bytes);
      return;
    }
    res.statusCode = 404;
    res.end("nope");
  });
  return { origin: server.origin, posts, views };
}

describe("comfyui workflow engine", () => {
  it("applies set and each, then saves downloads as 001.png, 002.png", async () => {
    const server = await fakeComfy({
      media: [
        { filename: "ComfyUI_00001_.png", bytes: Buffer.from("one"), subfolder: "batch", type: "output" },
      ],
    });
    // One media template is reused; give each prompt its own bytes by swapping after the first post.
    const dir = tempDir("flowgit-comfy-");
    const flow = comfy(server.origin, {
      set: { "6.inputs.text": "{{inputs.scene}} / {{upstream.note.content}}", "3.inputs.seed": 7 },
      each: { from: "scenes.json", path: "scenes", field: "prompt", target: "6.inputs.text" },
    });
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    write(dir, "note.md", "cats");
    write(dir, "scenes.json", JSON.stringify({ scenes: [{ prompt: "one cat" }, { prompt: "two cats" }] }));
    const loaded = loadFlow(dir);
    await runStage(loaded, "note", { inputs: { scene: "dawn" } });
    await runStage(loaded, "scenes", { inputs: { scene: "dawn" } });
    const run = await runStage(loaded, "pictures", { inputs: { scene: "dawn" }, env: { FLOWGIT_COMFYUI_URL: "http://127.0.0.1:9" } });
    expect(server.posts).toHaveLength(2);
    expect(server.posts[0]!.client_id).toEqual(expect.any(String));
    expect(server.posts[0]!.client_id!.length).toBeGreaterThan(8);
    // each overwrites the set text; the seed from set stays a number.
    expect(server.posts.map((post) => post.prompt?.["6"]?.inputs.text)).toEqual(["one cat", "two cats"]);
    expect(server.posts.every((post) => post.prompt?.["3"]?.inputs.seed === 7)).toBe(true);
    expect(server.views[0]).toContain("filename=ComfyUI_00001_.png");
    expect(server.views[0]).toContain("subfolder=batch");
    expect(server.views[0]).toContain("type=output");
    expect(fs.readFileSync(path.join(dir, "pictures", "001.png")).toString()).toBe("one");
    expect(fs.readFileSync(path.join(dir, "pictures", "002.png")).toString()).toBe("one");
    expect(run.params).toMatchObject({ engine: "comfyui", count: 2, promptIds: ["p1", "p2"] });
    expect(flowToMermaid(flow)).toContain("comfyui");
  });

  it("keeps a gif's extension and writes a single file when the output is one file", async () => {
    const server = await fakeComfy({
      media: [
        { filename: "frame.png", bytes: Buffer.from("png"), kind: "images" },
        { filename: "clip.gif", bytes: Buffer.from("gif"), kind: "gifs" },
      ],
    });
    const dir = tempDir("flowgit-comfy-gif-");
    const flow = comfy(server.origin, { set: { "3.inputs.seed": 1 } });
    flow.stages = flow.stages.filter((stage) => stage.id === "pictures");
    (flow.stages[0]!.executor as { params: { set?: unknown } }).params.set = { "3.inputs.seed": 1 };
    flow.stages[0]!.inputs = [];
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    const loaded = loadFlow(dir);
    await runStage(loaded, "pictures", { env: {} });
    expect(fs.readFileSync(path.join(dir, "pictures", "001.png")).toString()).toBe("png");
    expect(fs.readFileSync(path.join(dir, "pictures", "002.gif")).toString()).toBe("gif");

    const one = comfy(server.origin);
    one.stages = [
      {
        id: "pictures",
        name: "pictures",
        executor: { type: "workflow", engine: "comfyui", file: "comfy/picture.json", params: { server: server.origin, timeoutSec: 5 } },
        outputs: [{ type: "image/png", path: "shot.png" }],
      },
    ];
    write(dir, "flow.json", JSON.stringify(one));
    await expect(runStage(loadFlow(dir), "pictures", { env: {} })).rejects.toThrow(/one file output/);

    const serverOne = await fakeComfy({ media: [{ filename: "only.png", bytes: Buffer.from("solo") }] });
    one.stages[0]!.executor = {
      type: "workflow",
      engine: "comfyui",
      file: "comfy/picture.json",
      params: { server: serverOne.origin, timeoutSec: 5 },
    };
    write(dir, "flow.json", JSON.stringify(one));
    await runStage(loadFlow(dir), "pictures", { env: {} });
    expect(fs.readFileSync(path.join(dir, "shot.png")).toString()).toBe("solo");
    expect(fs.existsSync(path.join(dir, "001.png"))).toBe(false);
  });

  it("renders set from inputs and upstream text when there is no each", async () => {
    const server = await fakeComfy();
    const dir = tempDir("flowgit-comfy-set-");
    const flow = comfy(server.origin, { set: { "6.inputs.text": "{{inputs.scene}} / {{upstream.note.content}}" } });
    flow.stages = flow.stages.filter((stage) => stage.id !== "scenes");
    const pictures = flow.stages.find((stage) => stage.id === "pictures")!;
    pictures.inputs = ["note"];
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    write(dir, "note.md", "cats");
    const loaded = loadFlow(dir);
    await runStage(loaded, "note", { inputs: { scene: "dawn" } });
    await runStage(loaded, "pictures", { inputs: { scene: "dawn" }, env: {} });
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]!.prompt?.["6"]?.inputs.text).toBe("dawn / cats");
  });

  it("names the node in node_errors and execution failures, and does not retry them", async () => {
    const nodeServer = await fakeComfy({ mode: "node" });
    const dir = tempDir("flowgit-comfy-err-");
    const nodeFlow = comfy(nodeServer.origin, { retries: 3 });
    nodeFlow.stages = nodeFlow.stages.filter((stage) => stage.id === "pictures");
    nodeFlow.stages[0]!.inputs = [];
    write(dir, "flow.json", JSON.stringify(nodeFlow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    await expect(runStage(loadFlow(dir), "pictures", { env: {} })).rejects.toThrow(/节点 6[\s\S]*Required input is missing/);
    expect(nodeServer.posts).toHaveLength(1);

    const execServer = await fakeComfy({ mode: "exec" });
    nodeFlow.stages[0]!.executor = {
      type: "workflow",
      engine: "comfyui",
      file: "comfy/picture.json",
      params: { server: execServer.origin, timeoutSec: 5, retries: 3 },
    };
    write(dir, "flow.json", JSON.stringify(nodeFlow));
    await expect(runStage(loadFlow(dir), "pictures", { env: {} })).rejects.toThrow(/节点 3[\s\S]*CUDA out of memory/);
    expect(execServer.posts).toHaveLength(1);
  });

  it("stops when the history poll passes timeoutSec", async () => {
    const server = await fakeComfy({ mode: "hold" });
    const dir = tempDir("flowgit-comfy-time-");
    const flow = comfy(server.origin, { timeoutSec: 1 });
    flow.stages = flow.stages.filter((stage) => stage.id === "pictures");
    flow.stages[0]!.inputs = [];
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    const started = Date.now();
    await expect(runStage(loadFlow(dir), "pictures", { env: {} })).rejects.toThrow(/超时（1 秒）/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("retries a 500 and a hung request, and records the retry", async () => {
    const server = await fakeComfy({ mode: "500", failTimes: 1 });
    const dir = tempDir("flowgit-comfy-retry-");
    const flow = comfy(server.origin, { retries: 2 });
    flow.stages = flow.stages.filter((stage) => stage.id === "pictures");
    flow.stages[0]!.inputs = [];
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    const run = await runStage(loadFlow(dir), "pictures", { env: {}, sleep: async () => {}, random: () => 0 });
    expect(server.posts).toHaveLength(2);
    expect(run.params).toMatchObject({ retries: [expect.objectContaining({ n: 1, status: 500 })] });
    expect(fs.readFileSync(path.join(dir, "pictures", "001.png")).toString()).toBe("png-1");

    const hung = await fakeComfy({ mode: "hang" });
    flow.stages[0]!.executor = {
      type: "workflow",
      engine: "comfyui",
      file: "comfy/picture.json",
      params: { server: hung.origin, timeoutSec: 1, retries: 1 },
    };
    write(dir, "flow.json", JSON.stringify(flow));
    await expect(runStage(loadFlow(dir), "pictures", { env: {}, sleep: async () => {}, random: () => 0 })).rejects.toThrow(/超时（1 秒）/);
    const failed = listRuns(dir, "pictures").at(-1);
    expect(failed?.status).toBe("error");
    expect(failed?.params).toMatchObject({ retries: [expect.objectContaining({ n: 1 })] });
  });

  it("lets params.server win over FLOWGIT_COMFYUI_URL, and refuses a non-http address", async () => {
    const chosen = await fakeComfy();
    const other = await fakeComfy();
    const dir = tempDir("flowgit-comfy-url-");
    const flow = comfy(chosen.origin);
    flow.stages = flow.stages.filter((stage) => stage.id === "pictures");
    flow.stages[0]!.inputs = [];
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    await runStage(loadFlow(dir), "pictures", { env: { FLOWGIT_COMFYUI_URL: other.origin } });
    expect(chosen.posts).toHaveLength(1);
    expect(other.posts).toHaveLength(0);

    const envOnly = comfy(chosen.origin);
    envOnly.stages = [
      {
        id: "pictures",
        name: "pictures",
        executor: { type: "workflow", engine: "comfyui", file: "comfy/picture.json", params: { timeoutSec: 5 } },
        outputs: [{ type: "dir", path: "pictures/" }],
      },
    ];
    write(dir, "flow.json", JSON.stringify(envOnly));
    fs.rmSync(path.join(dir, "pictures"), { recursive: true, force: true });
    await runStage(loadFlow(dir), "pictures", { env: { FLOWGIT_COMFYUI_URL: other.origin } });
    expect(other.posts).toHaveLength(1);

    const loaded = loadFlow(dir);
    const stage = loaded.flow.stages[0]!;
    if (stage.executor.type !== "workflow") throw new Error("expected workflow");
    stage.executor.params = { server: "ftp://127.0.0.1/comfy", timeoutSec: 5 };
    await expect(runStage(loaded, "pictures", { env: {} })).rejects.toThrow(/http 和 https|http or https/);
    expect(chosen.posts).toHaveLength(1);
    expect(other.posts).toHaveLength(1);
  });

  it("hashes the workflow file and the params as written, not a rendered value", () => {
    const dir = tempDir("flowgit-comfy-hash-");
    const flow = comfy("http://127.0.0.1:9", { set: { "6.inputs.text": "{{inputs.scene}}" } });
    write(dir, "flow.json", JSON.stringify(flow));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    const loaded = loadFlow(dir);
    const stage = loaded.flow.stages.find((item) => item.id === "pictures")!;
    const before = stageConfigHash(dir, stage, new Set(), loaded.flow);
    expect(stageConfigHash(dir, stage, new Set(), loaded.flow)).toBe(before);
    write(dir, "comfy/picture.json", `${JSON.stringify(WORKFLOW)}\n`);
    const edited = stageConfigHash(dir, stage, new Set(), loaded.flow);
    expect(edited).not.toBe(before);
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    expect(stageConfigHash(dir, stage, new Set(), loaded.flow)).toBe(before);
    const executor = stage.executor as { params: { set: Record<string, string> } };
    executor.params.set["6.inputs.text"] = "{{inputs.scene}}!";
    expect(stageConfigHash(dir, stage, new Set(), loaded.flow)).not.toBe(before);
  });

  it("lists ComfyUI in flowActions and asks before a copied flow submits anything", async () => {
    const server = await fakeComfy();
    const dir = tempDir("flowgit-comfy-trust-");
    const home = tempDir("flowgit-comfy-home-");
    const previous = process.env.FLOWGIT_HOME;
    process.env.FLOWGIT_HOME = home;
    try {
      const flow = comfy(server.origin, { set: { "3.inputs.seed": 1 } });
      flow.stages = flow.stages.filter((stage) => stage.id === "pictures");
      flow.stages[0]!.inputs = [];
      flow.forkedFrom = { source: "https://example.com/someone/flow.git", commit: "abc123" };
      write(dir, "flow.json", JSON.stringify(flow));
      write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
      const loaded = loadFlow(dir);
      expect(flowActions(loaded.flow)).toEqual([{ stage: "pictures", kind: "workflow", detail: `ComfyUI ${server.origin}` }]);
      const state = trustState(loaded);
      expect(state.needed).toBe(true);
      expect(state.actions).toEqual([{ stage: "pictures", kind: "workflow", detail: `ComfyUI ${server.origin}` }]);
      await expect(runStage(loaded, "pictures", { env: {} })).rejects.toBeInstanceOf(TrustNeededError);
      expect(server.posts).toHaveLength(0);
      trustFlow(loaded, state.fingerprint);
      await runStage(loaded, "pictures", { env: {} });
      expect(server.posts).toHaveLength(1);
      const plan = planRunAll(loaded, { env: {} });
      expect(plan.find((step) => step.stage.id === "pictures")).toMatchObject({ action: "skip", callsModel: false });
    } finally {
      if (previous === undefined) delete process.env.FLOWGIT_HOME;
      else process.env.FLOWGIT_HOME = previous;
    }
  });

  it("doctor warns when ComfyUI is down and is ok when system_stats answers", async () => {
    const dir = tempDir("flowgit-comfy-doctor-");
    const down = comfy("http://127.0.0.1:1");
    down.stages = down.stages.filter((stage) => stage.id === "pictures");
    down.stages[0]!.inputs = [];
    write(dir, "flow.json", JSON.stringify(down));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    const missing = await doctor(loadFlow(dir), { env: {} });
    const hint = missing.find((check) => check.stage === "pictures" && check.level === "warn");
    expect(hint?.message).toContain("连不上 ComfyUI");
    expect(hint?.message).toContain("Can't reach ComfyUI");
    expect(missing.some((check) => check.level === "error" && check.stage === "pictures")).toBe(false);

    const server = await fakeComfy();
    down.stages[0]!.executor = {
      type: "workflow",
      engine: "comfyui",
      file: "comfy/picture.json",
      params: { server: server.origin },
    };
    write(dir, "flow.json", JSON.stringify(down));
    const up = await doctor(loadFlow(dir), { env: {} });
    expect(up).toContainEqual(expect.objectContaining({ level: "ok", stage: "pictures", message: expect.stringContaining(`ComfyUI is up at ${server.origin}`) }));

    const badFlow = loadFlow(dir);
    const stage = badFlow.flow.stages[0]!;
    if (stage.executor.type !== "workflow") throw new Error("expected workflow");
    stage.executor.params = { server: "ftp://127.0.0.1/nope" };
    const bad = await doctor(badFlow, { env: {} });
    expect(bad).toContainEqual(expect.objectContaining({ level: "error", stage: "pictures", message: expect.stringContaining("http") }));
  });

  it("rejects a UI save, a bad set key, and an each path that is not upstream", () => {
    const ui: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "bad",
      stages: [
        {
          id: "pictures",
          name: "pictures",
          executor: { type: "workflow", engine: "comfyui", file: "comfy/picture.json", params: { set: { "text": "nope" }, extra: true } },
          outputs: [{ type: "dir", path: "pictures/" }],
        },
      ],
    };
    expect(validateFlow(ui).some((issue) => issue.level === "error" && /extra/.test(issue.message))).toBe(true);
    const dir = tempDir("flowgit-comfy-valid-");
    const shaped = structuredClone(ui);
    shaped.stages[0]!.executor = { type: "workflow", engine: "comfyui", file: "comfy/picture.json", params: { set: { text: "nope" } } };
    write(dir, "flow.json", JSON.stringify(shaped));
    write(dir, "comfy/picture.json", JSON.stringify({ nodes: [], links: [] }));
    const issues = validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir }).map((issue: { message: string }) => issue.message).join("\n");
    expect(issues).toMatch(/API/);
    expect(issues).toMatch(/<node>\.inputs\.<field>|<节点>\.inputs\.<字段>/);

    const each: Flow = comfy("http://127.0.0.1:9", { each: { from: "other.json", path: "scenes", field: "prompt", target: "6.inputs.text" } });
    write(dir, "flow.json", JSON.stringify(each));
    write(dir, "comfy/picture.json", JSON.stringify(WORKFLOW));
    expect(validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir }).map((issue) => issue.message).join("\n")).toMatch(/upstream output path|上游阶段的产物路径/);
  });

  it("does not call ComfyUI from a browser host", async () => {
    let fetched = false;
    const memory = createMemoryHost({
      platform: "browser",
      fetch: async () => {
        fetched = true;
        throw new Error("fetched");
      },
      files: {
        "/w/flow.json": JSON.stringify({
          format: "flowgit",
          version: "0.1",
          name: "web",
          stages: [
            {
              id: "pictures",
              name: "pictures",
              executor: { type: "workflow", engine: "comfyui", file: "comfy/picture.json", params: { server: "http://127.0.0.1:9" } },
              outputs: [{ type: "dir", path: "pictures/" }],
            },
          ],
        }),
        "/w/comfy/picture.json": JSON.stringify(WORKFLOW),
      },
    });
    await withHost(memory, async () => {
      await expect(runStage(loadFlow("/w"), "pictures")).rejects.toThrow(/needs to run on a computer|要在电脑上运行/);
    });
    expect(fetched).toBe(false);
  });

  it("ships a minimal API workflow example with four demo scenes", () => {
    const example = path.join(repoDir, "examples", "comfyui-picture");
    const loaded = loadFlow(example);
    expect(validateFlow(loaded.flow, { dir: loaded.dir })).toEqual([]);
    const graph = JSON.parse(fs.readFileSync(path.join(example, "comfy", "picture.json"), "utf8")) as Record<string, { class_type: string; inputs: { ckpt_name?: string } }>;
    const types = Object.values(graph).map((node) => node.class_type);
    expect(types.filter((name) => name === "CLIPTextEncode")).toHaveLength(2);
    for (const name of ["CheckpointLoaderSimple", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage"]) {
      expect(types).toContain(name);
    }
    expect(graph["4"]!.inputs.ckpt_name).toBe("your-checkpoint.safetensors");
    const scenes = JSON.parse(fs.readFileSync(path.join(example, "demo-replies", "scenes.json"), "utf8")) as { scenes: unknown[] };
    expect(scenes.scenes).toHaveLength(4);
    const readme = fs.readFileSync(path.join(example, "README.md"), "utf8");
    expect(readme).toContain("Export Workflow (API)");
    expect(readme).toContain("https://docs.comfy.org/development/api-development/workflow-api-format");
    expect(flowActions(loaded.flow)).toEqual([{ stage: "pictures", kind: "workflow", detail: "ComfyUI http://127.0.0.1:8188" }]);
    const plan = planRunAll(loaded, { env: { FLOWGIT_LLM_MOCK_DIR: path.join(example, "demo-replies") } });
    expect(plan.map((step) => `${step.stage.id}:${step.action}`)).toEqual(["scenes:run", "pictures:run"]);
    expect(plan[1]?.detail).toBe("ComfyUI http://127.0.0.1:8188");
    expect(plan[1]?.callsModel).toBe(false);
  });
});
