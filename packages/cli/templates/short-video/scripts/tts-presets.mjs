// Speech presets for the short-video voice stage.
// Chosen with FLOWGIT_TTS=<provider>/<model or voice>.
// FLOWGIT_TTS_BASE_URL, FLOWGIT_TTS_API_KEY, FLOWGIT_TTS_MODEL and FLOWGIT_TTS_VOICE
// override the preset. Keys are read from the environment and never written to a file.
// Every URL and parameter below is taken from the linked official docs. HTTP only.
import { randomUUID } from "node:crypto";

const NO_AUDIO = "语音合成没有返回音频 / text-to-speech returned no audio";
const BAD_AUDIO = "语音合成返回的音频无法解码 / text-to-speech returned audio that could not be decoded";
const BAD_JSON = "语音合成返回的内容无法解析 / text-to-speech returned a response that could not be parsed";

/**
 * @typedef {"model" | "voice"} Selector
 * @typedef {"chars" | "utf8"} LimitUnit
 * @typedef {{ zh: string[], en: string[] }} Voices
 */

/**
 * @type {Array<{
 *   id: string,
 *   nameZh: string,
 *   nameEn: string,
 *   docs: string,
 *   apiKeyEnv: string,
 *   extras: Array<{ name: string, purposeZh: string, purposeEn: string }>,
 *   selector: Selector,
 *   defaultModel: string,
 *   voices: Voices,
 *   format: "mp3",
 *   speedZh: string,
 *   speedEn: string,
 *   inputLimit: number,
 *   limitUnit: LimitUnit,
 *   limitNote: string,
 *   path: string,
 *   origin: (env: NodeJS.ProcessEnv, baseOverride: string) => string,
 * }>}
 */
export const PRESETS = [
  {
    id: "openai",
    nameZh: "OpenAI 语音合成",
    nameEn: "OpenAI Audio Speech",
    // https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
    // Voices (multilingual; optimized for English): https://developers.openai.com/api/docs/guides/text-to-speech
    docs: "https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create",
    apiKeyEnv: "OPENAI_API_KEY",
    extras: [],
    selector: "model",
    defaultModel: "gpt-4o-mini-tts",
    voices: {
      zh: ["alloy", "nova", "shimmer"],
      en: ["coral", "marin", "alloy"],
    },
    format: "mp3",
    speedZh: "speed 1（范围 0.25–4）",
    speedEn: "speed 1 (range 0.25–4)",
    // input maxLength 4096
    inputLimit: 4096,
    limitUnit: "chars",
    limitNote: "4096 characters",
    path: "/audio/speech",
    origin: (_env, baseOverride) => baseOverride || "https://api.openai.com/v1",
  },
  {
    id: "dashscope",
    nameZh: "阿里云百炼 CosyVoice",
    nameEn: "Alibaba DashScope CosyVoice",
    // https://www.alibabacloud.com/help/en/model-studio/cosyvoice-tts-http-api
    // Voices: https://help.aliyun.com/en/model-studio/cosyvoice-voice-list
    // Per-call text cap (HTTP synthesize): https://www.alibabacloud.com/help/en/model-studio/cosyvoice-python-sdk
    docs: "https://www.alibabacloud.com/help/en/model-studio/cosyvoice-tts-http-api",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    extras: [
      {
        name: "DASHSCOPE_WORKSPACE_ID",
        purposeZh: "填进官方地址里的工作空间 ID",
        purposeEn: "workspace id in the official host",
      },
    ],
    selector: "model",
    defaultModel: "cosyvoice-v3-flash",
    voices: {
      zh: ["longanyang", "longanhuan", "longhuhu_v3"],
      en: ["loongabby_v3", "loongandy_v3", "loongemily_v3"],
    },
    format: "mp3",
    speedZh: "rate 1（范围 0.5–2）",
    speedEn: "rate 1 (range 0.5–2)",
    inputLimit: 20000,
    limitUnit: "chars",
    limitNote: "20000 characters",
    path: "/api/v1/services/audio/tts/SpeechSynthesizer",
    origin(env, baseOverride) {
      if (baseOverride) return baseOverride;
      const id = env.DASHSCOPE_WORKSPACE_ID?.trim() ?? "";
      if (!id) {
        throw new Error(
          "没有设置 DASHSCOPE_WORKSPACE_ID，没法拼出语音接口地址。也可以改用 FLOWGIT_TTS_BASE_URL / DASHSCOPE_WORKSPACE_ID is not set, so the speech URL cannot be built. Set FLOWGIT_TTS_BASE_URL instead",
        );
      }
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(id)) {
        throw new Error("DASHSCOPE_WORKSPACE_ID 不是合法的工作空间 ID / DASHSCOPE_WORKSPACE_ID is not a valid workspace id");
      }
      // https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
      return `https://${id}.cn-beijing.maas.aliyuncs.com`;
    },
  },
  {
    id: "volcengine",
    nameZh: "火山引擎豆包语音合成",
    nameEn: "Volcengine Doubao speech",
    // https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-http
    // Voices: https://docs.volcengine.com/docs/doubao-voice/tone-list-3
    docs: "https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-http",
    apiKeyEnv: "VOLCENGINE_API_KEY",
    extras: [],
    selector: "model",
    defaultModel: "seed-tts-2.0",
    voices: {
      zh: ["zh_female_vv_uranus_bigtts", "zh_female_xiaohe_uranus_bigtts", "zh_male_m191_uranus_bigtts"],
      en: ["en_female_dacey_uranus_bigtts", "en_female_stokie_uranus_bigtts", "en_male_tim_uranus_bigtts"],
    },
    format: "mp3",
    speedZh: "speech_rate 0（1 倍速，范围 -50–100）",
    speedEn: "speech_rate 0 (1x, range -50–100)",
    // The V3 HTTP page (updated 2026-10-27) does not publish a character cap.
    // The V1 HTTP API caps one text at 1024 UTF-8 bytes:
    // https://docs.volcengine.com/docs/doubao-voice/http-one-timecompositenon-streaming-interface-v1-not-recommended
    inputLimit: 1024,
    limitUnit: "utf8",
    limitNote: "1024 UTF-8 bytes",
    path: "/api/v3/tts/unidirectional",
    origin: (_env, baseOverride) => baseOverride || "https://openspeech.bytedance.com",
  },
  {
    id: "minimax",
    nameZh: "MiniMax 语音合成",
    nameEn: "MiniMax speech",
    // https://platform.minimax.cn/docs/api-reference/speech-t2a-http (https://api.minimax.cn/v1/t2a_v2)
    // International host, same path: https://platform.minimax.io/docs/api-reference/speech-t2a-http
    docs: "https://platform.minimax.cn/docs/api-reference/speech-t2a-http",
    apiKeyEnv: "MINIMAX_API_KEY",
    extras: [],
    selector: "model",
    defaultModel: "speech-2.8-hd",
    voices: {
      zh: ["male-qn-qingse", "Chinese (Mandarin)_Lyrical_Voice", "Chinese (Mandarin)_HK_Flight_Attendant"],
      en: ["English_expressive_narrator", "English_Graceful_Lady", "English_Insightful_Speaker"],
    },
    format: "mp3",
    speedZh: "speed 1（范围 0.5–2）",
    speedEn: "speed 1 (range 0.5–2)",
    // "Must be less than 10,000 characters."
    inputLimit: 9999,
    limitUnit: "chars",
    limitNote: "9999 characters",
    path: "/v1/t2a_v2",
    origin: (_env, baseOverride) => baseOverride || "https://api.minimax.cn",
  },
  {
    id: "azure",
    nameZh: "Azure 语音",
    nameEn: "Azure Speech",
    // https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech
    // Region host and SPEECH_KEY / SPEECH_REGION: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech
    // SSML rate: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice
    // Voices: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices
    docs: "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech",
    apiKeyEnv: "SPEECH_KEY",
    extras: [
      {
        name: "SPEECH_REGION",
        purposeZh: "区域，用来拼官方地址",
        purposeEn: "region used in the official host",
      },
    ],
    selector: "voice",
    defaultModel: "",
    voices: {
      zh: ["zh-CN-Xiaoxiao:DragonHDFlashLatestNeural", "zh-CN-Yunxi:DragonHDFlashLatestNeural", "zh-CN-XiaomoNeural"],
      en: ["en-US-Ava:DragonHDLatestNeural", "en-US-AvaMultilingualNeural", "en-US-AvaNeural"],
    },
    format: "mp3",
    speedZh: 'prosody rate="1"（1 倍速，约 0.5–2）',
    speedEn: 'prosody rate="1" (1x, about 0.5–2)',
    // REST: audio longer than 10 minutes is truncated. ~2500 Chinese characters stays under that.
    inputLimit: 2500,
    limitUnit: "chars",
    limitNote: "2500 characters",
    path: "/cognitiveservices/v1",
    origin(env, baseOverride) {
      if (baseOverride) return baseOverride;
      const region = (env.SPEECH_REGION?.trim() ?? "").toLowerCase();
      if (!region) {
        throw new Error(
          "没有设置 SPEECH_REGION，没法拼出语音接口地址。也可以改用 FLOWGIT_TTS_BASE_URL / SPEECH_REGION is not set, so the speech URL cannot be built. Set FLOWGIT_TTS_BASE_URL instead",
        );
      }
      if (!/^[a-z0-9]+$/.test(region)) {
        throw new Error("SPEECH_REGION 不是合法的区域名 / SPEECH_REGION is not a valid region name");
      }
      // https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
      return `https://${region}.tts.speech.microsoft.com`;
    },
  },
];

const BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]));

function flowLang(env) {
  try {
    return JSON.parse(env.FLOWGIT_FLOW_INPUTS ?? "{}").language === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function mark(env, name) {
  return env[name]?.trim() ? "已设置 / set" : "未设置 / unset";
}

/** Bilingual preset list for `node scripts/tts.mjs --list`. Never prints a secret. */
export function formatList(env) {
  const lines = [
    "语音合成预设 / Text-to-speech presets",
    "",
    "FLOWGIT_TTS=<供应商>/<模型或声音> 选择预设。没设置时，仍用 FLOWGIT_TTS_API_KEY 调用 OpenAI 兼容接口（没密钥就跳过，不报错）。",
    "FLOWGIT_TTS=<provider>/<model or voice> selects a preset. With it unset, FLOWGIT_TTS_API_KEY still calls an OpenAI-compatible speech API (no key skips, it does not fail).",
    "",
    "这些变量会覆盖预设 / These override a preset: FLOWGIT_TTS_BASE_URL, FLOWGIT_TTS_API_KEY, FLOWGIT_TTS_MODEL, FLOWGIT_TTS_VOICE",
    "",
  ];
  for (const preset of PRESETS) {
    const example = preset.selector === "voice" ? `${preset.id}/${preset.voices.zh[0]}` : `${preset.id}/${preset.defaultModel}`;
    const envBits = [`${preset.apiKeyEnv}（${mark(env, preset.apiKeyEnv)}）`, ...preset.extras.map((extra) => `${extra.name}（${mark(env, extra.name)}）`)];
    lines.push(`${preset.id} — ${preset.nameZh} / ${preset.nameEn}`);
    lines.push(`  文档 / Docs: ${preset.docs}`);
    lines.push(`  示例 / Example: FLOWGIT_TTS=${example}`);
    lines.push(`  环境变量 / Env: ${envBits.join(", ")}`);
    lines.push(`  中文音色 / Chinese voices: ${preset.voices.zh.join(", ")}`);
    lines.push(`  英文音色 / English voices: ${preset.voices.en.join(", ")}`);
    lines.push(`  格式 / Format: ${preset.format}    语速 / Speed: ${preset.speedZh} / ${preset.speedEn}`);
    lines.push("");
  }
  return lines.join("\n");
}

function badShape() {
  return new Error(
    "FLOWGIT_TTS 要写成 <供应商>/<模型或声音>，例如 openai/gpt-4o-mini-tts / FLOWGIT_TTS must look like <provider>/<model or voice>, for example openai/gpt-4o-mini-tts",
  );
}

/**
 * Resolve FLOWGIT_TTS plus overrides.
 * Legacy mode (no FLOWGIT_TTS) keeps the OpenAI-compatible request from #70.
 * @returns {{ mode: "legacy", key: string } | {
 *   mode: "preset",
 *   preset: (typeof PRESETS)[number],
 *   model: string,
 *   voice: string,
 *   key: string,
 *   keyEnv: string,
 *   base: string,
 *   url: string,
 * }}
 */
export function resolveCall(env) {
  const selected = env.FLOWGIT_TTS?.trim() ?? "";
  const overrideKey = env.FLOWGIT_TTS_API_KEY?.trim() ?? "";
  if (!selected) return { mode: "legacy", key: overrideKey };
  const slash = selected.indexOf("/");
  if (slash <= 0 || slash === selected.length - 1) throw badShape();
  const id = selected.slice(0, slash).toLowerCase();
  const rest = selected.slice(slash + 1).trim();
  if (!rest) throw badShape();
  const preset = BY_ID.get(id);
  if (!preset) {
    throw new Error(
      `不认识的语音预设 ${id}。运行 node scripts/tts.mjs --list 查看 / Unknown speech preset ${id}. Run node scripts/tts.mjs --list`,
    );
  }
  const key = overrideKey || (env[preset.apiKeyEnv]?.trim() ?? "");
  const keyEnv = overrideKey ? "FLOWGIT_TTS_API_KEY" : preset.apiKeyEnv;
  if (!key) {
    throw new Error(
      `没有设置 ${preset.apiKeyEnv}，选了 ${preset.id} 预设也无法合成。也可以改用 FLOWGIT_TTS_API_KEY / ${preset.apiKeyEnv} is not set, so the ${preset.id} preset cannot synthesize speech. FLOWGIT_TTS_API_KEY overrides it`,
    );
  }
  const baseOverride = env.FLOWGIT_TTS_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const base = preset.origin(env, baseOverride).replace(/\/+$/, "");
  const lang = flowLang(env);
  const modelOverride = env.FLOWGIT_TTS_MODEL?.trim() ?? "";
  const voiceOverride = env.FLOWGIT_TTS_VOICE?.trim() ?? "";
  const model = preset.selector === "model" ? modelOverride || rest : modelOverride || preset.defaultModel;
  const voice = voiceOverride || (preset.selector === "voice" ? rest : preset.voices[lang][0]);
  return { mode: "preset", preset, model, voice, key, keyEnv, base, url: `${base}${preset.path}` };
}

function xmlEscape(text) {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
}

function voiceLocale(voice) {
  const match = voice.match(/^([a-z]{2}-[A-Za-z]{2})/);
  return match ? match[1] : "zh-CN";
}

/** Headers and body for one preset request. `body` is a string. */
export function buildRequest(call, text) {
  const { preset, model, voice, key } = call;
  if (preset.id === "openai") {
    // https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
    return {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice, response_format: "mp3", speed: 1 }),
    };
  }
  if (preset.id === "dashscope") {
    // https://www.alibabacloud.com/help/en/model-studio/cosyvoice-tts-http-api
    return {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: { text, voice, format: "mp3", rate: 1 },
      }),
    };
  }
  if (preset.id === "volcengine") {
    // https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-http
    return {
      headers: {
        "X-Api-Key": key,
        "X-Api-Resource-Id": model,
        "X-Api-Request-Id": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        req_params: {
          text,
          speaker: voice,
          audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 0 },
        },
      }),
    };
  }
  if (preset.id === "minimax") {
    // https://platform.minimax.cn/docs/api-reference/speech-t2a-http
    return {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        output_format: "hex",
        voice_setting: { voice_id: voice, speed: 1 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      }),
    };
  }
  if (preset.id === "azure") {
    // https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech
    const locale = voiceLocale(voice);
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlEscape(locale)}">` +
      `<voice name="${xmlEscape(voice)}"><prosody rate="1">${xmlEscape(text)}</prosody></voice></speak>`;
    return {
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        "User-Agent": "flowgit",
      },
      body: ssml,
    };
  }
  throw new Error(`不认识的语音预设 ${preset.id} / Unknown speech preset ${preset.id}`);
}

function nonempty(buffer) {
  if (!buffer.length) throw new Error(NO_AUDIO);
  return buffer;
}

function decodeBase64(value) {
  const clean = value.replace(/\s+/g, "");
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error(BAD_AUDIO);
  const buf = Buffer.from(clean, "base64");
  if (!buf.length) throw new Error(BAD_AUDIO);
  return buf;
}

function parseJsonValues(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(NO_AUDIO);
  try {
    return [JSON.parse(trimmed)];
  } catch {
    // One JSON value is the common case. Streams may send several.
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    try {
      return lines.map((line) => JSON.parse(line));
    } catch {
      // Fall through to concatenated objects with no newline.
    }
  }
  const values = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
    if (i >= trimmed.length) break;
    if (trimmed[i] !== "{") throw new Error(BAD_JSON);
    let depth = 0;
    let inStr = false;
    let esc = false;
    const start = i;
    for (; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          try {
            values.push(JSON.parse(trimmed.slice(start, i)));
          } catch {
            throw new Error(BAD_JSON);
          }
          break;
        }
      }
    }
    if (depth !== 0) throw new Error(BAD_JSON);
  }
  if (!values.length) throw new Error(BAD_JSON);
  return values;
}

async function decodeDashscope(buffer, fetchBytes) {
  let json;
  try {
    json = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(BAD_JSON);
  }
  const data = json?.output?.audio?.data;
  if (typeof data === "string" && data.trim()) return decodeBase64(data);
  const url = json?.output?.audio?.url;
  if (typeof url === "string" && url.trim()) return nonempty(await fetchBytes(url));
  throw new Error(NO_AUDIO);
}

function decodeVolcengine(buffer) {
  const values = parseJsonValues(buffer.toString("utf8"));
  const parts = [];
  for (const obj of values) {
    if (obj && typeof obj.code === "number" && obj.code !== 0) {
      const detail = typeof obj.message === "string" ? obj.message : "";
      throw new Error(`语音合成失败 / text-to-speech failed: ${obj.code}${detail ? ` ${detail}` : ""}`);
    }
    const data = obj?.data;
    if (typeof data === "string" && data.trim()) parts.push(decodeBase64(data));
  }
  if (!parts.length) throw new Error(NO_AUDIO);
  return Buffer.concat(parts);
}

function decodeMinimax(buffer) {
  let json;
  try {
    json = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(BAD_JSON);
  }
  const code = json?.base_resp?.status_code;
  if (typeof code === "number" && code !== 0) {
    const detail = typeof json?.base_resp?.status_msg === "string" ? json.base_resp.status_msg : "";
    throw new Error(`语音合成失败 / text-to-speech failed: ${code}${detail ? ` ${detail}` : ""}`);
  }
  const audio = json?.data?.audio;
  if (typeof audio !== "string" || !audio.trim()) throw new Error(NO_AUDIO);
  const hex = audio.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error(BAD_AUDIO);
  return nonempty(Buffer.from(hex, "hex"));
}

/**
 * Turn one HTTP response body into audio bytes.
 * Raw audio (audio/* or application/octet-stream) is returned as-is.
 * JSON uses the vendor's documented field: DashScope base64 or URL, Volcengine base64, MiniMax hex.
 * @param {(url: string) => Promise<Buffer>} fetchBytes download a documented audio URL, without the API key
 */
export async function decodeAudio(preset, buffer, contentType, fetchBytes) {
  const type = (contentType || "").toLowerCase();
  if (type.startsWith("audio/") || type.includes("octet-stream")) return nonempty(buffer);
  const jsonLike = type.includes("json") || type.startsWith("text/") || buffer[0] === 0x7b || buffer[0] === 0x5b;
  if (!jsonLike) return nonempty(buffer);
  if (preset.id === "dashscope") return decodeDashscope(buffer, fetchBytes);
  if (preset.id === "volcengine") return decodeVolcengine(buffer);
  if (preset.id === "minimax") return decodeMinimax(buffer);
  throw new Error(NO_AUDIO);
}
