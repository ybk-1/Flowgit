import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandProgram, doctor, findOnPath, loadFlow, proxySupport, runStage, validateFlow, type DoctorCheck, type Flow } from "./index.js";

let dir: string;
let bin: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-doctor-"));
  bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Put a do-nothing program called `name` in bin/ (a .cmd file on Windows). */
function fakeProgram(name: string) {
  const file = path.join(bin, process.platform === "win32" ? `${name}.cmd` : name);
  fs.writeFileSync(file, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
  fs.chmodSync(file, 0o755);
}

/** PATH with only bin/, so the machine's own programs (a real claude, say) don't leak in. */
const pathEnv = () => ({ PATH: bin });

function setup(flow: Partial<Flow>) {
  const full: Flow = { format: "flowgit", version: "0.1", name: "doctor test", stages: [], ...flow };
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(full));
  fs.writeFileSync(path.join(dir, "prompt.md"), "Write.");
  return loadFlow(dir);
}

const byStage = (checks: DoctorCheck[], stage: string) => checks.filter((c) => c.stage?.split(", ").includes(stage));

describe("commandProgram", () => {
  it("finds the program a command starts", () => {
    expect(commandProgram("node scripts/render.mjs")).toBe("node");
    expect(commandProgram("  python3 -m tool")).toBe("python3");
    expect(commandProgram("FOO=1 node x.mjs")).toBe("node");
    expect(commandProgram('"node" x.mjs')).toBe("node");
  });

  it("gives up on paths and shell builtins", () => {
    expect(commandProgram("./run.sh")).toBeUndefined();
    expect(commandProgram("C:\\tools\\x.exe")).toBeUndefined();
    expect(commandProgram("cd sub && node x.mjs")).toBeUndefined();
    expect(commandProgram("")).toBeUndefined();
  });
});

describe("findOnPath", () => {
  it("finds programs on PATH, and only there", () => {
    fakeProgram("fg-tool");
    expect(findOnPath("fg-tool", pathEnv())).toMatch(/fg-tool/);
    expect(findOnPath("fg-missing", pathEnv())).toBeUndefined();
    expect(findOnPath("fg-tool", { PATH: "" })).toBeUndefined();
  });
});

describe("doctor", () => {
  it("checks keys, programs and agents without running anything", () => {
    fakeProgram("fg-tool");
    fakeProgram("node");
    const loaded = setup({
      inputs: { topic: { type: "string", required: true } },
      stages: [
        { id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md", model: "deepseek/deepseek-flash" }, outputs: [{ type: "text/markdown", path: "a.md" }] },
        { id: "polish", name: "polish", inputs: ["draft"], executor: { type: "llm", prompt: "prompt.md", model: "deepseek/deepseek-flash" }, outputs: [{ type: "text/markdown", path: "b.md" }] },
        { id: "build", name: "build", inputs: ["polish"], executor: { type: "script", run: "node build.mjs", requires: ["fg-tool", "fg-missing"] }, outputs: [{ type: "text/plain", path: "c.txt" }] },
        { id: "page", name: "page", inputs: ["build"], executor: { type: "agent", agent: "claude-code", prompt: "prompt.md" }, outputs: [{ type: "text/html", path: "d.html" }] },
        { id: "fix", name: "fix", inputs: ["page"], executor: { type: "agent", agent: "cursor", prompt: "prompt.md" }, outputs: [{ type: "text/html", path: "e.html" }] },
      ],
    });
    const checks = doctor(loaded, { env: pathEnv() });

    expect(checks[0]).toMatchObject({ level: "ok", message: expect.stringMatching(/^Node\.js /) });
    expect(checks).toContainEqual(expect.objectContaining({ level: "warn", message: expect.stringContaining("flow inputs not set: topic"), hint: "flowgit inputs set topic=..." }));
    // Both llm stages need the same key, so they share one line.
    const key = checks.filter((c) => c.message.includes("DEEPSEEK_API_KEY"));
    expect(key).toHaveLength(1);
    expect(key[0]).toMatchObject({ level: "error", stage: "draft, polish" });
    expect(key[0].hint).toContain('$env:DEEPSEEK_API_KEY="..."');

    const build = byStage(checks, "build");
    expect(build.map((c) => [c.level, c.message])).toEqual([
      ["ok", "找到 / found node"],
      ["ok", "找到 / found fg-tool"],
      ["error", "找不到 fg-missing / fg-missing not found on PATH"],
    ]);
    expect(byStage(checks, "page")).toEqual([
      expect.objectContaining({ level: "error", message: "找不到 claude / claude not found on PATH", hint: expect.stringContaining("@anthropic-ai/claude-code") }),
    ]);
    expect(byStage(checks, "fix").map((c) => c.level)).toEqual(["error", "warn"]);
    expect(byStage(checks, "fix")[1].message).toContain("--force");
  });

  it("is happy with a key, and with canned replies instead of a key", () => {
    const loaded = setup({
      stages: [{ id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md", model: "deepseek/deepseek-flash" }, outputs: [{ type: "text/markdown", path: "a.md" }] }],
    });
    expect(doctor(loaded, { env: { ...pathEnv(), DEEPSEEK_API_KEY: "sk-test" } }).every((c) => c.level === "ok")).toBe(true);
    expect(doctor(loaded, { env: { ...pathEnv() }, model: "ollama/qwen3:8b" })).toContainEqual(
      expect.objectContaining({ level: "ok", stage: "draft", message: expect.stringContaining("no key needed") }),
    );

    fs.mkdirSync(path.join(dir, "replies"));
    const mock = doctor(loaded, { env: { ...pathEnv(), FLOWGIT_LLM_MOCK_DIR: path.join(dir, "replies") } });
    expect(mock).toContainEqual(expect.objectContaining({ level: "error", stage: "draft", message: expect.stringContaining("no canned reply") }));
    fs.writeFileSync(path.join(dir, "replies", "draft.md"), "hi");
    expect(doctor(loaded, { env: { ...pathEnv(), FLOWGIT_LLM_MOCK_DIR: path.join(dir, "replies") } })).toContainEqual(
      expect.objectContaining({ level: "ok", stage: "draft", message: `用固定回复 / canned reply ${path.join("replies", "draft.md")}` }),
    );
  });

  it("reports the proxy model requests will go through, only when a model is called", () => {
    const loaded = setup({
      stages: [{ id: "draft", name: "draft", executor: { type: "llm", prompt: "prompt.md", model: "deepseek/deepseek-flash" }, outputs: [{ type: "text/markdown", path: "a.md" }] }],
    });
    const env = { ...pathEnv(), DEEPSEEK_API_KEY: "sk-test", HTTPS_PROXY: "http://me:secret@127.0.0.1:7890" };
    const none = () => undefined;
    const proxy = (checks: DoctorCheck[]) => checks.find((c) => /proxy|代理/.test(c.message));
    if (proxySupport() !== "none") {
      expect(proxy(doctor(loaded, { env, systemProxy: none }))).toMatchObject({
        level: "ok",
        message: "模型和服务请求走代理 http://127.0.0.1:7890（HTTPS_PROXY）/ model and service requests go through http://127.0.0.1:7890 (HTTPS_PROXY)",
      });
      const windows = { url: "http://127.0.0.1:7897", source: "windows" as const, usable: true };
      expect(proxy(doctor(loaded, { env: { ...pathEnv(), DEEPSEEK_API_KEY: "sk-test" }, systemProxy: () => windows }))?.message).toContain("(the Windows system proxy)");
    }
    expect(proxy(doctor(loaded, { env: { ...env, HTTPS_PROXY: "socks5://127.0.0.1:7891" }, systemProxy: none }))).toMatchObject({ level: "warn" });
    expect(proxy(doctor(loaded, { env: { ...env, FLOWGIT_PROXY: "off" }, systemProxy: none }))?.message).toContain("FLOWGIT_PROXY=off");
    expect(proxy(doctor(loaded, { env: { ...pathEnv(), DEEPSEEK_API_KEY: "sk-test" }, systemProxy: none }))).toBeUndefined();
    fs.mkdirSync(path.join(dir, "replies"));
    expect(proxy(doctor(loaded, { env: { ...env, FLOWGIT_LLM_MOCK_DIR: path.join(dir, "replies") }, systemProxy: none }))).toBeUndefined();
  });

  it("reports flow inputs outside their enum as errors", () => {
    const loaded = setup({
      inputs: { language: { type: "string", enum: ["zh", "en"], default: "zh" } },
      stages: [{ id: "a", name: "a", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "a.md" }] }],
    });
    expect(doctor(loaded, { env: pathEnv() }).filter((c) => c.level !== "ok")).toEqual([]);
    expect(doctor(loaded, { env: pathEnv(), inputs: { language: "fr" } })).toContainEqual(
      expect.objectContaining({ level: "error", message: expect.stringContaining('must be one of "zh", "en"') }),
    );
  });
});

describe("script requires", () => {
  it("stops before running when a required program is missing", async () => {
    const loaded = setup({
      stages: [{ id: "build", name: "build", executor: { type: "script", run: "node -e \"require('fs').writeFileSync('c.txt','x')\"", requires: ["fg-missing-program"] }, outputs: [{ type: "text/plain", path: "c.txt" }] }],
    });
    await expect(runStage(loaded, "build")).rejects.toThrow("fg-missing-program not found on PATH");
    expect(fs.existsSync(path.join(dir, "c.txt"))).toBe(false);
  });

  it("only takes program names", () => {
    const flow = { format: "flowgit", version: "0.1", name: "x", stages: [{ id: "a", name: "a", executor: { type: "script", run: "x", requires: ["ffmpeg -y"] }, outputs: [{ type: "text/plain", path: "a.txt" }] }] };
    expect(validateFlow(flow).filter((i) => i.level === "error").map((i) => i.path)).toEqual(["/stages/0/executor/requires/0"]);
  });
});
