// 导出阶段：用 FFmpeg 把 timeline.json 渲染成 final.mp4。
// Export stage: render timeline.json to final.mp4 with FFmpeg.
//
// 需要 / requires: ffmpeg on PATH. 字幕需要一个中文字体，可用 FLOWGIT_FONT 指定。
// Captions need a CJK-capable font; set FLOWGIT_FONT=/path/to/font to choose one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const lang = flowInputs.language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const timeline = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8"));

function loadPlatforms() {
  const file = path.join(dir, "scripts", "platforms.json");
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed.platforms && typeof parsed.platforms === "object" ? parsed.platforms : {};
  } catch {
    return {};
  }
}

function selectedPlatform() {
  const id = typeof flowInputs.platform === "string" ? flowInputs.platform : "";
  if (!id) return undefined;
  const spec = loadPlatforms()[id];
  if (!spec || typeof spec !== "object") {
    console.warn(say(`没有平台预设 ${id}，按时间线的尺寸导出`, `no platform preset ${id}; exporting at the timeline size`));
    return undefined;
  }
  return { id, ...spec };
}

const platform = selectedPlatform();
let W = timeline.width ?? 1080;
let H = timeline.height ?? 1920;
let FPS = timeline.fps ?? 30;
if (Number(platform?.width) > 0 && Number(platform?.height) > 0) {
  W = Number(platform.width);
  H = Number(platform.height);
}
if (Number(platform?.fps) > 0) FPS = Number(platform.fps);

const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ff.status !== 0) {
  console.error(say("找不到 ffmpeg，请先安装（https://ffmpeg.org/download.html）再重跑这个阶段", "ffmpeg not found. Install it (https://ffmpeg.org/download.html) and run this stage again."));
  process.exit(1);
}

const FONT_CANDIDATES = [
  process.env.FLOWGIT_FONT,
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/Library/Fonts/Arial Unicode.ttf",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "C:\\Windows\\Fonts\\simhei.ttf",
].filter(Boolean);
const font = FONT_CANDIDATES.find((f) => fs.existsSync(f));
if (!font) console.warn(say("找不到中文字体，字幕会被跳过。可以设置 FLOWGIT_FONT=/path/to/font.ttc", "No CJK font found, captions are skipped. Set FLOWGIT_FONT=/path/to/font.ttc to enable them."));

// Same object the board preview draws from (copied onto timeline.json by the edit stage).
const CAPTION_STYLE_DEFAULT = {
  caption: {
    fontSizeRatio: 18,
    color: "#ffffff",
    box: { color: "#000000", alpha: 0.45, borderRatio: 45 },
    lineSpacing: 12,
    y: 0.76,
    wrap: { perLine: 12, maxLines: 3, englishFactor: 2 },
  },
  title: {
    fontSizeRatio: 13,
    color: "#ffffff",
    box: { color: "#000000", alpha: 0.5, borderRatio: 36 },
    lineSpacingRatio: 60,
    y: 0.12,
    wrap: { perLine: 10, maxLines: 2, englishFactor: 2 },
    hold: 2.2,
    fade: 0.6,
  },
  card: {
    fontSizeRatio: 16,
    color: "#ffffff",
    shadow: { color: "#000000", alpha: 0.35, x: 3, y: 3 },
    lineSpacingRatio: 40,
    y: "middle",
    wrap: { perLine: 11, maxLines: 7, englishFactor: 2 },
  },
};

/** presets[id], or a flat { caption, title, card } file from before presets existed. */
function resolveCaptionStyle(doc, presetId) {
  if (!doc || typeof doc !== "object") return undefined;
  if (doc.presets && typeof doc.presets === "object") {
    const id = presetId || doc.preset;
    const chosen = id && doc.presets[id];
    if (chosen && typeof chosen === "object") return chosen;
    const first = Object.values(doc.presets).find((item) => item && typeof item === "object");
    if (first) return first;
  }
  if (doc.caption && typeof doc.caption === "object") return doc;
  return undefined;
}

function loadCaptionStyle() {
  let fromFile;
  const file = path.join(dir, "scripts", "caption-style.json");
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      fromFile = undefined;
    }
  }
  const presetId = timeline.captionPreset || fromFile?.preset;
  return resolveCaptionStyle(fromFile, presetId) || resolveCaptionStyle(timeline.captionStyle, presetId) || CAPTION_STYLE_DEFAULT;
}

const captionStyle = loadCaptionStyle();

function styleRule(name) {
  const rule = captionStyle[name];
  return rule && typeof rule === "object" ? rule : CAPTION_STYLE_DEFAULT[name];
}

function ffmpegColor(color) {
  const hex = String(color || "#ffffff").toLowerCase();
  if (hex === "#ffffff" || hex === "#fff") return "white";
  if (hex === "#000000" || hex === "#000") return "black";
  return hex;
}

function ffmpegAlpha(color, alpha) {
  const name = ffmpegColor(color);
  const value = Number(alpha);
  if (!Number.isFinite(value) || value >= 1) return name;
  return `${name}@${value}`;
}

function fontPx(rule) {
  return Math.round(W / (Number(rule.fontSizeRatio) || 18));
}

function gapPx(rule) {
  if (rule.lineSpacing != null && Number.isFinite(Number(rule.lineSpacing))) return Math.round(Number(rule.lineSpacing));
  return Math.round(W / (Number(rule.lineSpacingRatio) || 40));
}

function yExpr(rule) {
  if (rule.y === "middle") return "(h-text_h)/2";
  const y = Number(rule.y);
  return `h*${Number.isFinite(y) ? y : 0.76}`;
}

/** drawtext filter for one caption rule in scripts/caption-style.json. */
function drawText(name, fileName, text) {
  const rule = styleRule(name);
  const wrap = rule.wrap || {};
  const parts = [
    `drawtext=fontfile='${esc(font)}'`,
    `textfile='${textFile(fileName, wrapCaption(text, Number(wrap.perLine) || 12, Number(wrap.maxLines) || 3, Number(wrap.englishFactor) || 2))}'`,
    `fontsize=${fontPx(rule)}`,
    `fontcolor=${ffmpegColor(rule.color)}`,
  ];
  if (rule.box) {
    parts.push("box=1", `boxcolor=${ffmpegAlpha(rule.box.color, rule.box.alpha)}`, `boxborderw=${Math.round(W / (Number(rule.box.borderRatio) || 45))}`);
  }
  if (rule.shadow) {
    parts.push(
      `shadowcolor=${ffmpegAlpha(rule.shadow.color, rule.shadow.alpha)}`,
      `shadowx=${Math.round(Number(rule.shadow.x) || 0)}`,
      `shadowy=${Math.round(Number(rule.shadow.y) || 0)}`,
    );
  }
  parts.push(`line_spacing=${gapPx(rule)}`);
  let tail = "";
  if (rule.hold != null) {
    const hold = Number(rule.hold);
    const fade = Number(rule.fade ?? 0.6);
    const until = Number((hold + fade).toFixed(3));
    tail = `:alpha='if(lt(t,${hold}),1,max(0,(${until}-t)/${fade}))':enable='lt(t,${until})'`;
  }
  return `${parts.join(":")}${CENTER}:x=(w-text_w)/2:y=${yExpr(rule)}${tail}`;
}

// ffmpeg filter values: escape \ : ' for the filtergraph parser.
const esc = (s) => s.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-render-"));
const PALETTE = ["0x1f2937", "0x0f766e", "0x1d4ed8", "0x7c3aed", "0xb45309", "0xbe123c"];

/** Break text into balanced lines (no lonely last character), at most maxLines lines. */
function wrapCaption(text, perLine = 12, maxLines = 3, englishFactor = 2) {
  const clean = text.trim();
  // English and other space-separated text (no CJK): wrap on words, about twice as many characters per line
  if (/\s/.test(clean) && !/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(clean)) {
    const max = perLine * englishFactor;
    const lines = [];
    let line = "";
    for (const word of clean.split(/\s+/)) {
      if (line && (line + " " + word).length > max) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines).join("\n");
  }
  const chars = [...clean];
  if (chars.length <= perLine) return chars.join("");
  const lines = Math.min(maxLines, Math.ceil(chars.length / perLine));
  const size = Math.ceil(chars.length / lines);
  const out = [];
  for (let i = 0; i < chars.length && out.length < maxLines; i += size) out.push(chars.slice(i, i + size).join(""));
  return out.join("\n");
}

// Feature checks: drawtext text_align (FFmpeg 6.1), gradients (6.0), xfade (4.3).
const help = (filter) => spawnSync("ffmpeg", ["-hide_banner", "-h", `filter=${filter}`], { encoding: "utf8" }).stdout ?? "";
const CENTER = help("drawtext").includes("text_align") ? ":text_align=C" : "";
const HAS_GRADIENTS = help("gradients").includes("gradients");
const HAS_XFADE = help("xfade").includes("xfade");
const AMIX_NORMALIZE = help("amix").includes("normalize"); // FFmpeg 4.4+

function run(args, label) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`${say(`ffmpeg 处理 ${label} 时失败`, `ffmpeg failed on ${label}`)}:\n${r.stderr}`);
    process.exit(1);
  }
}

const clips = timeline.clips ?? [];
if (!clips.length) {
  console.error(say("timeline.json 里没有镜头", "timeline.json has no clips"));
  process.exit(1);
}
let durations = clips.map((clip) => Math.max(0.5, Number(clip.duration) || 3));

// Shorten from the end so the file stays inside the platform's published length limit.
if (platform && Number(platform.maxDuration) > 0) {
  const exclusive = platform.maxDurationExclusive === true;
  const limit = exclusive ? Math.max(0.2, Number(platform.maxDuration) - 1 / FPS) : Number(platform.maxDuration);
  let totalNow = durations.reduce((a, b) => a + b, 0);
  if (totalNow > limit + 1e-3) {
    console.warn(
      say(
        `这条视频有 ${totalNow.toFixed(1)} 秒，超过 ${platform.id} 的时长上限 ${platform.maxDuration} 秒，导出时从结尾截短`,
        `this video is ${totalNow.toFixed(1)}s, over ${platform.id}'s length limit of ${platform.maxDuration}s, so the export is shortened from the end`,
      ),
    );
    let over = totalNow - limit;
    for (let i = durations.length - 1; i >= 0 && over > 0.001; i -= 1) {
      const floor = Math.min(0.5, limit / durations.length);
      const cut = Math.min(over, durations[i] - floor);
      if (cut > 0) {
        durations[i] = Number((durations[i] - cut).toFixed(3));
        over -= cut;
      }
    }
  }
}

const total = durations.reduce((a, b) => a + b, 0);

// Gap after clip i. xfade names are from https://ffmpeg.org/ffmpeg-filters.html#xfade
// (fade, slideleft, zoomin). "cut" and the older "none" are a hard cut, so no xfade.
const XFADE_NAME = { fade: "fade", slide: "slideleft", zoom: "zoomin" };
function boundary(i) {
  if (i < 0 || i >= clips.length - 1) return { duration: 0, xfade: "" };
  const spec = clips[i].transition || timeline.transition || { type: "fade", duration: 0.4 };
  const type = spec.type || "fade";
  if (!HAS_XFADE || type === "none" || type === "cut" || !XFADE_NAME[type]) return { duration: 0, xfade: "" };
  const requested = Number(spec.duration ?? timeline.transition?.duration ?? 0.4);
  const cap = Math.min(durations[i], durations[i + 1]) / 2;
  const duration = Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), 1, cap);
  if (duration < 0.04) return { duration: 0, xfade: "" };
  return { duration, xfade: XFADE_NAME[type] };
}

// Blurred, darkened copy of the picture fills the frame; the whole picture sits on top.
// No black bars when a landscape photo goes into a vertical video.
const fill = (w, h, out) =>
  `split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=${Math.round(w / 40)},eq=brightness=-0.12[bg];` +
  `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2${out ? `[${out}]` : ""}`;

const textFile = (name, text) => {
  const file = path.join(work, name);
  fs.writeFileSync(file, text);
  return esc(file);
};

const segments = [];
clips.forEach((clip, i) => {
  const dur = durations[i];
  const len = dur + boundary(i).duration;
  const frames = Math.round(len * FPS);
  const out = path.join(work, `seg-${String(i).padStart(3, "0")}.mp4`);
  const filters = [];
  let inputArgs;
  const src = clip.source ?? { kind: "card" };
  const srcPath = src.path ? path.join(dir, src.path) : undefined;
  if (src.kind === "image" && srcPath && fs.existsSync(srcPath)) {
    // Slow zoom ("Ken Burns"): in on even clips, out on odd ones; clip.motion = "zoom-in" | "zoom-out" | "none".
    // Compose at 2x and let zoompan scale down, which keeps the motion smooth.
    const motion = clip.motion ?? (i % 2 === 0 ? "zoom-in" : "zoom-out");
    const zoom = motion === "zoom-in" ? `1+0.1*on/${frames}` : motion === "zoom-out" ? `1.1-0.1*on/${frames}` : "1";
    inputArgs = ["-i", srcPath];
    filters.push(
      fill(W * 2, H * 2),
      `zoompan=z='${zoom}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`,
      "setsar=1",
      "format=yuv420p",
    );
  } else if (src.kind === "video" && srcPath && fs.existsSync(srcPath)) {
    inputArgs = ["-stream_loop", "-1", "-t", String(len), "-i", srcPath];
    filters.push(fill(W, H), `fps=${FPS}`, "setsar=1", "format=yuv420p");
  } else {
    // Text card: a slowly moving two-colour gradient (flat colour on FFmpeg < 6.0).
    const c0 = PALETTE[i % PALETTE.length];
    const c1 = PALETTE[(i + 2) % PALETTE.length];
    const bg = HAS_GRADIENTS
      ? `gradients=s=${W}x${H}:r=${FPS}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.008:d=${len}`
      : `color=c=${c0}:s=${W}x${H}:r=${FPS}`;
    inputArgs = ["-f", "lavfi", "-t", String(len), "-i", bg];
    filters.push("format=yuv420p");
    if (font && clip.narration) {
      // no asset: show the narration in the middle
      filters.push(drawText("card", `card-${i}.txt`, clip.narration));
    }
  }
  if (font && i === 0 && timeline.title) {
    // Title over the first clip for about 2.5 seconds, then it fades away.
    filters.push(drawText("title", "title.txt", timeline.title));
  }
  if (font && clip.caption) {
    filters.push(drawText("caption", `cap-${i}.txt`, clip.caption));
  }
  run([...inputArgs, "-filter_complex", `[0:v]${filters.join(",")}[v]`, "-map", "[v]", "-frames:v", String(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-pix_fmt", "yuv420p", out], `clip ${clip.id}`);
  segments.push(out);
  const what = { image: say("图片", "image"), video: say("视频", "video"), card: say("文字卡", "text card") }[src.kind] ?? src.kind;
  console.log(`${say("镜头", "clip")} ${i + 1}/${clips.length} ${clip.id}: ${what}${src.path ? ` ${src.path}` : ""}, ${dur}${say(" 秒", "s")}`);
});

// Join: cross-fade between clips, with a short fade in from and out to black.
const finalPath = path.join(dir, "final.mp4");
const graph = [];
segments.forEach((_, k) => graph.push(`[${k}:v]fps=${FPS},settb=AVTB,setpts=PTS-STARTPTS[s${k}]`));
let last = "s0";
if (segments.length > 1) {
  for (let k = 1; k < segments.length; k++) {
    const gap = boundary(k - 1);
    // offset is the cut in the timeline (sum of the clip lengths), which is where the
    // overlap starts. Each previous xfade consumes the extra tail, so the offset stays
    // the sum of durations even when earlier gaps were cuts.
    const offset = durations.slice(0, k).reduce((sum, item) => sum + item, 0);
    if (gap.duration > 0) {
      graph.push(`[${last}][s${k}]xfade=transition=${gap.xfade}:duration=${gap.duration.toFixed(3)}:offset=${offset.toFixed(3)}[x${k}]`);
      last = `x${k}`;
    } else {
      graph.push(`[${last}][s${k}]concat=n=2:v=1:a=0[c${k}]`);
      last = `c${k}`;
    }
  }
}
const edge = Math.min(0.4, total / 4);
graph.push(`[${last}]fade=t=in:st=0:d=${edge},fade=t=out:st=${(total - edge).toFixed(3)}:d=${edge},format=yuv420p[out]`);

// Sound: timeline.voice plays once from the start. timeline.music (assets/music.* or
// assets/bgm.*, or a path named on the timeline) is looped to the video and fades out.
// With both, the music is ducked under the voice with sidechaincompress.
const inputs = segments.flatMap((s) => ["-i", s]);
const vol = (v, fallback) => Math.min(Math.max(Number(v ?? fallback) || 0, 0), 2);
const fadeIn = Math.min(0.5, total / 4);
const fadeOut = Math.min(1.5, total / 3);
const tracks = [];
const audioFile = (track, label) => {
  if (!track?.path) return undefined;
  const file = path.join(dir, track.path);
  if (fs.existsSync(file)) return file;
  console.warn(say(`找不到${label.zh} ${track.path}，导出时不带它`, `${label.en} ${track.path} not found; exporting without it`));
  return undefined;
};
const inputIndex = () => inputs.filter((arg) => arg === "-i").length - 1;

const voicePath = audioFile(timeline.voice, { zh: "配音", en: "voiceover" });
let voiceIndex;
let voiceVolume = 1;
if (voicePath) {
  voiceVolume = vol(timeline.voice.volume, 1);
  inputs.push("-i", voicePath);
  voiceIndex = inputIndex();
  const voiceLength = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voicePath], { encoding: "utf8" }).stdout?.trim());
  console.log(say(`配音：${timeline.voice.path}，音量 ${voiceVolume}`, `voiceover: ${timeline.voice.path}, volume ${voiceVolume}`));
  if (voiceLength > total + 0.05) {
    console.warn(
      say(
        `配音有 ${voiceLength.toFixed(1)} 秒，比视频长 ${(voiceLength - total).toFixed(1)} 秒，结尾会被截掉。重跑剪辑阶段会按配音重新分配时长。`,
        `the voiceover is ${voiceLength.toFixed(1)}s, ${(voiceLength - total).toFixed(1)}s longer than the video, so its end is cut. Re-run the edit stage to fit the clips to it.`,
      ),
    );
  }
}

const musicPath = audioFile(timeline.music, { zh: "背景音乐", en: "music" });
let musicIndex;
let musicVolume = 0.6;
if (musicPath) {
  musicVolume = vol(timeline.music.volume, 0.6);
  inputs.push("-stream_loop", "-1", "-i", musicPath);
  musicIndex = inputIndex();
  console.log(say(`背景音乐：${timeline.music.path}，音量 ${musicVolume}`, `music: ${timeline.music.path}, volume ${musicVolume}`));
}

const voiceOut = Math.max(0, total - 0.3).toFixed(3);
const musicOut = (total - fadeOut).toFixed(3);
if (voiceIndex != null && musicIndex != null) {
  // Duck the music while the voice is loud, then fade the music out at the end.
  // https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress
  // Both tracks are padded to the video length: on FFmpeg 8 sidechaincompress can
  // stop when the voice ends, which cut the music (and the audio) short.
  // https://ffmpeg.org/ffmpeg-filters.html#apad
  // threshold 0.05 is inside the documented range 0.00097563–1 (default 0.125).
  // ratio 8 is inside 1–20 (default 2): above the threshold the music is reduced.
  // attack 20 ms and release 250 ms are the documented defaults.
  // makeup 1, knee 2.82843, link=average, detection=rms, level_sc=1 and mix=1 are the documented defaults.
  graph.push(
    `[${voiceIndex}:a]asplit=2[vsrc][scsrc]`,
    `[vsrc]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${voiceVolume},afade=t=out:st=${voiceOut}:d=0.3,apad=whole_dur=${total.toFixed(3)}[voice]`,
    `[scsrc]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,apad=whole_dur=${total.toFixed(3)}[sc]`,
    `[${musicIndex}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${musicVolume}[mraw]`,
    `[mraw][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250:makeup=1:knee=2.82843:link=average:detection=rms:level_sc=1:mix=1,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${musicOut}:d=${fadeOut},apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[music]`,
  );
  tracks.push("[voice]", "[music]");
  console.log(say("背景音乐在有人声时压低", "music ducks under the voice"));
} else if (voiceIndex != null) {
  graph.push(`[${voiceIndex}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${voiceVolume},afade=t=out:st=${voiceOut}:d=0.3[voice]`);
  tracks.push("[voice]");
} else if (musicIndex != null) {
  graph.push(`[${musicIndex}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${musicVolume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${musicOut}:d=${fadeOut}[music]`);
  tracks.push("[music]");
}

let audioArgs = ["-an"];
if (tracks.length) {
  if (tracks.length === 1) {
    graph.push(`${tracks[0]}anull[aout]`);
  } else {
    // amix halves each input unless normalize=0 (FFmpeg 4.4+); on older builds, scale back up.
    graph.push(`${tracks.join("")}amix=inputs=${tracks.length}:duration=longest${AMIX_NORMALIZE ? ":normalize=0" : `,volume=${tracks.length}`}[aout]`);
  }
  const audioBitrate = Number(platform?.audioBitrateKbps) > 0 ? `${Math.round(platform.audioBitrateKbps)}k` : "160k";
  audioArgs = ["-map", "[aout]", "-c:a", "aac", "-b:a", audioBitrate];
}
const videoRate = Number(platform?.videoBitrateKbps) > 0 ? ["-b:v", `${Math.round(platform.videoBitrateKbps)}k`] : ["-crf", "20"];
if (Number(platform?.maxVideoBitrateKbps) > 0) {
  const cap = `${Math.round(platform.maxVideoBitrateKbps)}k`;
  videoRate.push("-maxrate", cap, "-bufsize", cap);
}
if (platform) console.log(say(`平台：${platform.id}，${W}x${H}`, `platform: ${platform.id}, ${W}x${H}`));
run(
  [...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", ...audioArgs, "-c:v", "libx264", "-preset", "veryfast", ...videoRate, "-r", String(FPS), "-pix_fmt", "yuv420p", "-movflags", "+faststart", finalPath],
  "join",
);
fs.rmSync(work, { recursive: true, force: true });

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", finalPath], { encoding: "utf8" });
console.log(say(`final.mp4：${W}x${H}，${Number(probe.stdout || 0).toFixed(1)} 秒`, `final.mp4: ${W}x${H}, ${Number(probe.stdout || 0).toFixed(1)}s`));
