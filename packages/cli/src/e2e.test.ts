import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
    // Two lines, no `&&`, so it also works in Windows PowerShell 5.1.
    expect(init.stdout).toContain(`next:\n    cd ${/\s/.test(flowDir) ? `"${flowDir}"` : flowDir}\n    flowgit status`);
    expect(init.stdout).not.toContain("&&");
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
    // when nothing blocks, doctor points at the dry run, with the same --model
    const text = flowgit(["doctor", "--model", "glm/glm-5.3"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(text.out.includes("先预演一下 / preview it first: flowgit run all --dry-run --model glm/glm-5.3")).toBe(hasFfmpeg);
  });

  it("lists the bundled templates, and names them when -t is wrong", () => {
    const list = spawnSync(process.execPath, [cli, "templates", "--json"], { encoding: "utf8" });
    expect(list.status).toBe(0);
    const templates = JSON.parse(list.stdout) as { id: string; default: boolean; stages: { executor: string }[] }[];
    expect(templates[0]).toMatchObject({ id: "short-video", default: true });
    expect(templates.map((t) => t.id)).toEqual(expect.arrayContaining(["weekly-report", "article", "support-sop", "job-application", "research-report", "ecommerce-listing", "slides", "live-selling", "short-drama", "lesson-plan", "meeting-notes"]));
    expect(spawnSync(process.execPath, [cli, "templates"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }).stdout).toMatch(/weekly-report\s+周报（入门示例）\s+随手记 human → 周报草稿 llm → 检查 script/);

    const wrong = spawnSync(process.execPath, [cli, "init", path.join(work, "nope"), "-t", "no-such-template"], { encoding: "utf8" });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("bundled templates: short-video, article, ecommerce-listing, job-application, lesson-plan, live-selling, meeting-notes, research-report, short-drama, slides, support-sop, weekly-report");
  });

  it("shows a short, quoted path when the new flow is below the current folder", () => {
    const init = spawnSync(process.execPath, [cli, "init", "my video"], { cwd: work, encoding: "utf8" });
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('next:\n    cd "my video"\n    flowgit status');
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
    // With --input only, the stop says how to keep the values for the next command.
    const once = flowgit(["run", "all", "--input", "topic=为什么猫喜欢纸箱", "--input", "duration=25"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(once.code, once.out).toBe(2);
    expect(once.out).toContain("save it before you continue: flowgit inputs set topic=为什么猫喜欢纸箱 duration=25");
    expect(flowgit(["inputs", "set", "topic=为什么猫喜欢纸箱", "duration=25"]).code).toBe(0);
    const r = flowgit(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(r.code).toBe(2);
    expect(r.out).toContain("waiting for you: assets");
    expect(r.out).not.toContain("--input lasts one run");
    expect(fs.existsSync(path.join(flowDir, "storyboard.json"))).toBe(true);
    const status = JSON.parse(flowgit(["status", "--json"]).out);
    expect(status.stages.map((s: { state: string }) => s.state)).toEqual(["ok", "ok", "never-run", "waiting-upstream", "waiting-upstream"]);
  });

  it("draws the flow as a Mermaid diagram, colored by state", () => {
    const plain = flowgit(["graph"]);
    expect(plain.code).toBe(0);
    expect(plain.out).toMatch(/^flowchart LR\n {2}s1\["脚本<br\/>llm"\]/);
    expect(plain.out).toContain("  s2 --> s4\n  s3 --> s4\n");
    const md = flowgit(["graph", "--status", "--md"]);
    expect(md.out.startsWith("```mermaid\nflowchart LR\n")).toBe(true);
    expect(md.out.trimEnd().endsWith("```")).toBe(true);
    expect(md.out).toContain('s3["素材<br/>human · ○ never-run"]');
    expect(md.out).toContain("  class s1,s2 ok");
    expect(md.out).toContain("  class s4,s5 waitingUpstream");

    // --out writes UTF-8 next to the flow; a .md file gets the code block
    expect(flowgit(["graph", "--out", "flow.md"]).out).toContain("is the flow file's name; pick another, e.g. graph.md");
    expect(flowgit(["graph", "--out", "graph.md"]).out).toContain("wrote");
    const saved = fs.readFileSync(path.join(flowDir, "graph.md"));
    expect(saved.subarray(0, 10).toString("utf8")).toBe("```mermaid");
    expect(saved.toString("utf8")).toContain('s1["脚本<br/>llm"]');
    flowgit(["graph", "--out", "flow.mmd"]);
    expect(fs.readFileSync(path.join(flowDir, "flow.mmd"), "utf8").startsWith("flowchart LR\n")).toBe(true);
  });

  it("shows what run all would do with --dry-run, without running anything", () => {
    const noMock = { FLOWGIT_LLM_MOCK_DIR: "" };
    const r = flowgit(["run", "all", "--dry-run"], noMock);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/脚本 script\s+· 跳过，已是最新 \/ skip, up to date/);
    expect(r.out).toMatch(/素材 assets\s+⏸ 停下等你 \/ stops for you\s+需要你放好 \/ needs assets/);
    expect(r.out).toMatch(/导出 export\s+· 走不到 \/ not reached/);
    expect(r.out).toContain("不会调用模型 / no model calls");
    const forced = flowgit(["run", "all", "--dry-run", "--force", "--model", "deepseek/deepseek-v4-flash", "--input", "style=very calm"], noMock);
    expect(forced.out).toMatch(/分镜 storyboard\s+▶ 运行 \/ run\s+模型 \/ model deepseek\/deepseek-v4-flash/);
    expect(forced.out).toContain("最多 2 次模型调用 / at most 2 model call(s)");
    expect(forced.out).toContain('真的运行 / to run it: flowgit run all --force --model deepseek/deepseek-v4-flash --input "style=very calm"');
    expect(fs.readdirSync(path.join(flowDir, "runs", "script"))).toEqual(["1"]);
    expect(flowgit(["run", "script", "--dry-run"]).out).toContain("--dry-run only works with all");
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

  it("shows help in both languages", () => {
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    for (const text of ["用法 / Usage: flowgit", "选项 / Options:", "命令 / Commands:", "显示帮助 / show help", "显示版本号 / show the version number", "显示某个命令的帮助 / show help for a command", '(默认 / default: ".")']) {
      expect(help.stdout).toContain(text);
    }
    expect(help.stdout).not.toMatch(/display help|output the version/);
    const init = spawnSync(process.execPath, [cli, "init", "--help"], { encoding: "utf8" });
    expect(init.stdout).toContain("参数 / Arguments:");
    expect(init.stdout).toContain('(默认 / default: "short-video")');
  });

  it("explains mistakes in both languages", () => {
    const typo = flowgit(["statsu"]);
    expect(typo.code).toBe(1);
    expect(typo.out).toContain("✗ 没有这个命令 statsu / unknown command 'statsu'");
    expect(typo.out).toContain("是不是想输入 status？/ did you mean status?");
    expect(flowgit(["run"]).out).toContain("✗ 缺少参数 stage / missing required argument 'stage'");
    expect(flowgit(["log", "a", "b"]).out).toContain("log 只要 1 个参数，给了 2 个 / log takes 1 argument(s), got 2");
    expect(flowgit(["restore", "storyboard", "abc"]).out).toContain("版本号要写数字，例如 flowgit restore storyboard 2 / the version is a number");
    expect(flowgit(["restore", "storyboard", "99"]).out).toMatch(/没有 v99（现有 v1.*）\/ Stage "storyboard" has no run #99 \(it has v1/);
    expect(flowgit(["inputs", "set", "topic"]).out).toContain('expected key=value, e.g. topic=cats, got "topic"');

    const noFlow = spawnSync(process.execPath, [cli, "-C", work, "status"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    expect(noFlow.status).toBe(1);
    expect(noFlow.stderr).toContain(`No flow.json or flow.md in ${work}`);
    expect(noFlow.stderr).toContain("新建一个 / create one: flowgit init <目录 dir>");
  });

  it("starts a local board on 127.0.0.1 and requires a token", async () => {
    const child = spawn(process.execPath, [cli, "-C", flowDir, "board", "--port", "0", "--no-open"], {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let exited = false;
    child.on("exit", () => {
      exited = true;
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`board did not print a URL:\n${buf}`)), 15_000);
        const onData = (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          const match = buf.match(/http:\/\/127\.0\.0\.1:\d+\//);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        };
        child.stdout!.on("data", onData);
        child.stderr!.on("data", onData);
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`board exited ${code} before printing a URL:\n${buf}`));
        });
      });
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.get(`${url}api/flow`, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
      });
      expect(status).toBe(401);
      expect(buf).toContain("可以修改产物");
    } finally {
      if (!exited) {
        const closed = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await closed;
      }
    }
  }, 20_000);

  it("exports a SKILL.md", () => {
    const r = flowgit(["export-skill", "--out", "-"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("name: short-video");
    expect(r.out).toContain("# 短视频制作");
    expect(r.out).toContain("flowgit run storyboard");
    expect(r.out).toContain("flowgit run all --dry-run");
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

describe("flowgit diff", () => {
  let diffWork: string;
  let diffDir: string;

  function flowgitDiff(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", diffDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    diffWork = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-diff-e2e-"));
    diffDir = path.join(diffWork, "video");
  });

  afterAll(() => {
    if (diffWork) fs.rmSync(diffWork, { recursive: true, force: true });
  });

  it("shows the hand-edited storyboard lines between two demo runs", () => {
    const init = spawnSync(process.execPath, [cli, "init", diffDir], { encoding: "utf8" });
    expect(init.status, init.stderr).toBe(0);
    expect(flowgitDiff(["inputs", "set", "topic=为什么猫喜欢纸箱", "duration=25"]).code).toBe(0);

    const mock = { FLOWGIT_LLM_MOCK_DIR: path.join(diffDir, "demo-replies") };
    const first = flowgitDiff(["run", "all"], mock);
    expect(first.code, first.out).toBe(2);

    const sbFile = path.join(diffDir, "storyboard.json");
    const sb = JSON.parse(fs.readFileSync(sbFile, "utf8")) as { title: string };
    sb.title = "为什么猫喜欢纸箱（手改）";
    fs.writeFileSync(sbFile, `${JSON.stringify(sb, null, 2)}\n`);

    const second = flowgitDiff(["run", "storyboard"], mock);
    expect(second.code, second.out).toBe(0);
    expect(second.out).toContain("已存为 v2");

    const diff = flowgitDiff(["diff", "storyboard", "1", "2"]);
    expect(diff.code, diff.out).toBe(0);
    expect(diff.out).toContain("v1 → v2");
    expect(diff.out).toContain('-  "title": "为什么猫喜欢纸箱",');
    expect(diff.out).toContain('+  "title": "为什么猫喜欢纸箱（手改）",');
    expect(diff.out).not.toMatch(/\x1b\[/);

    const json = JSON.parse(flowgitDiff(["diff", "storyboard", "1", "2", "--json"]).out) as {
      stage: string;
      a: number;
      b: number;
      outputs: { path: string; kind: string; same: boolean; diff: string }[];
    };
    expect(json).toMatchObject({ stage: "storyboard", a: 1, b: 2 });
    expect(json.outputs[0]).toMatchObject({ path: "storyboard.json", kind: "text", same: false });
    expect(json.outputs[0].diff).toContain("为什么猫喜欢纸箱（手改）");

    const missing = flowgitDiff(["diff", "storyboard", "1", "99"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("没有 v99");
    expect(missing.out).toContain("has no run #99");

    const bad = flowgitDiff(["diff", "storyboard", "v1"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("正整数");
    expect(bad.out).toContain("positive integer");
  });
});

describe("flowgit init from a directory or a Git URL", () => {
  const hasGit = spawnSync("git", ["--version"]).status === 0;
  let root: string;
  let source: string;

  function run(args: string[]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-fork-init-"));
    source = path.join(root, "source");
    const init = run(["init", source, "-t", "weekly-report"]);
    expect(init.code, init.out).toBe(0);
    fs.writeFileSync(path.join(source, "notes.md"), "this week\n");
    fs.mkdirSync(path.join(source, "runs", "notes", "1"), { recursive: true });
    fs.writeFileSync(path.join(source, "runs", "notes", "1", "run.json"), "{}\n");
    fs.writeFileSync(path.join(source, "flowgit.local.json"), "{}\n");
    fs.writeFileSync(path.join(source, ".env"), "SECRET=1\n");
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies a local flow without its outputs unless --with-outputs is set", () => {
    const dest = path.join(root, "copy");
    const copied = run(["init", dest, "-t", source]);
    expect(copied.code, copied.out).toBe(0);
    expect(copied.out).toContain("跳过的产物 / skipped outputs: notes.md");
    // a flow from somewhere else says what it will run before anyone runs it
    expect(copied.out).toContain("Before you run it, look at what this flow does on your computer:");
    expect(copied.out).toMatch(/script\s+check\s+node scripts\/check-report\.mjs/);
    expect(fs.existsSync(path.join(dest, "prompts", "draft.md"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "notes.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "runs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "flowgit.local.json"))).toBe(false);
    const flow = JSON.parse(fs.readFileSync(path.join(dest, "flow.json"), "utf8")) as { forkedFrom?: unknown };
    expect(flow.forkedFrom).toBeUndefined();

    const withOutputs = path.join(root, "with-outputs");
    const again = run(["init", withOutputs, "-t", source, "--with-outputs"]);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("没有跳过产物");
    expect(fs.readFileSync(path.join(withOutputs, "notes.md"), "utf8")).toBe("this week\n");
    expect(fs.existsSync(path.join(withOutputs, ".env"))).toBe(false);
  });

  it.skipIf(!hasGit)("records forkedFrom.commit when init clones a file:// repository", () => {
    const repo = path.join(root, "repo");
    fs.cpSync(source, repo, { recursive: true, filter: (p) => !p.split(path.sep).includes("runs") && path.basename(p) !== "flowgit.local.json" && path.basename(p) !== ".env" });
    const git = (args: string[]) => {
      const r = spawnSync("git", ["-c", "user.email=dev@example.com", "-c", "user.name=Flowgit", ...args], { cwd: repo, encoding: "utf8" });
      expect(r.status, `${args.join(" ")}\n${r.stdout}${r.stderr}`).toBe(0);
      return r;
    };
    git(["init", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-m", "init flow"]);
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    const url = pathToFileURL(repo).href;
    const dest = path.join(root, "from-git");
    const cloned = run(["init", dest, "-t", url, "--ref", "main"]);
    expect(cloned.code, cloned.out).toBe(0);
    expect(cloned.out).toContain(url);
    expect(cloned.out).toContain("notes.md");
    expect(fs.existsSync(path.join(dest, "notes.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "prompts", "draft.md"))).toBe(true);
    const flow = JSON.parse(fs.readFileSync(path.join(dest, "flow.json"), "utf8")) as { forkedFrom: { source: string; ref?: string; commit: string } };
    expect(flow.forkedFrom).toEqual({ source: url, ref: "main", commit });

    const escape = run(["init", path.join(root, "escape"), "-t", url, "--path", ".."]);
    expect(escape.code).toBe(1);
    expect(escape.out).toContain("--path must stay inside the repository");
    expect(fs.existsSync(path.join(root, "escape", "flow.json"))).toBe(false);
  });

  it.skipIf(!hasGit)("never prints the credentials in a Git URL", () => {
    const r = spawnSync(process.execPath, [cli, "init", path.join(root, "secret"), "-t", "https://someone:s3cr3tTOKEN@127.0.0.1:1/flow.git"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" },
      timeout: 60_000,
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out).toBe(1);
    expect(out).toContain("clone failed: https://127.0.0.1:1/flow.git");
    expect(out).not.toContain("s3cr3tTOKEN");
  });
});

describe("flowgit stage add / rm", () => {
  let reportRoot: string;
  let reportDir: string;

  function report(args: string[]) {
    const r = spawnSync(process.execPath, [cli, "-C", reportDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-stage-"));
    reportDir = path.join(reportRoot, "weekly");
  });

  afterAll(() => {
    if (reportRoot) fs.rmSync(reportRoot, { recursive: true, force: true });
  });

  it("adds an llm stage to the weekly report and does not overwrite an existing prompt", () => {
    const init = spawnSync(process.execPath, [cli, "init", reportDir, "-t", "weekly-report"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);

    const add = report(["stage", "add", "polish", "--type", "llm", "--after", "draft"]);
    expect(add.code, add.out).toBe(0);
    expect(add.out).toContain("下一步 / next: flowgit status");
    const prompt = path.join(reportDir, "prompts", "polish.md");
    expect(fs.existsSync(prompt)).toBe(true);
    expect(fs.readFileSync(prompt, "utf8")).toContain("{{inputs.name}}");
    expect(report(["validate"]).code).toBe(0);

    const saved = JSON.parse(fs.readFileSync(path.join(reportDir, "flow.json"), "utf8")) as {
      stages: { id: string; inputs?: string[] }[];
    };
    expect(saved.stages.map((s) => s.id)).toEqual(["notes", "draft", "polish", "check"]);
    expect(saved.stages[2]?.inputs).toEqual(["draft"]);
    expect(Object.keys(saved.stages[0] ?? {})).toEqual(["id", "name", "description", "executor", "outputs"]);

    const refused = report(["stage", "rm", "draft"]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("polish");
    expect(refused.out).toContain("check");
    expect(fs.existsSync(prompt)).toBe(true);

    fs.writeFileSync(prompt, "KEEP\n");
    const again = report(["stage", "rm", "polish"]);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("runs/ 也留着");
    expect(fs.readFileSync(prompt, "utf8")).toBe("KEEP\n");
    const readd = report(["stage", "add", "polish", "--type", "llm", "--after", "draft"]);
    expect(readd.code, readd.out).toBe(0);
    expect(readd.out).toContain("没有覆盖");
    expect(fs.readFileSync(prompt, "utf8")).toBe("KEEP\n");
    expect(report(["validate"]).code).toBe(0);
  });
});

describe("flow.md", () => {
  let root: string;

  function inDir(dir: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-md-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("starts a flow as flow.md, runs it, edits it in place and converts it back", () => {
    const dir = path.join(root, "weekly");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "weekly-report", "--format", "md"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(dir, "flow.json"))).toBe(false);
    const md = fs.readFileSync(path.join(dir, "flow.md"), "utf8");
    expect(md).toContain("# 周报（入门示例）");
    expect(md).toContain("## 周报草稿 {#draft}");
    expect(md).toContain("```flowgit");

    expect(inDir(dir, ["validate"]).out).toContain("✓ flow.md 符合规范 / is valid");
    expect(inDir(dir, ["status"]).out).toContain("· flow.md v0.1 ·");
    expect(inDir(dir, ["inputs", "set", "name=小明"]).code).toBe(0);
    fs.writeFileSync(path.join(dir, "notes.md"), "- 修了登录 bug\n");
    const run = inDir(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies") });
    expect(run.code, run.out).toBe(0);

    const add = inDir(dir, ["stage", "add", "polish", "--type", "llm", "--after", "draft"]);
    expect(add.code, add.out).toBe(0);
    expect(fs.existsSync(path.join(dir, "flow.json"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "flow.md"), "utf8")).toContain("{#polish}");
    expect(inDir(dir, ["export-skill", "-o", "-"]).out).toContain("由 `flow.md` 自动生成");

    const back = inDir(dir, ["convert", "--to", "json"]);
    expect(back.code, back.out).toBe(0);
    expect(back.out).toContain("已把 flow.md 换成 flow.json / converted flow.md to flow.json");
    expect(fs.existsSync(path.join(dir, "flow.md"))).toBe(false);
    const flow = JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")) as { stages: { id: string }[] };
    expect(flow.stages.map((s) => s.id)).toEqual(["notes", "draft", "polish", "check"]);
    expect(inDir(dir, ["convert", "--to", "json"]).out).toContain("already flow.json");
    // Same flow, so converting does not make anything stale.
    expect(inDir(dir, ["status"]).out).not.toMatch(/check\s.*(stale|过期)/);
  });

  it("explains a broken flow.md and refuses both files at once", () => {
    const dir = path.join(root, "broken");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "flow.md"), "---\nformat: flowgit\nversion: \"0.1\"\nname: x\n---\n\n## A {#a}\n\n说明\n");
    const bad = inDir(dir, ["validate"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("needs a ```flowgit block");

    fs.writeFileSync(path.join(dir, "flow.json"), "{}");
    const both = inDir(dir, ["status"]);
    expect(both.code).toBe(1);
    expect(both.out).toContain("has both flow.json and flow.md");
    expect(inDir(dir, ["convert", "--to", "yaml"]).out).toContain("format must be json or md");
  });
});

describe("flowgit validate output schemas", () => {
  it("reports a schema on a non-JSON output and a missing schema file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-schema-cli-"));
    const flow = {
      format: "flowgit",
      version: "0.1",
      name: "bad schema",
      stages: [
        {
          id: "a",
          name: "A",
          executor: { type: "human" },
          outputs: [{ type: "text/plain", path: "a.txt", schema: "schemas/out.schema.json" }],
        },
        {
          id: "b",
          name: "B",
          executor: { type: "human" },
          outputs: [{ type: "application/json", path: "b.json", schema: "schemas/missing.schema.json" }],
        },
      ],
    };
    fs.mkdirSync(path.join(dir, "schemas"), { recursive: true });
    fs.writeFileSync(path.join(dir, "schemas", "out.schema.json"), JSON.stringify({ type: "object" }));
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow, null, 2));
    const r = spawnSync(process.execPath, [cli, "-C", dir, "validate"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    expect(r.status).toBe(1);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("only for JSON outputs");
    expect(out).toContain("schema file not found");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("job-application template", () => {
  let jobDir: string;

  function run(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", jobDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-job-"));
  });

  afterAll(() => {
    if (jobDir) fs.rmSync(jobDir, { recursive: true, force: true });
  });

  it("runs on demo replies and shows the analysis linked to both resume and letter", () => {
    const init = spawnSync(process.execPath, [cli, "init", jobDir, "-t", "job-application"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(run(["inputs", "set", "role=后端工程师"]).code).toBe(0);
    const ran = run(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(jobDir, "demo-replies") });
    expect(ran.code, ran.out).toBe(0);
    expect(fs.existsSync(path.join(jobDir, "check-report.md"))).toBe(true);
    expect(fs.readFileSync(path.join(jobDir, "check-report.md"), "utf8")).toContain("3/3");
    const graph = run(["graph"]);
    expect(graph.code, graph.out).toBe(0);
    expect(graph.out).toContain('s2["匹配分析<br/>llm"]');
    expect(graph.out).toContain('s3["简历<br/>llm"]');
    expect(graph.out).toContain('s4["求职信<br/>llm"]');
    expect(graph.out).toContain("s2 --> s3");
    expect(graph.out).toContain("s2 --> s4");
  });
});

describe("research-report template", () => {
  let researchDir: string;

  function run(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", researchDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    researchDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-research-"));
  });

  afterAll(() => {
    if (researchDir) fs.rmSync(researchDir, { recursive: true, force: true });
  });

  it("runs on demo replies and reports a source that was never cited", () => {
    const init = spawnSync(process.execPath, [cli, "init", researchDir, "-t", "research-report"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(run(["inputs", "set", "topic=为什么猫喜欢纸箱"]).code).toBe(0);
    const ran = run(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(researchDir, "demo-replies") });
    expect(ran.code, ran.out).toBe(0);
    const report = fs.readFileSync(path.join(researchDir, "check-report.md"), "utf8");
    expect(report).toContain("没被引用的来源");
    expect(report).toContain("shelter.md");
  });
});

describe("popular templates on demo replies", () => {
  let root: string;

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-popular-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function runIn(dir: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  // template, required inputs, files the run must produce, text the check report must contain
  const cases: [string, string[], string[], string][] = [
    ["ecommerce-listing", ["product=便携榨汁杯"], ["points.json", "titles.json", "detail.md", "faq.md", "check-report.md"], "资料里找不到的数字"],
    ["slides", ["topic=把周报做成流程"], ["slides.json", "slides.html", "notes.md", "check-report.md"], "最后一页是下一步"],
    ["live-selling", ["product=便携榨汁杯", "price=直播间 99 元"], ["rundown.json", "script.md", "qa.md", "check-report.md"], "网络直播营销管理办法"],
    ["short-drama", ["premise=面馆逆袭", "episodes=3", "paywallAt=3"], ["characters.json", "episodes.json", "script.md", "review.md", "check-report.md"], "付费卡点在第 3 集结尾"],
    ["lesson-plan", ["topic=分数的初步认识"], ["objectives.json", "assessment.json", "lesson-plan.md", "exercises.json", "worksheet.md", "answer-key.md", "check-report.md"], "没有评价任务的目标"],
  ];

  it.each(cases)("%s runs end to end", (template, inputs, files, expected) => {
    const dir = path.join(root, template);
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", template], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", ...inputs]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies") });
    expect(ran.code, ran.out).toBe(0);
    for (const file of files) expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    expect(fs.readFileSync(path.join(dir, "check-report.md"), "utf8")).toContain(expected);
  });

  it("the deck draws charts offline and the worksheet hides the answers", () => {
    const html = fs.readFileSync(path.join(root, "slides", "slides.html"), "utf8");
    expect(html).toContain("把周报做成流程");
    expect(html).toContain('class="chart"');
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href="http/);
    const worksheet = fs.readFileSync(path.join(root, "lesson-plan", "worksheet.md"), "utf8");
    const key = fs.readFileSync(path.join(root, "lesson-plan", "answer-key.md"), "utf8");
    expect(key).toContain("分母 5，分子 3");
    expect(worksheet).not.toContain("分母 5，分子 3");
    expect(worksheet).toContain("课后作业");
  });
});

describe("meeting-notes template", () => {
  let root: string;

  function runIn(dir: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-meeting-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs the Chinese sample and the check report matches", () => {
    const dir = path.join(root, "zh");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "meeting-notes"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "meeting=轻杯 Mini 产品周会", "date=2026-03-04", "attendees=林夏、周衡、沈予", "style=brief", "language=zh"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    const clean = fs.readFileSync(path.join(dir, "clean.md"), "utf8");
    expect(clean).toContain("来源：transcript/weekly-zh.srt");
    expect(clean).toContain("[0:20] 林夏：");
    expect(clean).toContain("出席的是我、周衡和沈予");
    expect(clean).not.toContain("[0:48]");
    expect(clean).not.toContain("-->");
    const minutes = fs.readFileSync(path.join(dir, "minutes.md"), "utf8");
    expect(minutes).toContain("[12:30]");
    expect(minutes).toContain("[7:30]");
    const actions = JSON.parse(fs.readFileSync(path.join(dir, "actions.json"), "utf8")) as { owner: string; due: string; source: string }[];
    expect(actions.map((item) => item.owner)).toEqual(["周衡", "林夏", "沈予"]);
    expect(actions.map((item) => item.due)).toEqual(["2026-03-11", "2026-03-11", "2026-03-09"]);
    expect(actions.map((item) => item.source)).toEqual(["8:50", "16:40", "22:15"]);
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("待办 3 条。");
    expect(report).toContain("周衡：交出下一版 380 克结构草图，只给下一版；做不到就写上实际估重（2026-03-11，出处 8:50）");
    expect(report).toContain("林夏：锁上架清单（标题、详情、7 天无理由退换、电机保修 1 年）并发到群里（2026-03-11，出处 16:40）");
    expect(report).toContain("沈予：写 5 条客服问答（重量、榨冰、充电、退换、保修），每条对应已有资料，不新增承诺（2026-03-09，出处 22:15）");
    expect(report).toContain("没有。");
    expect(report).toContain("检查通过。");
    expect(fs.readFileSync(path.join(dir, "follow-up.md"), "utf8")).toContain("完整转录不附在这封邮件里");
  });

  it("runs the English sample and the check report matches", () => {
    const dir = path.join(root, "en");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "meeting-notes"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "meeting=Lightcup Mini product weekly", "date=2026-03-04", "attendees=Lin Xia, Zhou Heng, Shen Yu", "style=brief", "language=en"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") });
    expect(ran.code, ran.out).toBe(0);
    const clean = fs.readFileSync(path.join(dir, "clean.md"), "utf8");
    expect(clean).toContain("Source: transcript/weekly-en.srt");
    expect(clean).toContain("[0:20] Lin Xia:");
    expect(clean).toContain("Here today: Lin Xia, Zhou Heng, and Shen Yu.");
    expect(clean).not.toContain("[0:48]");
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("3 action(s).");
    expect(report).toContain("Zhou Heng: Deliver the 380 gram structure sketch for the next version only, and write the real estimate if 380 grams is missed (2026-03-11, source 8:50)");
    expect(report).toContain("Lin Xia: Lock the launch list (title, detail page, 7-day returns, 1-year motor warranty) and send it to the group (2026-03-11, source 16:40)");
    expect(report).toContain("Shen Yu: Write 5 support answers (weight, ice, charging, returns, warranty) from facts already on record, with no new promises (2026-03-09, source 22:15)");
    expect(report).toContain("None.");
    expect(report).toContain("All checks passed.");
  });

  it("warns on a due date before the meeting and stops only on a format error", () => {
    const dir = path.join(root, "zh");
    const actionsPath = path.join(dir, "actions.json");
    const original = fs.readFileSync(actionsPath, "utf8");
    const actions = JSON.parse(original) as { due: string }[];
    actions[0].due = "2026-03-01";
    fs.writeFileSync(actionsPath, `${JSON.stringify(actions, null, 2)}\n`);
    const warned = runIn(dir, ["run", "check"]);
    expect(warned.code, warned.out).toBe(0);
    const warning = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(warning).toContain("2026-03-01 早于会议 2026-03-04");
    expect(warning).not.toContain("检查通过。");

    fs.writeFileSync(actionsPath, "{\"owner\":\"林夏\"}\n");
    const broken = runIn(dir, ["run", "check"]);
    expect(broken.code).not.toBe(0);
    const format = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(format).toContain("## 格式错误");
    expect(format).toContain("actions.json 必须是数组。");
  });
});

describe("flowgit share", () => {
  let root: string;
  let flowDir: string;
  let prompt: string;
  let originalPrompt: string;

  function run(args: string[]) {
    const r = spawnSync(process.execPath, [cli, "-C", flowDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-share-"));
    flowDir = path.join(root, "flow");
    const init = spawnSync(process.execPath, [cli, "init", flowDir, "-t", "weekly-report"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    prompt = path.join(flowDir, "prompts", "draft.md");
    originalPrompt = fs.readFileSync(prompt, "utf8");
    fs.mkdirSync(path.join(flowDir, "runs", "draft", "1"), { recursive: true });
    fs.writeFileSync(path.join(flowDir, "runs", "draft", "1", "run.json"), "{}\n");
    fs.writeFileSync(path.join(flowDir, "flowgit.local.json"), "{\"inputs\":{}}\n");
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses a fake key and writes an email-only copy without runs or local inputs", () => {
    const key = "sk-abcdefghijklmnopqrstuvwxyz";
    fs.writeFileSync(prompt, `${originalPrompt}\nkey ${key}\n`);
    const blocked = path.join(root, "blocked");
    const refused = run(["share", blocked]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("没有写入任何文件");
    expect(refused.out).toContain("sk-a…");
    expect(refused.out).not.toContain(key);
    expect(fs.existsSync(blocked)).toBe(false);

    fs.writeFileSync(prompt, `${originalPrompt}\nmail me at dev@example.com\n`);
    const shared = path.join(root, "shared");
    const ok = run(["share", shared]);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toContain("dev@…");
    expect(ok.out).toContain("请你自己看一眼");
    expect(fs.readFileSync(path.join(shared, "prompts", "draft.md"), "utf8")).toContain("dev@example.com");
    expect(fs.existsSync(path.join(shared, "runs"))).toBe(false);
    expect(fs.existsSync(path.join(shared, "flowgit.local.json"))).toBe(false);
    expect(ok.out).not.toContain("dev@example.com");
  });

  it("never copies a share folder inside the flow into itself, and refuses the flow folder", () => {
    fs.writeFileSync(prompt, originalPrompt);
    const dist = path.join(flowDir, "dist");
    expect(run(["share", dist]).code).toBe(0);
    const again = run(["share", dist, "--force"]);
    expect(again.code, again.out).toBe(0);
    expect(fs.existsSync(path.join(flowDir, "dist", "prompts", "draft.md"))).toBe(true);
    expect(fs.existsSync(path.join(flowDir, "dist", "dist"))).toBe(false);

    const self = run(["share", flowDir, "--force"]);
    expect(self.code).toBe(1);
    expect(self.out).toContain("can't be the flow directory itself");
  });
});
