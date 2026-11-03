#!/usr/bin/env node
// "render" stage: one video per segment from timeline.json, with FFmpeg.
//
// video/<n>-<id>.mp4 at 1920×1080, 30 fps, H.264 and stereo AAC at 256 kb/s
// (Udemy's video standards, rules.md "video"). The picture is the screen
// recording, or else the slides: each slide's headline, then its screenshot
// from images/<slide>.png|jpg|jpeg|webp, or its on-screen phrases when there
// is none. The sound is normalized in two passes to the loudness in rules.md
// (-16 LUFS, true peak -1.5 dBTP); a segment with no sound gets a silent
// stereo track. An AI-voiced video carries the aiLabel in the top right the
// whole time (China's AI content labeling measures, art. 4). Captions stay
// separate files. video/manifest.json lists what each video is made of.
//
// Needs ffmpeg and ffprobe on PATH. Text needs a font with Chinese glyphs for
// Chinese; set FLOWGIT_FONT=/path/to/font to choose one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const rulesFile = process.argv[2] ?? "rules.md";
const outDir = outputs[0]?.path ?? "video/";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") : null);

let rules;
{
  const fenced = read(rulesFile)?.match(/```json\n([\s\S]*?)\n```/);
  if (!fenced) fail(t(`${rulesFile} 里没有 JSON 规则块`, `${rulesFile} has no JSON rules block`));
  try {
    rules = JSON.parse(fenced[1]);
  } catch (err) {
    fail(t(`${rulesFile} 的 JSON 不合法：${err.message}`, `The JSON in ${rulesFile} is invalid: ${err.message}`));
  }
}
let timeline;
try {
  timeline = JSON.parse(read("timeline.json") ?? "");
} catch (err) {
  fail(t(`timeline.json 不存在或不是合法的 JSON：${err.message}`, `timeline.json is missing or not valid JSON: ${err.message}`));
}

for (const tool of ["ffmpeg", "ffprobe"]) {
  const r = spawnSync(tool, ["-version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) fail(t(`找不到 ${tool}，请先安装 FFmpeg（https://ffmpeg.org/download.html）再重跑这个阶段`, `${tool} not found. Install FFmpeg (https://ffmpeg.org/download.html) and run this stage again.`));
}

const W = Number(timeline.width) || 1920;
const H = Number(timeline.height) || 1080;
const FPS = Number(timeline.fps) || 30;
const px = (n) => Math.round((n * H) / 1080);
const loud = rules.loudness ?? {};
const TARGET_I = Number(loud.target) || -16;
const TARGET_TP = Number(loud.renderTruePeak) || -1.5;
const AUDIO_BITRATE = String(rules.video?.audioBitrate ?? "256k");
const SAMPLE_RATE = Number(rules.video?.sampleRate) || 48000;

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
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "C:\\Windows\\Fonts\\arial.ttf",
].filter(Boolean);
const font = FONT_CANDIDATES.find((f) => fs.existsSync(f));
if (!font) console.warn(t("找不到字体，幻灯片上不会有字。可以设置 FLOWGIT_FONT=/path/to/font.ttc", "No font found, so the slides will have no text. Set FLOWGIT_FONT=/path/to/font.ttc"));
else if (!en && /DejaVu|Helvetica|arial\.ttf/i.test(font) && !process.env.FLOWGIT_FONT)
  console.warn(t(`只找到 ${path.basename(font)}，它可能没有中文字形。可以设置 FLOWGIT_FONT 指定一个中文字体`, `Only ${path.basename(font)} was found and it may lack Chinese glyphs; set FLOWGIT_FONT to a Chinese font`));

// ffmpeg filter values: escape \ : ' for the filtergraph parser.
const esc = (s) => String(s).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-lesson-"));
let fileNo = 0;
const textFile = (text) => {
  const file = path.join(work, `text-${fileNo++}.txt`);
  fs.writeFileSync(file, text);
  return esc(file);
};

function ffmpeg(args, label) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`${t(`ffmpeg 处理 ${label} 时失败`, `ffmpeg failed on ${label}`)}:\n${r.stderr}`);
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
}

const probeSeconds = (file) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout?.trim()) || 0;

// ---- Text layout ----
const wide = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF]/;
const unit = (ch) => (wide.test(ch) ? 1 : /[A-Z0-9]/.test(ch) ? 0.64 : /[\s.,:;'!|ilj()[\]]/.test(ch) ? 0.3 : 0.55);
const widthOf = (s) => [...s].reduce((n, ch) => n + unit(ch), 0);
const noLineStart = /^[，。、；：！？」』）》,.;:!?)\]]/;

/** Greedy lines no wider than maxUnits em; Han characters break anywhere, Latin words stay whole. */
function greedy(text, maxUnits) {
  const tokens = String(text).match(/[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF]|[^\s\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF]+\s*|\s+/g) ?? [];
  const lines = [];
  let line = "";
  for (const token of tokens) {
    if (line.trim() && widthOf((line + token).trimEnd()) > maxUnits && !noLineStart.test(token)) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else {
      line += token;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** Balanced lines: the narrowest width that still needs no more lines than the greedy fit. */
function wrap(text, maxUnits) {
  const lines = greedy(text, maxUnits);
  if (lines.length < 2) return lines;
  let best = lines;
  for (let w = maxUnits - 0.5; w > maxUnits / 2; w -= 0.5) {
    const tryLines = greedy(text, w);
    if (tryLines.length > lines.length) break;
    best = tryLines;
  }
  return best;
}

/** The largest size, down to a floor, at which a line of text fits the width. */
function fitSize(text, size, maxWidth, floor) {
  let s = size;
  while (s > floor && widthOf(text) * s > maxWidth) s = Math.max(floor, Math.floor(s * 0.94));
  return s;
}

// ---- Slides ----
const imageFor = (slideId) => {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const file = path.join("images", `${slideId}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
};

function drawText(text, size, color, x, y, extra = "") {
  return `drawtext=fontfile='${esc(font)}':textfile='${textFile(text)}':expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}${extra}`;
}

function slidePng(seg, slide, k, total, aiLabel, out) {
  const question = slide.kind === "question";
  const bg = question ? "0x12305F" : "0xF7F6F2";
  const ink = question ? "white" : "0x16181D";
  const muted = question ? "white@0.7" : "0x6B6F78";
  const image = imageFor(slide.id);
  const padX = px(120);
  const inputs = ["-f", "lavfi", "-i", `color=c=${bg}:s=${W}x${H}:d=1`];
  if (image) inputs.push("-i", image);

  const headSize = px(slide.kind === "intro" || slide.kind === "recap" ? 76 : 68);
  let headLines = wrap(slide.headline, (W - 2 * padX) / headSize);
  let size = headSize;
  while (headLines.length > 3 && size > headSize * 0.7) {
    size = Math.round(size * 0.9);
    headLines = wrap(slide.headline, (W - 2 * padX) / size);
  }
  const lineH = Math.round(size * 1.32);
  const headTop = question ? px(210) : px(150);
  const headBottom = headTop + headLines.length * lineH;

  const chains = [];
  let last = "[0:v]";
  const keys = slide.onScreen ?? [];
  if (image) {
    const boxTop = headBottom + px(36);
    const boxBottom = H - (keys.length ? px(180) : px(110));
    const boxW = W - 2 * padX;
    const boxH = Math.max(px(120), boxBottom - boxTop);
    chains.push(`[1:v]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease[img]`, `[0:v][img]overlay=x=(W-w)/2:y=${boxTop}+(${boxH}-h)/2[bg]`);
    last = "[bg]";
  }
  const draws = [];
  if (font) {
    const segLabel = t(`第 ${seg.n} 段 · ${seg.title}`, `Segment ${seg.n} · ${seg.title}`);
    draws.push(drawText(segLabel, px(34), muted, padX, px(70)));
    draws.push(drawText(`${k} / ${total}`, px(30), muted, `w-text_w-${padX}`, `h-${px(80)}`));
    if (aiLabel) draws.push(drawText(aiLabel, px(32), "white", `w-text_w-${padX}`, px(62), `:box=1:boxcolor=0x16181D@0.8:boxborderw=${px(14)}`));
    if (question) draws.push(drawText(t("暂停一下，自己试一试", "Pause and try it yourself"), px(40), "0x9FC0FF", padX, px(140)));
    if (headLines.length) draws.push(drawText(headLines.join("\n"), size, ink, padX, headTop, `:line_spacing=${lineH - size}`));
    if (keys.length && image) {
      const row = keys.join("   ·   ");
      draws.push(drawText(row, fitSize(row, px(46), W - 2 * padX, px(26)), ink, padX, `h-${px(150)}`));
    } else if (keys.length) {
      const keySize = Math.min(...keys.map((key) => fitSize(key, px(keys.length > 2 ? 80 : 92), W - 2 * padX, px(40))));
      const gap = px(36);
      const block = keys.length * keySize + (keys.length - 1) * gap;
      const areaTop = headBottom + px(40);
      const areaBottom = H - px(120);
      let y = Math.round(areaTop + Math.max(0, areaBottom - areaTop - block) / 2);
      for (const key of keys) {
        draws.push(drawText(key, keySize, question ? "white" : "0x1D4ED8", "(w-text_w)/2", y));
        y += keySize + gap;
      }
    }
  }
  chains.push(`${last}${draws.length ? draws.join(",") : "null"},format=rgb24[v]`);
  ffmpeg([...inputs, "-filter_complex", chains.join(";"), "-map", "[v]", "-frames:v", "1", out], `${slide.id}.png`);
}

// ---- Sound: two-pass loudness normalization (FFmpeg loudnorm) ----
function loudnessFilter(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json`, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(String(r.stderr ?? ""))?.[0];
  let m;
  try {
    m = json ? JSON.parse(json) : null;
  } catch {
    m = null;
  }
  const resample = `aresample=${SAMPLE_RATE}`;
  if (!m || !Number.isFinite(Number(m.input_i)) || Number(m.input_i) < -70) return { filter: resample, measured: null };
  const measured = Number(m.input_i);
  // When a plain gain reaches the target without pushing the true peak over the
  // limit, apply just that gain: it is what loudnorm's linear mode does, and much
  // cheaper than running loudnorm (which works at 192 kHz) a second time.
  const gain = TARGET_I - measured;
  if (Number.isFinite(Number(m.input_tp)) && Number(m.input_tp) + gain <= TARGET_TP) return { filter: `volume=${gain.toFixed(2)}dB,${resample}`, measured };
  return {
    filter: `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,${resample}`,
    measured,
  };
}

// A still slide is encoded once as a one-second clip and repeated by the concat
// demuxer with stream copy: a two-minute slide costs one second of encoding, not
// two minutes, and every second starts on a keyframe, so seeking stays quick. The
// clip has no B-frames, so the last repeat can stop on any frame (the demuxer's
// outpoint) and the slide keeps its exact length.
const BASE_SECONDS = 1;
function stillClips(png, seconds, key) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const baseFrames = BASE_SECONDS * FPS;
  const base = path.join(work, `${key}.mp4`);
  ffmpeg(
    ["-loop", "1", "-framerate", String(FPS), "-i", png, "-frames:v", String(baseFrames), "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "20", "-bf", "0", "-g", String(baseFrames), "-pix_fmt", "yuv420p", "-r", String(FPS), "-an", base],
    base,
  );
  const quoted = `file '${base.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
  const lines = [];
  for (let left = frames; left > 0; left -= baseFrames) {
    lines.push(quoted);
    if (left < baseFrames) lines.push(`outpoint ${(left / FPS).toFixed(6)}`);
  }
  return lines;
}

// ---- Render ----
fs.mkdirSync(outDir, { recursive: true });
for (const name of fs.readdirSync(outDir)) {
  if (/\.(mp4|json)$/i.test(name)) fs.rmSync(path.join(outDir, name), { force: true });
}
const segments = Array.isArray(timeline.segments) ? timeline.segments : [];
if (!segments.length) fail(t("timeline.json 里没有段", "timeline.json has no segments"));
const slideTotal = segments.reduce((n, s) => n + (Array.isArray(s.slides) ? s.slides.length : 0), 0);
const manifest = { width: W, height: H, fps: FPS, segments: [] };
let slideNo = 0;
const soundName = { recording: t("你的录音", "your recording"), ai: t("AI 配音", "AI voice"), none: t("没有声音", "no sound") };

for (const seg of segments) {
  const n = Number(seg.n) || segments.indexOf(seg) + 1;
  const id = String(seg.id);
  const out = path.join(outDir, `${String(n).padStart(2, "0")}-${id}.mp4`);
  const seconds = Math.max(0.5, Number(seg.seconds) || 0);
  const ai = seg.audio?.source === "ai";
  const aiLabel = ai ? String(timeline.aiLabel || rules.aiLabel?.[en ? "en" : "zh"] || "") : "";
  const audioFile = seg.audio?.file && fs.existsSync(seg.audio.file) ? seg.audio.file : null;
  const screen = seg.picture?.source === "recording" && seg.picture.file && fs.existsSync(seg.picture.file) ? seg.picture.file : null;
  const args = [];
  let videoFilter;
  let videoMap;

  if (screen) {
    args.push("-i", screen);
    const extra = Math.max(0, seconds - probeSeconds(screen));
    const label = aiLabel && font ? `,${drawText(aiLabel, px(32), "white", `w-text_w-${px(60)}`, px(48), `:box=1:boxcolor=0x16181D@0.8:boxborderw=${px(14)}`)}` : "";
    videoFilter = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}${extra > 0.05 ? `,tpad=stop_mode=clone:stop_duration=${extra.toFixed(3)}` : ""}${label},format=yuv420p[v]`;
    videoMap = "[v]";
    slideNo += Array.isArray(seg.slides) ? seg.slides.length : 0;
  } else {
    const slides = Array.isArray(seg.slides) && seg.slides.length ? seg.slides : [{ id: `${id}-1`, kind: "teach", headline: String(seg.title ?? id), onScreen: [], start: 0, end: seconds }];
    const lines = ["ffconcat version 1.0"];
    for (const slide of slides) {
      slideNo += 1;
      const png = path.join(work, `${slide.id}.png`);
      slidePng({ n, title: String(seg.title ?? id) }, slide, slideNo, slideTotal, aiLabel, png);
      const dur = Math.max(1 / FPS, (Number(slide.end) || 0) - (Number(slide.start) || 0));
      lines.push(...stillClips(png, dur, slide.id));
    }
    const list = path.join(work, `${id}.ffconcat`);
    fs.writeFileSync(list, `${lines.join("\n")}\n`);
    args.push("-f", "concat", "-safe", "0", "-i", list);
    videoFilter = null;
    videoMap = "0:v";
  }

  let audioFilter;
  let measured = null;
  if (audioFile) {
    args.push("-i", audioFile);
    const loud = loudnessFilter(audioFile);
    measured = loud.measured;
    audioFilter = `[1:a:0]${loud.filter}[a]`;
  } else {
    args.push("-f", "lavfi", "-t", seconds.toFixed(3), "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`);
    audioFilter = "[1:a]anull[a]";
  }
  const videoArgs = videoFilter
    ? ["-filter_complex", `${videoFilter};${audioFilter}`, "-map", videoMap, "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-pix_fmt", "yuv420p"]
    : ["-filter_complex", audioFilter, "-map", videoMap, "-map", "[a]", "-c:v", "copy"];
  ffmpeg([...args, ...videoArgs, "-t", seconds.toFixed(3), "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", String(SAMPLE_RATE), "-ac", "2", "-movflags", "+faststart", out], out);
  const real = probeSeconds(out);
  manifest.segments.push({
    id,
    n,
    file: out.replace(/\\/g, "/"),
    seconds: Math.round(real * 1000) / 1000,
    audio: seg.audio?.source ?? "none",
    picture: screen ? "recording" : "slides",
    aiLabel: Boolean(aiLabel),
    loudnessBefore: measured,
    captions: seg.captions ?? null,
  });
  console.log(
    t(
      `${out.replace(/\\/g, "/")}：${real.toFixed(1)} 秒，${screen ? "录屏" : "幻灯片"}，${soundName[seg.audio?.source] ?? soundName.none}${aiLabel ? "，标着「" + aiLabel + "」" : ""}`,
      `${out.replace(/\\/g, "/")}: ${real.toFixed(1)}s, ${screen ? "screen recording" : "slides"}, ${soundName[seg.audio?.source] ?? soundName.none}${aiLabel ? `, labeled "${aiLabel}"` : ""}`,
    ),
  );
}

fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.rmSync(work, { recursive: true, force: true });
const totalSeconds = manifest.segments.reduce((sum, s) => sum + s.seconds, 0);
console.log(t(`写好了 ${manifest.segments.length} 个视频，共 ${(totalSeconds / 60).toFixed(1)} 分钟，见 ${outDir}。`, `Wrote ${manifest.segments.length} videos, ${(totalSeconds / 60).toFixed(1)} minutes in all, in ${outDir}.`));
