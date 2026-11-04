import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const template = path.join(here, "..", "templates", "weekly-report");

function flowgit(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, out: `${result.stdout}${result.stderr}` };
}

describe("flowgit test", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-test-cmd-"));

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists the flags", () => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    const help = flowgit(["test", "--help"]);
    expect(help.code, help.out).toBe(0);
    expect(help.stdout).toContain("--live");
    expect(help.stdout).toContain("--json");
    expect(help.stdout).toContain("--keep");
    expect(help.stdout).toContain("--model");
  });

  it("runs the weekly-report cases and prints JSON of the same shape", () => {
    const result = flowgit(["-C", template, "test", "--json"]);
    expect(result.code, result.out).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      cases: { id: string; name: string; file: string; ok: boolean; checks: { stage: string; file: string; ok: boolean; expected: string }[] }[];
    };
    expect(report.ok).toBe(true);
    expect(report.cases[0]).toMatchObject({ id: "sample", name: "示例周报", file: "sample.json", ok: true });
    expect(report.cases[0]?.checks[0]).toEqual(
      expect.objectContaining({ stage: expect.any(String), file: expect.any(String), ok: true, expected: expect.any(String) }),
    );
    const text = flowgit(["-C", template, "test", "sample"]);
    expect(text.code, text.out).toBe(0);
    expect(text.stdout.split(/\r?\n/).some((line) => line.startsWith("✓") && line.includes("示例周报"))).toBe(true);
  });

  it("copies tests/ with init -t", () => {
    const dir = path.join(root, "report");
    const init = flowgit(["init", dir, "-t", "weekly-report"]);
    expect(init.code, init.out).toBe(0);
    expect(fs.existsSync(path.join(dir, "tests", "sample.json"))).toBe(true);
    const ran = flowgit(["-C", dir, "test"]);
    expect(ran.code, ran.out).toBe(0);
    expect(ran.stdout).toContain("✓");
  });

  it("exits 1 and lists the stage, file, expected value and first 200 characters", () => {
    const dir = path.join(root, "bad");
    fs.cpSync(template, dir, { recursive: true });
    const sample = JSON.parse(fs.readFileSync(path.join(dir, "tests", "sample.json"), "utf8")) as {
      expect: { draft: unknown[] };
    };
    sample.expect.draft.push({ file: "report.md", contains: "这个句子不在周报里-NOT-HERE" });
    fs.writeFileSync(path.join(dir, "tests", "sample.json"), `${JSON.stringify(sample, null, 2)}\n`);
    const text = flowgit(["-C", dir, "test"]);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("✗");
    expect(text.stdout).toContain("draft report.md");
    expect(text.stdout).toContain("期望 / expected:");
    expect(text.stdout).toContain("实际 / actual:");
    const json = flowgit(["-C", dir, "test", "--json"]);
    expect(json.code).toBe(1);
    const report = JSON.parse(json.stdout) as {
      ok: boolean;
      cases: { ok: boolean; checks: { ok: boolean; stage: string; file: string; expected: string; actual?: string }[] }[];
    };
    expect(report).toEqual(expect.objectContaining({ ok: false, cases: expect.any(Array) }));
    const failed = report.cases[0]?.checks.filter((check) => !check.ok) ?? [];
    expect(failed.length).toBeGreaterThan(0);
    for (const check of failed) {
      expect(check.stage).toBeTruthy();
      expect(check.file).toBeTruthy();
      expect(check.expected).toBeTruthy();
      expect(Array.from(check.actual ?? "").length).toBeLessThanOrEqual(200);
    }
  });

  it("names a test that does not exist", () => {
    const result = flowgit(["-C", template, "test", "no-such"]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/没有这个测试|No such test/);
  });
});
