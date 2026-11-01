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

describe("flowgit CLI with the article template", () => {
  const title = "为什么猫喜欢纸箱";
  const coverPrompt = "一只橘猫把脑袋挤出小号纸箱，窗边的早晨侧光，竖构图，画面里没有文字";
  let articleRoot: string;
  let articleDir: string;

  function article(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", articleDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    articleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-e2e-article-"));
    articleDir = path.join(articleRoot, "post");
  });

  afterAll(() => {
    fs.rmSync(articleRoot, { recursive: true, force: true });
  });

  it("creates and validates an article flow", () => {
    const init = spawnSync(process.execPath, [cli, "init", articleDir, "-t", "article"], { encoding: "utf8" });
    expect(init.status, init.stdout + init.stderr).toBe(0);
    expect(fs.existsSync(path.join(articleDir, "flow.json"))).toBe(true);
    expect(article(["validate"])).toMatchObject({ code: 0 });
    expect(article(["status"]).out).toContain("flow inputs not set: topic");
  });

  it("stops at the photos stage, then exports a post from an empty photos directory", () => {
    const mock = { FLOWGIT_LLM_MOCK_DIR: path.join(articleDir, "demo-replies") };
    expect(article(["inputs", "set", "topic=为什么猫喜欢纸箱"]).code).toBe(0);
    const waiting = article(["run", "all"], mock);
    expect(waiting.code, waiting.out).toBe(2);
    expect(waiting.out).toContain("waiting for you: photos");
    expect(fs.existsSync(path.join(articleDir, "outline.md"))).toBe(true);
    expect(fs.existsSync(path.join(articleDir, "draft.md"))).toBe(true);
    const images = JSON.parse(fs.readFileSync(path.join(articleDir, "images.json"), "utf8"));
    expect(images.images[0]).toMatchObject({ purpose: expect.any(String), prompt: coverPrompt, alt: expect.any(String) });
    const status = JSON.parse(article(["status", "--json"]).out);
    expect(status.stages.map((s: { id: string; state: string }) => [s.id, s.state])).toEqual([
      ["outline", "ok"],
      ["draft", "ok"],
      ["images", "ok"],
      ["photos", "never-run"],
      ["export", "waiting-upstream"],
    ]);

    fs.mkdirSync(path.join(articleDir, "photos"));
    const done = article(["run", "all"], mock);
    expect(done.code, done.out).toBe(0);
    expect(done.out).toContain("3 张占位");
    const html = fs.readFileSync(path.join(articleDir, "post.html"), "utf8");
    const md = fs.readFileSync(path.join(articleDir, "post.md"), "utf8");
    expect(html).toContain(title);
    expect(html).toContain(`<h1>${title}</h1>`);
    expect(html).toContain("快递箱");
    expect(html).toContain(coverPrompt);
    expect(html).not.toContain('src="photos/');
    expect(md).toContain(`# ${title}`);
    expect(md).toContain(coverPrompt);

    fs.writeFileSync(path.join(articleDir, "photos", "cover.jpg"), "not-a-real-jpeg");
    const withPhoto = article(["run", "all"], mock);
    expect(withPhoto.code, withPhoto.out).toBe(0);
    expect(withPhoto.out).toContain("kept your manual edit");
    const html2 = fs.readFileSync(path.join(articleDir, "post.html"), "utf8");
    expect(html2).toContain('src="photos/cover.jpg"');
    expect(html2).toContain(title);
    expect(html2).not.toContain(coverPrompt);

    const en = article(["run", "export", "--input", "language=en"]);
    expect(en.code, en.out).toBe(0);
    expect(en.out).toContain("2 placeholders");
    expect(en.out).not.toContain("张占位");
    const enHtml = fs.readFileSync(path.join(articleDir, "post.html"), "utf8");
    expect(enHtml).toContain('lang="en"');
    expect(enHtml).toContain("Image to add");
    expect(article(["run", "export", "--input", "language=fr"]).out).toContain('Input "language" must be one of "zh", "en"');
    expect(article(["run", "export", "--input", "platform=tiktok"]).out).toContain('Input "platform" must be one of "xiaohongshu", "wechat", "blog"');
  });

  it("exports a SKILL.md", () => {
    const r = article(["export-skill", "--out", "-"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("name: article");
    expect(r.out).toContain("# 图文帖子");
    expect(r.out).toContain("flowgit run draft");
  });
});
