import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_ADAPTERS,
  MissingOutputsError,
  STDIN_INSTRUCTION,
  agentCommandLine,
  listRuns,
  loadFlow,
  runStage,
  shellQuote,
  stageStatus,
  validateFlow,
  type ExecutorAgent,
  type Flow,
} from "./index.js";

// A stand-in for an agent CLI: reads the prompt from stdin and from {{promptFile}},
// then behaves according to its last argument.
const FAKE_AGENT = `
import fs from "node:fs";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const [promptFile, mode = "ok"] = process.argv.slice(2);
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS);
if (mode === "fail") { console.error("boom"); process.exit(3); }
if (mode === "nothing") process.exit(0);
const fromFile = fs.readFileSync(promptFile, "utf8");
fs.writeFileSync(outputs[0].path, "same=" + (fromFile === stdin) + "\\nstage=" + process.env.FLOWGIT_STAGE + "\\n" + stdin);
if (mode === "extra") fs.writeFileSync("notes.txt", "extra");
console.log("fake agent done");
`;

const MAKE_SOURCE = `import fs from "node:fs"; fs.writeFileSync("source.md", "# source\\n");`;

function flowWith(executor: ExecutorAgent): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "agent test",
    inputs: { topic: { type: "string", default: "cats" } },
    stages: [
      { id: "source", name: "来源 source", executor: { type: "script", run: "node make-source.mjs" }, outputs: [{ type: "text/markdown", path: "source.md" }] },
      { id: "write", name: "写 write", inputs: ["source"], executor, outputs: [{ type: "text/markdown", path: "out.md", description: "the article" }] },
    ],
  };
}

const custom = (args?: string[]): ExecutorAgent => ({ type: "agent", agent: "custom", prompt: "prompt.md", command: "node fake-agent.mjs {{promptFile}}", ...(args ? { args } : {}) });

let dir: string;

function setup(executor: ExecutorAgent = custom()) {
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flowWith(executor)));
  fs.writeFileSync(path.join(dir, "prompt.md"), "Write about {{inputs.topic}}.");
  fs.writeFileSync(path.join(dir, "fake-agent.mjs"), FAKE_AGENT);
  fs.writeFileSync(path.join(dir, "make-source.mjs"), MAKE_SOURCE);
  return loadFlow(dir);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-agent-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("agent executor", () => {
  it("validates agent stages", () => {
    const bad = flowWith({ type: "agent", agent: "custom", prompt: "prompt.md" } as ExecutorAgent);
    expect(validateFlow(bad).filter((i) => i.level === "error").map((i) => i.message)).toEqual([expect.stringContaining('missing required property "command"')]);
    const unknownAgent = flowWith({ type: "agent", agent: "devin", prompt: "prompt.md" } as unknown as ExecutorAgent);
    expect(validateFlow(unknownAgent).some((i) => i.level === "error")).toBe(true);
    const ignored = flowWith({ type: "agent", agent: "claude-code", prompt: "prompt.md", command: "x" });
    expect(validateFlow(ignored).map((i) => i.message)).toEqual([expect.stringContaining('only used when agent is "custom"')]);
    setup();
    expect(validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir })).toEqual([]);
    fs.rmSync(path.join(dir, "prompt.md"));
    expect(validateFlow(JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")), { dir })[0].message).toContain("prompt file not found");
  });

  it("runs the agent in the flow directory with the rendered prompt on stdin and in {{promptFile}}", async () => {
    const loaded = setup();
    await runStage(loaded, "source", {});
    const logs: string[] = [];
    const run = await runStage(loaded, "write", { onEvent: (e) => e.type === "stage:log" && logs.push(e.line) });

    const out = fs.readFileSync(path.join(dir, "out.md"), "utf8");
    expect(out).toContain("same=true");
    expect(out).toContain("stage=write");
    expect(out).toContain("Write about cats.");
    expect(out).toContain("- `source.md` (text/markdown, 来源 source)");
    expect(out).toContain("- `out.md` (text/markdown): the article");
    expect(out).toContain("- topic: cats");
    expect(out).toContain("never touch runs/");
    expect(run).toMatchObject({ status: "ok", executor: "agent", params: { agent: "custom", exitCode: 0 } });
    expect(run.params?.command).toMatch(/^node fake-agent\.mjs .*<prompt>/);
    expect(run.params?.changedOutside).toBeUndefined();
    expect(logs.join("\n")).toContain("fake agent done");
    // the prompt is kept in run.json, and its working copy under runs/ is cleaned up
    expect(run.params?.prompt).toContain("Write about cats.");
    expect(fs.existsSync(path.join(dir, "runs", ".agent"))).toBe(false);
  });

  it("notes files the agent changed outside its outputs", async () => {
    const loaded = setup(custom(["extra"]));
    await runStage(loaded, "source", {});
    const logs: string[] = [];
    const run = await runStage(loaded, "write", { onEvent: (e) => e.type === "stage:log" && logs.push(e.line) });
    expect(run.params?.changedOutside).toEqual(["notes.txt"]);
    expect(logs.join("\n")).toContain("the agent also changed: notes.txt");
  });

  it("records a failing agent and an agent that writes nothing", async () => {
    let loaded = setup(custom(["fail"]));
    await runStage(loaded, "source", {});
    await expect(runStage(loaded, "write", {})).rejects.toThrow(/exited with code 3[\s\S]*boom/);
    expect(listRuns(dir, "write")[0]).toMatchObject({ status: "error" });

    loaded = setup(custom(["nothing"]));
    await expect(runStage(loaded, "write", {})).rejects.toBeInstanceOf(MissingOutputsError);
  });

  it("marks the stage stale when the prompt or the agent script changes", async () => {
    const loaded = setup();
    await runStage(loaded, "source", {});
    await runStage(loaded, "write", {});
    expect(stageStatus(loaded, "write", { topic: "cats" }).state).toBe("ok");
    fs.appendFileSync(path.join(dir, "fake-agent.mjs"), "\n// changed\n");
    expect(stageStatus(loaded, "write", { topic: "cats" }).state).toBe("stale");
    await runStage(loaded, "write", {});
    fs.appendFileSync(path.join(dir, "prompt.md"), " Be brief.");
    expect(stageStatus(loaded, "write", { topic: "cats" }).state).toBe("stale");
  });

  it("explains how to install a built-in agent that is missing", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-empty-path-"));
    try {
      const loaded = setup({ type: "agent", agent: "claude-code", prompt: "prompt.md" });
      await runStage(loaded, "source", {});
      await expect(runStage(loaded, "write", { env: { PATH: empty, Path: empty } })).rejects.toThrow(/claude not found; install it first: npm install -g @anthropic-ai\/claude-code/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  /** Put a fake `name` executable on an otherwise empty PATH; it runs fake-cli.mjs with node. */
  function fakeBin(name: string): { env: Record<string, string>; cleanup: () => void } {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-fake-bin-"));
    const script = path.join(dir, "fake-cli.mjs");
    fs.writeFileSync(
      script,
      `import fs from "node:fs";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS);
if (process.env.FAKE_WRITE !== "no") fs.writeFileSync(outputs[0].path, JSON.stringify({ argv: process.argv.slice(2), stdin }));
`,
    );
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(bin, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
    }
    return { env: { PATH: bin, Path: bin }, cleanup: () => fs.rmSync(bin, { recursive: true, force: true }) };
  }

  it("starts Claude Code headless with acceptEdits and the prompt on stdin", async () => {
    const fake = fakeBin("claude");
    try {
      const loaded = setup({ type: "agent", agent: "claude-code", prompt: "prompt.md", args: ["--model", "claude-opus-5-5"] });
      await runStage(loaded, "source", {});
      const run = await runStage(loaded, "write", { env: fake.env });
      const seen = JSON.parse(fs.readFileSync(path.join(dir, "out.md"), "utf8")) as { argv: string[]; stdin: string };
      expect(seen.argv).toEqual(["-p", "--permission-mode", "acceptEdits", "--model", "claude-opus-5-5", STDIN_INSTRUCTION]);
      expect(seen.stdin).toContain("Write about cats.");
      expect(seen.stdin).toContain("- `out.md` (text/markdown): the article");
      expect(run.params).toMatchObject({ agent: "claude-code", exitCode: 0 });
    } finally {
      fake.cleanup();
    }
  });

  it("points Cursor at the prompt file, and explains --force when it wrote nothing", async () => {
    const fake = fakeBin("agent");
    try {
      const loaded = setup({ type: "agent", agent: "cursor", prompt: "prompt.md" });
      await runStage(loaded, "source", {});
      await runStage(loaded, "write", { env: fake.env });
      const seen = JSON.parse(fs.readFileSync(path.join(dir, "out.md"), "utf8")) as { argv: string[] };
      expect(seen.argv).toEqual(["-p", "--output-format", "text", "Read runs/.agent/write.prompt.md and do the task it describes."]);
      // writing nothing leaves the previous out.md in place; that still counts as "wrote nothing"
      await expect(runStage(loaded, "write", { env: { ...fake.env, FAKE_WRITE: "no" } })).rejects.toThrow(/add "--force" to executor.args/);
      fs.rmSync(path.join(dir, "out.md"));
      await expect(runStage(loaded, "write", { env: { ...fake.env, FAKE_WRITE: "no" } })).rejects.toThrow(/add "--force" to executor.args/);
    } finally {
      fake.cleanup();
    }
  });
});

describe("built-in agent command lines", () => {
  const BYPASS = /dangerously|yolo|--force\b|bypass/i;

  it("starts each agent headless with no bypass flag", () => {
    for (const agent of Object.keys(AGENT_ADAPTERS) as (keyof typeof AGENT_ADAPTERS)[]) {
      const line = agentCommandLine({ type: "agent", agent, prompt: "p.md" }, "/abs/p.md", "runs/.agent/s.prompt.md", "linux");
      expect(line.startsWith(`${AGENT_ADAPTERS[agent].bin} `)).toBe(true);
      expect(line).not.toMatch(BYPASS);
    }
    const line = (agent: keyof typeof AGENT_ADAPTERS, args?: string[]) =>
      agentCommandLine({ type: "agent", agent, prompt: "p.md", ...(args ? { args } : {}) }, "/abs/p.md", "runs/.agent/s.prompt.md", "linux");
    expect(line("claude-code")).toBe(`claude -p --permission-mode acceptEdits '${STDIN_INSTRUCTION}'`);
    // user args go before codex's trailing "-" (read the prompt from stdin)
    expect(line("codex", ["--model", "gpt-5"])).toBe("codex exec --sandbox workspace-write --skip-git-repo-check --model gpt-5 -");
    expect(line("cursor")).toBe("agent -p --output-format text 'Read runs/.agent/s.prompt.md and do the task it describes.'");
    expect(line("gemini")).toBe(`gemini --approval-mode auto_edit -p '${STDIN_INSTRUCTION}'`);
  });

  it("quotes the prompt path and extra args for each shell", () => {
    const ex: ExecutorAgent = { type: "agent", agent: "custom", prompt: "p.md", command: "my-agent --file {{promptFile}}", args: ["--note", "it's ok"] };
    expect(agentCommandLine(ex, "/tmp/a b/prompt.md", "x", "linux")).toBe(`my-agent --file '/tmp/a b/prompt.md' --note 'it'\\''s ok'`);
    expect(agentCommandLine(ex, "C:\\Temp\\a b\\prompt.md", "x", "win32")).toBe(`my-agent --file "C:\\Temp\\a b\\prompt.md" --note "it's ok"`);
    expect(shellQuote("plain-arg_1.0", "linux")).toBe("plain-arg_1.0");
  });
});
