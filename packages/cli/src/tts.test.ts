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

function run(dir: string, env: Record<string, string> = {}, args: string[] = []): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    FLOWGIT_TTS: "",
    FLOWGIT_TTS_API_KEY: "",
    FLOWGIT_TTS_BASE_URL: "",
    FLOWGIT_TTS_MODEL: "",
    FLOWGIT_TTS_VOICE: "",
    FLOWGIT_FLOW_INPUTS: "{}",
    OPENAI_API_KEY: "",
    DASHSCOPE_API_KEY: "",
    DASHSCOPE_WORKSPACE_ID: "",
    VOLCENGINE_API_KEY: "",
    MINIMAX_API_KEY: "",
    SPEECH_KEY: "",
    SPEECH_REGION: "",
    ...env,
    FLOWGIT_PROJECT_DIR: dir,
  };
  // An empty proxy variable makes fetch hang, and a real one would leave the machine.
  // Drop them unless this test set one on purpose.
  for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NODE_USE_ENV_PROXY"]) {
    if (!(key in env)) delete merged[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: dir, env: merged });
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
    // One request: the audio is written as it came, so this part runs without ffmpeg too.
    const voiceDir = path.join(dir, "voice");
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(voiceDir)).toEqual(["voice.mp3"]);
    expect(fs.readFileSync(path.join(voiceDir, "voice.mp3")).equals(mp3)).toBe(true);
    expect(fs.readFileSync(path.join(voiceDir, "voice.mp3")).includes(Buffer.from(key))).toBe(false);
    if (hasFfmpeg) {
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
    expect(r.status, r.stderr).toBe(0);
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

interface Recorded {
  url: string | undefined;
  method: string | undefined;
  headers: http.IncomingHttpHeaders;
  raw: string;
  json: unknown;
}

/** Local fake speech server. No network. */
function serve(onHit: (hit: Recorded, res: http.ServerResponse) => void): Promise<{ port: number; hits: Recorded[] }> {
  const hits: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let json: unknown;
      try {
        json = JSON.parse(raw) as unknown;
      } catch {
        json = undefined;
      }
      const hit: Recorded = { url: req.url, method: req.method, headers: req.headers, raw, json };
      hits.push(hit);
      onHit(hit, res);
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

function posts(hits: Recorded[]): Recorded[] {
  return hits.filter((hit) => hit.method === "POST");
}

function audioFile(dir: string): Buffer {
  return fs.readFileSync(path.join(dir, "voice", "voice.mp3"));
}

const RAW = Buffer.from("flowgit-raw-audio");
const B64 = Buffer.from("flowgit-base64-audio");
const HEX = Buffer.from("flowgit-hex-audio");

function jsonOk(res: http.ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function rawOk(res: http.ServerResponse, bytes: Buffer) {
  res.writeHead(200, { "Content-Type": "audio/mpeg" });
  res.end(bytes);
}

describe("text-to-speech presets", () => {
  it("lists presets, required env vars, and whether they are set, without printing secrets", async () => {
    const dir = project("**口播**：你好。\n");
    const secret = "sk-list-should-not-appear";
    const r = await run(dir, { OPENAI_API_KEY: secret, SPEECH_REGION: "eastus" }, ["--list"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).not.toContain("eastus");
    for (const id of ["openai", "dashscope", "volcengine", "minimax", "azure"]) expect(r.stdout).toContain(`${id} —`);
    expect(r.stdout).toContain("OPENAI_API_KEY（已设置 / set）");
    expect(r.stdout).toContain("DASHSCOPE_API_KEY（未设置 / unset）");
    expect(r.stdout).toContain("DASHSCOPE_WORKSPACE_ID（未设置 / unset）");
    expect(r.stdout).toContain("VOLCENGINE_API_KEY（未设置 / unset）");
    expect(r.stdout).toContain("MINIMAX_API_KEY（未设置 / unset）");
    expect(r.stdout).toContain("SPEECH_KEY（未设置 / unset）");
    expect(r.stdout).toContain("SPEECH_REGION（已设置 / set）");
    expect(r.stdout).toContain("https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create");
    expect(r.stdout).toContain("https://www.alibabacloud.com/help/en/model-studio/cosyvoice-tts-http-api");
    expect(r.stdout).toContain("https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-http");
    expect(r.stdout).toContain("https://platform.minimax.cn/docs/api-reference/speech-t2a-http");
    expect(r.stdout).toContain("https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech");
    expect(fs.existsSync(path.join(dir, "voice"))).toBe(false);
  });

  it("rejects an unknown preset and a value without a slash", async () => {
    const dir = project("**口播**：你好。\n");
    const unknown = await run(dir, { FLOWGIT_TTS: "nope/voice" });
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain("不认识的语音预设 nope");
    expect(unknown.stderr).toContain("Unknown speech preset nope");
    const bare = await run(dir, { FLOWGIT_TTS: "openai" });
    expect(bare.status).not.toBe(0);
    expect(bare.stderr).toContain("FLOWGIT_TTS 要写成");
    expect(bare.stderr).toContain("FLOWGIT_TTS must look like");
  });

  it("lets FLOWGIT_TTS_MODEL, FLOWGIT_TTS_VOICE and FLOWGIT_TTS_API_KEY override a preset", async () => {
    const { port, hits } = await serve((_hit, res) => rawOk(res, RAW));
    const dir = project("**口播**：你好。\n");
    const r = await run(dir, {
      FLOWGIT_TTS: "openai/tts-1",
      FLOWGIT_TTS_MODEL: "gpt-4o-mini-tts",
      FLOWGIT_TTS_VOICE: "nova",
      FLOWGIT_TTS_API_KEY: "override-key",
      OPENAI_API_KEY: "vendor-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1/`,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(hits[0].headers.authorization).toBe("Bearer override-key");
    expect(hits[0].url).toBe("/v1/audio/speech");
    expect(hits[0].json).toEqual({ model: "gpt-4o-mini-tts", input: "你好。", voice: "nova", response_format: "mp3", speed: 1 });
    expect(r.stdout).not.toContain("override-key");
    expect(r.stderr).not.toContain("override-key");
  });

  it("uses an English voice when the flow language is English", async () => {
    const { port, hits } = await serve((_hit, res) => jsonOk(res, { data: { audio: HEX.toString("hex"), status: 2 }, base_resp: { status_code: 0, status_msg: "success" } }));
    const dir = project("**Voiceover**: Cats love boxes.\n");
    const r = await run(dir, {
      FLOWGIT_TTS: "minimax/speech-02-hd",
      MINIMAX_API_KEY: "mm-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}`,
      FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "en" }),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(hits[0].json).toMatchObject({ model: "speech-02-hd", voice_setting: { voice_id: "English_expressive_narrator", speed: 1 } });
  });

  it("names the missing preset key and does not call the server", async () => {
    const { port, hits } = await serve((_hit, res) => rawOk(res, RAW));
    const dir = project("**口播**：你好。\n");
    const r = await run(dir, { FLOWGIT_TTS: "volcengine/seed-tts-2.0", FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}` });
    expect(r.status).not.toBe(0);
    expect(hits).toHaveLength(0);
    expect(r.stderr).toContain("没有设置 VOLCENGINE_API_KEY");
    expect(r.stderr).toContain("VOLCENGINE_API_KEY is not set");
    expect(fs.existsSync(path.join(dir, "voice", "README.md"))).toBe(false);
  });

  it("names a missing workspace id and a missing speech region", async () => {
    const dir = project("**口播**：你好。\n");
    const dash = await run(dir, { FLOWGIT_TTS: "dashscope/cosyvoice-v3-flash", DASHSCOPE_API_KEY: "dash-key" });
    expect(dash.status).not.toBe(0);
    expect(dash.stderr).toContain("没有设置 DASHSCOPE_WORKSPACE_ID");
    expect(dash.stderr).toContain("DASHSCOPE_WORKSPACE_ID is not set");
    expect(dash.stderr).not.toContain("dash-key");
    const azure = await run(dir, { FLOWGIT_TTS: "azure/zh-CN-Xiaoxiao:DragonHDFlashLatestNeural", SPEECH_KEY: "speech-key" });
    expect(azure.status).not.toBe(0);
    expect(azure.stderr).toContain("没有设置 SPEECH_REGION");
    expect(azure.stderr).toContain("SPEECH_REGION is not set");
  });

  it("explains a missing ffmpeg in both languages when pieces must be joined", async () => {
    const { port, hits } = await serve((_hit, res) => rawOk(res, Buffer.from("x")));
    const dir = project(`**口播**：${"甲".repeat(3000)}\n\n**口播**：${"乙".repeat(3000)}\n`);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-no-ffmpeg-"));
    dirs.push(empty);
    const r = await run(dir, {
      FLOWGIT_TTS_API_KEY: "sk-test-voice-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1`,
      PATH: empty,
    });
    expect(posts(hits)).toHaveLength(2);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("找不到 ffmpeg");
    expect(r.stderr).toContain("ffmpeg not found");
  });

  describe("openai", () => {
    // Official success body is the audio file itself (raw), not base64.
    it("posts the speech request and writes the raw audio", async () => {
      const { port, hits } = await serve((_hit, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(RAW);
      });
      const dir = project("**口播**：你好。\n");
      const key = "sk-openai-test";
      const r = await run(dir, {
        FLOWGIT_TTS: "openai/gpt-4o-mini-tts",
        OPENAI_API_KEY: key,
        FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1`,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(hits[0].method).toBe("POST");
      expect(hits[0].url).toBe("/v1/audio/speech");
      expect(hits[0].headers.authorization).toBe(`Bearer ${key}`);
      expect(hits[0].headers["content-type"]).toBe("application/json");
      expect(hits[0].json).toEqual({ model: "gpt-4o-mini-tts", input: "你好。", voice: "alloy", response_format: "mp3", speed: 1 });
      expect(audioFile(dir).equals(RAW)).toBe(true);
      expect(audioFile(dir).includes(Buffer.from(key))).toBe(false);
    });

    it("names OPENAI_API_KEY when the key is rejected", async () => {
      const key = "sk-openai-rejected";
      const { port, hits } = await serve((_hit, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(key);
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, { FLOWGIT_TTS: "openai/gpt-4o-mini-tts", OPENAI_API_KEY: key, FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
      expect(r.status).not.toBe(0);
      expect(hits).toHaveLength(1);
      expect(r.stderr).toContain("密钥被拒绝了，检查 OPENAI_API_KEY 是否正确");
      expect(r.stderr).toContain("The key was rejected; check OPENAI_API_KEY");
      expect(r.stderr).not.toContain(key);
    });

    it("splits a long script on a sentence boundary", async () => {
      const mp3 = hasFfmpeg ? tone() : Buffer.from("x");
      const { port, hits } = await serve((_hit, res) => rawOk(res, mp3));
      const first = `${"甲".repeat(3000)}。`;
      const second = "乙".repeat(3000);
      const dir = project(`**口播**：${first}${second}\n`);
      const r = await run(dir, { FLOWGIT_TTS: "openai/gpt-4o-mini-tts", OPENAI_API_KEY: "sk-openai-test", FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
      expect(posts(hits).map((hit) => (hit.json as { input: string }).input)).toEqual([first, second]);
      expect(posts(hits).every((hit) => ((hit.json as { input: string }).input ?? "").length <= 4096)).toBe(true);
      if (hasFfmpeg) expect(r.status, r.stderr).toBe(0);
      else {
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain("ffmpeg not found");
      }
    });
  });

  describe("dashscope", () => {
    const env = (port: number) => ({
      FLOWGIT_TTS: "dashscope/cosyvoice-v3-flash",
      DASHSCOPE_API_KEY: "dash-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}`,
    });

    it("posts the CosyVoice body and downloads the raw audio URL without the key", async () => {
      const { port, hits } = await serve((hit, res) => {
        if (hit.url === "/file.mp3") {
          rawOk(res, RAW);
          return;
        }
        jsonOk(res, {
          output: { audio: { data: "", url: `http://${hit.headers.host}/file.mp3` }, finish_reason: "stop" },
          request_id: "req-1",
        });
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      const posted = posts(hits);
      expect(posted).toHaveLength(1);
      expect(posted[0].url).toBe("/api/v1/services/audio/tts/SpeechSynthesizer");
      expect(posted[0].headers.authorization).toBe("Bearer dash-key");
      expect(posted[0].headers["content-type"]).toBe("application/json");
      expect(posted[0].json).toEqual({ model: "cosyvoice-v3-flash", input: { text: "你好。", voice: "longanyang", format: "mp3", rate: 1 } });
      const download = hits.find((hit) => hit.url === "/file.mp3");
      expect(download?.method).toBe("GET");
      expect(download?.headers.authorization).toBeUndefined();
      expect(audioFile(dir).equals(RAW)).toBe(true);
    });

    it("decodes base64 audio from output.audio.data", async () => {
      const { port, hits } = await serve((_hit, res) => {
        jsonOk(res, { output: { audio: { data: B64.toString("base64") }, finish_reason: "stop" }, request_id: "req-2" });
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      expect(hits).toHaveLength(1);
      expect(audioFile(dir).equals(B64)).toBe(true);
    });

    it("names DASHSCOPE_API_KEY when the key is rejected", async () => {
      const key = "dash-rejected";
      const { port } = await serve((_hit, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(key);
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, { ...env(port), DASHSCOPE_API_KEY: key });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("密钥被拒绝了，检查 DASHSCOPE_API_KEY 是否正确");
      expect(r.stderr).toContain("The key was rejected; check DASHSCOPE_API_KEY");
      expect(r.stderr).not.toContain(key);
    });

    it("splits text that is longer than one CosyVoice request", async () => {
      const mp3 = hasFfmpeg ? tone() : Buffer.from("x");
      const { port, hits } = await serve((_hit, res) => rawOk(res, mp3));
      const first = "甲".repeat(12000);
      const second = "乙".repeat(12000);
      const dir = project(`**口播**：${first}\n\n**口播**：${second}\n`);
      const r = await run(dir, env(port));
      expect(posts(hits).map((hit) => (hit.json as { input: { text: string } }).input.text)).toEqual([first, second]);
      expect(posts(hits).every((hit) => (hit.json as { input: { text: string } }).input.text.length <= 20000)).toBe(true);
      if (hasFfmpeg) expect(r.status, r.stderr).toBe(0);
      else expect(r.stderr).toContain("ffmpeg not found");
    });
  });

  describe("volcengine", () => {
    const env = (port: number, extra: Record<string, string> = {}) => ({
      FLOWGIT_TTS: "volcengine/seed-tts-2.0",
      VOLCENGINE_API_KEY: "volc-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}`,
      ...extra,
    });

    it("posts the Doubao request and concatenates base64 chunks", async () => {
      const { port, hits } = await serve((_hit, res) => {
        const a = Buffer.from("aaa");
        const b = Buffer.from("bbb");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          `${JSON.stringify({ code: 0, message: "OK", data: a.toString("base64") })}\n${JSON.stringify({ code: 0, message: "OK", data: b.toString("base64"), usage: { text_words: 2 } })}`,
        );
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      expect(hits[0].url).toBe("/api/v3/tts/unidirectional");
      expect(hits[0].headers["x-api-key"]).toBe("volc-key");
      expect(hits[0].headers["x-api-resource-id"]).toBe("seed-tts-2.0");
      expect(hits[0].headers["x-api-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
      expect(hits[0].headers["content-type"]).toBe("application/json");
      expect(hits[0].json).toEqual({
        req_params: {
          text: "你好。",
          speaker: "zh_female_vv_uranus_bigtts",
          audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 0 },
        },
      });
      expect(audioFile(dir).equals(Buffer.concat([Buffer.from("aaa"), Buffer.from("bbb")]))).toBe(true);
    });

    it("accepts a raw audio body and lets model and voice overrides win", async () => {
      const { port, hits } = await serve((_hit, res) => rawOk(res, RAW));
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port, { FLOWGIT_TTS_MODEL: "seed-icl-2.0", FLOWGIT_TTS_VOICE: "en_female_dacey_uranus_bigtts" }));
      expect(r.status, r.stderr).toBe(0);
      expect(hits[0].headers["x-api-resource-id"]).toBe("seed-icl-2.0");
      expect((hits[0].json as { req_params: { speaker: string } }).req_params.speaker).toBe("en_female_dacey_uranus_bigtts");
      expect(audioFile(dir).equals(RAW)).toBe(true);
    });

    it("names VOLCENGINE_API_KEY when the key is rejected", async () => {
      const key = "volc-rejected";
      const { port } = await serve((_hit, res) => {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end(key);
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port, { VOLCENGINE_API_KEY: key }));
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("密钥被拒绝了，检查 VOLCENGINE_API_KEY 是否正确");
      expect(r.stderr).toContain("The key was rejected; check VOLCENGINE_API_KEY");
      expect(r.stderr).not.toContain(key);
    });

    it("splits text above 1024 UTF-8 bytes", async () => {
      const mp3 = hasFfmpeg ? tone() : Buffer.from("x");
      const { port, hits } = await serve((_hit, res) => rawOk(res, mp3));
      const spoken = "啊".repeat(400);
      const dir = project(`**口播**：${spoken}\n`);
      const r = await run(dir, env(port));
      const texts = posts(hits).map((hit) => (hit.json as { req_params: { text: string } }).req_params.text);
      expect(texts.length).toBeGreaterThan(1);
      expect(texts.every((text) => Buffer.byteLength(text) <= 1024)).toBe(true);
      expect(texts.join("")).toBe(spoken);
      const ids = posts(hits).map((hit) => hit.headers["x-api-request-id"]);
      expect(new Set(ids).size).toBe(ids.length);
      if (hasFfmpeg) expect(r.status, r.stderr).toBe(0);
      else expect(r.stderr).toContain("ffmpeg not found");
    });
  });

  describe("minimax", () => {
    const env = (port: number) => ({
      FLOWGIT_TTS: "minimax/speech-2.8-hd",
      MINIMAX_API_KEY: "mm-key",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}`,
    });

    it("posts the T2A body and decodes hex audio", async () => {
      const { port, hits } = await serve((_hit, res) => {
        jsonOk(res, { data: { audio: HEX.toString("hex"), status: 2 }, base_resp: { status_code: 0, status_msg: "success" } });
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      expect(hits[0].url).toBe("/v1/t2a_v2");
      expect(hits[0].headers.authorization).toBe("Bearer mm-key");
      expect(hits[0].headers["content-type"]).toBe("application/json");
      expect(hits[0].json).toEqual({
        model: "speech-2.8-hd",
        text: "你好。",
        stream: false,
        output_format: "hex",
        voice_setting: { voice_id: "male-qn-qingse", speed: 1 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      });
      expect(audioFile(dir).equals(HEX)).toBe(true);
    });

    it("accepts a raw audio body", async () => {
      const { port } = await serve((_hit, res) => rawOk(res, RAW));
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      expect(audioFile(dir).equals(RAW)).toBe(true);
    });

    it("names MINIMAX_API_KEY when the key is rejected", async () => {
      const key = "mm-rejected";
      const { port } = await serve((_hit, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ base_resp: { status_code: 1004, status_msg: key } }));
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, { ...env(port), MINIMAX_API_KEY: key });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("密钥被拒绝了，检查 MINIMAX_API_KEY 是否正确");
      expect(r.stderr).toContain("The key was rejected; check MINIMAX_API_KEY");
      expect(r.stderr).not.toContain(key);
    });

    it("splits text at the 10000-character cap", async () => {
      const mp3 = hasFfmpeg ? tone() : Buffer.from("x");
      const { port, hits } = await serve((_hit, res) => rawOk(res, mp3));
      const first = "甲".repeat(6000);
      const second = "乙".repeat(6000);
      const dir = project(`**口播**：${first}\n\n**口播**：${second}\n`);
      const r = await run(dir, env(port));
      const texts = posts(hits).map((hit) => (hit.json as { text: string }).text);
      expect(texts).toEqual([first, second]);
      expect(texts.every((text) => text.length < 10000)).toBe(true);
      if (hasFfmpeg) expect(r.status, r.stderr).toBe(0);
      else expect(r.stderr).toContain("ffmpeg not found");
    });
  });

  describe("azure", () => {
    const voice = "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural";
    const env = (port: number, extra: Record<string, string> = {}) => ({
      FLOWGIT_TTS: `azure/${voice}`,
      SPEECH_KEY: "speech-key",
      SPEECH_REGION: "eastus",
      FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}`,
      ...extra,
    });

    it("posts SSML and writes the raw audio", async () => {
      const { port, hits } = await serve((_hit, res) => rawOk(res, RAW));
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      expect(hits[0].url).toBe("/cognitiveservices/v1");
      expect(hits[0].headers.authorization).toBeUndefined();
      expect(hits[0].headers["ocp-apim-subscription-key"]).toBe("speech-key");
      expect(hits[0].headers["content-type"]).toBe("application/ssml+xml");
      expect(hits[0].headers["x-microsoft-outputformat"]).toBe("audio-16khz-128kbitrate-mono-mp3");
      expect(hits[0].headers["user-agent"]).toBe("flowgit");
      expect(hits[0].raw).toBe(
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${voice}"><prosody rate="1">你好。</prosody></voice></speak>`,
      );
      expect(audioFile(dir).equals(RAW)).toBe(true);
    });

    it("escapes SSML", async () => {
      const { port, hits } = await serve((_hit, res) => rawOk(res, RAW));
      const dir = project("**口播**：A & B <C>\n");
      const r = await run(dir, env(port));
      expect(r.status, r.stderr).toBe(0);
      expect(hits[0].raw).toContain("A &amp; B &lt;C&gt;");
      expect(hits[0].raw).not.toContain("A & B");
    });

    it("names SPEECH_KEY when the key is rejected", async () => {
      const key = "speech-rejected";
      const { port } = await serve((_hit, res) => {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end(key);
      });
      const dir = project("**口播**：你好。\n");
      const r = await run(dir, env(port, { SPEECH_KEY: key }));
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("密钥被拒绝了，检查 SPEECH_KEY 是否正确");
      expect(r.stderr).toContain("The key was rejected; check SPEECH_KEY");
      expect(r.stderr).not.toContain(key);
    });

    it("splits text so one request stays under the ten-minute cap", async () => {
      const mp3 = hasFfmpeg ? tone() : Buffer.from("x");
      const { port, hits } = await serve((_hit, res) => rawOk(res, mp3));
      const first = "甲".repeat(2000);
      const second = "乙".repeat(2000);
      const dir = project(`**口播**：${first}\n\n**口播**：${second}\n`);
      const r = await run(dir, env(port));
      const texts = posts(hits).map((hit) => hit.raw.match(/<prosody rate="1">([\s\S]*?)<\/prosody>/)?.[1] ?? "");
      expect(texts).toEqual([first, second]);
      expect(texts.every((text) => text.length <= 2500)).toBe(true);
      if (hasFfmpeg) expect(r.status, r.stderr).toBe(0);
      else expect(r.stderr).toContain("ffmpeg not found");
    });
  });

  it.skipIf(!hasFfmpeg)("joins split voiceover parts with ffmpeg", async () => {
    const mp3 = tone();
    const { port } = await serve((_hit, res) => rawOk(res, mp3));
    const dir = project(`**口播**：${"甲".repeat(3000)}。${"乙".repeat(3000)}\n`);
    const r = await run(dir, { FLOWGIT_TTS: "openai/gpt-4o-mini-tts", OPENAI_API_KEY: "sk-openai-test", FLOWGIT_TTS_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(r.status, r.stderr).toBe(0);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "voice", "voice.mp3")], {
      encoding: "utf8",
    });
    expect(Number(probe.stdout)).toBeGreaterThan(0.4);
  });
});
