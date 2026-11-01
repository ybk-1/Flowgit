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

// drawtext gained text_align in FFmpeg 6.1; older builds left-align multi-line text.
const drawtextHelp = spawnSync("ffmpeg", ["-hide_banner", "-h", "filter=drawtext"], { encoding: "utf8" }).stdout ?? "";
const CENTER = drawtextHelp.includes("text_align") ? ":text_align=C" : "";

function run(args, label) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`${say(`ffmpeg 处理 ${label} 时失败`, `ffmpeg failed on ${label}`)}:\n${r.stderr}`);
    process.exit(1);
  }
}

const segments = [];
timeline.clips.forEach((clip, i) => {
  const dur = Math.max(0.5, Number(clip.duration) || 3);
  const out = path.join(work, `seg-${String(i).padStart(3, "0")}.mp4`);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},format=yuv420p`;
  const filters = [];
  let inputArgs;
  const src = clip.source ?? { kind: "card" };
  const srcPath = src.path ? path.join(dir, src.path) : undefined;
  if (src.kind === "image" && srcPath && fs.existsSync(srcPath)) {
    inputArgs = ["-loop", "1", "-t", String(dur), "-i", srcPath];
    filters.push(fit);
  } else if (src.kind === "video" && srcPath && fs.existsSync(srcPath)) {
    inputArgs = ["-stream_loop", "-1", "-t", String(dur), "-i", srcPath];
    filters.push(fit);
  } else {
    const color = PALETTE[i % PALETTE.length];
    inputArgs = ["-f", "lavfi", "-t", String(dur), "-i", `color=c=${color}:s=${W}x${H}:r=${FPS}`];
    filters.push("format=yuv420p");
    if (font && clip.narration) {
      // text card: show the narration in the middle when there is no asset
      const cardFile = path.join(work, `card-${i}.txt`);
      fs.writeFileSync(cardFile, wrapCaption(clip.narration, 11, 7));
      filters.push(
        `drawtext=fontfile='${esc(font)}':textfile='${esc(cardFile)}':fontsize=${Math.round(W / 16)}:fontcolor=white:line_spacing=${Math.round(W / 40)}${CENTER}:x=(w-text_w)/2:y=(h-text_h)/2`,
      );
    }
  }
  if (font && clip.caption) {
    const capFile = path.join(work, `cap-${i}.txt`);
    fs.writeFileSync(capFile, wrapCaption(clip.caption, 12));
    filters.push(
      `drawtext=fontfile='${esc(font)}':textfile='${esc(capFile)}':fontsize=${Math.round(W / 18)}:fontcolor=white:borderw=4:bordercolor=black@0.8:line_spacing=12${CENTER}:x=(w-text_w)/2:y=h*0.78`,
    );
  }
  run([...inputArgs, "-vf", filters.join(","), "-an", "-c:v", "libx264", "-preset", "veryfast", "-r", String(FPS), "-pix_fmt", "yuv420p", out], `clip ${clip.id}`);
  segments.push(out);
  const what = { image: say("图片", "image"), video: say("视频", "video"), card: say("文字卡", "text card") }[src.kind] ?? src.kind;
  console.log(`${say("镜头", "clip")} ${i + 1}/${timeline.clips.length} ${clip.id}: ${what}${src.path ? ` ${src.path}` : ""}, ${dur}${say(" 秒", "s")}`);
});

const list = path.join(work, "list.txt");
fs.writeFileSync(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"));
const finalPath = path.join(dir, "final.mp4");
run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", finalPath], "concat");
fs.rmSync(work, { recursive: true, force: true });

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", finalPath], { encoding: "utf8" });
console.log(say(`final.mp4：${W}x${H}，${Number(probe.stdout || 0).toFixed(1)} 秒`, `final.mp4: ${W}x${H}, ${Number(probe.stdout || 0).toFixed(1)}s`));
