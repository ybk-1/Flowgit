import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The short-video voice script, against a local fake speech server. No network and no real key.
const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, "..", "templates", "short-video");
const script = path.join(template, "scripts", "tts.mjs");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const SKIP =
  "没有配置语音合成，跳过自动配音；可以自己录 assets/voice.mp3，或设置 FLOWGIT_TTS_API_KEY / No text-to-speech configured, so no voiceover was made; record assets/voice.mp3 yourself or set FLOWGIT_TTS_API_KEY";

const dirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Hit {
  url: string | undefined;
  method: string | undefined;
  authorization: string | undefined;
  body: { model?: string; input?: string; voice?: string; response_format?: string };
}

function tone(): Buffer {
  const file = path.join(os.tmpdir(), `flowgit-tts-tone-${process.pid}.mp3`);
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25", "-c:a", "libmp3lame", "-q:a", "9", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return bytes;
}

function listen(status: number, payload: Buffer | string): Promise<{ port: number; hits: Hit[] }> {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      let body: Hit["body"] = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Hit["body"];
      } catch {
        body = {};
      }
      hits.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body });
      res.writeHead(status, { "Content-Type": status === 200 ? "audio/mpeg" : "application/json" });
      res.end(payload);
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({ port: address.port, hits });
    });
  });
}

function project(markdown: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-tts-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "script.md"), markdown);
  return dir;
}

function run(dir: string, env: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    FLOWGIT_TTS_API_KEY: "",
    FLOWGIT_TTS_BASE_URL: "",
    FLOWGIT_TTS_MODEL: "",
    FLOWGIT_TTS_VOICE: "",
    ...env,
    FLOWGIT_PROJECT_DIR: dir,
  };
  // An empty proxy variable makes fetch hang, and a real one would leave the machine.
  // Drop them unless this test set one on purpose.
  for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NODE_USE_ENV_PROXY"]) {
    if (!(key in env)) delete merged[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: dir, env: merged });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const DEMO_LINES = [
  "你家猫是不是放着几百块的猫窝不睡，偏偏钻进快递箱？",
  "这不是它傻，是它的祖先留下的本能：小而封闭的空间，最安全。",
  "研究发现，有纸箱可以躲的收容所猫咪，压力水平下降得更快。",
  "纸板还很保暖。猫最舒服的温度比人高好几度，纸箱刚好帮它锁住体温。",
  "所以下次拆完快递，别急着扔箱子。你家猫可能已经在排队了。评论区说说，你家主子最爱哪个箱子？",
];

describe("short-video text-to-speech", () => {
  it("posts each spoken chunk and writes voice/voice.mp3", async () => {
    const mp3 = hasFfmpeg ? tone() : Buffer.from("not-audio");
    const { port, hits } = await listen(200, mp3);
    const dir = project(fs.readFileSync(path.join(template, "demo-replies", "script.md"), "utf8"));
    const key = "sk-test-voice-key";
    const r = await run(dir, { FLOWGIT_TTS_API_KEY: key, FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(hits).toHaveLength(1);
    expect(hits[0].method).toBe("POST");
    expect(hits[0].url).toBe("/v1/audio/speech");
    expect(hits[0].authorization).toBe(`Bearer ${key}`);
    expect(hits[0].body).toEqual({
      model: "gpt-4o-mini-tts",
      input: DEMO_LINES.join("\n\n"),
      voice: "alloy",
      response_format: "mp3",
    });
    expect(hits[0].body.input).not.toContain("画面");
    expect(hits[0].body.input).not.toContain("为什么猫喜欢纸箱");
    expect(r.stdout).not.toContain(key);
    expect(r.stderr).not.toContain(key);
    const voiceDir = path.join(dir, "voice");
    if (hasFfmpeg) {
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readdirSync(voiceDir)).toEqual(["voice.mp3"]);
      expect(fs.readFileSync(path.join(voiceDir, "voice.mp3")).includes(Buffer.from(key))).toBe(false);
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(voiceDir, "voice.mp3")], {
        encoding: "utf8",
      });
      expect(Number(probe.stdout)).toBeGreaterThan(0);
    }
  });

  it("honors the model, voice and a trailing slash on the base URL", async () => {
    const { port, hits } = await listen(200, hasFfmpeg ? tone() : Buffer.from("x"));
    const dir = project("**Voiceover**: Cats love boxes.\n\n**Visual**: A cat in a box.\n\nDo not read this note.\n");
    const r = await run(dir, {
      FLOWGIT_TTS_API_KEY: "sk-test-voice-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1/`,
      FLOWGIT_TTS_MODEL: "tts-1",
      FLOWGIT_TTS_VOICE: "nova",
    });
    expect(hits[0].url).toBe("/v1/audio/speech");
    expect(hits[0].body).toEqual({ model: "tts-1", input: "Cats love boxes.", voice: "nova", response_format: "mp3" });
    if (hasFfmpeg) expect(r.status, r.stderr).toBe(0);
  });

  it("splits paragraphs that do not fit in one request and concatenates the audio", async () => {
    const mp3 = hasFfmpeg ? tone() : Buffer.from("x");
    const { port, hits } = await listen(200, mp3);
    const first = "甲".repeat(3000);
    const second = "乙".repeat(3000);
    const dir = project(`**口播**：${first}\n\n**口播**：${second}\n`);
    const r = await run(dir, { FLOWGIT_TTS_API_KEY: "sk-test-voice-key", FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(hits.map((hit) => hit.body.input)).toEqual([first, second]);
    expect(hits.every((hit) => (hit.body.input ?? "").length <= 4096)).toBe(true);
    expect(hits.every((hit) => hit.authorization === "Bearer sk-test-voice-key")).toBe(true);
    if (hasFfmpeg) {
      expect(r.status, r.stderr).toBe(0);
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "voice", "voice.mp3")], {
        encoding: "utf8",
      });
      expect(Number(probe.stdout)).toBeGreaterThan(0.4);
    }
  });

  it("hard-splits one paragraph that is longer than the API limit", async () => {
    const { port, hits } = await listen(200, hasFfmpeg ? tone() : Buffer.from("x"));
    const spoken = "啊".repeat(5000);
    const dir = project(`**口播**：${spoken}\n`);
    await run(dir, { FLOWGIT_TTS_API_KEY: "sk-test-voice-key", FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((hit) => (hit.body.input ?? "").length <= 4096)).toBe(true);
    expect(hits.map((hit) => hit.body.input).join("")).toBe(spoken);
  });

  it("succeeds and writes only voice/README.md when no key is set", async () => {
    const { port, hits } = await listen(200, Buffer.from("should-not-be-called"));
    const dir = project("**口播**：你好。\n");
    fs.mkdirSync(path.join(dir, "voice"));
    fs.writeFileSync(path.join(dir, "voice", "voice.mp3"), "old");
    const r = await run(dir, { FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(r.status, r.stderr).toBe(0);
    expect(hits).toHaveLength(0);
    expect(fs.readdirSync(path.join(dir, "voice"))).toEqual(["README.md"]);
    expect(fs.readFileSync(path.join(dir, "voice", "README.md"), "utf8")).toBe(`${SKIP}\n`);
  });

  it("explains a rejected key without writing it down", async () => {
    const key = "sk-test-voice-key";
    const { port, hits } = await listen(401, key);
    const dir = project("**口播**：你好。\n");
    const r = await run(dir, { FLOWGIT_TTS_API_KEY: key, FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(r.status).not.toBe(0);
    expect(hits).toHaveLength(1);
    expect(r.stderr).toContain("密钥被拒绝了，检查 FLOWGIT_TTS_API_KEY 是否正确");
    expect(r.stderr).toContain("The key was rejected; check FLOWGIT_TTS_API_KEY");
    expect(r.stderr).not.toContain(key);
    expect(r.stdout).not.toContain(key);
    expect(fs.existsSync(path.join(dir, "voice", "voice.mp3"))).toBe(false);
  });

  it("explains a rate limit", async () => {
    const { port } = await listen(429, JSON.stringify({ error: { message: "slow down" } }));
    const dir = project("**口播**：你好。\n");
    const r = await run(dir, { FLOWGIT_TTS_API_KEY: "sk-test-voice-key", FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("请求太频繁，或者额度、用量上限用完了");
    expect(r.stderr).toContain("Rate-limited or out of quota");
  });

  it("explains a connection failure, including a proxy Node will ignore", async () => {
    const dir = project("**口播**：你好。\n");
    const r = await run(dir, {
      FLOWGIT_TTS_API_KEY: "sk-test-voice-key",
      FLOWGIT_TTS_BASE_URL: "http://127.0.0.1:1/v1",
      HTTPS_PROXY: "http://127.0.0.1:9",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("连不上这个地址，检查 FLOWGIT_TTS_BASE_URL 和网络");
    expect(r.stderr).toContain("Could not reach it; check FLOWGIT_TTS_BASE_URL and your network");
    expect(r.stderr).toContain("NODE_USE_ENV_PROXY=1");
    expect(fs.existsSync(path.join(dir, "voice", "voice.mp3"))).toBe(false);
  });

  it("fails when the script has nothing to read aloud", async () => {
    const dir = project("# 标题\n\n**画面**：一只猫。\n");
    const r = await run(dir, { FLOWGIT_TTS_API_KEY: "sk-test-voice-key" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("脚本里没有可以念的旁白");
  });
});
