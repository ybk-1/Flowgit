import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFlow, runStage, validateFlow, type Flow, type LlmComplete } from "./index.js";

// A downloaded flow can carry a symlink such as prompt.md → ~/.ssh/id_rsa. Its contents must not
// end up in a model request or a service call.
let work: string;
let flowDir: string;
let secret: string;

/** Creates a symlink, or returns false where the OS doesn't allow it (Windows without the right privilege). */
function link(target: string, at: string): boolean {
  try {
    fs.symlinkSync(target, at, "file");
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return false;
    throw err;
  }
}

const echo: LlmComplete = async (req) => ({ text: `# ok\n\n${req.prompt.length}`, model: "echo" });

function writeFlow(flow: Flow): void {
  fs.writeFileSync(path.join(flowDir, "flow.json"), JSON.stringify(flow, null, 2));
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-links-"));
  flowDir = path.join(work, "flow");
  fs.mkdirSync(flowDir);
  secret = path.join(work, "id_rsa");
  fs.writeFileSync(secret, "-----BEGIN OPENSSH PRIVATE KEY-----\nnot really\n");
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("links that lead out of the flow directory", () => {
  it("rejects a prompt file that links outside", () => {
    if (!link(secret, path.join(flowDir, "prompt.md"))) return;
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "links",
      stages: [{ id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md" }, outputs: [{ type: "text/markdown", path: "draft.md" }] }],
    };
    const issues = validateFlow(flow, { dir: flowDir });
    expect(issues.find((i) => i.level === "error")?.message).toContain("prompt.md is a link to a file outside the flow directory");
  });

  it("keeps an upstream output that links outside out of model requests and service calls, but not out of scripts", async () => {
    fs.writeFileSync(path.join(flowDir, "prompt.md"), "Summarize.");
    const flow: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "links",
      stages: [
        { id: "notes", name: "notes", executor: { type: "human", instructions: "add notes.md" }, outputs: [{ type: "text/markdown", path: "notes.md" }] },
        { id: "draft", name: "draft", inputs: ["notes"], executor: { type: "llm", prompt: "prompt.md" }, outputs: [{ type: "text/markdown", path: "draft.md" }] },
        {
          id: "post",
          name: "post",
          inputs: ["notes"],
          executor: { type: "service", method: "POST", url: "http://127.0.0.1:9/never" },
          outputs: [{ type: "application/json", path: "post.json" }],
        },
        { id: "copy", name: "copy", inputs: ["notes"], executor: { type: "script", run: "node -e \"require('fs').writeFileSync('copy.txt','done')\"" }, outputs: [{ type: "text/plain", path: "copy.txt" }] },
      ],
    };
    writeFlow(flow);
    if (!link(secret, path.join(flowDir, "notes.md"))) return;
    const loaded = loadFlow(flowDir);
    await runStage(loaded, "notes", { llm: echo });

    const prompts: string[] = [];
    const spy: LlmComplete = async (req) => {
      prompts.push(req.prompt);
      return echo(req);
    };
    await expect(runStage(loaded, "draft", { llm: spy })).rejects.toThrow(/notes\.md is a link to a file outside the flow directory/);
    expect(prompts).toEqual([]);
    await expect(runStage(loaded, "post", {})).rejects.toThrow(/notes\.md is a link to a file outside the flow directory/);
    // Scripts already run with your permissions, so a linked input is theirs to read.
    await runStage(loaded, "copy", {});
    expect(fs.readFileSync(path.join(flowDir, "copy.txt"), "utf8")).toBe("done");
  });

  it("still reads a link that stays inside the flow directory", async () => {
    fs.mkdirSync(path.join(flowDir, "prompts"));
    fs.writeFileSync(path.join(flowDir, "prompts", "real.md"), "Say hi.");
    if (!link(path.join(flowDir, "prompts", "real.md"), path.join(flowDir, "prompt.md"))) return;
    writeFlow({
      format: "flowgit",
      version: "0.1",
      name: "links",
      stages: [{ id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md" }, outputs: [{ type: "text/markdown", path: "draft.md" }] }],
    });
    const prompts: string[] = [];
    await runStage(loadFlow(flowDir), "draft", {
      llm: async (req) => {
        prompts.push(req.prompt);
        return echo(req);
      },
    });
    expect(prompts[0]).toContain("Say hi.");
  });
});
