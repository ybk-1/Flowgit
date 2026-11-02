// 配音阶段：把 script.md 里要念的口播合成 voice/voice.mp3。
// Voice stage: turn the spoken lines of script.md into voice/voice.mp3.
//
// 密钥只放在请求头里，不写进任何文件。没设置 FLOWGIT_TTS_API_KEY 时不报错，写一份说明后退出。
// The key is sent only as a header and never written to a file. With no FLOWGIT_TTS_API_KEY
// the stage writes a note and exits successfully.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const lang = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}").language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);

// https://platform.openai.com/docs/api-reference/audio/createSpeech
// `input` maximum length is 4096 characters.
const INPUT_LIMIT = 4096;
const SKIP_MESSAGE =
  "没有配置语音合成，跳过自动配音；可以自己录 assets/voice.mp3，或设置 FLOWGIT_TTS_API_KEY / No text-to-speech configured, so no voiceover was made; record assets/voice.mp3 yourself or set FLOWGIT_TTS_API_KEY";

const VOICE_NAMES = new Set(["口播", "旁白", "voiceover", "narration"]);
const VISUAL_NAMES = new Set(["画面", "视觉", "画面提示", "visual", "visual note"]);

function envOr(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** A bold or plain "口播：" / "Visual:" label, or null when the line is ordinary text. */
function classify(line) {
  const match = line.match(/^(?:[-*]\s+)?(?:\*\*|__)?([A-Za-z\u4e00-\u9fff ]+?)(?:\*\*|__)?(?:\s*[:：]\s*([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1].trim().toLowerCase();
  if (VOICE_NAMES.has(name)) return { kind: "voice", rest: (match[2] ?? "").trim() };
  if (VISUAL_NAMES.has(name)) return { kind: "visual", rest: (match[2] ?? "").trim() };
  return null;
}

function stripMarkup(line) {
  return line
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .trim();
}

/**
 * Narration only. Headings, visual notes and any other unspoken part are dropped.
 * A script with 口播 / Voiceover labels speaks those sections; a plain script speaks
 * its paragraphs, still without headings or visual notes.
 */
function spokenParagraphs(markdown) {
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const lines = text.split("\n");
  const hasVoice = lines.some((line) => classify(line.trim())?.kind === "voice");
  const paragraphs = [];
  let buf = [];
  let mode = hasVoice ? "drop" : "speak";
  let fence = false;
  const flush = () => {
    const paragraph = buf.join("\n").trim();
    buf = [];
    if (paragraph) paragraphs.push(paragraph);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      if (mode === "speak") flush();
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (!line || /^([-*_])\1{2,}$/.test(line)) {
      if (mode === "speak") flush();
      else if (mode === "visual") mode = hasVoice ? "drop" : "speak";
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      if (mode === "speak") flush();
      mode = hasVoice ? "drop" : "speak";
      continue;
    }
    const label = classify(line);
    if (label?.kind === "voice") {
      flush();
      mode = "speak";
      if (label.rest) buf.push(stripMarkup(label.rest));
      continue;
    }
    if (label?.kind === "visual") {
      if (mode === "speak") flush();
      mode = "visual";
      continue;
    }
    if (mode === "speak") buf.push(stripMarkup(line));
  }
  if (mode === "speak") flush();
  return paragraphs;
}

/** Split one paragraph on a sentence boundary when it exceeds the API limit. */
function withinLimit(text) {
  const out = [];
  let rest = text.trim();
  while (rest.length > INPUT_LIMIT) {
    const head = rest.slice(0, INPUT_LIMIT);
    let cut = -1;
    for (const mark of ["。", "！", "？", "!", "?", "；", ";", "\n"]) {
      const at = head.lastIndexOf(mark);
      if (at > cut) cut = at + mark.length;
    }
    if (cut < 32) cut = INPUT_LIMIT;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Pack paragraphs into requests that each fit the speech API input limit. */
function chunksOf(paragraphs) {
  const chunks = [];
  let cur = "";
  const flush = () => {
    if (cur) chunks.push(cur);
    cur = "";
  };
  for (const paragraph of paragraphs) {
    for (const piece of withinLimit(paragraph)) {
      const next = cur ? `${cur}\n\n${piece}` : piece;
      if (next.length > INPUT_LIMIT) {
        flush();
        cur = piece;
      } else {
        cur = next;
      }
    }
  }
  flush();
  return chunks;
}

function proxyLines(env) {
  const proxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].find((key) => env[key]);
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return [];
  return [
    `检测到 ${proxy}，但 Node 默认不走代理。设置 NODE_USE_ENV_PROXY=1 后重试（PowerShell：$env:NODE_USE_ENV_PROXY="1"；macOS/Linux：export NODE_USE_ENV_PROXY=1）。还是不行就升级到最新的 Node 22 或 24。`,
    `${proxy} is set, but Node ignores proxies by default. Set NODE_USE_ENV_PROXY=1 and try again (PowerShell: $env:NODE_USE_ENV_PROXY="1"; macOS/Linux: export NODE_USE_ENV_PROXY=1). If it still fails, update to the latest Node 22 or 24.`,
  ];
}

function redact(text, key) {
  return key ? text.split(key).join("***") : text;
}

function connectionError(base, err, key) {
  const error = err instanceof Error ? err : new Error(String(err));
  const cause = error.cause && typeof error.cause === "object" && "message" in error.cause ? String(error.cause.message) : "";
  const msg = `${error.name}: ${error.message}${cause ? ` (${cause})` : ""}`;
  const lines = [
    `请求语音合成（${base}）失败 / Request to text-to-speech (${base}) failed: ${msg}`,
    "连不上这个地址，检查 FLOWGIT_TTS_BASE_URL 和网络 / Could not reach it; check FLOWGIT_TTS_BASE_URL and your network",
    ...proxyLines(process.env),
  ];
  return new Error(redact(lines.join("\n"), key));
}

async function httpError(base, response, key) {
  const detail = (await response.text()).trim().slice(0, 500);
  const lines = [
    `请求语音合成（${base}）失败 / Request to text-to-speech (${base}) failed: ${response.status}${detail ? ` ${detail}` : ""}`,
  ];
  if (response.status === 401 || response.status === 403) {
    lines.push("密钥被拒绝了，检查 FLOWGIT_TTS_API_KEY 是否正确 / The key was rejected; check FLOWGIT_TTS_API_KEY");
  } else if (response.status === 429) {
    lines.push(
      "请求太频繁，或者额度、用量上限用完了。稍后再试，或到供应商的控制台检查额度 / Rate-limited or out of quota. Try again later, or check your limits in the provider's console",
    );
  } else if (response.status >= 500) {
    lines.push("供应商那边暂时出错，稍后再试 / The provider returned a server error; try again later");
  }
  return new Error(redact(lines.join("\n"), key));
}

/**
 * POST {base}/audio/speech. Redirects stay on the same origin so the key
 * in Authorization is never sent to another site.
 */
async function postSpeech(base, body, key) {
  const started = new URL(`${base}/audio/speech`);
  let url = started;
  const payload = JSON.stringify(body);
  for (let hop = 0; ; hop++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: payload,
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw connectionError(base, err, key);
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location) {
      const next = new URL(location, url);
      if (next.origin !== started.origin) {
        throw new Error(
          redact(
            `语音合成要求跳转到另一个地址 ${next.origin}，为了不把密钥发过去，没有跟过去。确认可信后把 FLOWGIT_TTS_BASE_URL 改成新地址 / text-to-speech redirected to another origin, ${next.origin}; it was not followed so the key stays put. If you trust it, set FLOWGIT_TTS_BASE_URL to the new address`,
            key,
          ),
        );
      }
      if (hop >= 5) throw new Error("跳转太多次 / too many redirects");
      url = next;
      continue;
    }
    if (!response.ok) throw await httpError(base, response, key);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("语音合成没有返回音频 / text-to-speech returned no audio");
    return bytes;
  }
}

function joinWithFfmpeg(files, outFile) {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error(
      say(
        "找不到 ffmpeg，请先安装（https://ffmpeg.org/download.html）再重跑这个阶段",
        "ffmpeg not found. Install it (https://ffmpeg.org/download.html) and run this stage again.",
      ),
    );
  }
  const list = path.join(path.dirname(files[0]), "concat.txt");
  const body = files.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(list, body);
  const joined = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", outFile],
    { encoding: "utf8" },
  );
  if (joined.status !== 0) {
    throw new Error(
      say(
        `ffmpeg 拼接配音失败：\n${joined.stderr ?? ""}`,
        `ffmpeg failed to join the voiceover:\n${joined.stderr ?? ""}`,
      ),
    );
  }
}

function skipVoiceover() {
  const voiceDir = path.join(dir, "voice");
  fs.mkdirSync(voiceDir, { recursive: true });
  fs.rmSync(path.join(voiceDir, "voice.mp3"), { force: true });
  fs.writeFileSync(path.join(voiceDir, "README.md"), `${SKIP_MESSAGE}\n`);
  console.log(SKIP_MESSAGE);
}

async function main() {
  const key = process.env.FLOWGIT_TTS_API_KEY?.trim() ?? "";
  if (!key) {
    skipVoiceover();
    return;
  }
  const scriptPath = path.join(dir, "script.md");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(say("找不到 script.md", "script.md not found"));
  }
  const paragraphs = spokenParagraphs(fs.readFileSync(scriptPath, "utf8"));
  const chunks = chunksOf(paragraphs);
  if (!chunks.length) {
    throw new Error(say("脚本里没有可以念的旁白", "the script has no narration to read"));
  }
  const base = envOr("FLOWGIT_TTS_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = envOr("FLOWGIT_TTS_MODEL", "gpt-4o-mini-tts");
  const voiceName = envOr("FLOWGIT_TTS_VOICE", "alloy");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-tts-"));
  try {
    const parts = [];
    for (const [i, input] of chunks.entries()) {
      console.log(say(`正在合成第 ${i + 1}/${chunks.length} 段`, `synthesizing part ${i + 1}/${chunks.length}`));
      // https://platform.openai.com/docs/api-reference/audio/createSpeech
      const audio = await postSpeech(base, { model, input, voice: voiceName, response_format: "mp3" }, key);
      const file = path.join(tmp, `part-${i}.mp3`);
      fs.writeFileSync(file, audio);
      parts.push(file);
    }
    const voiceDir = path.join(dir, "voice");
    fs.mkdirSync(voiceDir, { recursive: true });
    const outFile = path.join(voiceDir, "voice.mp3");
    joinWithFfmpeg(parts, outFile);
    fs.rmSync(path.join(voiceDir, "README.md"), { force: true });
    console.log(say("配音已写入 voice/voice.mp3", "wrote voice/voice.mp3"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(redact(message, process.env.FLOWGIT_TTS_API_KEY?.trim() ?? ""));
  process.exit(1);
});
