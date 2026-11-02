import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRuns, loadFlow, runStage, stageStatus, validateFlow, type ExecutorScript, type Flow } from "./index.js";

const TIMEOUT_ERROR = "超时（1 秒），已停止 / Timed out after 1s and was stopped";

/** Writes `marker` two seconds after start, then stays alive only for that timer. */
function lateWriter(marker: string, delayMs = 2000): string {
  return `import fs from "node:fs";
setTimeout(() => { fs.writeFileSync(${JSON.stringify(marker)}, "late"); }, ${delayMs});
`;
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-timeout-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeFlow(flow: Flow) {
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow));
}

describe("timeoutSec schema", () => {
  it("accepts timeoutSec on script and agent and rejects it elsewhere or below 1", () => {
    const script = (timeoutSec: unknown): Flow => ({
      format: "flowgit",
      version: "0.1",
      name: "t",
      stages: [
        {
          id: "s",
          name: "s",
          executor: { type: "script", run: "node ok.mjs", ...(timeoutSec === undefined ? {} : { timeoutSec }) } as ExecutorScript,
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    });
    expect(validateFlow(script(1)).filter((i) => i.level === "error")).toEqual([]);
    expect(validateFlow(script(undefined)).filter((i) => i.level === "error")).toEqual([]);

    const agent: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "t",
      stages: [
        {
          id: "a",
          name: "a",
          executor: { type: "agent", agent: "custom", prompt: "p.md", command: "node ok.mjs", timeoutSec: 2 },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    };
    fs.writeFileSync(path.join(dir, "p.md"), "hi");
    expect(validateFlow(agent, { dir }).filter((i) => i.level === "error")).toEqual([]);

    expect(validateFlow(script(0)).some((i) => i.level === "error")).toBe(true);
    expect(validateFlow(script(1.5)).some((i) => i.level === "error")).toBe(true);
    const llm: Flow = {
      format: "flowgit",
      version: "0.1",
      name: "t",
      stages: [
        {
          id: "l",
          name: "l",
          executor: { type: "llm", prompt: "p.md", timeoutSec: 1 } as unknown as Flow["stages"][number]["executor"],
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    };
    expect(validateFlow(llm, { dir }).map((i) => i.message).join("\n")).toContain('unknown property "timeoutSec"');
  });
});

describe("script timeoutSec", () => {
  it("stops the process tree and records a failed run", async () => {
    const marker = path.join(dir, "marker.txt");
    fs.writeFileSync(path.join(dir, "late.mjs"), lateWriter(marker));
    writeFlow({
      format: "flowgit",
      version: "0.1",
      name: "timeout",
      stages: [
        {
          id: "slow",
          name: "slow",
          executor: { type: "script", run: "node late.mjs", timeoutSec: 1 },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    });
    await expect(runStage(loadFlow(dir), "slow")).rejects.toThrow(TIMEOUT_ERROR);
    expect(listRuns(dir, "slow")[0]).toMatchObject({ status: "error", error: TIMEOUT_ERROR });
    await new Promise((r) => setTimeout(r, 3000));
    expect(fs.existsSync(marker)).toBe(false);
  }, 15_000);

  it("SIGKILLs a script that ignores SIGTERM, so it never writes the marker", async () => {
    const marker = path.join(dir, "marker.txt");
    fs.writeFileSync(
      path.join(dir, "late.mjs"),
      `import fs from "node:fs";
process.on("SIGTERM", () => {});
process.on("SIGHUP", () => {});
setTimeout(() => { fs.writeFileSync(${JSON.stringify(marker)}, "late"); }, 8000);
`,
    );
    writeFlow({
      format: "flowgit",
      version: "0.1",
      name: "timeout",
      stages: [
        {
          id: "slow",
          name: "slow",
          executor: { type: "script", run: "node late.mjs", timeoutSec: 1 },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    });
    const started = Date.now();
    await expect(runStage(loadFlow(dir), "slow")).rejects.toThrow(TIMEOUT_ERROR);
    const elapsed = Date.now() - started;
    // Unix must wait out the 5s grace before SIGKILL. Windows force-kills immediately.
    if (process.platform !== "win32") expect(elapsed).toBeGreaterThanOrEqual(5_000);
    await new Promise((r) => setTimeout(r, Math.max(0, 8_500 - elapsed)));
    expect(fs.existsSync(marker)).toBe(false);
  }, 20_000);

  it("marks the stage stale when timeoutSec changes", async () => {
    fs.writeFileSync(path.join(dir, "ok.mjs"), `import fs from "node:fs"; fs.writeFileSync("out.txt", "ok");\n`);
    writeFlow({
      format: "flowgit",
      version: "0.1",
      name: "timeout",
      stages: [
        {
          id: "fast",
          name: "fast",
          executor: { type: "script", run: "node ok.mjs", timeoutSec: 30 },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    });
    const loaded = loadFlow(dir);
    await runStage(loaded, "fast");
    expect(stageStatus(loaded, "fast", {}).state).toBe("ok");
    (loaded.flow.stages[0].executor as ExecutorScript).timeoutSec = 31;
    expect(stageStatus(loaded, "fast", {}).state).toBe("stale");
  });
});

describe("agent timeoutSec", () => {
  it("stops a custom agent process tree and records a failed run", async () => {
    const marker = path.join(dir, "marker.txt");
    fs.writeFileSync(path.join(dir, "late.mjs"), lateWriter(marker));
    fs.writeFileSync(path.join(dir, "prompt.md"), "Do the task.");
    writeFlow({
      format: "flowgit",
      version: "0.1",
      name: "timeout",
      stages: [
        {
          id: "slow",
          name: "slow",
          executor: { type: "agent", agent: "custom", prompt: "prompt.md", command: "node late.mjs", timeoutSec: 1 },
          outputs: [{ type: "text/markdown", path: "out.md" }],
        },
      ],
    });
    await expect(runStage(loadFlow(dir), "slow")).rejects.toThrow(TIMEOUT_ERROR);
    expect(listRuns(dir, "slow")[0]).toMatchObject({ status: "error", executor: "agent", error: TIMEOUT_ERROR });
    await new Promise((r) => setTimeout(r, 3000));
    expect(fs.existsSync(marker)).toBe(false);
  }, 15_000);
});
