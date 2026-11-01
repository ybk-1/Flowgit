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
const lang = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}").language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const timeline = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8"));
const W = timeline.width ?? 1080;
const H = timeline.height ?? 1920;
const FPS = timeline.fps ?? 30;

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

// ffmpeg filter values: escape \ : ' for the filtergraph parser.
const esc = (s) => s.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-render-"));
const PALETTE = ["0x1f2937", "0x0f766e", "0x1d4ed8", "0x7c3aed", "0xb45309", "0xbe123c"];

/** Break text into balanced lines (no lonely last character), at most maxLines lines. */
function wrapCaption(text, perLine = 12, maxLines = 3) {
  const clean = text.trim();
  // English and other space-separated text (no CJK): wrap on words, about twice as many characters per line
  if (/\s/.test(clean) && !/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(clean)) {
    const max = perLine * 2;
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
const durations = clips.map((clip) => Math.max(0.5, Number(clip.duration) || 3));
const total = durations.reduce((a, b) => a + b, 0);

// Transition between clips. timeline.transition = { "type": "fade" | "none", "duration": seconds }.
// Each clip but the last is rendered T seconds longer and overlaps the next one, so the
// video keeps the timeline's total length.
const wantFade = (timeline.transition?.type ?? "fade") !== "none";
const T = wantFade && HAS_XFADE && clips.length > 1 ? Math.min(Math.max(Number(timeline.transition?.duration ?? 0.4) || 0, 0), 1, Math.min(...durations) / 2) : 0;

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
  const len = dur + (i < clips.length - 1 ? T : 0);
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
      filters.push(
        `drawtext=fontfile='${esc(font)}':textfile='${textFile(`card-${i}.txt`, wrapCaption(clip.narration, 11, 7))}':fontsize=${Math.round(W / 16)}:fontcolor=white:shadowcolor=black@0.35:shadowx=3:shadowy=3:line_spacing=${Math.round(W / 40)}${CENTER}:x=(w-text_w)/2:y=(h-text_h)/2`,
      );
    }
  }
  if (font && i === 0 && timeline.title) {
    // Title over the first clip for about 2.5 seconds, then it fades away.
    filters.push(
      `drawtext=fontfile='${esc(font)}':textfile='${textFile("title.txt", wrapCaption(timeline.title, 10, 2))}':fontsize=${Math.round(W / 13)}:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=${Math.round(W / 36)}:line_spacing=${Math.round(W / 60)}${CENTER}:x=(w-text_w)/2:y=h*0.12:alpha='if(lt(t,2.2),1,max(0,(2.8-t)/0.6))':enable='lt(t,2.8)'`,
    );
  }
  if (font && clip.caption) {
    filters.push(
      `drawtext=fontfile='${esc(font)}':textfile='${textFile(`cap-${i}.txt`, wrapCaption(clip.caption, 12))}':fontsize=${Math.round(W / 18)}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=${Math.round(W / 45)}:line_spacing=12${CENTER}:x=(w-text_w)/2:y=h*0.76`,
    );
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
if (T > 0) {
  let offset = 0;
  for (let k = 1; k < segments.length; k++) {
    offset += durations[k - 1];
    graph.push(`[${last}][s${k}]xfade=transition=fade:duration=${T}:offset=${offset.toFixed(3)}[x${k}]`);
    last = `x${k}`;
  }
} else if (segments.length > 1) {
  graph.push(`${segments.map((_, k) => `[s${k}]`).join("")}concat=n=${segments.length}:v=1:a=0[c]`);
  last = "c";
}
const edge = Math.min(0.4, total / 4);
graph.push(`[${last}]fade=t=in:st=0:d=${edge},fade=t=out:st=${(total - edge).toFixed(3)}:d=${edge},format=yuv420p[out]`);
run(
  [...segments.flatMap((s) => ["-i", s]), "-filter_complex", graph.join(";"), "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-pix_fmt", "yuv420p", "-movflags", "+faststart", finalPath],
  "join",
);
fs.rmSync(work, { recursive: true, force: true });

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", finalPath], { encoding: "utf8" });
console.log(say(`final.mp4：${W}x${H}，${Number(probe.stdout || 0).toFixed(1)} 秒`, `final.mp4: ${W}x${H}, ${Number(probe.stdout || 0).toFixed(1)}s`));
