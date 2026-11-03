import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFlowMd, renderFlowMd, type Flow } from "@flowgit/core";
import { BrowserBoard } from "./router.js";

function flow(): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "markdown",
    description: "keep",
    inputs: { topic: { type: "string", required: true } },
    stages: [
      {
        id: "notes",
        name: "笔记",
        executor: { type: "human" },
        outputs: [{ type: "text/markdown", path: "notes.md" }],
      },
      {
        id: "draft",
        name: "草稿",
        inputs: ["notes"],
        executor: { type: "llm", prompt: "prompts/draft.md", effort: "low" },
        outputs: [{ type: "text/markdown", path: "draft.md" }],
      },
    ],
  };
}

async function call(board: BrowserBoard, method: string, url: string, body?: unknown) {
  const res = await board.fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("BrowserBoard PUT /api/stage and PUT /api/flow", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("edits a flow.md, refuses a cycle and a bad body, and returns 409 while running", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-app-edit-"));
    fs.mkdirSync(path.join(dir, "prompts"));
    fs.writeFileSync(path.join(dir, "prompts", "draft.md"), "hi\n");
    const file = path.join(dir, "flow.md");
    fs.writeFileSync(file, renderFlowMd(flow()));
    const board = new BrowserBoard({ dir });

    const renamed = await call(board, "PUT", "/api/stage", { id: "draft", name: "润色", model: "glm/glm-5.3", retries: 2 });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    const meta = await call(board, "PUT", "/api/flow", {
      name: "改过",
      concurrency: 4,
      inputs: { tone: { type: "string", enum: ["calm", "bold"], default: "calm" } },
    });
    expect(meta.status, JSON.stringify(meta.body)).toBe(200);
    const prompt = await board.fetch("/api/file?path=prompts/draft.md", {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "new {{inputs.topic}}\n",
    });
    expect(prompt.status).toBe(200);
    expect(fs.readFileSync(path.join(dir, "prompts", "draft.md"), "utf8")).toBe("new {{inputs.topic}}\n");

    const saved = parseFlowMd(fs.readFileSync(file, "utf8")) as unknown as Flow;
    expect(fs.existsSync(path.join(dir, "flow.json"))).toBe(false);
    expect(saved.name).toBe("改过");
    expect(saved.description).toBe("keep");
    expect(saved.concurrency).toBe(4);
    expect(saved.inputs?.tone).toMatchObject({ enum: ["calm", "bold"], default: "calm" });
    expect(saved.stages[1]).toMatchObject({
      name: "润色",
      executor: { type: "llm", prompt: "prompts/draft.md", effort: "low", model: "glm/glm-5.3", retries: 2 },
    });

    const before = fs.readFileSync(file);
    const cycle = await call(board, "PUT", "/api/stage", { id: "notes", inputs: ["draft"] });
    expect(cycle.status).toBe(400);
    expect(String(cycle.body.error)).toContain("会形成环");
    expect(String(cycle.body.error)).toContain("would cycle");
    expect(Array.isArray(cycle.body.issues)).toBe(true);
    const empty = await call(board, "PUT", "/api/flow", { name: "" });
    expect(empty.status).toBe(400);
    expect(fs.readFileSync(file)).toEqual(before);

    board.running = true;
    const blockedStage = await call(board, "PUT", "/api/stage", { id: "draft", name: "不行" });
    const blockedFlow = await call(board, "PUT", "/api/flow", { name: "不行" });
    expect(blockedStage.status).toBe(409);
    expect(blockedFlow.status).toBe(409);
    expect(String(blockedStage.body.error)).toContain("正在运行");
    expect(String(blockedFlow.body.error)).toContain("结束后再改阶段");
    expect(fs.readFileSync(file)).toEqual(before);
    board.running = false;

    const missing = await call(board, "PUT", "/api/stage", { id: "nope", name: "x" });
    expect(missing.status).toBe(404);
  });
});
