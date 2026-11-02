import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { doctor, flowActions, listRuns, loadFlow, planRunAll, runAll, runStage, stageConfigHash, validateFlow, type Flow } from "./index.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const OTHER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

const dirs: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

function write(dir: string, rel: string, content: string | Buffer): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) await server.close();
});

function listen(handler: http.RequestListener): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const origin = `http://127.0.0.1:${address.port}`;
      const handle = { origin, close: () => new Promise<void>((done) => server.close(() => done())) };
      servers.push(handle);
      resolve(handle);
    });
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function tempFlow(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-image-"));
  dirs.push(dir);
  write(dir, "prompts/shots.md", "风格：{{inputs.style}}。\n");
  return dir;
}

function imageFlow(model: string, extra: Record<string, unknown> = {}): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "pics",
    inputs: { style: { type: "string", default: "水彩" } },
    stages: [
      {
        id: "shots",
        name: "画面",
        executor: { type: "image", model, prompt: "prompts/shots.md", size: "1024x1024", timeoutSec: 5, ...extra },
        outputs: [{ type: "dir", path: "shots/" }],
      },
    ],
  };
}

function eachFlow(model: string): Flow {
  const flow = imageFlow(model, {
    each: { from: "storyboard.json", path: "shots", field: "image_prompt" },
    timeoutSec: 5,
  });
  flow.stages.unshift({
    id: "board",
    name: "分镜",
    executor: { type: "human" },
    outputs: [{ type: "application/json", path: "storyboard.json" }],
  });
  flow.stages[1]!.inputs = ["board"];
  return flow;
}

describe("image executor", () => {
  it("decodes an OpenAI base64 response and names the env var on 401", async () => {
    const seen: Array<{ auth?: string; body?: unknown }> = [];
    const server = await listen(async (req, res) => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(await readBody(req)) });
      if (seen.length === 1) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG.toString("base64") }] }));
        return;
      }
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("openai/gpt-image-1")));
    const env = { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/v1`, OPENAI_API_KEY: "test-openai" };
    const run = await runStage(loadFlow(dir), "shots", { env });
    expect(seen[0]?.auth).toBe("Bearer test-openai");
    expect(seen[0]?.body).toMatchObject({ model: "gpt-image-1", n: 1, size: "1024x1024", output_format: "png", prompt: "风格：水彩。" });
    expect(fs.readFileSync(path.join(dir, "shots", "001.png"))).toEqual(TINY_PNG);
    expect(run.params).toMatchObject({ provider: "openai", model: "gpt-image-1", size: "1024x1024", count: 1, images: [{ file: "001.png", bytes: TINY_PNG.length }] });

    await expect(runStage(loadFlow(dir), "shots", { env })).rejects.toThrow(/401[\s\S]*环境变量 OPENAI_API_KEY[\s\S]*environment variable OPENAI_API_KEY/);
    expect(seen).toHaveLength(2);
  });

  it("downloads a Zhipu URL and does not send the key to that URL", async () => {
    const downloads: Array<string | undefined> = [];
    const server = await listen(async (req, res) => {
      if (req.url === "/pic.png") {
        downloads.push(req.headers.authorization);
        res.end(TINY_PNG);
        return;
      }
      const body = JSON.parse(await readBody(req)) as { model?: string; size?: string };
      expect(req.headers.authorization).toBe("Bearer test-zhipu");
      expect(body).toMatchObject({ model: "cogview-4", size: "1024x1024", prompt: "风格：水彩。" });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ url: `${server.origin}/pic.png` }] }));
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("zhipu/cogview-4")));
    await runStage(loadFlow(dir), "shots", { env: { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/api/paas/v4`, GLM_API_KEY: "test-zhipu" } });
    expect(fs.readFileSync(path.join(dir, "shots", "001.png"))).toEqual(TINY_PNG);
    expect(downloads).toEqual([undefined]);
  });

  it("asks Volcengine Seedream for a URL and png on 5.0", async () => {
    const bodies: unknown[] = [];
    const server = await listen(async (req, res) => {
      if (req.url === "/pic.png") {
        res.end(OTHER_PNG);
        return;
      }
      bodies.push(JSON.parse(await readBody(req)));
      expect(req.headers.authorization).toBe("Bearer test-ark");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ url: `${server.origin}/pic.png` }] }));
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("volcengine/doubao-seedream-5-0-pro-260628")));
    const env = { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/api/v3`, ARK_API_KEY: "test-ark" };
    await runStage(loadFlow(dir), "shots", { env });
    expect(bodies[0]).toMatchObject({
      model: "doubao-seedream-5-0-pro-260628",
      size: "1024x1024",
      response_format: "url",
      output_format: "png",
    });
    expect(fs.readFileSync(path.join(dir, "shots", "001.png"))).toEqual(OTHER_PNG);

    write(dir, "flow.json", JSON.stringify(imageFlow("volcengine/doubao-seedream-4-0-250828")));
    await runStage(loadFlow(dir), "shots", { env });
    expect(bodies[1]).toMatchObject({ model: "doubao-seedream-4-0-250828", response_format: "url" });
    expect(bodies[1]).not.toHaveProperty("output_format");
  });

  it("polls DashScope from PENDING to SUCCEEDED, and records FAILED", async () => {
    const polls: number[] = [];
    let posts = 0;
    const server = await listen(async (req, res) => {
      const url = req.url ?? "";
      if (url === "/pic.png") {
        expect(req.headers.authorization).toBeUndefined();
        res.end(TINY_PNG);
        return;
      }
      if (req.method === "POST") {
        posts += 1;
        const body = JSON.parse(await readBody(req)) as { model?: string; input?: { prompt?: string }; parameters?: { size?: string; n?: number; prompt_extend?: boolean } };
        expect(req.headers.authorization).toBe("Bearer test-dash");
        expect(req.headers["x-dashscope-async"]).toBe("enable");
        expect(url).toBe("/api/v1/services/aigc/text2image/image-synthesis");
        expect(body.input?.prompt).toBe("风格：水彩。");
        expect(body.parameters).toMatchObject({ size: "1024*1024", n: 1, prompt_extend: false });
        res.end(JSON.stringify({ output: { task_id: "task-1", task_status: "PENDING" } }));
        return;
      }
      polls.push(Date.now());
      if (polls.length === 1) {
        res.end(JSON.stringify({ output: { task_id: "task-1", task_status: "PENDING" } }));
        return;
      }
      res.end(JSON.stringify({ output: { task_id: "task-1", task_status: "SUCCEEDED", results: [{ url: `${server.origin}/pic.png` }] } }));
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("dashscope/wan2.2-t2i-flash", { timeoutSec: 8 })));
    const env = { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/api/v1`, DASHSCOPE_API_KEY: "test-dash" };
    const run = await runStage(loadFlow(dir), "shots", { env });
    expect(posts).toBe(1);
    expect(polls.length).toBeGreaterThanOrEqual(2);
    expect(polls[1]! - polls[0]!).toBeGreaterThanOrEqual(1500);
    expect(fs.readFileSync(path.join(dir, "shots", "001.png"))).toEqual(TINY_PNG);
    expect(run.params).toMatchObject({ provider: "dashscope", model: "wan2.2-t2i-flash", count: 1 });

    const failed = await listen(async (req, res) => {
      if (req.method === "POST") {
        res.end(JSON.stringify({ output: { task_id: "task-2", task_status: "PENDING" } }));
        return;
      }
      res.end(JSON.stringify({ output: { task_id: "task-2", task_status: "FAILED", code: "DataInspectionFailed", message: "bad prompt" } }));
    });
    await expect(runStage(loadFlow(dir), "shots", { env: { ...env, FLOWGIT_IMAGE_BASE_URL: `${failed.origin}/api/v1` } })).rejects.toThrow(/FAILED[\s\S]*bad prompt/);
  }, 15_000);

  it("sends wan2.6 on the newer async endpoint", async () => {
    const server = await listen(async (req, res) => {
      if (req.url === "/pic.png") {
        res.end(TINY_PNG);
        return;
      }
      if (req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as { input?: { messages?: unknown } };
        expect(req.url).toBe("/api/v1/services/aigc/image-generation/generation");
        expect(body.input?.messages).toEqual([{ role: "user", content: [{ text: "风格：水彩。" }] }]);
        res.end(JSON.stringify({ output: { task_id: "task-3", task_status: "SUCCEEDED", choices: [{ message: { content: [{ image: `${server.origin}/pic.png`, type: "image" }] } }] } }));
        return;
      }
      res.statusCode = 500;
      res.end("should not poll a finished submit");
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("dashscope/wan2.6-t2i")));
    await runStage(loadFlow(dir), "shots", { env: { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/api/v1`, DASHSCOPE_API_KEY: "test-dash" } });
    expect(fs.existsSync(path.join(dir, "shots", "001.png"))).toBe(true);
  });

  it("stops when timeoutSec elapses while DashScope stays PENDING", async () => {
    const server = await listen((req, res) => {
      const id = req.method === "POST" ? "task-slow" : "task-slow";
      res.end(JSON.stringify({ output: { task_id: id, task_status: "PENDING" } }));
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("dashscope/wanx-v1", { timeoutSec: 1 })));
    const started = Date.now();
    await expect(
      runStage(loadFlow(dir), "shots", { env: { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/api/v1`, DASHSCOPE_API_KEY: "test-dash" } }),
    ).rejects.toThrow(/超时（1 秒）/);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("does not call the server when the key is missing", async () => {
    let hits = 0;
    const server = await listen((_req, res) => {
      hits += 1;
      res.end("{}");
    });
    const dir = tempFlow();
    write(dir, "flow.json", JSON.stringify(imageFlow("openai/gpt-image-1")));
    await expect(runStage(loadFlow(dir), "shots", { env: { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/v1` } })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(hits).toBe(0);
  });

  it("writes one file per storyboard item, named 001.png onward", async () => {
    const prompts: string[] = [];
    const server = await listen(async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { prompt?: string };
      prompts.push(body.prompt ?? "");
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG.toString("base64") }] }));
    });
    const dir = tempFlow();
    write(
      dir,
      "storyboard.json",
      JSON.stringify({
        shots: [{ image_prompt: "猫钻进纸箱" }, { image_prompt: "只露出耳朵" }, { image_prompt: "纸箱翻倒" }],
      }),
    );
    write(dir, "flow.json", JSON.stringify(eachFlow("openai/gpt-image-1")));
    const loaded = loadFlow(dir);
    await runStage(loaded, "board", { env: {} });
    const run = await runStage(loaded, "shots", { env: { FLOWGIT_IMAGE_BASE_URL: `${server.origin}/v1`, OPENAI_API_KEY: "k" } });
    expect(prompts).toEqual(["风格：水彩。\n\n猫钻进纸箱", "风格：水彩。\n\n只露出耳朵", "风格：水彩。\n\n纸箱翻倒"]);
    expect(fs.readdirSync(path.join(dir, "shots")).sort()).toEqual(["001.png", "002.png", "003.png"]);
    expect(run.params).toMatchObject({ count: 3 });
  });

  it("cycles canned pictures and runs the image-shots example", async () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const example = path.join(repo, "examples", "image-shots");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-image-example-"));
    dirs.push(dir);
    fs.cpSync(example, dir, { recursive: true });
    const loaded = loadFlow(dir);
    expect(validateFlow(loaded.flow, { dir })).toEqual([]);
    let hits = 0;
    const server = await listen((_req, res) => {
      hits += 1;
      res.end("{}");
    });
    await runAll(loaded, {
      env: {
        FLOWGIT_IMAGE_MOCK_DIR: path.join(dir, "demo-pictures"),
        FLOWGIT_IMAGE_BASE_URL: `${server.origin}/api/paas/v4`,
        GLM_API_KEY: "should-not-be-sent",
      },
    });
    expect(hits).toBe(0);
    const shots = ["001.png", "002.png", "003.png"].map((name) => fs.readFileSync(path.join(dir, "shots", name)));
    const canned = fs
      .readdirSync(path.join(dir, "demo-pictures", "shots"))
      .filter((name) => name.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => fs.readFileSync(path.join(dir, "demo-pictures", "shots", name)));
    expect(canned.length).toBe(2);
    expect(shots[0]).toEqual(canned[0]);
    expect(shots[1]).toEqual(canned[1]);
    expect(shots[2]).toEqual(canned[0]);
    const run = listRuns(dir, "shots").at(-1);
    expect(run?.params).toMatchObject({ provider: "zhipu", model: "cogview-4", count: 3, size: "1024x1024" });
    expect(run?.executor).toBe("image");
  });

  it("rejects a bad image stage, and hashes the prompt file", () => {
    const dir = tempFlow();
    const bad: Flow = imageFlow("nope/x");
    expect(validateFlow(bad, { dir }).map((issue) => issue.message).join("\n")).toMatch(/unknown image provider "nope"/);
    const notDir = imageFlow("zhipu/cogview-4");
    notDir.stages[0]!.outputs = [{ type: "image/png", path: "one.png" }];
    expect(validateFlow(notDir, { dir }).map((issue) => issue.message).join("\n")).toMatch(/ends with \//);
    const both = eachFlow("zhipu/cogview-4");
    (both.stages[1]!.executor as { n?: number }).n = 2;
    expect(validateFlow(both, { dir }).map((issue) => issue.message).join("\n")).toMatch(/n must be 1 or omitted/);

    const ok = imageFlow("zhipu/cogview-4");
    write(dir, "flow.json", JSON.stringify(ok));
    const loaded = loadFlow(dir);
    const before = stageConfigHash(dir, loaded.flow.stages[0]!);
    write(dir, "prompts/shots.md", "changed\n");
    expect(stageConfigHash(dir, loaded.flow.stages[0]!)).not.toBe(before);
    expect(doctor(loaded, { env: {} }).some((check) => check.level === "error" && check.message.includes("GLM_API_KEY"))).toBe(true);
    expect(doctor(loaded, { env: { GLM_API_KEY: "set" } }).some((check) => check.level === "ok" && check.message.includes("GLM_API_KEY"))).toBe(true);
    const plan = planRunAll(loaded, { env: { FLOWGIT_IMAGE_MOCK_DIR: path.join(dir, "demo") } });
    expect(plan[0]).toMatchObject({ action: "run", callsModel: false });
    expect(plan[0]?.detail).toContain("canned pictures");
    expect(flowActions(ok)).toEqual([{ stage: "shots", kind: "image", detail: "zhipu/cogview-4", env: ["GLM_API_KEY"] }]);
  });
});
