import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFlow, runStage, validateFlow } from "./index.js";

const examplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples");
const examples = fs
  .readdirSync(examplesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(examplesDir, e.name, "flow.json")))
  .map((e) => e.name);

describe("examples/", () => {
  it("has examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const name of examples) {
    it(`${name} is a valid flow with no warnings`, () => {
      const loaded = loadFlow(path.join(examplesDir, name));
      expect(validateFlow(loaded.flow, { dir: loaded.dir })).toEqual([]);
    });
  }
});

// A stand-in for Claude Code: writes outline.md or index.html depending on the
// stage, and records the arguments it got so we can check the permission flags.
const FAKE_CLAUDE = `
import fs from "node:fs";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const stage = process.env.FLOWGIT_STAGE;
fs.appendFileSync("argv.log", stage + " " + JSON.stringify(process.argv.slice(2)) + "\\n");
if (stage === "outline") {
  fs.writeFileSync("outline.md", "# 猫和纸箱\\n为什么猫喜欢纸箱\\n\\n## 安全感\\n- 箱子让猫觉得安全\\n");
} else if (stage === "page") {
  const external = process.env.FAKE_EXTERNAL === "yes" ? '<script src="https://cdn.example.com/x.js"></script>' : "";
  fs.writeFileSync("index.html", '<!doctype html><html lang="zh-CN"><head><title>猫和纸箱</title><style>body{max-width:720px}</style>' + external + "</head><body><h1>猫和纸箱</h1></body></html>");
}
`;

describe("examples/agent-page end to end (fake Claude Code)", () => {
  let dir: string;
  let bin: string;
  let env: Record<string, string>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-agent-page-"));
    fs.cpSync(path.join(examplesDir, "agent-page"), dir, { recursive: true });
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-fake-claude-"));
    const script = path.join(bin, "fake-claude.mjs");
    fs.writeFileSync(script, FAKE_CLAUDE);
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(bin, "claude.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
    }
    // The fake claude comes first; node must stay reachable for the check script.
    const pathValue = [bin, path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter);
    env = { PATH: pathValue, Path: pathValue };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  });

  const inputs = { topic: "为什么猫喜欢纸箱" };

  it("outlines, builds the page and passes the check", async () => {
    const loaded = loadFlow(dir);
    await runStage(loaded, "outline", { env, inputs });
    await runStage(loaded, "page", { env, inputs });
    const check = await runStage(loaded, "check", { env, inputs });
    expect(check.status).toBe("ok");
    const report = JSON.parse(fs.readFileSync(path.join(dir, "check.json"), "utf8")) as { ok: boolean; checks: { ok: boolean }[] };
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    // Claude Code ran headless with acceptEdits, never a bypass flag.
    const argv = fs.readFileSync(path.join(dir, "argv.log"), "utf8");
    expect(argv).toContain('"--permission-mode","acceptEdits"');
    expect(argv).not.toMatch(/dangerously|bypass/i);
  });

  it("fails the check when the page loads something from the network", async () => {
    const loaded = loadFlow(dir);
    await runStage(loaded, "outline", { env, inputs });
    await runStage(loaded, "page", { env: { ...env, FAKE_EXTERNAL: "yes" }, inputs });
    await expect(runStage(loaded, "check", { env, inputs })).rejects.toThrow();
    const report = JSON.parse(fs.readFileSync(path.join(dir, "check.json"), "utf8")) as { ok: boolean };
    expect(report.ok).toBe(false);
  });
});
