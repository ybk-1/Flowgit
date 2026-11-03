#!/usr/bin/env node
// "voice" stage: an AI voice for each segment, only when the voice input is "ai".
//
// Each segment's narration goes to an OpenAI-compatible speech endpoint
// (POST {FLOWGIT_TTS_BASE_URL}/audio/speech) and lands in voice/<segment>.mp3.
// Every file opens with the aiNotice sentence from rules.md: China's Measures
// for Labeling AI-Generated and Synthetic Content (art. 4) ask for a spoken
// notice in synthetic audio, and each segment is published as its own video.
// voice/voice.json lists the files and the notice for the captions stage.
//
// The key is sent only as a header and never written to a file. With voice set
// to "record", or no FLOWGIT_TTS_API_KEY, the stage writes a note and succeeds.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const rulesFile = process.argv[2] ?? "rules.md";
const voiceDir = outputs[0]?.path ?? "voice/";

// https://platform.openai.com/docs/api-reference/audio/createSpeech
// `input` maximum length is 4096 characters.
const INPUT_LIMIT = 4096;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") : null);
const envOr = (name, fallback) => process.env[name]?.trim() || fallback;
const redact = (text, key) => (key ? String(text).split(key).join("***") : String(text));

function rulesBlock() {
  const fenced = read(rulesFile)?.match(/```json\n([\s\S]*?)\n```/);
  if (!fenced) throw new Error(t(`${rulesFile} 里没有 JSON 规则块`, `${rulesFile} has no JSON rules block`));
  try {
    return JSON.parse(fenced[1]);
  } catch (err) {
    throw new Error(t(`${rulesFile} 的 JSON 不合法：${err.message}`, `The JSON in ${rulesFile} is invalid: ${err.message}`));
  }
}

/** Remove what an earlier AI run left, so a switch back to "record" leaves no stale voice behind. */
function clearVoice() {
  fs.mkdirSync(voiceDir, { recursive: true });
  for (const name of fs.readdirSync(voiceDir)) {
    if (/\.(mp3|json)$/i.test(name)) fs.rmSync(path.join(voiceDir, name), { force: true });
  }
}

function skip(message) {
  clearVoice();
  fs.writeFileSync(path.join(voiceDir, "README.md"), `${message}\n`);
  console.log(message);
}

/** Split text on a sentence boundary so each request fits the API limit. */
function chunksOf(text) {
  const out = [];
  let rest = text.trim();
  while (rest.length > INPUT_LIMIT) {
    const head = rest.slice(0, INPUT_LIMIT);
    let cut = -1;
    for (const mark of ["\n\n", "。", "！", "？", ". ", "! ", "? ", "；", "; ", "\n"]) {
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

function proxyLines(env) {
  const proxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].find((k) => env[k]);
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return [];
  return [
    `检测到 ${proxy}，但 Node 默认不走代理。设置 NODE_USE_ENV_PROXY=1 后重试（PowerShell：$env:NODE_USE_ENV_PROXY="1"；macOS/Linux：export NODE_USE_ENV_PROXY=1）。`,
    `${proxy} is set, but Node ignores proxies by default. Set NODE_USE_ENV_PROXY=1 and try again (PowerShell: $env:NODE_USE_ENV_PROXY="1"; macOS/Linux: export NODE_USE_ENV_PROXY=1).`,
  ];
}

function connectionError(base, err, key) {
  const error = err instanceof Error ? err : new Error(String(err));
  const cause = error.cause && typeof error.cause === "object" && "message" in error.cause ? String(error.cause.message) : "";
  return new Error(
    redact(
      [
        `请求语音合成（${base}）失败 / Request to text-to-speech (${base}) failed: ${error.name}: ${error.message}${cause ? ` (${cause})` : ""}`,
        "连不上这个地址，检查 FLOWGIT_TTS_BASE_URL 和网络 / Could not reach it; check FLOWGIT_TTS_BASE_URL and your network",
        ...proxyLines(process.env),
      ].join("\n"),
      key,
    ),
  );
}

async function httpError(base, response, key) {
  const detail = (await response.text()).trim().slice(0, 500);
  const lines = [`请求语音合成（${base}）失败 / Request to text-to-speech (${base}) failed: ${response.status}${detail ? ` ${detail}` : ""}`];
  if (response.status === 401 || response.status === 403) lines.push("密钥被拒绝了，检查 FLOWGIT_TTS_API_KEY / The key was rejected; check FLOWGIT_TTS_API_KEY");
  else if (response.status === 429) lines.push("请求太频繁，或者额度用完了，稍后再试 / Rate-limited or out of quota; try again later");
  else if (response.status >= 500) lines.push("供应商那边暂时出错，稍后再试 / The provider returned a server error; try again later");
  return new Error(redact(lines.join("\n"), key));
}

/** POST {base}/audio/speech. Redirects stay on the same origin so the key is never sent to another site. */
async function postSpeech(base, body, key) {
  const started = new URL(`${base}/audio/speech`);
  let url = started;
  const payload = JSON.stringify(body);
  for (let hop = 0; ; hop++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: payload,
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
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
            `语音合成要求跳转到另一个地址 ${next.origin}，为了不把密钥发过去，没有跟过去 / text-to-speech redirected to another origin, ${next.origin}; it was not followed so the key stays put`,
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

function joinParts(files, outFile) {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    throw new Error(t("这一段太长，要用 ffmpeg 拼接，但找不到 ffmpeg（https://ffmpeg.org/download.html）", "This segment is long enough to need joining with ffmpeg, which was not found (https://ffmpeg.org/download.html)"));
  }
  const list = path.join(path.dirname(files[0]), "concat.txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  const joined = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", outFile], { encoding: "utf8" });
  if (joined.status !== 0) throw new Error(t(`ffmpeg 拼接配音失败：\n${joined.stderr ?? ""}`, `ffmpeg failed to join the voice:\n${joined.stderr ?? ""}`));
}

async function main() {
  const rules = rulesBlock();
  if (flowInputs.voice !== "ai") {
    skip(
      t(
        "输入 voice 是 record：你自己录，这一步不合成配音。要用 AI 配音，把 voice 改成 ai，并设置 FLOWGIT_TTS_API_KEY。",
        "The voice input is record: you record it yourself, so no AI voice was made. For an AI voice, set voice to ai and set FLOWGIT_TTS_API_KEY.",
      ),
    );
    return;
  }
  const key = process.env.FLOWGIT_TTS_API_KEY?.trim() ?? "";
  if (!key) {
    skip(
      t(
        "输入 voice 是 ai，但没有设置 FLOWGIT_TTS_API_KEY，跳过 AI 配音。设置以后重跑这一步，或者把 voice 改回 record 自己录。",
        "The voice input is ai, but FLOWGIT_TTS_API_KEY is not set, so no AI voice was made. Set it and run this stage again, or set voice back to record and record it yourself.",
      ),
    );
    return;
  }
  let script;
  try {
    script = JSON.parse(read("script.json") ?? "");
  } catch (err) {
    throw new Error(t(`script.json 不存在或不是合法的 JSON：${err.message}`, `script.json is missing or not valid JSON: ${err.message}`));
  }
  const notice = String(rules.aiNotice?.[en ? "en" : "zh"] ?? "").trim();
  const base = envOr("FLOWGIT_TTS_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = envOr("FLOWGIT_TTS_MODEL", "gpt-4o-mini-tts");
  const voiceName = envOr("FLOWGIT_TTS_VOICE", "alloy");
  const segments = (Array.isArray(script.segments) ? script.segments : []).filter((s) => /^s[1-9][0-9]*$/.test(String(s?.id ?? "")));
  if (!segments.length) throw new Error(t("script.json 里没有可以念的段", "script.json has no segments to read"));

  clearVoice();
  fs.rmSync(path.join(voiceDir, "README.md"), { force: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-voice-"));
  const made = [];
  try {
    for (const seg of segments) {
      const narration = (Array.isArray(seg.slides) ? seg.slides : []).map((s) => String(s?.narration ?? "").trim()).filter(Boolean);
      if (!narration.length) continue;
      const chunks = chunksOf([notice, ...narration].filter(Boolean).join("\n\n"));
      const parts = [];
      for (const [i, input] of chunks.entries()) {
        console.log(t(`正在合成 ${seg.id}，第 ${i + 1}/${chunks.length} 部分`, `synthesizing ${seg.id}, part ${i + 1}/${chunks.length}`));
        // https://platform.openai.com/docs/api-reference/audio/createSpeech
        const audio = await postSpeech(base, { model, input, voice: voiceName, response_format: "mp3" }, key);
        const file = path.join(tmp, `${seg.id}-${i}.mp3`);
        fs.writeFileSync(file, audio);
        parts.push(file);
      }
      const outFile = path.join(voiceDir, `${seg.id}.mp3`);
      if (parts.length === 1) fs.copyFileSync(parts[0], outFile);
      else joinParts(parts, outFile);
      made.push({ id: seg.id, file: `${seg.id}.mp3` });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(voiceDir, "voice.json"), `${JSON.stringify({ ai: true, notice, model, voice: voiceName, segments: made }, null, 2)}\n`);
  console.log(t(`AI 配音写好了：${made.map((m) => path.join(voiceDir, m.file).replace(/\\/g, "/")).join("、")}。每段开头都说了「${notice}」`, `Wrote the AI voice: ${made.map((m) => path.join(voiceDir, m.file).replace(/\\/g, "/")).join(", ")}. Each opens with "${notice}"`));
}

main().catch((err) => {
  console.error(redact(err instanceof Error ? err.message : String(err), process.env.FLOWGIT_TTS_API_KEY?.trim() ?? ""));
  process.exit(1);
});
