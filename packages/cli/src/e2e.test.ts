import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the built CLI (dist/) against the bundled short-video template,
// with canned model replies instead of real Claude calls.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

let work: string;
let flowDir: string;

function flowgit(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, "-C", flowDir, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeAll(() => {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-e2e-"));
  flowDir = path.join(work, "video");
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("flowgit CLI with the short-video template", () => {
  it("creates and validates a flow", () => {
    const init = spawnSync(process.execPath, [cli, "init", flowDir], { encoding: "utf8" });
    expect(init.status).toBe(0);
    // The flow is outside the current folder, so the hint shows its full path, not ../../..
    expect(init.stdout).toContain(`next: cd ${/\s/.test(flowDir) ? `"${flowDir}"` : flowDir} && flowgit status`);
    expect(fs.existsSync(path.join(flowDir, "flow.json"))).toBe(true);
    expect(flowgit(["validate"])).toMatchObject({ code: 0 });
    const status = flowgit(["status"]);
    expect(status.out).toContain("flow inputs not set: topic");
  });

  it("checks what the flow needs with doctor", () => {
    const noKey = flowgit(["doctor"], { ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", FLOWGIT_LLM_MOCK_DIR: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.out).toContain("! 还没填流程输入 / flow inputs not set: topic");
    expect(noKey.out).toContain("✗ script, storyboard: 模型 claude-opus-5-5 的密钥 ANTHROPIC_API_KEY 没有设置");
    expect(noKey.out).toContain("FLOWGIT_LLM_MOCK_DIR=demo-replies");
    expect(noKey.out).toContain("✓ edit, export: 找到 / found node");

    const demo = flowgit(["doctor", "--json"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    const report = JSON.parse(demo.out);
    expect(report.ok).toBe(hasFfmpeg);
    expect(demo.code).toBe(hasFfmpeg ? 0 : 1);
    expect(report.checks).toContainEqual({ level: "ok", stage: "script", message: `用固定回复 / canned reply ${path.join("demo-replies", "script.md")}` });
    expect(report.checks).toContainEqual(expect.objectContaining({ level: hasFfmpeg ? "ok" : "error", stage: "export", message: expect.stringContaining("ffmpeg") }));
  });

  it("lists the bundled templates, and names them when -t is wrong", () => {
    const list = spawnSync(process.execPath, [cli, "templates", "--json"], { encoding: "utf8" });
    expect(list.status).toBe(0);
    const templates = JSON.parse(list.stdout) as { id: string; default: boolean; stages: { executor: string }[] }[];
    expect(templates[0]).toMatchObject({ id: "short-video", default: true });
    expect(templates.map((t) => t.id)).toContain("weekly-report");
    expect(spawnSync(process.execPath, [cli, "templates"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).stdout).toMatch(/weekly-report\s+周报（入门示例）\s+随手记 human → 周报草稿 llm → 检查 script/);

    const wrong = spawnSync(process.execPath, [cli, "init", path.join(work, "nope"), "-t", "no-such-template"], { encoding: "utf8" });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("bundled templates: short-video, weekly-report");
  });

  it("shows a short, quoted path when the new flow is below the current folder", () => {
    const init = spawnSync(process.execPath, [cli, "init", "my video"], { cwd: work, encoding: "utf8" });
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('next: cd "my video" && flowgit status');
  });

  it("checks input names and values before saving them", () => {
    const typo = flowgit(["inputs", "set", "topci=猫"]);
    expect(typo.code).toBe(1);
    expect(typo.out).toContain("known inputs: topic, duration, style, audience, language");
    const bad = flowgit(["inputs", "set", "language=fr", "duration=abc"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('Input "language" must be one of "zh", "en", got "fr"');
    expect(bad.out).toContain('Input "duration" must be a number, got "abc"');
    expect(fs.existsSync(path.join(flowDir, "flowgit.local.json"))).toBe(false);
  });

  it("runs until the human stage and waits", () => {
    expect(flowgit(["inputs", "set", "topic=为什么猫喜欢纸箱", "duration=25"]).code).toBe(0);
    const r = flowgit(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(r.code).toBe(2);
    expect(r.out).toContain("waiting for you: assets");
    expect(fs.existsSync(path.join(flowDir, "storyboard.json"))).toBe(true);
    const status = JSON.parse(flowgit(["status", "--json"]).out);
    expect(status.stages.map((s: { state: string }) => s.state)).toEqual(["ok", "ok", "never-run", "waiting-upstream", "waiting-upstream"]);
  });

  it.skipIf(!hasFfmpeg)("finishes the flow and renders final.mp4", () => {
    fs.mkdirSync(path.join(flowDir, "assets"));
    const r = flowgit(["run", "all"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("timeline.json：5 个镜头，25 秒");
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(flowDir, "final.mp4")], { encoding: "utf8" });
    expect(Number(probe.stdout)).toBeCloseTo(25, 0);

    // edit the storyboard by hand: downstream stages become stale, re-run only those
    const sbFile = path.join(flowDir, "storyboard.json");
    const sb = JSON.parse(fs.readFileSync(sbFile, "utf8"));
    sb.shots = sb.shots.slice(0, 2);
    fs.writeFileSync(sbFile, JSON.stringify(sb, null, 2));
    const status = JSON.parse(flowgit(["status", "--json"]).out);
    expect(status.stages.map((s: { state: string }) => s.state)).toEqual(["ok", "edited", "stale", "stale", "stale"]);
    const again = flowgit(["run", "all"]);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("kept your manual edit as v2");
    expect(again.out).toContain("timeline.json：2 个镜头，9 秒");
    expect(JSON.parse(fs.readFileSync(sbFile, "utf8")).shots).toHaveLength(2);
    expect(flowgit(["log", "storyboard"]).out).toMatch(/v2\s+ok\s+\S+ \S+\s+manual/);

    expect(flowgit(["log", "export"]).out).toMatch(/v2\s+ok/);

    // the template's scripts speak the language the user picked
    const en = flowgit(["run", "edit", "--input", "language=en"]);
    expect(en.code, en.out).toBe(0);
    expect(en.out).toContain("timeline.json: 2 clips, 9s");
    expect(flowgit(["run", "edit", "--input", "language=fr"]).out).toContain('Input "language" must be one of "zh", "en"');
  }, 120_000);

  it("exports a SKILL.md", () => {
    const r = flowgit(["export-skill", "--out", "-"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("name: short-video");
    expect(r.out).toContain("# 短视频制作");
    expect(r.out).toContain("flowgit run storyboard");
  });

  it("lists providers and whether their keys are set, never the keys", () => {
    const home = path.join(work, "flowgit-home");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "providers.json"), JSON.stringify({ providers: { mine: { protocol: "openai", baseUrl: "http://127.0.0.1:1/v1", apiKeyEnv: "MINE_KEY" } } }));
    const env = { FLOWGIT_HOME: home, GLM_API_KEY: "secret-glm-key", MINE_KEY: "", ANTHROPIC_BASE_URL: "" };
    const r = flowgit(["providers"], env);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/glm\s+anthropic\s+https:\/\/open\.bigmodel\.cn\/api\/anthropic\s+GLM_API_KEY ✓ 已设置 set/);
    expect(r.out).toMatch(/mine\s+openai\s+http:\/\/127\.0\.0\.1:1\/v1\s+MINE_KEY ✗ 未设置 not set\s+全局 global/);
    expect(r.out).not.toContain("secret-glm-key");
    const json = JSON.parse(flowgit(["providers", "--json"], env).out);
    expect(json.providers.find((p: { id: string }) => p.id === "ollama")).toMatchObject({ key: "none", baseUrl: "http://localhost:11434/v1" });
    expect(JSON.stringify(json)).not.toContain("secret-glm-key");

    // an unknown provider fails with a hint
    const bad = flowgit(["run", "script", "--model", "nope/x"], env);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('Unknown provider "nope"');
  });
});
