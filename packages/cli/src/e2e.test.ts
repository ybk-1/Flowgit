import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
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
    env: { ...process.env, NO_COLOR: "1", FLOWGIT_TTS_API_KEY: "", FLOWGIT_TTS: "", ...env },
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
    expect(noKey.out).toContain("voice: 没有设置 FLOWGIT_TTS_API_KEY");
    expect(noKey.out).toContain("✓ voice, edit, export: 找到 / found node");

    const demo = flowgit(["doctor", "--json"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    const report = JSON.parse(demo.out);
    expect(report.ok).toBe(hasFfmpeg);
    expect(demo.code).toBe(hasFfmpeg ? 0 : 1);
    expect(report.checks).toContainEqual({ level: "ok", stage: "script", message: `用固定回复 / canned reply ${path.join("demo-replies", "script.md")}` });
    expect(report.checks).toContainEqual(
      expect.objectContaining({ level: "warn", stage: "voice", message: expect.stringContaining("FLOWGIT_TTS_API_KEY is not set") }),
    );
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
    expect(templates.map((t) => t.id)).toEqual(expect.arrayContaining(["weekly-report", "article", "support-sop", "job-application", "research-report", "ecommerce-listing", "slides", "live-selling", "short-drama", "lesson-plan", "novel-serial", "business-plan", "event-plan", "hiring", "travel-guide", "online-course", "landing-page", "social-posts", "data-report", "meeting-notes", "podcast", "picture-book", "product-launch", "micro-course"]));
    const listed = spawnSync(process.execPath, [cli, "templates"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    expect(listed.stdout).toMatch(/weekly-report\s+周报（入门示例）\s+随手记 human → 周报草稿 llm → 检查 script/);
    expect(listed.stdout).toMatch(/landing-page\s+落地页\s+简报 human → 结构 llm → 文案 llm → 照片 human → 生成 script → 检查 script/);

    const wrong = spawnSync(process.execPath, [cli, "init", path.join(work, "nope"), "-t", "no-such-template"], { encoding: "utf8" });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("bundled templates: short-video, article, business-plan, data-report, ecommerce-listing, event-plan, hiring, job-application, landing-page, lesson-plan, live-selling, meeting-notes, micro-course, novel-serial, online-course, picture-book, podcast, product-launch, research-report, short-drama, slides, social-posts, support-sop, travel-guide, weekly-report");
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
    expect(once.out).toContain("[script]");
    expect(once.out).toContain("[voice]");
    expect(once.out).toContain("[storyboard]");
    expect(once.out).toContain("save it before you continue: flowgit inputs set topic=为什么猫喜欢纸箱 duration=25");
    expect(flowgit(["inputs", "set", "topic=为什么猫喜欢纸箱", "duration=25"]).code).toBe(0);
    const r = flowgit(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(flowDir, "demo-replies") });
    expect(r.code).toBe(2);
    expect(r.out).toContain("waiting for you: assets");
    expect(r.out).not.toContain("--input lasts one run");
    expect(fs.existsSync(path.join(flowDir, "storyboard.json"))).toBe(true);
    expect(fs.readFileSync(path.join(flowDir, "voice", "README.md"), "utf8")).toBe(
      "没有配置语音合成，跳过自动配音；可以自己录 assets/voice.mp3，或设置 FLOWGIT_TTS_API_KEY / No text-to-speech configured, so no voiceover was made; record assets/voice.mp3 yourself or set FLOWGIT_TTS_API_KEY\n",
    );
    expect(fs.existsSync(path.join(flowDir, "voice", "voice.mp3"))).toBe(false);
    const status = JSON.parse(flowgit(["status", "--json"]).out);
    expect(status.stages.map((s: { id: string; state: string }) => [s.id, s.state])).toEqual([
      ["script", "ok"],
      ["voice", "ok"],
      ["storyboard", "ok"],
      ["assets", "never-run"],
      ["edit", "waiting-upstream"],
      ["export", "waiting-upstream"],
    ]);
  });

  it("draws the flow as a Mermaid diagram, colored by state", () => {
    const plain = flowgit(["graph"]);
    expect(plain.code).toBe(0);
    expect(plain.out).toMatch(/^flowchart LR\n {2}s1\["脚本<br\/>llm"\]/);
    expect(plain.out).toContain('s2["配音<br/>script"]');
    expect(plain.out).toContain("  s1 --> s2\n  s1 --> s3\n  s3 --> s4\n  s3 --> s5\n  s4 --> s5\n  s2 --> s5\n  s5 --> s6\n");
    const md = flowgit(["graph", "--status", "--md"]);
    expect(md.out.startsWith("```mermaid\nflowchart LR\n")).toBe(true);
    expect(md.out.trimEnd().endsWith("```")).toBe(true);
    expect(md.out).toContain('s4["素材<br/>human · ○ never-run"]');
    expect(md.out).toContain("  class s1,s2,s3 ok");
    expect(md.out).toContain("  class s5,s6 waitingUpstream");

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
    expect(forced.out).toContain("同时运行 / run together: voice, storyboard");
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
    expect(status.stages.map((s: { id: string; state: string }) => [s.id, s.state])).toEqual([
      ["script", "ok"],
      ["voice", "ok"],
      ["storyboard", "edited"],
      ["assets", "stale"],
      ["edit", "stale"],
      ["export", "stale"],
    ]);
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
    const env = {
      FLOWGIT_HOME: home,
      GLM_API_KEY: "secret-glm-key",
      MINE_KEY: "",
      ANTHROPIC_BASE_URL: "",
      OPENAI_API_KEY: "",
      ARK_API_KEY: "",
      DASHSCOPE_API_KEY: "",
    };
    const r = flowgit(["providers"], env);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/glm\s+anthropic\s+https:\/\/open\.bigmodel\.cn\/api\/anthropic\s+GLM_API_KEY ✓ 已设置 set/);
    expect(r.out).toMatch(/mine\s+openai\s+http:\/\/127\.0\.0\.1:1\/v1\s+MINE_KEY ✗ 未设置 not set\s+全局 global/);
    expect(r.out).not.toContain("secret-glm-key");
    const json = JSON.parse(flowgit(["providers", "--json"], env).out);
    expect(json.providers.find((p: { id: string }) => p.id === "ollama")).toMatchObject({ key: "none", baseUrl: "http://localhost:11434/v1" });
    expect(JSON.stringify(json)).not.toContain("secret-glm-key");
    expect(r.out).toContain("生图 / Image");
    expect(r.out).toMatch(/zhipu\s+cogview-4\s+https:\/\/open\.bigmodel\.cn\/api\/paas\/v4\s+GLM_API_KEY ✓ 已设置 set/);
    expect(r.out).toMatch(/volcengine\s+doubao-seedream-5-0-pro-260628\s+https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3\s+ARK_API_KEY ✗ 未设置 not set/);
    const image = json.imageProviders.find((p: { id: string }) => p.id === "dashscope");
    expect(image).toMatchObject({ exampleModel: "wan2.6-t2i", apiKeyEnv: "DASHSCOPE_API_KEY", key: "unset" });

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

  it("says in status which version the files are after a restore", () => {
    // v1 and v3 are the demo reply, v2 is the hand edit kept before the re-run
    const restored = flowgitDiff(["restore", "storyboard", "2"]);
    expect(restored.code, restored.out).toBe(0);
    const board = flowgitDiff(["status"]);
    expect(board.code, board.out).toBe(0);
    expect(board.out).toMatch(/storyboard\s.*v2（回退 \/ restored） \/3/);
    const json = JSON.parse(flowgitDiff(["status", "--json"]).out) as { stages: { id: string; latest: { n: number } | null; current: number | null }[] };
    expect(json.stages.find((stage) => stage.id === "storyboard")).toMatchObject({ current: 2, latest: { n: 3 } });

    // back on the newest version (v3, the same files as v1): the plain form again
    expect(flowgitDiff(["restore", "storyboard", "3"]).code).toBe(0);
    const plain = flowgitDiff(["status"]);
    expect(plain.out).toMatch(/storyboard\s.*v3 \/3/);
    expect(plain.out).not.toContain("restored");
  });
});

describe("flowgit init from a directory or a Git URL", () => {
  const hasGit = spawnSync("git", ["--version"]).status === 0;
  // git init, commit and clone plus several CLI starts: a slow Windows runner once took 36s for the clone test alone.
  const GIT_TEST_TIMEOUT = 120_000;
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

  /** The source flow as a local Git repository, made once. */
  let gitRepo: { url: string; commit: string } | undefined;
  function makeGitRepo(): { url: string; commit: string } {
    if (gitRepo) return gitRepo;
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
    gitRepo = { url: pathToFileURL(repo).href, commit };
    return gitRepo;
  }

  it.skipIf(!hasGit)("records forkedFrom.commit when init clones a file:// repository", () => {
    const { url, commit } = makeGitRepo();
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
  }, GIT_TEST_TIMEOUT);

  it.skipIf(!hasGit)("asks once before the first run of a flow cloned from a Git URL, and again only when its commands change", () => {
    const { url } = makeGitRepo();
    const home = path.join(root, "trust-home");
    const env = { FLOWGIT_HOME: home };
    const flowgit = (args: string[]) => {
      // spawnSync has no terminal, so nothing can be asked: the run stops and says how to confirm
      const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env } });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };
    const dest = path.join(root, "trusted-copy");
    const cloned = flowgit(["init", dest, "-t", url]);
    expect(cloned.code, cloned.out).toBe(0);
    expect(cloned.out).toContain("the first run asks you to confirm these; or run flowgit trust first");
    const notes = path.join(root, "my-notes.md");
    fs.writeFileSync(notes, "- shipped the board\n");

    const refused = flowgit(["-C", dest, "run", "notes", "--from", notes]);
    expect(refused.code, refused.out).toBe(1);
    expect(refused.out).toContain(`This flow was copied from ${url} and does this on your computer:`);
    expect(refused.out).toMatch(/script\s+check\s+node scripts\/check-report\.mjs/);
    expect(refused.out).toContain("run flowgit trust to see what it does on your computer and confirm");
    expect(refused.out).toContain("or add --yes to run to confirm and run");
    expect(fs.existsSync(path.join(dest, "notes.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "runs"))).toBe(false);

    const doctor = flowgit(["-C", dest, "doctor"]);
    expect(doctor.out).toContain("what it does hasn't been confirmed yet");

    const trusted = flowgit(["-C", dest, "trust"]);
    expect(trusted.code, trusted.out).toBe(0);
    expect(trusted.out).toMatch(/script\s+check\s+node scripts\/check-report\.mjs/);
    expect(trusted.out).toContain("You won't be asked again unless the commands change.");
    // remembered under FLOWGIT_HOME, not in the flow
    expect(fs.existsSync(path.join(home, "trusted.json"))).toBe(true);
    expect(fs.readdirSync(dest)).not.toContain("trusted.json");
    expect(flowgit(["-C", dest, "trust"]).out).toContain("Already confirmed; the commands haven't changed.");

    const named = flowgit(["-C", dest, "inputs", "set", "name=Cyrus"]);
    expect(named.code, named.out).toBe(0);
    const ran = flowgit(["-C", dest, "run", "notes", "--from", notes]);
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).not.toContain("copied from");
    expect(fs.readFileSync(path.join(dest, "notes.md"), "utf8")).toBe("- shipped the board\n");

    // a changed command is asked about again; --yes confirms it without a prompt
    const flowFile = path.join(dest, "flow.json");
    const flow = JSON.parse(fs.readFileSync(flowFile, "utf8")) as { stages: Array<{ id: string; executor: { run?: string } }> };
    const check = flow.stages.find((stage) => stage.id === "check");
    if (!check) throw new Error("weekly-report has a check stage");
    check.executor.run = "node scripts/check-report.mjs --strict";
    fs.writeFileSync(flowFile, `${JSON.stringify(flow, null, 2)}\n`);
    const again = flowgit(["-C", dest, "run", "notes", "--from", notes]);
    expect(again.code, again.out).toBe(1);
    expect(again.out).toContain("This flow's commands changed since you confirmed them.");
    expect(again.out).toContain("node scripts/check-report.mjs --strict");
    const yes = flowgit(["-C", dest, "run", "notes", "--from", notes, "--yes"]);
    expect(yes.code, yes.out).toBe(0);
    expect(yes.out).toContain("You won't be asked again unless the commands change.");
  }, GIT_TEST_TIMEOUT);

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
    ["novel-serial", ["premise=好感度眼镜", "chapterWords=160"], ["setting.json", "outline.json", "chapters.md", "check-report.md"], "第 4–6 章连续 3 章没有爽点"],
    ["business-plan", ["company=店小算"], ["market.json", "financials.json", "business-plan.md", "check-report.md"], "LTV:CAC = 4.44，回本 7.50 个月"],
    ["event-plan", ["event=咖啡馆五周年市集", "attendees=1200", "audience=public"], ["brief.json", "runsheet.json", "budget.json", "risks.json", "proposal.md", "check-report.md"], "属于大型群众性活动"],
    ["hiring", ["role=社群运营", "company=转角咖啡"], ["competencies.json", "job-ad.md", "interview.json", "scorecard.md", "check-report.md"], "行为题占一半以上"],
    ["travel-guide", ["destination=泉州"], ["places.json", "itinerary.json", "guide.md", "check-report.md"], "每人预算合计 1300，在 3000 以内"],
    ["online-course", ["topic=用表格做个人记账", "lessons=4"], ["analysis.json", "outline.json", "lesson-1.md", "course-page.md", "check-report.md"], "用条件格式标出超支」8 分钟"],
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

describe("landing-page template", () => {
  let pageDir: string;

  function run(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", pageDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    pageDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-landing-"));
  });

  afterAll(() => {
    if (pageDir) fs.rmSync(pageDir, { recursive: true, force: true });
  });

  it("builds a site from demo replies and escapes a heading", () => {
    const init = spawnSync(process.execPath, [cli, "init", pageDir, "-t", "landing-page"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(run(["inputs", "set", "product=箱栖", "audience=养猫的人", "goal=留下邮箱"]).code).toBe(0);
    const ran = run(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(pageDir, "demo-replies") });
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("5 个区块，0 张图片，5 个色块");

    const htmlPath = path.join(pageDir, "site", "index.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, "utf8");
    const copy = JSON.parse(fs.readFileSync(path.join(pageDir, "copy.json"), "utf8")) as { blocks: Record<string, { heading?: string }> };
    for (const block of Object.values(copy.blocks)) {
      if (block.heading) expect(html).toContain(block.heading);
    }
    expect(html).toContain('<html lang="zh-Hans">');
    expect(html).toContain("<title>箱栖：一块纸板，折一下就是猫窝</title>");
    expect(html).toContain('<meta name="description" content="箱栖是一块瓦楞纸');
    expect(html).toContain('name="viewport"');
    // a labelled email field with autocomplete, marked required, tied to the notice under it
    expect(html).toContain('<label for="f-email">邮箱<span class="req">（必填）</span></label>');
    expect(html).toContain('<input id="f-email" type="email" autocomplete="email" required aria-describedby="form-note">');
    expect(html).toContain('<p id="form-note" class="note">邮箱由箱栖工作室（hello@boxnest.example）收集');
    expect(html).not.toMatch(/\bchecked\b/);
    // the placeholder form sends nothing: its input has no name
    expect(html).not.toMatch(/<input[^>]*\bname=/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']\s*https?:/i);
    const css = fs.readFileSync(path.join(pageDir, "site", "style.css"), "utf8");
    expect(css).toMatch(/max-width:\s*40rem/);
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("--field-line: #78716c;");
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/url\s*\(/);
    const report = fs.readFileSync(path.join(pageDir, "check-report.md"), "utf8");
    expect(report).toContain("没有必须修的问题；上线前确认 2 项。");
    expect(report).toContain("| 必须修 | 缺少替代文本的图片 | WCAG 1.1.1 | 通过 |");
    expect(report).toContain("| 必须修 | 颜色对比度不够 | WCAG 1.4.3, 1.4.11 | 通过 |");
    expect(report).toContain("| 上线前确认 | 推荐语 |");
    expect(report).toContain("### 隐私政策链接");
    expect(report).toContain("还没有图片，页面上显示的是「图片待补」：hero.jpg、features.jpg、testimonial.jpg、faq.jpg、cta.jpg");

    const en = run(["run", "check", "--input", "language=en"]);
    expect(en.code, en.out).toBe(0);
    expect(fs.readFileSync(path.join(pageDir, "check-report.md"), "utf8")).toContain("Nothing to fix; 2 to confirm before going live.");

    // a privacy policy link goes in the notice; anything but http(s) is ignored
    const linked = run(["run", "build", "--input", "privacyUrl=https://boxnest.example/privacy?a=1&b=2"]);
    expect(linked.code, linked.out).toBe(0);
    expect(fs.readFileSync(htmlPath, "utf8")).toContain('我们马上删除。<a href="https://boxnest.example/privacy?a=1&amp;b=2" rel="privacy-policy">隐私政策</a></p>');
    const sneaky = run(["run", "build", "--input", "privacyUrl=javascript:alert(1)"]);
    expect(sneaky.code, sneaky.out).toBe(0);
    expect(sneaky.out).toContain("privacyUrl 不是 http(s) 链接，已忽略");
    expect(fs.readFileSync(htmlPath, "utf8")).not.toContain("javascript:");

    // photos: an unreadable file gets no size, a PNG and a rotated JPEG get theirs
    fs.writeFileSync(path.join(pageDir, "images", "hero.jpg"), "not-a-real-jpeg");
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(1200, 16);
    png.writeUInt32BE(800, 20);
    fs.writeFileSync(path.join(pageDir, "images", "features.jpg"), png);
    const exif = Buffer.concat([
      Buffer.from("Exif\0\0", "latin1"),
      Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]), // big-endian TIFF, first IFD at 8
      Buffer.from([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00]), // orientation 6
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, exif.length + 2]), exif]);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, ...new Array(9).fill(0)]); // 400 x 300
    fs.writeFileSync(path.join(pageDir, "images", "cta.jpg"), Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]));
    const withPhoto = run(["run", "build"]);
    expect(withPhoto.code, withPhoto.out).toBe(0);
    expect(withPhoto.out).toContain("3 张图片，2 个色块");
    const htmlPhoto = fs.readFileSync(htmlPath, "utf8");
    expect(htmlPhoto).toContain('<img src="images/hero.jpg" alt="一只猫钻进折好的纸板窝，只露出头" fetchpriority="high">');
    expect(htmlPhoto).toContain('<img src="images/features.jpg" alt="一块摊开的纸板和一个折好的猫窝并排放着" width="1200" height="800" loading="lazy">');
    expect(htmlPhoto).toContain('<img src="images/cta.jpg" alt="折好的纸板窝放在沙发旁边" width="300" height="400" loading="lazy">');
    expect(fs.readFileSync(path.join(pageDir, "site", "images", "hero.jpg"), "utf8")).toBe("not-a-real-jpeg");
    const checked = run(["run", "check"]);
    expect(checked.code, checked.out).toBe(0);
    expect(fs.readFileSync(path.join(pageDir, "check-report.md"), "utf8")).toContain("images/hero.jpg：没写 width 和 height，图片加载时页面会跳");

    const edited = JSON.parse(fs.readFileSync(path.join(pageDir, "copy.json"), "utf8")) as { blocks: { hero: { heading: string } } };
    edited.blocks.hero.heading = "Hello <script>alert(1)</script>";
    fs.writeFileSync(path.join(pageDir, "copy.json"), `${JSON.stringify(edited, null, 2)}\n`);
    const rebuilt = run(["run", "build"]);
    expect(rebuilt.code, rebuilt.out).toBe(0);
    const html2 = fs.readFileSync(htmlPath, "utf8");
    expect(html2).toContain("Hello &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html2).not.toContain("<script>");
  });

  it("reports missing alt, empty links, skipped headings, long copy, and blocks left off the page", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-landing-check-"));
    fs.mkdirSync(path.join(root, "site"));
    fs.writeFileSync(
      path.join(root, "site", "index.html"),
      '<!DOCTYPE html><html><body>\n<h1>Hi</h1>\n<h3>Skipped</h3>\n<img src="images/a.jpg">\n<a href="">x</a>\n<section data-block="hero"><h1>Hi</h1></section>\n</body></html>\n',
    );
    fs.writeFileSync(
      path.join(root, "copy.json"),
      JSON.stringify({
        blocks: {
          hero: { heading: "Hi", body: "short", button: "Go" },
          gone: { heading: "Missing heading", body: "x".repeat(501), button: "" },
        },
      }),
    );
    const script = path.join(here, "..", "templates", "landing-page", "scripts", "check.mjs");
    const r = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        FLOWGIT_PROJECT_DIR: root,
        FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "zh" }),
        FLOWGIT_OUTPUTS: JSON.stringify([{ path: "check-report.md" }]),
      },
    });
    expect(r.status).toBe(1);
    const report = fs.readFileSync(path.join(root, "check-report.md"), "utf8");
    expect(report).toContain("images/a.jpg");
    expect(report).toContain('href=""');
    expect(report).toContain("h1 之后是 h3");
    expect(report).toContain("gone：正文 501 字（上限 500）");
    expect(report).toContain("文案里有、页面上没有的区块");
    expect(report).toContain("- gone");
    expect(report).not.toContain("没有问题。");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("fails on form, consent and contrast problems and warns about wording the brief does not back", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-landing-form-"));
    fs.mkdirSync(path.join(root, "site"));
    fs.writeFileSync(
      path.join(root, "site", "index.html"),
      [
        '<!DOCTYPE html><html lang="en"><head><title>Join</title></head><body>',
        '<section id="cta" data-block="cta"><h1>Join the list</h1>',
        '<form action="#cta"><input id="mail" type="email" placeholder="Email">',
        '<input id="news" type="checkbox" checked><label for="news">Send me news</label>',
        '<button type="submit">Submit</button></form></section>',
        '<section data-block="testimonial"><h2>What people say</h2></section>',
        '<a href="https://elsewhere.example/">Learn more</a>',
        "</body></html>",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(root, "site", "style.css"), ":root { --bg: #ffffff; --text: #999999; --card: #ffffff; --field-line: #eeeeee; }\n");
    fs.writeFileSync(
      path.join(root, "copy.json"),
      JSON.stringify({
        blocks: {
          cta: { heading: "Join the list", body: "Limited time: the best bed, only 3 left. No countdown here. To add: who we are", button: "Submit" },
          testimonial: { heading: "What people say", body: '"Best bed ever, my cat loves it" - Anna', button: "" },
        },
      }),
    );
    fs.writeFileSync(path.join(root, "brief.md"), '# Bed\n\n## Proof\n\nNo quotes yet.\n\n## Do not say\n\n- Never say "vet recommended" or "limited time".\n');
    const script = path.join(here, "..", "templates", "landing-page", "scripts", "check.mjs");
    const r = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        FLOWGIT_PROJECT_DIR: root,
        FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "en" }),
        FLOWGIT_OUTPUTS: JSON.stringify([{ path: "check-report.md" }]),
      },
    });
    expect(r.status).toBe(1);
    const report = fs.readFileSync(path.join(root, "check-report.md"), "utf8");
    const must = report.slice(report.indexOf("## Must fix"), report.indexOf("## Confirm before going live"));
    const confirm = report.slice(report.indexOf("## Confirm before going live"), report.indexOf("## What was checked"));
    expect(must).toContain("### Inputs without a label (WCAG 1.3.1, 3.3.2)\n\n- #mail");
    expect(must).toContain('#mail: type="email" needs autocomplete="email"');
    expect(must).toContain("### Pre-ticked boxes (CJEU C-673/17 Planet49; GDPR recital 32)\n\n- Send me news");
    expect(must).toContain("### Fields without a notice at collection");
    expect(must).toContain("cta.body: Limited time");
    expect(must).toContain("Light: --text (#999999) on --bg (#ffffff) is 2.85:1; it needs at least 4.5:1");
    expect(must).toContain("Light: --field-line (#eeeeee) on --card (#ffffff) is 1.16:1; it needs at least 3:1");
    expect(confirm).toContain("There is no privacy policy link near the form.");
    expect(confirm).toContain('"Submit": say the action and what happens');
    expect(confirm).toContain('"Learn more": say the action and what happens');
    expect(confirm).toContain("Learn more → https://elsewhere.example/");
    expect(confirm).toContain('"limited time": the brief states no real deadline or stock');
    expect(confirm).toContain('"limited time": the brief says not to say this');
    expect(confirm).toContain('"the best": remove it unless you can prove it');
    expect(confirm).toContain('"Best bed ever, my cat loves it" is not in the brief.');
    expect(confirm).toContain("3: not in the brief; verify before going live");
    // "No countdown" is not urgency, and the copy never mentions a vet
    expect(confirm).not.toContain('"countdown"');
    expect(confirm).not.toContain("vet recommended");
    expect(report).toContain("| Must fix | Low color contrast | WCAG 1.4.3, 1.4.11 | 4 |");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("fails a page whose lang does not match its text", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-landing-lang-"));
    fs.mkdirSync(path.join(root, "site"));
    const zh = "一块纸板，折一下就是猫窝。沿压痕折好就能让猫钻进去，不用工具，也没有塑料零件。现在还不能下单。";
    fs.writeFileSync(path.join(root, "site", "index.html"), `<!DOCTYPE html><html lang="en"><head><title>BoxNest</title></head><body>\n<section data-block="hero"><h1>箱栖</h1><p>${zh}</p></section>\n</body></html>\n`);
    fs.writeFileSync(path.join(root, "copy.json"), JSON.stringify({ blocks: { hero: { heading: "箱栖", body: zh, button: "" } } }));
    const script = path.join(here, "..", "templates", "landing-page", "scripts", "check.mjs");
    const r = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        FLOWGIT_PROJECT_DIR: root,
        FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "en" }),
        FLOWGIT_OUTPUTS: JSON.stringify([{ path: "check-report.md" }]),
      },
    });
    expect(r.status).toBe(1);
    expect(fs.readFileSync(path.join(root, "check-report.md"), "utf8")).toContain('The page says lang="en" but most of its text is Chinese');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("social-posts template", () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-social-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs in Chinese and the check report names the sample warnings", () => {
    const dir = path.join(root, "zh");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "social-posts"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "topic=南风文具社的周末写信会", "language=zh"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("微博: 最佳");
    expect(report).toContain("多于 2 个");
    expect(report).toContain("标题 7/20");
    expect(report).not.toContain("格式错误");
    const exported = fs.readFileSync(path.join(dir, "posts.md"), "utf8");
    expect(exported).toContain("## 小红书");
    expect(exported).toContain("桌角的灯还亮着");
    expect(exported).toContain("## 微博");
    expect(exported).toContain("## X");
  });

  it("runs in English and the check report names the sample warning", () => {
    const dir = path.join(root, "en");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "social-posts"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "topic=a weekend letter at South Wind Stationery", "language=en"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") });
    expect(ran.code, ran.out).toBe(0);
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("X: best");
    expect(report).toContain("weighted 108/280");
    expect(report).toContain("title 18/20");
    expect(report).not.toContain("Format error");
    const exported = fs.readFileSync(path.join(dir, "posts.md"), "utf8");
    expect(exported).toContain("## Xiaohongshu");
    expect(exported).toContain("Desk lamp still on");
    expect(exported).toContain("## Weibo");
    expect(exported).toContain("## X");
  });
});

describe("data-report template", () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-data-report-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function init(dir: string, inputs: string[]) {
    const created = spawnSync(process.execPath, [cli, "init", dir, "-t", "data-report"], { encoding: "utf8" });
    expect(created.status, `${created.stdout}${created.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", ...inputs]).code).toBe(0);
  }

  it("runs in Chinese on the canned replies and the check matches", () => {
    const dir = path.join(root, "zh");
    init(dir, ["question=哪个类目和地区的销售额最高，下一步该补货还是促销？"]);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    for (const file of ["profile.json", "charts.json", "aggregates.json", "analysis.md", "report.md", "report.html", "check-report.md", "charts/category-amount.svg"]) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
    const profile = JSON.parse(fs.readFileSync(path.join(dir, "profile.json"), "utf8")) as { rowCount: number; columns: { name: string; missing: number; mean: number; median: number }[] };
    expect(profile.rowCount).toBe(208);
    const amount = profile.columns.find((col) => col.name === "amount");
    expect(amount).toMatchObject({ missing: 3, mean: 623.53, median: 543 });
    const aggregates = JSON.parse(fs.readFileSync(path.join(dir, "aggregates.json"), "utf8")) as { charts: { id: string; points: { x: string; y: number }[] }[] };
    expect(aggregates.charts.map((chart) => chart.id)).toEqual(["category-amount", "category-quantity", "region-amount", "weekly-amount", "category-median", "east-category"]);
    expect(aggregates.charts[0]?.points[0]).toEqual({ x: "茶饮", y: 52860 });
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("## 对不上的数字\n\n没有。");
    expect(check).toContain("## 没被引用的图\n\n没有。");
    expect(check).toContain("## 开头不是结论\n\n没有。");
    const html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("哪个类目和地区的销售额最高");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href="http/);
    const svg = fs.readFileSync(path.join(dir, "charts", "category-amount.svg"), "utf8");
    expect(svg).toContain("52860");
    expect(svg).toContain("prefers-color-scheme: dark");

    fs.appendFileSync(path.join(dir, "analysis.md"), "\n多出来的数 999999。\n");
    const warned = runIn(dir, ["run", "report"]);
    expect(warned.code, warned.out).toBe(0);
    const again = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(again).toContain("- 999999");
    expect(again).not.toContain("## 对不上的数字\n\n没有。");

    fs.writeFileSync(path.join(dir, "analysis.md"), "\n");
    const broken = runIn(dir, ["run", "report"]);
    expect(broken.code).toBe(1);
    expect(broken.out).toContain("analysis.md 是空的");
  });

  it("runs in English on the canned replies and the check matches", () => {
    const dir = path.join(root, "en");
    init(dir, [
      "question=Which category and region brought in the most revenue, and should we restock or run a discount?",
      "audience=regional sales managers",
      "language=en",
    ]);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") });
    expect(ran.code, ran.out).toBe(0);
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("## Numbers that do not match\n\nNone.");
    expect(check).toContain("## Charts the analysis never cites\n\nNone.");
    expect(check).toContain("## Answer is not first\n\nNone.");
    const report = fs.readFileSync(path.join(dir, "report.md"), "utf8");
    expect(report).toContain("52860");
    expect(report).toContain("For: regional sales managers");
    const html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
    expect(html).toContain('lang="en"');
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href="http/);
  });

  it("reads any CSV: another file name, Chinese headers, GBK bytes from Excel", () => {
    const dir = path.join(root, "any");
    init(dir, ["question=哪个门店的金额最高？", "audience=店长"]);
    fs.rmSync(path.join(dir, "data", "sales.csv"));
    // GBK bytes, as Excel on Chinese Windows saves a CSV by default.
    const gbk: Record<string, number[]> = { 日: [0xc8, 0xd5], 期: [0xc6, 0xda], 门: [0xc3, 0xc5], 店: [0xb5, 0xea], 金: [0xbd, 0xf0], 额: [0xb6, 0xee], 东: [0xb6, 0xab], 西: [0xce, 0xf7], 区: [0xc7, 0xf8] };
    const toGbk = (text: string) => Buffer.from([...text].flatMap((ch) => gbk[ch] ?? [...Buffer.from(ch)]));
    const table = ["日期,门店,金额", "2025-01-06,东区,120", "2025-01-06,西区,80", "2025-01-13,东区,150", "2025-01-13,西区,", "2025-01-20,东区,90", "2025-01-20,西区,110", ""].join("\r\n");
    fs.writeFileSync(path.join(dir, "data", "stores.csv"), toGbk(table));

    const mock = path.join(root, "any-mock");
    fs.mkdirSync(mock, { recursive: true });
    const chart = (id: string, type: string, x: string, agg: string, filter: string, title: string) => ({ id, type, x, y: "金额", agg, filter, title });
    fs.writeFileSync(
      path.join(mock, "plan.json"),
      JSON.stringify({
        charts: [
          chart("store-sum", "bar", "门店", "sum", "", "比较各门店的金额合计。"),
          chart("big-orders", "bar", "门店", "sum", "金额>=100", "只看金额不低于 100 的单，比较各门店的合计。"),
          chart("weekly", "line", "日期", "sum", "", "看每周金额合计的变化。"),
          chart("store-median", "table", "门店", "median", "", "列出各门店金额的中位数。"),
        ],
      }),
    );
    fs.writeFileSync(
      path.join(mock, "analysis.md"),
      [
        "东区的金额合计是 360，高于西区的 190，先看东区。",
        "",
        "## 发生了什么",
        "",
        "- 按门店合计，东区是 360，西区是 190，见 charts/store-sum.svg。",
        "- 只看金额不低于 100 的单，东区是 270，西区是 110，见 charts/big-orders.svg。",
        "- 每周合计见 charts/weekly.svg，2025-01-13 是 150。",
        "- 中位数见 charts/store-median.svg，东区是 120，西区是 95。金额列缺失 1 个。",
        "",
        "## 可能的原因",
        "",
        "猜测：东区客流更多，没有检验过。",
        "",
        "## 建议",
        "",
        "店长先看东区的备货。",
        "",
      ].join("\n"),
    );
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: mock });
    expect(ran.code, ran.out).toBe(0);
    const profile = JSON.parse(fs.readFileSync(path.join(dir, "profile.json"), "utf8")) as { source: string; rowCount: number; dateRange: unknown; columns: { name: string; type: string }[] };
    expect(profile).toMatchObject({ source: "data/stores.csv", rowCount: 6, dateRange: { min: "2025-01-06", max: "2025-01-20" } });
    expect(profile.columns.map((col) => [col.name, col.type])).toEqual([["日期", "date"], ["门店", "string"], ["金额", "number"]]);
    const aggregates = JSON.parse(fs.readFileSync(path.join(dir, "aggregates.json"), "utf8")) as { charts: { id: string; skippedRows: number; points: { x: string; y: number }[] }[] };
    const byId = Object.fromEntries(aggregates.charts.map((c) => [c.id, c]));
    expect(byId["store-sum"]?.points).toEqual([{ x: "东区", y: 360 }, { x: "西区", y: 190 }]);
    expect(byId["store-sum"]?.skippedRows).toBe(1);
    expect(byId["big-orders"]?.points).toEqual([{ x: "东区", y: 270 }, { x: "西区", y: 110 }]);
    expect(byId["weekly"]?.points.map((p) => p.x)).toEqual(["2025-01-06", "2025-01-13", "2025-01-20"]);
    expect(byId["store-median"]?.points).toEqual([{ x: "东区", y: 120 }, { x: "西区", y: 95 }]);
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("## 对不上的数字\n\n没有。");
    expect(check).toContain("## 没被引用的图\n\n没有。");
    expect(fs.readFileSync(path.join(dir, "report.md"), "utf8")).toContain("数据来自 data/stores.csv，共 6 行。");
    const svg = fs.readFileSync(path.join(dir, "charts", "store-median.svg"), "utf8");
    expect(svg).toMatch(/<svg [^>]*width="\d+" height="\d+"/);

    // Two CSVs: the profile stops and names both.
    fs.writeFileSync(path.join(dir, "data", "extra.csv"), "a,b\n1,2\n");
    const two = runIn(dir, ["run", "profile"]);
    expect(two.code).toBe(1);
    expect(two.out).toContain("只留下要分析的那一个");
    fs.rmSync(path.join(dir, "data", "extra.csv"));

    // A sum over a text column is a spec error that says how to fix it.
    fs.writeFileSync(path.join(dir, "charts.json"), JSON.stringify({ charts: [{ ...chart("bad", "bar", "日期", "sum", "", "错的。"), y: "门店" }] }));
    const bad = runIn(dir, ["run", "charts"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("里没有数字");
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
    expect(actions.map((item) => item.owner)).toEqual(["周衡", "林夏", "沈予", "沈予"]);
    expect(actions.map((item) => item.due)).toEqual(["2026-03-11", "2026-03-11", "2026-03-09", ""]);
    expect(actions.map((item) => item.source)).toEqual(["8:50", "16:40", "22:15", "28:50"]);
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("待办 4 条。");
    expect(report).toContain("周衡：交出下一版 380 克结构草图，只给下一版；做不到就写上实际估重（2026-03-11，出处 8:50）");
    expect(report).toContain("林夏：锁上架清单（标题、详情、7 天无理由退换、电机保修 1 年）并发到群里（2026-03-11，出处 16:40）");
    expect(report).toContain("沈予：写 5 条客服问答（重量、榨冰、充电、退换、保修），每条对应已有资料，不新增承诺（2026-03-09，出处 22:15）");
    // the sample's last promise names no day: kept, and the check asks for a date
    expect(report).toContain("沈予：把问答草稿先发给林夏看一眼（日期待定，出处 28:50）");
    expect(report).toContain("#4 把问答草稿先发给林夏看一眼：会上没说什么时候做完，请补上日期。");
    expect(report).toContain("没有。");
    expect(report).toContain("有 1 处要看一下。");
    const followUp = fs.readFileSync(path.join(dir, "follow-up.md"), "utf8");
    expect(followUp).toContain("完整转录不附在这封邮件里");
    expect(followUp).toContain("日期待定");
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
    expect(report).toContain("4 actions.");
    expect(report).toContain("Zhou Heng: Deliver the 380 gram structure sketch for the next version only, and write the real estimate if 380 grams is missed (2026-03-11, source 8:50)");
    expect(report).toContain("Lin Xia: Lock the launch list (title, detail page, 7-day returns, 1-year motor warranty) and send it to the group (2026-03-11, source 16:40)");
    expect(report).toContain("Shen Yu: Write 5 support answers (weight, ice, charging, returns, warranty) from facts already on record, with no new promises (2026-03-09, source 22:15)");
    expect(report).toContain("Shen Yu: Send the draft answers to Lin Xia for a quick look (date TBD, source 28:50)");
    expect(report).toContain("#4 Send the draft answers to Lin Xia for a quick look: no date was named; add one.");
    expect(report).toContain("None.");
    expect(report).toContain("1 thing to look at.");
  });

  it("reads a GBK .txt with a name-and-time line above the words, and keeps an action nobody took", () => {
    const dir = path.join(root, "txt");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "meeting-notes"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    for (const name of fs.readdirSync(path.join(dir, "transcript"))) fs.rmSync(path.join(dir, "transcript", name));
    // GBK bytes, as many Windows tools save a .txt. "会议改到 10:30" ends with a time but is words, not a speaker line.
    const gbk: Record<string, number[]> = { 林: [0xc1, 0xd6], 夏: [0xcf, 0xc4], 先: [0xcf, 0xc8], 对: [0xb6, 0xd4], 上: [0xc9, 0xcf], 架: [0xbc, 0xdc], "。": [0xa1, 0xa3], 会: [0xbb, 0xe1], 议: [0xd2, 0xe9], 改: [0xb8, 0xc4], 到: [0xb5, 0xbd], 周: [0xd6, 0xdc], 衡: [0xba, 0xe2], 寄: [0xbc, 0xc4], 出: [0xb3, 0xf6], 个: [0xb8, 0xf6], 不: [0xb2, 0xbb], 材: [0xb2, 0xc4], 料: [0xc1, 0xcf] };
    const toGbk = (text: string) => Buffer.from([...text].flatMap((ch) => gbk[ch] ?? [...Buffer.from(ch)]));
    const transcript = ["林夏  00:00:20", "先对上架。", "会议改到 10:30", "", "周衡  00:01:10", "寄出 20 个。", "", "林夏  00:07:30", "不改材料。", ""].join("\r\n");
    fs.writeFileSync(path.join(dir, "transcript", "meeting.txt"), toGbk(transcript));
    const replies = path.join(root, "txt-replies");
    fs.mkdirSync(replies, { recursive: true });
    fs.writeFileSync(path.join(replies, "summary.md"), "# 周会\n\n## 议题\n\n### 材料\n- 决定：不改材料。[7:30]\n");
    fs.writeFileSync(
      path.join(replies, "actions.json"),
      `${JSON.stringify([{ owner: "", task: "问物流报价", due: "", source: "7:30" }, { owner: "周衡", task: "再寄 20 个试用", due: "2026-03-11", source: "1:10" }], null, 2)}\n`,
    );
    fs.writeFileSync(path.join(replies, "email.md"), "# 会后跟进：周会\n\n- 负责人待定：问物流报价。日期待定，请确认。\n");
    expect(runIn(dir, ["inputs", "set", "meeting=周会", "date=2026-03-04", "language=zh"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: replies });
    expect(ran.code, ran.out).toBe(0);
    const clean = fs.readFileSync(path.join(dir, "clean.md"), "utf8");
    expect(clean).toContain("[0:20] 林夏：先对上架。会议改到 10:30");
    expect(clean).toContain("[1:10] 周衡：寄出 20 个。");
    expect(clean).toContain("[7:30] 林夏：不改材料。");
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("（负责人待定）：问物流报价（日期待定，出处 7:30）");
    expect(report).toContain("#1 问物流报价：会上没人接下，请指定一个负责人。");
    expect(report).toContain("#1 问物流报价：会上没说什么时候做完，请补上日期。");
    // 周衡 is found inside the words, so no "not in the transcript" warning
    expect(report).toContain("## 负责人不在记录里\n没有。");
    expect(report).toContain("有 2 处要看一下。");
  });

  it("keeps a time in the words out of the speaker name and groups unlabeled subtitles by the minute", () => {
    const dir = path.join(root, "srt");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "meeting-notes"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    for (const name of fs.readdirSync(path.join(dir, "transcript"))) fs.rmSync(path.join(dir, "transcript", name));
    const cues = [
      ["00:00:01,000", "我们约在 10:30 开会"],
      ["00:00:20,000", "比例是 3:1"],
      ["00:01:05,000", "下一段从这里开始"],
    ];
    const srt = cues.map(([start, text], index) => `${index + 1}\n${start} --> 00:01:30,000\n${text}\n`).join("\n");
    fs.writeFileSync(path.join(dir, "transcript", "subs.srt"), srt);
    expect(runIn(dir, ["inputs", "set", "meeting=周会", "date=2026-03-04"]).code).toBe(0);
    expect(runIn(dir, ["run", "transcript"]).code).toBe(0);
    const ran = runIn(dir, ["run", "clean"]);
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("记录里没有发言人");
    const clean = fs.readFileSync(path.join(dir, "clean.md"), "utf8");
    expect(clean).toContain("[0:01] 我们约在 10:30 开会比例是 3:1");
    expect(clean).toContain("[1:05] 下一段从这里开始");
    expect(clean).not.toContain("我们约在 10：");
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

describe("podcast template", () => {
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-podcast-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs the Chinese sample: transcript with speakers, chapters on block starts, and the planted yes/no question", () => {
    const dir = path.join(root, "zh");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "podcast"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "show=开店手记", "host=陆遥", "topic=一家独立书店怎么靠会员和活动活下来", "guest=沈禾，半亩书店创始人", "sponsor=店小算", "language=zh"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    for (const file of ["plan.json", "script.md", "prep.md", "precheck-report.md", "transcript.md", "publish/transcript.vtt", "shownotes.md", "check-report.md"]) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
    const transcript = fs.readFileSync(path.join(dir, "transcript.md"), "utf8");
    expect(transcript).toContain("来源：recording/episode-zh.srt");
    expect(transcript).toContain("时长：30:40");
    expect(transcript).toContain("说话人：沈禾、陆遥");
    expect(transcript).toContain("章节上限：4 个（Apple 建议每小时不超过 6 个）");
    // one-minute blocks: the ad at 12:30 and the next question at 13:40 are separate blocks
    expect(transcript).toContain("[12:30] 陆遥：插一段广告。");
    expect(transcript).toContain("[13:40] 陆遥：回到书店。");
    const vtt = fs.readFileSync(path.join(dir, "publish", "transcript.vtt"), "utf8");
    expect(vtt.startsWith("WEBVTT\n\n00:00:00.500 --> 00:00:24.000\n<v 沈禾>我们试过一次全场五折。")).toBe(true);
    const precheck = fs.readFileSync(path.join(dir, "precheck-report.md"), "utf8");
    expect(precheck).toContain("分段 8 段，共 30 分钟（目标 30 分钟），对得上。");
    expect(precheck).toContain("- 会员会不会觉得 399 元贵？");
    expect(ran.out).toContain("有 1 处要看一下，见 precheck-report.md。");
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("时长 30:40（目标 30 分钟）。");
    expect(check).toContain("章节 4 个：00:00、06:40、13:40、21:30。");
    expect(check).toContain("recording/ 里没有成品音频，跳过响度检查。");
    expect(ran.out).toContain("检查通过。");
    // the guest's unsourced claim stays out of the show notes
    expect(fs.readFileSync(path.join(dir, "shownotes.md"), "utf8")).not.toContain("关了一半");
  });

  it("runs the English sample", () => {
    const dir = path.join(root, "en");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "podcast"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "show=Shop Notes", "host=Lu Yao", "topic=How an independent bookstore lives on members and events", "guest=Shen He, founder of Half Acre Books", "sponsor=ShopTally", "language=en"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") });
    expect(ran.code, ran.out).toBe(0);
    const transcript = fs.readFileSync(path.join(dir, "transcript.md"), "utf8");
    expect(transcript).toContain("Speakers: Shen He, Lu Yao");
    expect(transcript).toContain("Chapter limit: 4 (Apple suggests no more than six an hour)");
    expect(fs.readFileSync(path.join(dir, "publish", "transcript.vtt"), "utf8")).toContain("<v Lu Yao>A quick ad. This episode is sponsored by ShopTally");
    const precheck = fs.readFileSync(path.join(dir, "precheck-report.md"), "utf8");
    expect(precheck).toContain("8 segments, 30 minutes in all (target 30), matches.");
    expect(precheck).toContain("- Do members think 399 yuan is too much?");
    expect(ran.out).toContain("1 thing to look at; see precheck-report.md.");
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("4 chapters: 00:00, 06:40, 13:40, 21:30.");
    expect(ran.out).toContain("All checks passed.");
  });

  it("flags an ad that isn't disclosed first, too many talk segments, chapters off the transcript, and loud or quiet audio", () => {
    const dir = path.join(root, "zh");
    const script = path.join(dir, "script.md");
    fs.writeFileSync(script, fs.readFileSync(script, "utf8").replace("陆遥：插一段广告。本期节目由店小算赞助。", "陆遥：本期节目由店小算赞助，它是最好用的记账应用。"));
    // a fifth talk segment: more chapters than a 30-minute episode should have
    const planPath = path.join(dir, "plan.json");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    plan.segments[0].kind = "talk";
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const pre = runIn(dir, ["run", "precheck"]);
    expect(pre.code, pre.out).toBe(0);
    const precheck = fs.readFileSync(path.join(dir, "precheck-report.md"), "utf8");
    expect(precheck).toContain("- 第一句没有说明是广告：「本期节目由店小算赞助，它是最好用的记账应用。」");
    expect(precheck).toContain("## 广告里的绝对化用语（《广告法》第九条）\n- 最好");
    expect(precheck).toContain("- 访谈段（talk）有 5 个，目标 30 分钟最多 4 个：一个访谈段就是一个章节，Apple 建议每小时不超过 6 个章节");

    const notes = path.join(dir, "shownotes.md");
    fs.writeFileSync(notes, fs.readFileSync(notes, "utf8").replace("13:40 每周四的读书会", "12:00 每周四的读书会").replace(/21:30 重来会少做什么\r?\n/, ""));
    if (hasFfmpeg) {
      const tone = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-af", "volume=-12dB", path.join(dir, "recording", "episode.wav")]);
      expect(tone.status).toBe(0);
    }
    const checked = runIn(dir, ["run", "check"]);
    expect(checked.code, checked.out).toBe(0);
    const report = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(report).toContain("- 12:00 不是文字稿里任何一段的开头。");
    expect(report).toContain("章节 3 个：00:00、06:40、12:00。");
    if (hasFfmpeg) expect(report).toMatch(/- episode\.wav：响度 -\d+(?:\.\d+)? LUFS，Apple 建议 -16（±1）。/);
    expect(report).not.toContain("检查通过。");
  });
});

describe("picture-book template", () => {
  let root: string;

  function runIn(dir: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  /** A blank 1-bit grayscale PNG: real pixels, a few kilobytes on disk. */
  function blankPng(file: string, width: number, height: number) {
    const table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf: Buffer) => {
      let c = 0xffffffff;
      for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.length);
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(body));
      return Buffer.concat([head, body, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 1; // bit depth 1, colour type 0 (grayscale)
    const pixels = Buffer.alloc((1 + Math.ceil(width / 8)) * height);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(file, Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]));
  }

  /** The head of a baseline JPEG (SOI, APP0, SOF0, EOI): the check reads only the frame header. */
  function jpegHead(file: string, width: number, height: number) {
    const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]));
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-picture-book-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs the Chinese sample: spreads at 300 DPI with bleed, art notes only where there are no words, and the planted art note", () => {
    const dir = path.join(root, "zh");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "picture-book"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    for (const file of ["layout.md", "story.json", "storyboard.json", "manuscript.md", "art-brief.md", "dummy.html", "precheck-report.md", "book.html", "check-report.md"]) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
    const layout = fs.readFileSync(path.join(dir, "layout.md"), "utf8");
    expect(layout).toContain("单页 2588×2625 像素，跨页 5175×2625 像素");
    expect(layout).toContain("| 1 | [4, 5] | 跨页 | p04-05.png |");
    expect(layout).toContain("| 15 | [32] | 左页，最后一页 | p32.png |");
    const manuscript = fs.readFileSync(path.join(dir, "manuscript.md"), "utf8");
    expect(manuscript).toContain("32 页绘本 · 约 244 字 · 3-6 岁");
    // the two wordless spreads keep an art note in the manuscript; the others don't
    expect(manuscript.match(/（（插图：/g)).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, "art-brief.md"), "utf8")).toContain("文字和脸离裁切线至少 0.375 英寸（约 113 像素）");
    const precheck = fs.readFileSync(path.join(dir, "precheck-report.md"), "utf8");
    expect(precheck).toContain("15 个单元（绘本，32 页），和版式对得上。");
    expect(precheck).toContain("全书 244 字（上限 1000）。");
    expect(precheck).toContain("（插图说明只写字里没说的，Underdown）\n- 第 20–21 页");
    expect(ran.out).toContain("有 1 处要看一下，见 precheck-report.md。");
    expect(ran.out).toContain("排好了 book.html：16 张图里有 0 张。");
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("16 张图：有 0 张，缺 16 张。");
    expect(check).toContain("- 缺 16 张：cover.png、p04-05.png、");
    expect(check).not.toContain("AI 插图");
  });

  it("runs the English sample", () => {
    const dir = path.join(root, "en");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "picture-book"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "language=en"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") });
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("Wrote manuscript.md (186 words), art-brief.md and dummy.html: 15 units.");
    const manuscript = fs.readFileSync(path.join(dir, "manuscript.md"), "utf8");
    expect(manuscript).toContain("A 32-page picture book · 186 words · ages 3-6");
    expect(manuscript.match(/\(\(Art: /g)).toHaveLength(2);
    const precheck = fs.readFileSync(path.join(dir, "precheck-report.md"), "utf8");
    expect(precheck).toContain("15 units (picture book, 32 pages), matching the layout.");
    expect(precheck).toContain("186 words in all (limit 600).");
    expect(ran.out).toContain("1 thing to look at; see precheck-report.md.");
    expect(fs.readFileSync(path.join(dir, "check-report.md"), "utf8")).toContain("16 images: 0 in place, 16 missing.");
  });

  it("checks the art for print: pixels, proportions, formats, stray files and the AI art notes", () => {
    const dir = path.join(root, "zh");
    const art = path.join(dir, "art");
    blankPng(path.join(art, "cover.png"), 2588, 2625);
    blankPng(path.join(art, "p04-05.png"), 5175, 2625);
    blankPng(path.join(art, "p06-07.png"), 2048, 1024);
    jpegHead(path.join(art, "p08-09.jpg"), 5175, 2625);
    blankPng(path.join(art, "p10-11.png"), 2625, 2625);
    fs.writeFileSync(path.join(art, "p12-13.webp"), "RIFF");
    blankPng(path.join(art, "extra.png"), 10, 10);
    expect(runIn(dir, ["inputs", "set", "aiArt=true"]).code).toBe(0);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("排好了 book.html：16 张图里有 5 张。");
    expect(fs.readFileSync(path.join(dir, "book.html"), "utf8")).toContain('<img src="art/p08-09.jpg"');
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain("16 张图：有 5 张，缺 11 张。");
    expect(check).toContain("- 缺 11 张：p12-13.png、p14-15.png、");
    expect(check).toContain("- p06-07.png：2048×1024，要 5175×2625（现在只有约 117 DPI）");
    expect(check).toContain("- p10-11.png：2625×2625，要 5175×2625（现在只有约 152 DPI）");
    expect(check).toContain("## 比例不对\n- p10-11.png：宽高比 1.00，应该是 1.97（5175×2625），印的时候会被裁掉或留白\n");
    expect(check).toContain("## 模板认不了的格式（用 PNG 或 JPEG）\n- p12-13.webp\n");
    expect(check).toContain("## 对不上任何一页的文件\n- extra.png\n");
    expect(check).toContain("## AI 插图要做的标识和声明\n- KDP：");
    expect(check).toContain("《人工智能生成合成内容标识办法》第十条");
    expect(ran.out).toContain("有 6 处要看一下，见 check-report.md。另有 AI 插图的标识和声明要做，见报告。");
    // the art brief adds an image prompt for each picture when the art is AI-generated
    expect(fs.readFileSync(path.join(dir, "art-brief.md"), "utf8")).toContain("画图提示");
  });

  it("lays out a comic page by page and checks its balloons, speakers and page turns", () => {
    const dir = path.join(root, "comic");
    const init = spawnSync(process.execPath, [cli, "init", dir, "-t", "picture-book"], { encoding: "utf8" });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    expect(runIn(dir, ["inputs", "set", "format=comic", "pages=8", "age=8-12", "trim=6.625x10.25in"]).code).toBe(0);
    const mock = path.join(root, "comic-replies");
    fs.mkdirSync(mock);
    fs.copyFileSync(path.join(dir, "demo-replies", "zh", "story.json"), path.join(mock, "story.json"));
    const units = Array.from({ length: 8 }, (_, i) => {
      const page = i + 1;
      return {
        pages: [page],
        text: "",
        art: `第 ${page} 页：公园里，风很大。`,
        alt: `米粒在公园里追她的黄帽子（第 ${page} 页）。`,
        // a hook on every odd page but page 3
        turn: page % 2 === 1 && page !== 3 ? "帽子会落到哪儿？" : "",
        panels: [{ art: "米粒追着帽子跑，豆豆跟在后面。", lines: [{ kind: page % 3 === 1 ? "speech" : "thought", who: "米粒", text: page % 3 === 1 ? "呼——风一吹，帽子飞走了！" : "等等我！" }] }],
      };
    });
    units[0].panels[0].lines.unshift({ kind: "caption", who: "", text: "星期六，有风。" });
    units[4].panels.push({ art: "米粒对着帽子说话。", lines: [{ kind: "speech", who: "米粒", text: "帽子帽子你别跑了，我给你找一个风吹不到的地方，我们一起坐在这里晒太阳，等你干了我们再回家好不好？" }] });
    units[5].panels.push({ art: "远处有人在喊。", lines: [{ kind: "shout", who: "老师", text: "别爬树！" }] });
    const board = { format: "comic", cover: { art: "米粒伸手去够半空中的黄帽子。", alt: "小女孩伸手去抓被风吹起的黄帽子。" }, dedication: "", units };
    fs.writeFileSync(path.join(mock, "storyboard.json"), `${JSON.stringify(board, null, 2)}\n`);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: mock });
    expect(ran.code, ran.out).toBe(0);
    const layout = fs.readFileSync(path.join(dir, "layout.md"), "utf8");
    expect(layout).toContain("单页 2025×3150 像素");
    expect(layout).toContain("| 8 | [8] |");
    const manuscript = fs.readFileSync(path.join(dir, "manuscript.md"), "utf8");
    expect(manuscript).toContain("### 第 1 页（右页，1 格）");
    expect(manuscript).toContain("1. 旁白：星期六，有风。\n2. 米粒：呼——风一吹，帽子飞走了！");
    expect(manuscript).toContain("1. 米粒（心想）：等等我！");
    expect(manuscript).toContain("1. 老师（喊）：别爬树！");
    expect(manuscript).toContain("（翻页：帽子会落到哪儿？）");
    const precheck = fs.readFileSync(path.join(dir, "precheck-report.md"), "utf8");
    expect(precheck).toContain("8 个单元（漫画，8 页），和版式对得上。");
    expect(precheck).toContain("- 8 页：单独印成 KDP 平装书最少要 24 页");
    expect(precheck).toContain("## 没有翻页钩子\n- 第 3 页\n");
    expect(precheck).toContain("- 第 5 页第 2 格：一个框 44 字，超过 40");
    expect(precheck).toContain("- 第 6 页第 2 格：老师 不在故事的角色里");
    expect(precheck).toContain("## 重复句\n没有。");
    expect(precheck).not.toContain("## 字数");
    expect(fs.readFileSync(path.join(dir, "check-report.md"), "utf8")).toContain("9 张图：有 0 张，缺 9 张。");
  });
});

describe("product-launch template", () => {
  let root: string;
  const templates = path.join(here, "..", "templates");

  function runIn(dir: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FLOWGIT_HOME: path.join(root, "home"), ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  function init(dir: string, inputs: string[]) {
    const r = spawnSync(process.execPath, [cli, "init", dir, "-t", "product-launch"], { encoding: "utf8" });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const set = runIn(dir, ["inputs", "set", ...inputs]);
    expect(set.code, set.out).toBe(0);
  }

  /** Replaces each `from` once in a flow file, failing loudly when the sample changed. */
  function plant(file: string, pairs: [string, string][]) {
    // a Windows checkout gives the demo replies, and so the outputs, CRLF line endings
    let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const [from, to] of pairs) {
      expect(text.includes(from), `${path.basename(file)}: ${from}`).toBe(true);
      text = text.replace(from, to);
    }
    fs.writeFileSync(file, text);
  }

  function editPosts(dir: string, edit: (posts: { productHunt: Record<string, string>; x: string; linkedin: string }) => void) {
    const file = path.join(dir, "posts.json");
    const posts = JSON.parse(fs.readFileSync(file, "utf8"));
    edit(posts);
    fs.writeFileSync(file, `${JSON.stringify(posts, null, 2)}\n`);
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-product-launch-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps its landing page sub-flow the same as the landing-page template", () => {
    for (const file of ["flow.json", "prompts/structure.md", "prompts/copy.md", "scripts/build.mjs", "scripts/check.mjs", "images/.gitkeep"]) {
      const copy = fs.readFileSync(path.join(templates, "product-launch", "subflows", "landing-page", file), "utf8");
      expect(copy, `subflows/landing-page/${file}`).toBe(fs.readFileSync(path.join(templates, "landing-page", file), "utf8"));
    }
  });

  it("runs the Chinese sample: one headline across the assets, the landing page through its sub-flow, and three answers to confirm", () => {
    const dir = path.join(root, "zh");
    init(dir, ["product=拍小票", "audience=开小店的人", "goal=留下邮箱，收到下载链接", "launchDate=2026-12-01", "embargo=true"]);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    for (const file of ["messaging.json", "launch-plan.md", "fact-sheet.md", "press-release.md", "email.md", "posts.json", "faq.md", "subflows/landing-page/brief.md", "site/index.html", "site/style.css", "landing-check.md", "launch-kit.md", "check-report.md"]) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
    expect(ran.out).toContain("写好了 launch-plan.md 和 fact-sheet.md：二级，时间表 11 项。公开发布 2026年12月1日 9:00（中国标准时间）；Product Hunt 2026年12月1日 16:01（中国标准时间）。");
    const plan = fs.readFileSync(path.join(dir, "launch-plan.md"), "utf8");
    expect(plan).toContain("新闻稿第一行：禁发至 2026年12月1日 9:00（中国标准时间）");
    expect(plan).toContain("| 2026-11-17（周二） | 把新闻稿发给记者，第一行写明：禁发至 2026年12月1日 9:00（中国标准时间）。");
    expect(plan).toContain("| 2026-12-15（周二） | CAN-SPAM：每一条退订都要在 10 个工作日内生效");
    expect(fs.readFileSync(path.join(dir, "press-release.md"), "utf8").split(/\r?\n/)[0]).toBe("禁发至 2026年12月1日 9:00（中国标准时间）");
    // the landing page's brief comes from the facts, and the page opens with the launch headline
    expect(fs.readFileSync(path.join(dir, "subflows", "landing-page", "brief.md"), "utf8")).toContain("这些物料都用同一句发布标题：「拍一张小票，账就记好了」。页面开头要接住这句话。");
    expect(fs.readFileSync(path.join(dir, "site", "index.html"), "utf8")).toContain("<h1>拍一张小票，账就记好了</h1>");
    expect(ran.out).toContain("[子流程 / sub-flow landing] 没有必须修的问题；上线前确认 2 项。");
    expect(fs.existsSync(path.join(dir, "subflows", "landing-page", "runs", "check", "1", "run.json"))).toBe(true);
    expect(ran.out).toContain("写好了 launch-kit.md：X 加权 175/280，LinkedIn 385/3000，Product Hunt 标语 53/60。");
    const kit = fs.readFileSync(path.join(dir, "launch-kit.md"), "utf8");
    expect(kit).toContain("### 标语（Tagline，53/60）\n\n```text\nSnap a receipt and it's booked, for small shop owners\n```");
    expect(kit).toContain("- 主题（11/60）：拍一张小票，账就记好了");
    expect(ran.out).toContain("有 4 处要看一下。");
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    expect(check).toContain(
      "### 待确认的回答\n\n- 常见问题：Pro 能退款或者随时取消吗？\n- 常见问题：用户想删掉一张小票的照片和那笔账，怎么做？\n- 常见问题：以后能读更多种类的单据吗？\n",
    );
    expect(check).toContain("- 落地页检查：没有必须修的问题；上线前确认 2 项。（见 landing-check.md）");
    expect(check).toContain("- [ ] 禁发：给记者的邮件正文里也写明禁发到什么时候、哪个时区。");
    expect(check).toContain("| 客户原话 | FTC 背书指南；16 CFR 465 | 通过 |");
  });

  it("finds the problems planted in the Chinese assets", () => {
    const dir = path.join(root, "zh");
    plant(path.join(dir, "press-release.md"), [
      ["禁发至 2026年12月1日 9:00（中国标准时间）\n", "即时发布\n"],
      ["今天推出新功能「拍小票」", "今天推出全球首款新功能「拍小票」"],
      ["」店小算创始人季白说，「", "」季白说，「"],
      ["每月前 30 张小票免费；", "每月前 30 张小票免费，限时到 12月2日 周三；"],
    ]);
    plant(path.join(dir, "email.md"), [
      ["主题：拍一张小票", "主题：回复：拍一张小票"],
      ["\n按钮：更新到 3.2 版", "\n按钮：看看内测故事 → https://blog.example.com\n\n按钮：更新到 3.2 版"],
      ["发件人：店小算，上海市示例区样板路 100 号", "发件人：店小算"],
    ]);
    plant(path.join(dir, "faq.md"), [["能，中文和英文的小票都能读。", "能，中文和英文的小票都能读，准确率 99%，业内最佳。TODO"]]);
    editPosts(dir, (posts) => {
      posts.productHunt.tagline = "拍一张小票，账就记好了 Snap a receipt";
      posts.productHunt.firstComment += " Please upvote us today!";
      // the URL ends where the Chinese starts, so the second copy still counts
      posts.x += posts.x;
      const quote = "半亩书店店主沈禾（内测期间免费使用 Pro）说：「以前月底要花一个晚上敲小票，现在进货的时候顺手拍一下。」";
      expect(posts.linkedin).toContain(quote);
      posts.linkedin = posts.linkedin.replace(quote, "半亩书店店主沈禾说：「现在月底不用熬夜了。」");
    });
    const ran = runIn(dir, ["run", "check"]);
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("有 21 处要看一下。");
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    for (const line of [
      "- 新闻稿第一行是「即时发布」，媒体资料里是「禁发至 2026年12月1日 9:00（中国标准时间）」",
      "- 新闻稿写了 12月2日，发布日期是 2026年12月1日：核对一下",
      "- 新闻稿写了周三，发布日是周二",
      "- 引语后面没写季白的职位（资料：店小算创始人）",
      "- 主题装成回信或转发：CAN-SPAM 不允许误导人的主题",
      "- 有 2 个按钮：一封信只请人做一件事",
      "- 页脚没写地址「上海市示例区样板路 100 号」",
      "- Product Hunt 只收英文：tagline 里有汉字",
      "- X 加权 350，超过 280",
      "- Product Hunt：「upvote」",
      "- 邮件的网址 https://blog.example.com：资料里没有，不要编网址",
      "- 常见问题的数字 99：资料里没有，核实后再发",
      "- LinkedIn 里沈禾的话和资料对不上，客户的话要一字不改：「现在月底不用熬夜了。」",
      "- LinkedIn 引用了沈禾，但没写明关系（资料：半亩书店店主，内测期间免费使用 Pro）",
      "- 常见问题：「最佳」",
      // terms the facts rule out are listed once, not again as needs-proof or urgency
      "### 资料里说不要写的话\n\n- 新闻稿：「首款」、「限时」\n",
      "- 常见问题：TODO",
      "| 要有证据的说法 | FTC 广告证据政策；《广告法》第九条 | 通过 |",
      "| 紧迫感用语 | UCPD 附件一第 7 项；FTC 暗黑模式报告 | 通过 |",
    ]) {
      expect(check).toContain(line);
    }
  });

  it("runs the English sample and words the planted problems in English", () => {
    const dir = path.join(root, "en");
    init(dir, ["language=en", "product=ShopTally Snap", "audience=owners of small shops", "goal=leave an email to get the download link", "launchDate=2026-12-01", "embargo=true"]);
    const mock = { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") };
    const ran = runIn(dir, ["run", "all"], mock);
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("Wrote launch-plan.md and fact-sheet.md: Tier 2, 11 timeline rows. Public launch Dec. 1, 2026, 9 a.m. GMT+8; Product Hunt Dec. 1, 2026, 4:01 p.m. GMT+8.");
    expect(fs.readFileSync(path.join(dir, "press-release.md"), "utf8").split(/\r?\n/)[0]).toBe("EMBARGOED UNTIL Dec. 1, 2026, 9 a.m. GMT+8");
    expect(fs.readFileSync(path.join(dir, "site", "index.html"), "utf8")).toContain("<h1>Snap a receipt and it&#39;s booked</h1>");
    expect(ran.out).toContain("Wrote launch-kit.md: X weighted 223/280, LinkedIn 1057/3000, Product Hunt tagline 53/60.");
    expect(ran.out).toContain("4 things to look at.");

    plant(path.join(dir, "press-release.md"), [
      ["EMBARGOED UNTIL Dec. 1, 2026, 9 a.m. GMT+8\n", "FOR IMMEDIATE RELEASE\n"],
      ["today launched ShopTally Snap.", "today launched ShopTally Snap, the world's first receipt reader for shops, on Wednesday."],
      ['" said Ji Bai, founder of ShopTally.', '" said Ji Bai.'],
    ]);
    plant(path.join(dir, "email.md"), [
      ["Subject: Snap", "Subject: RE: Snap"],
      ["From: ShopTally, 100 Sample Road, Shanghai, China", "From: ShopTally"],
    ]);
    plant(path.join(dir, "faq.md"), [["Yes. It reads receipts in Chinese and English.", "Yes, with 99% accuracy: the best receipt reader in Chinese and English. Act now. TODO"]]);
    editPosts(dir, (posts) => {
      posts.x = `${posts.x} ${posts.x}`;
      const said = 'Shen He, owner of Half Acre Books, who had free Pro during the beta, told us: "Month end used to cost me an evening of typing up receipts. Now I snap them when the delivery comes."';
      expect(posts.linkedin).toContain(said);
      posts.linkedin = posts.linkedin.replace(said, 'Shen He, owner of Half Acre Books, told us: "Month end is easy now."');
    });
    const checked = runIn(dir, ["run", "check"]);
    expect(checked.code, checked.out).toBe(0);
    expect(checked.out).toContain("17 things to look at.");
    const check = fs.readFileSync(path.join(dir, "check-report.md"), "utf8");
    for (const line of [
      '- The press release starts with "FOR IMMEDIATE RELEASE"; the fact sheet says "EMBARGOED UNTIL Dec. 1, 2026, 9 a.m. GMT+8"',
      "- Press release names a Wednesday; launch day is a Tuesday",
      "- The quote does not give Ji Bai's title (the facts: founder of ShopTally)",
      "- The subject poses as a reply or forward; CAN-SPAM bans misleading subject lines",
      '- The footer does not give the postal address, "100 Sample Road, Shanghai, China"',
      "- X post: 447 on the weighted count, over 280",
      "- FAQ: 99 not in the facts; verify before it goes out",
      `- LinkedIn: Shen He's words differ from the facts; quote customers word for word: "Month end is easy now."`,
      "- LinkedIn quotes Shen He without saying how they are tied to you (the facts: owner of Half Acre Books, free Pro during the beta)",
      '- FAQ: "the best"',
      '- FAQ: "act now"',
      '- Press release: "world\'s first"',
      "- FAQ: TODO",
    ]) {
      expect(check).toContain(line);
    }
  });
});

describe("micro-course template", () => {
  let root: string;
  const KEY = "fg-test-key-7f3a";

  function runIn(dir: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        FLOWGIT_HOME: path.join(root, "home"),
        FLOWGIT_TTS_API_KEY: "",
        FLOWGIT_TTS_BASE_URL: "",
        FLOWGIT_TTS_MODEL: "",
        FLOWGIT_TTS_VOICE: "",
        ...env,
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  function init(dir: string, inputs: string[]) {
    const r = spawnSync(process.execPath, [cli, "init", dir, "-t", "micro-course"], { encoding: "utf8" });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const set = runIn(dir, ["inputs", "set", ...inputs]);
    expect(set.code, set.out).toBe(0);
  }

  /** Runs the stages one at a time, the way `run all` would, stopping before the given one; returns what each printed. */
  function runUntil(dir: string, stop: string, env: Record<string, string> = {}) {
    const said: Record<string, string> = {};
    for (const stage of ["brief", "plan", "script", "deck", "precheck", "voice", "record", "captions", "render", "check"]) {
      if (stage === stop) break;
      const r = runIn(dir, ["run", stage], env);
      expect(r.code, `${stage}: ${r.out}`).toBe(0);
      said[stage] = r.out;
    }
    return said;
  }

  const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");
  const readJson = (dir: string, file: string) => JSON.parse(read(dir, file));
  /** Each caption's text lines, from an SRT file. */
  const cueLines = (srt: string) =>
    srt
      .trim()
      .split(/\n\s*\n/)
      .map((block) => block.split("\n").slice(2));

  function ffmpeg(args: string[]) {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  }

  function probe(file: string) {
    const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,channels,sample_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as { streams: Record<string, string | number>[]; format: { duration: string } };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-micro-course-"));
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("runs the Chinese sample: slides, a teleprompter script and a quiz, a clean pre-record check, captions and one video per segment", () => {
    const dir = path.join(root, "zh");
    init(dir, ["topic=10 分钟做出你的第一张记账表"]);
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(hasFfmpeg ? 0 : 1);
    expect(ran.out).toContain("写好了 deck/index.html（13 张幻灯片）、teleprompter.md（约 6 分 14 秒）和 quiz.md（4 道题）。");
    expect(ran.out).toContain("检查通过，见 precheck-report.md。");

    const deck = read(dir, "deck/index.html");
    expect(deck.match(/<section class="slide kind-/g)).toHaveLength(13);
    expect(deck.match(/<section class="slide kind-question/g)).toHaveLength(3);
    const teleprompter = read(dir, "teleprompter.md");
    expect(teleprompter).toContain("## s1 · 第 1 段：为什么记账 App 坚持不下去（约 1 分 53 秒，计划 2 分钟）");
    expect(teleprompter).toContain("### 【s1-2】记账难坚持，是因为每花一笔都要记一笔\n\n> 画面：记账 App 的日历截图：只有前三天记了账，后面都是空的\n> 屏幕上的字：每花一笔，记一笔");
    const quiz = read(dir, "quiz.md");
    expect(quiz).toContain("## 1. G2 要算出「吃饭」一共花了多少，哪个公式对？\n\n- A. =SUMIF(C:C, F2, B:B) ✓\n- B. =SUMIF(B:B, F2, C:C)\n- C. =SUM(B:B)");
    expect(quiz).toContain("（考第 3 段）");
    expect(read(dir, "voice/README.md")).toContain("输入 voice 是 record");

    // Chinese captions: one line of up to 16 characters, never ending on a comma or full stop
    for (const n of ["01-s1", "02-s2", "03-s3"]) {
      const cues = cueLines(read(dir, `captions/${n}.srt`));
      expect(cues.length).toBeGreaterThan(20);
      for (const lines of cues) {
        expect(lines).toHaveLength(1);
        expect([...lines[0]].length, lines[0]).toBeLessThanOrEqual(16);
        expect(lines[0]).not.toMatch(/[，。、；：]$/);
      }
      expect(read(dir, `captions/${n}.vtt`).startsWith("WEBVTT\n\n00:00:00.000 --> ")).toBe(true);
    }
    const timeline = readJson(dir, "timeline.json");
    expect(timeline.segments.map((s: { id: string; audio: { source: string }; picture: { source: string }; timedFrom: string }) => [s.id, s.audio.source, s.picture.source, s.timedFrom])).toEqual([
      ["s1", "none", "slides", "narration"],
      ["s2", "none", "slides", "narration"],
      ["s3", "none", "slides", "narration"],
    ]);
    for (const seg of timeline.segments) expect(seg.slides.at(-1).end).toBe(seg.seconds);

    if (!hasFfmpeg) return;
    for (const [i, seg] of timeline.segments.entries()) {
      const info = probe(path.join(dir, "video", `0${i + 1}-${seg.id}.mp4`));
      expect(info.streams).toEqual([
        expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" }),
      ]);
      expect(Math.abs(Number(info.format.duration) - seg.seconds)).toBeLessThan(0.1);
    }
    expect(ran.out).toContain("有 6 处要看一下，见 check-report.md。");
    const check = read(dir, "check-report.md");
    expect(check).toContain("- s1：没有讲解，是无声的幻灯片视频。录好 recordings/s1.m4a（或录屏 s1.mp4）再重跑。");
    expect(check).toContain("- s2：4 张幻灯片写了要放的画面，但 images/ 里没有图，视频里只有标题和关键词：s2-1、s2-2、s2-3、s2-4。");
    expect(check).toContain("## 字幕（WCAG 2.2 成功标准 1.2.2；Netflix 字幕规范）\n没有。");
    expect(check).toContain("- [ ] 上 Udemy 的话，在课程描述里写明用了 AI：这个流程用模型起草了讲稿和测验。");
    expect(check).not.toContain("国内平台");
  }, 180_000);

  it.skipIf(!hasFfmpeg)("uses your recording, your screen recording and your captions, and sets the loudness", () => {
    const dir = path.join(root, "zh");
    // a quiet voice-over for s1, a screen recording with sound for s2, and a silent screen recording with captions for s3
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=8", "-af", "volume=-30dB", "-c:a", "aac", path.join(dir, "recordings", "s1.m4a")]);
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6", "-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, "recordings", "s2.mp4")]);
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "recordings", "s3.mp4")]);
    fs.writeFileSync(path.join(dir, "recordings", "s3.srt"), "1\n00:00:00,000 --> 00:00:00,500\n先暂停视频\n\n2\n00:00:00,500 --> 00:00:02,000\n这三格金额里，哪一格算合计时会被漏掉呢？\n");
    const ran = runIn(dir, ["run", "all"], { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toContain("保留了你的手动修改");
    expect(ran.out).toMatch(/s1：8 秒，你的录音，画面用幻灯片，字幕 \d+ 条（按讲稿切的）/);
    expect(ran.out).toMatch(/s2：6 秒，你的录音，画面用录屏，字幕 \d+ 条（按讲稿切的）/);
    expect(ran.out).toContain("s3：5 秒，没有声音，画面用录屏，字幕 2 条（你的）");
    const timeline = readJson(dir, "timeline.json");
    expect(timeline.segments.map((s: { audio: { file: string | null }; timedFrom: string }) => [s.audio.file, s.timedFrom])).toEqual([
      ["recordings/s1.m4a", "media"],
      ["recordings/s2.mp4", "media"],
      [null, "media"],
    ]);
    const screen = probe(path.join(dir, "video", "02-s2.mp4"));
    expect(screen.streams[0]).toMatchObject({ codec_name: "h264", width: 1920, height: 1080 });
    expect(Math.abs(Number(screen.format.duration) - 6)).toBeLessThan(0.1);
    const manifest = readJson(dir, "video/manifest.json");
    // the quiet recording is lifted to about -16 LUFS
    expect(manifest.segments[0].loudnessBefore).toBeLessThan(-30);
    const check = read(dir, "check-report.md");
    expect(check).toMatch(/\| video\/01-s1\.mp4 \| 0:08 \| 1920×1080 \| 录音，-1[56](?:\.\d)? LUFS \/ -?\d+(?:\.\d)? dBTP \| 幻灯片 \| captions\/01-s1\.srt \|/);
    expect(check).toContain("- s1：字幕是按讲稿切的，时间是估的，和你实际说的话不会一字不差。用转写工具导出字幕存成 recordings/s1.srt，再从「字幕和时间线」重跑。");
    expect(check).toContain("- s3：没有讲解，录屏里没有声音。把讲解录成 recordings/s3.m4a（或重新录一段带声音的录屏）再重跑。");
    expect(check).toContain("- s3：1 条字幕有一行超过 16 个字（第 2 条）。");
    expect(check).toContain("- s3：1 条字幕显示不到 0.83 秒（第 1 条）。");
    expect(check).not.toContain("- s2：4 张幻灯片写了要放的画面");
  }, 120_000);

  it("finds the problems planted in the plan and the script", () => {
    const dir = path.join(root, "zh");
    const plan = readJson(dir, "plan.json");
    plan.objective.verb = "理解";
    plan.segments[2].minutes = 8;
    plan.quiz[1].options[2] = "以上都对";
    plan.quiz[2].segment = "s9";
    fs.writeFileSync(path.join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
    const script = readJson(dir, "script.json");
    const s2 = script.segments[1].slides;
    s2[s2.length - 1].kind = "teach";
    s2[0].headline = "四列";
    s2[1].onScreen = ["吃饭", "交通", "购物", "娱乐"];
    script.segments[0].slides[1].narration += "调查显示 90% 的人坚持不了一个月。跟着做，保证你月底存下钱。坚持记账就能存下钱。TODO";
    fs.writeFileSync(path.join(dir, "script.json"), `${JSON.stringify(script, null, 2)}\n`);
    const ran = runIn(dir, ["run", "precheck"]);
    expect(ran.code, ran.out).toBe(0);
    const report = read(dir, "precheck-report.md");
    for (const line of [
      "- 目标的动词「理解」看不见、没法检验。",
      "- 教学设计里各段的分钟数加起来是 12，目标是 6。",
      "- s3「让表格自己算分类合计」计划 8 分钟，超过 6 分钟。",
      "- s2「四列就够，分类先用 5 个」讲完后没有小问题。",
      "- s2-1 的标题「四列」像主题词，不像一句话",
      "- s2-2 屏幕上有 4 处字，最多 3 处",
      "- 第 2 题用了「以上都对」",
      "- 第 3 题考的段「s9」不在讲稿里。",
      "- 「90%」",
      "- 「保证」",
      "- 「坚持记账就能存下钱」",
      "- 「TODO」",
    ]) {
      expect(report, line).toContain(line);
    }
  });

  it("cuts Chinese captions between words and keeps formulas and numbers whole", () => {
    const dir = path.join(root, "zh-captions");
    init(dir, ["topic=10 分钟做出你的第一张记账表"]);
    runUntil(dir, "captions", { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "zh") });
    const script = readJson(dir, "script.json");
    script.segments[0].slides[1].narration =
      "架子搭好，来写公式。在 G2 这一格输入 =SUMIF(C:C, F2, B:B)。金额写成 1,000 元，10:30 记一笔。我就带你在十分钟里做出一张能按分类自动汇总支出的记账表。最后一步，把这周你记得的 5 笔花费填进表格，数不用很准。";
    fs.writeFileSync(path.join(dir, "script.json"), `${JSON.stringify(script, null, 2)}\n`);
    const ran = runIn(dir, ["run", "captions"]);
    expect(ran.code, ran.out).toBe(0);

    const srt = read(dir, "captions/01-s1.srt");
    const lines = cueLines(srt).flat();
    // the formula is one caption with its punctuation, the only line over 16 characters
    expect(lines).toContain("=SUMIF(C:C, F2, B:B)");
    expect(lines.filter((l) => [...l].length > 16)).toEqual(["=SUMIF(C:C, F2, B:B)"]);
    expect(lines.some((l) => l.includes("1,000 元"))).toBe(true);
    expect(lines.some((l) => l.includes("10:30"))).toBe(true);
    expect(srt).not.toMatch(/C C|1 000|10 30/);
    // words stay whole and a number stays with its measure word
    expect(lines.some((l) => /按分$/.test(l))).toBe(false);
    expect(lines.some((l) => l.startsWith("5 笔花费"))).toBe(true);
    expect(lines.some((l) => / 5$/.test(l))).toBe(false);
    // the formula stays up long enough to read at 9 characters a second
    const block = srt.split(/\n\s*\n/).find((b) => b.includes("=SUMIF(C:C, F2, B:B)"))!;
    const [a, b] = block.split("\n")[1].split(" --> ").map((s) => {
      const [h, m, rest] = s.split(":");
      return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(",", "."));
    });
    expect(b - a).toBeGreaterThanOrEqual(20 / 9 - 0.0005);
  });

  it.skipIf(!hasFfmpeg)("says and shows an English AI voice, keeps the key out of every file, and won't follow a redirect to another site", async () => {
    const dir = path.join(root, "en");
    init(dir, ["topic=Make your first budget spreadsheet in 10 minutes", "audience=office workers new to budgeting", "language=en", "voice=ai"]);
    const mock = { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies", "en") };
    const said = runUntil(dir, "voice", mock);
    expect(said.deck).toContain("Wrote deck/index.html (13 slides), teleprompter.md");
    expect(said.precheck).toContain("All checks passed; see precheck-report.md.");

    // no key: a note, and the stage still succeeds
    const noKey = runIn(dir, ["run", "voice"]);
    expect(noKey.code, noKey.out).toBe(0);
    expect(read(dir, "voice/README.md")).toContain("FLOWGIT_TTS_API_KEY is not set");

    // An OpenAI-compatible speech endpoint in its own process (spawnSync would block one in this one).
    const log = path.join(root, "tts.jsonl");
    const serverFile = path.join(root, "tts-server.mjs");
    fs.writeFileSync(
      serverFile,
      `import http from "node:http";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const [key, log, tmp] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const port = server.address().port;
    if (req.url === "/away/audio/speech") return res.writeHead(307, { location: "http://localhost:" + port + "/v1/audio/speech" }).end();
    if (req.url === "/echo/audio/speech") return res.writeHead(401).end("rejected " + req.headers.authorization);
    if (req.url !== "/v1/audio/speech" || req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("no");
    const { model, voice, input } = JSON.parse(body);
    fs.appendFileSync(log, JSON.stringify({ model, voice, input }) + "\\n");
    const file = tmp + "/" + Date.now() + Math.random() + ".mp3";
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=" + (input.length / 15).toFixed(2), "-af", "volume=-24dB", file]);
    res.writeHead(200, { "content-type": "audio/mpeg" }).end(fs.readFileSync(file));
  });
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`,
    );
    const server = spawn(process.execPath, [serverFile, KEY, log, root], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      const port = await new Promise<string>((resolve, reject) => {
        server.stdout.once("data", (d) => resolve(String(d).trim()));
        server.once("exit", (code) => reject(new Error(`the speech server stopped (${code})`)));
      });
      const base = `http://127.0.0.1:${port}`;

      const away = runIn(dir, ["run", "voice"], { FLOWGIT_TTS_API_KEY: KEY, FLOWGIT_TTS_BASE_URL: `${base}/away` });
      expect(away.code).toBe(1);
      expect(away.out).toContain(`text-to-speech redirected to another origin, http://localhost:${port}; it was not followed so the key stays put`);
      const echo = runIn(dir, ["run", "voice"], { FLOWGIT_TTS_API_KEY: KEY, FLOWGIT_TTS_BASE_URL: `${base}/echo` });
      expect(echo.code).toBe(1);
      expect(echo.out).toContain("401 rejected Bearer ***");
      expect(echo.out).toContain("The key was rejected; check FLOWGIT_TTS_API_KEY");
      expect(echo.out).not.toContain(KEY);

      const voiced = runIn(dir, ["run", "voice"], { FLOWGIT_TTS_API_KEY: KEY, FLOWGIT_TTS_BASE_URL: `${base}/v1` });
      expect(voiced.code, voiced.out).toBe(0);
      expect(voiced.out).toContain('Each opens with "The voice in this video is AI-generated."');
    } finally {
      server.kill();
    }
    const requests = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests).toHaveLength(3);
    for (const r of requests) {
      expect(r).toMatchObject({ model: "gpt-4o-mini-tts", voice: "alloy" });
      expect(r.input.startsWith("The voice in this video is AI-generated.\n\n")).toBe(true);
    }
    expect(readJson(dir, "voice/voice.json").segments).toEqual([
      { id: "s1", file: "s1.mp3" },
      { id: "s2", file: "s2.mp3" },
      { id: "s3", file: "s3.mp3" },
    ]);

    runIn(dir, ["run", "record"]);
    const captions = runIn(dir, ["run", "captions"]);
    expect(captions.code, captions.out).toBe(0);
    // English captions: up to two lines of 42 characters; the AI notice comes first
    const srt = read(dir, "captions/01-s1.srt");
    expect(srt.startsWith("1\n00:00:00,000 --> ")).toBe(true);
    expect(cueLines(srt)[0]).toEqual(["The voice in this video is AI-generated."]);
    for (const n of ["01-s1", "02-s2", "03-s3"]) {
      for (const lines of cueLines(read(dir, `captions/${n}.srt`))) {
        expect(lines.length).toBeLessThanOrEqual(2);
        for (const line of lines) {
          expect(line.length, line).toBeLessThanOrEqual(42);
          expect(line, line).not.toMatch(/\b(?:a|an|the|your)$/i);
        }
      }
    }

    // English captions keep to 20 characters a second and stay up at least 5/6 of a second
    const seconds = (stamp: string) => {
      const [h, m, rest] = stamp.trim().split(":");
      return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(",", "."));
    };
    const blocks = read(dir, "captions/01-s1.srt").trim().split(/\n\s*\n/);
    for (const block of blocks) {
      const [, times, ...lines] = block.split("\n");
      const [start, end] = times.split("-->").map(seconds);
      expect(end - start, block).toBeGreaterThanOrEqual(0.833 - 0.0005);
      expect(lines.join(" ").length / (end - start), block).toBeLessThanOrEqual(20);
    }

    // timeline.json and the captions can be edited by hand: keep the opening slide to render a short video
    const timeline = readJson(dir, "timeline.json");
    const first = timeline.segments[0];
    expect(first).toMatchObject({ audio: { source: "ai", file: "voice/s1.mp3" }, picture: { source: "slides" }, timedFrom: "media" });
    first.slides = first.slides.slice(0, 1);
    first.seconds = first.slides[0].end;
    timeline.segments = [first];
    fs.writeFileSync(path.join(dir, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    const opening = blocks.filter((block) => seconds(block.split("\n")[1].split("-->")[1]) <= first.seconds + 0.001);
    expect(opening.length).toBeGreaterThan(3);
    fs.writeFileSync(path.join(dir, "captions", "01-s1.srt"), `${opening.join("\n\n")}\n`);
    const rendered = runIn(dir, ["run", "render"]);
    expect(rendered.code, rendered.out).toBe(0);
    expect(rendered.out).toContain('labeled "AI-generated voice"');
    const checked = runIn(dir, ["run", "check"]);
    expect(checked.code, checked.out).toBe(0);
    const check = read(dir, "check-report.md");
    expect(check).toMatch(/\| video\/01-s1\.mp4 \| \d:\d\d \| 1920×1080 \| AI voice, -1[56](?:\.\d)? LUFS \/ -?\d+(?:\.\d)? dBTP \| slides \| captions\/01-s1\.srt \|/);
    expect(check).toContain("## Captions (WCAG 2.2 SC 1.2.2; Netflix timed text guides)\nNone.");
    expect(check).toContain("## AI voice labels (China's AI content labeling measures, art. 4)\nNone.");
    expect(check).toContain("- [ ] On Udemy, say in the course description that AI was used: this flow drafted the script and the quiz with a model, and the voice is AI.");
    expect(check).toContain("- [ ] When publishing on a platform in China, declare the AI content through the platform's labeling feature (Labeling Measures art. 10).");

    // the key never lands in a file
    const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    for (const f of files) expect(fs.readFileSync(path.join(f.parentPath, f.name)).includes(KEY), f.name).toBe(false);
  }, 180_000);
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
    fs.mkdirSync(path.join(flowDir, ".flowgit", "thumbs"), { recursive: true });
    fs.writeFileSync(path.join(flowDir, ".flowgit", "thumbs", "a.jpg"), "jpg");
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
    expect(fs.existsSync(path.join(shared, ".flowgit"))).toBe(false);
    expect(ok.out).toContain(".flowgit/");
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

describe("examples/subflow", () => {
  let flowDir: string;

  function run(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [cli, "-C", flowDir, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  beforeAll(() => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    const src = path.resolve(here, "../../..", "examples", "subflow");
    flowDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-subflow-"));
    fs.cpSync(src, flowDir, { recursive: true });
  });

  afterAll(() => {
    if (flowDir) fs.rmSync(flowDir, { recursive: true, force: true });
  });

  it("runs the parent through the sub-flow to the summary, using demo replies", () => {
    const mock = path.join(flowDir, "subflows", "brief", "demo-replies");
    expect(run(["inputs", "set", "topic=为什么猫喜欢纸箱"]).code).toBe(0);
    const waiting = run(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: mock });
    expect(waiting.code, waiting.out).toBe(2);
    expect(waiting.out).toContain("waiting for you: topic.md");

    fs.writeFileSync(path.join(flowDir, "topic.md"), "为什么猫喜欢纸箱\n");
    const done = run(["run", "all"], { FLOWGIT_LLM_MOCK_DIR: mock });
    expect(done.code, done.out).toBe(0);
    expect(done.out).toContain("[子流程 / sub-flow make]");
    expect(fs.readFileSync(path.join(flowDir, "brief.md"), "utf8")).toContain("纸箱");
    expect(fs.readFileSync(path.join(flowDir, "summary.md"), "utf8")).toContain("为什么猫喜欢纸箱");
    expect(fs.existsSync(path.join(flowDir, "subflows", "brief", "runs", "draft", "1", "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(flowDir, "subflows", "brief", "runs", "check", "1", "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(flowDir, "runs", "make", "1", "run.json"))).toBe(true);
    // the sub-flow's own runs stay under its directory, not mixed into the parent's draft stage
    expect(fs.existsSync(path.join(flowDir, "runs", "draft"))).toBe(false);

    const skill = run(["export-skill", "--out", "-"]);
    expect(skill.code, skill.out).toBe(0);
    expect(skill.out).toContain("运行子流程 `subflows/brief/flow.json`");
    expect(skill.out).toContain("run the sub-flow `subflows/brief/flow.json`");
    const graph = run(["graph"]);
    expect(graph.code, graph.out).toBe(0);
    expect(graph.out).toContain("sub-flow");

    // Copying the flow lists what the sub-flow runs too, and leaves out the sub-flow's outputs and runs.
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-subflow-copy-"));
    try {
      const r = spawnSync(process.execPath, [cli, "init", path.join(dest, "copy"), "-t", flowDir], {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const out = `${r.stdout}${r.stderr}`;
      expect(r.status, out).toBe(0);
      expect(out).toMatch(/workflow\s+make\s+子流程 \/ sub-flow subflows\/brief\/flow\.json/);
      expect(out).toMatch(/script\s+make\/check\s+node scripts\/check\.mjs/);
      const copy = path.join(dest, "copy");
      expect(fs.existsSync(path.join(copy, "subflows", "brief", "flow.json"))).toBe(true);
      expect(fs.existsSync(path.join(copy, "subflows", "brief", "brief.md"))).toBe(false);
      expect(fs.existsSync(path.join(copy, "subflows", "brief", "check.txt"))).toBe(false);
      expect(fs.existsSync(path.join(copy, "subflows", "brief", "runs"))).toBe(false);
      expect(fs.existsSync(path.join(copy, "brief.md"))).toBe(false);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe("image stage", () => {
  it("runs the example from canned pictures and logs the count", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-image-e2e-"));
    const dir = path.join(root, "shots");
    fs.cpSync(path.resolve(here, "../../../examples/image-shots"), dir, { recursive: true });
    try {
      const run = spawnSync(process.execPath, [cli, "-C", dir, "run", "all"], {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1", FLOWGIT_IMAGE_MOCK_DIR: path.join(dir, "demo-pictures"), OPENAI_API_KEY: "", GLM_API_KEY: "" },
      });
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      expect(fs.readdirSync(path.join(dir, "shots")).sort()).toEqual(["001.png", "002.png", "003.png"]);
      const log = spawnSync(process.execPath, [cli, "-C", dir, "log", "shots"], {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      });
      expect(log.status, `${log.stdout}${log.stderr}`).toBe(0);
      expect(`${log.stdout}${log.stderr}`).toMatch(/zhipu\/cogview-4 1024x1024 · 3 张 \/ 3 image\(s\)/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
