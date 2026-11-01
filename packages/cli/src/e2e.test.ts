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
    expect(fs.existsSync(path.join(flowDir, "flow.json"))).toBe(true);
    expect(flowgit(["validate"])).toMatchObject({ code: 0 });
    const status = flowgit(["status"]);
    expect(status.out).toContain("flow inputs not set: topic");
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
});
