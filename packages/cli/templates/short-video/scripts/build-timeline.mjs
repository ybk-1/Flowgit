// 剪辑阶段：把 storyboard.json + assets/ 排成 timeline.json。
// Edit stage: lay out storyboard.json + assets/ as timeline.json.
//
// 时间线可以直接手改（顺序、时长、字幕、素材），改完再运行导出阶段。
// You can hand-edit timeline.json afterwards; the export stage renders whatever is there.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const lang = flowInputs.language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);

function loadPlatforms() {
  const file = path.join(dir, "scripts", "platforms.json");
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return parsed.platforms && typeof parsed.platforms === "object" ? parsed.platforms : {};
}

/** The platform input, when it names a preset. Absent when the input is unset. */
function selectedPlatform() {
  const id = typeof flowInputs.platform === "string" ? flowInputs.platform : "";
  if (!id) return undefined;
  const spec = loadPlatforms()[id];
  if (!spec || typeof spec !== "object") {
    console.warn(say(`没有平台预设 ${id}，按分镜的画幅排时间线`, `no platform preset ${id}; laying the timeline out from the storyboard's aspect`));
    return undefined;
  }
  return { id, ...spec };
}
const storyboard = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"));
const assetsDir = path.join(dir, "assets");
const available = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => !f.startsWith(".")) : [];

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);
const AUDIO = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);

/** Find the asset for a shot: exact name first, then any file whose base name is the shot id. */
function findAsset(shot) {
  if (shot.asset && available.includes(shot.asset)) return shot.asset;
  const base = (shot.asset ? path.parse(shot.asset).name : shot.id).toLowerCase();
  return available.find((f) => path.parse(f).name.toLowerCase() === base);
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE.has(ext)) return "image";
  if (VIDEO.has(ext)) return "video";
  return undefined;
}

const shots = Array.isArray(storyboard.shots) ? storyboard.shots : [];
if (!shots.length) {
  console.error(say("storyboard.json 里没有镜头", "storyboard.json has no shots"));
  process.exit(1);
}

let t = 0;
let missing = 0;
const clips = shots.map((shot, i) => {
  const duration = Math.max(0.5, Number(shot.duration) || 3);
  const file = findAsset(shot);
  const kind = file ? kindOf(file) : undefined;
  if (!file || !kind) missing += 1;
  const clip = {
    id: shot.id ?? `s${i + 1}`,
    start: Number(t.toFixed(3)),
    duration,
    source: file && kind ? { kind, path: `assets/${file}` } : { kind: "card" },
    caption: shot.caption ?? "",
    narration: shot.narration ?? "",
  };
  t += duration;
  return clip;
});

const platform = selectedPlatform();
const [aspectW, aspectH] = (storyboard.aspect ?? "9:16") === "16:9" ? [1920, 1080] : (storyboard.aspect === "1:1" ? [1080, 1080] : [1080, 1920]);
const w = Number(platform?.width) || aspectW;
const h = Number(platform?.height) || aspectH;
const fps = Number(platform?.fps) || 30;
const audioNamed = (names) =>
  available.find((f) => AUDIO.has(path.extname(f).toLowerCase()) && names.includes(path.parse(f).name.toLowerCase()));
// 背景音乐：assets/music.mp3（或 bgm.*）。 / Background music: assets/music.mp3 (or bgm.*).
const musicFile = audioNamed(["music", "bgm"]);
// 配音：优先 assets/ 里自己录的 voice.*（或 narration.*、voiceover.*、配音.*），
// 否则用配音阶段合成的 voice/voice.mp3。
// Voiceover: a recording in assets/ (voice.*, narration.*, voiceover.*, 配音.*) wins;
// otherwise voice/voice.mp3 from the voice stage.
const recordedVoice = audioNamed(["voice", "narration", "voiceover", "配音"]);
const generatedVoice = path.join(dir, "voice", "voice.mp3");
const voiceRel = recordedVoice ? `assets/${recordedVoice}` : fs.existsSync(generatedVoice) ? "voice/voice.mp3" : undefined;
const voiceLabel = recordedVoice ? recordedVoice : voiceRel ?? "";

/** Length of an audio file in seconds, or undefined when ffprobe is missing or can't read it. */
function audioLength(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const n = Number(r.stdout?.trim());
  return r.status === 0 && n > 0 ? n : undefined;
}

// With a voiceover, the voice sets the pace: the clips share its length (plus a short tail)
// in proportion to how much narration each one has, so each shot is on screen while its
// lines are spoken. Without narration text, the storyboard's durations set the proportions.
let voice;
let retimed; // "narration" | "storyboard" once the clips are fitted to the voice
if (voiceRel) {
  const length = audioLength(path.join(dir, voiceRel));
  voice = { path: voiceRel, volume: 1 };
  if (length) {
    const tail = 0.6;
    const weights = clips.map((c) => [...c.narration.replace(/\s+/g, "")].length);
    const useNarration = weights.every((n) => n > 0);
    const shares = useNarration ? weights : clips.map((c) => c.duration);
    const sum = shares.reduce((a, b) => a + b, 0);
    let start = 0;
    for (const [i, clip] of clips.entries()) {
      clip.duration = Number(Math.max(1, ((length + tail) * shares[i]) / sum).toFixed(2));
      clip.start = Number(start.toFixed(3));
      start += clip.duration;
    }
    t = start;
    retimed = useNarration ? "narration" : "storyboard";
  } else {
    console.warn(
      say(
        `读不出配音 ${voiceLabel} 的长度（需要 ffprobe），镜头时长按分镜不变`,
        `couldn't read the length of voiceover ${voiceLabel} (needs ffprobe); keeping the storyboard's durations`,
      ),
    );
  }
}

// The board preview draws from this copy. render.mjs reads the same file when it exports.
function readCaptionStyle() {
  const file = path.join(dir, "scripts", "caption-style.json");
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
const captionStyle = readCaptionStyle();
const captionPreset = typeof captionStyle?.preset === "string" && captionStyle.preset
  ? captionStyle.preset
  : captionStyle?.presets && typeof captionStyle.presets === "object"
    ? Object.keys(captionStyle.presets)[0]
    : undefined;

const timeline = {
  format: "flowgit/timeline",
  version: "0.1",
  title: storyboard.title ?? "",
  width: w,
  height: h,
  fps,
  duration: Number(t.toFixed(3)),
  // Default between clips. A clip's own transition replaces it for the gap after that clip.
  // type: "cut" | "fade" | "slide" | "zoom" | "none". "none" is the older name for a cut.
  transition: { type: "fade", duration: 0.4 },
  // 有配音时背景音乐压低，免得盖过人声。 / With a voiceover the music sits lower so the voice stays clear.
  ...(voice ? { voice } : {}),
  ...(musicFile ? { music: { path: `assets/${musicFile}`, volume: voice ? 0.2 : 0.6 } } : {}),
  ...(captionStyle ? { captionStyle } : {}),
  ...(captionPreset ? { captionPreset } : {}),
  ...(platform ? { platform } : {}),
  clips,
};

fs.writeFileSync(path.join(dir, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
console.log(
  say(
    `timeline.json：${clips.length} 个镜头，${timeline.duration} 秒，${clips.length - missing} 个有素材，${missing} 个用文字卡${voiceLabel ? `，配音 ${voiceLabel}` : ""}${musicFile ? `，背景音乐 ${musicFile}` : ""}${platform ? `，平台 ${platform.id}` : ""}`,
    `timeline.json: ${clips.length} clips, ${timeline.duration}s, ${clips.length - missing} with assets, ${missing} as text cards${voiceLabel ? `, voiceover ${voiceLabel}` : ""}${musicFile ? `, music ${musicFile}` : ""}${platform ? `, platform ${platform.id}` : ""}`,
  ),
);
if (retimed) {
  const by = retimed === "narration" ? say("按每个镜头旁白的字数分", "shared by each clip's narration length") : say("按分镜里的时长比例分", "in the storyboard's proportions");
  console.log(
    say(
      `镜头时长已按配音重新分配（${by}）。哪里不合适，直接改 timeline.json 里的 duration。`,
      `Clip durations were fitted to the voiceover (${by}). If a cut feels off, change duration in timeline.json.`,
    ),
  );
}
