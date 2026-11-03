#!/usr/bin/env node
// "check" stage: before publishing. Warns only; the report says what to fix and why.
//
// The numbers come from rules.md (passed on the command line so Flowgit hashes
// it); the README's "依据 / Sources" has the links.
// - Format: at least 1280×720, 16:9, H.264 or HEVC, AAC stereo, under 4 GB (Udemy).
// - Length: six minutes or less a video (Guo, Kim & Rubin 2014; Brame 2016).
// - Sound: a voice at all; -16 LUFS (±1) and a true peak of -1 dBTP at most (AES TD1004).
// - Captions for every video (WCAG 2.2 SC 1.2.2): line length, line count, reading
//   speed and minimum duration (Netflix timed text guides), within the video's length,
//   and a warning when captions cut from the script sit on a real recording.
// - An AI voice is said and shown (China's AI content labeling measures, arts. 4 and 10).
// - Slides that describe a visual but have no screenshot in images/.
// Then a list of things to confirm yourself: Udemy's course minimum, the AI
// disclosure on the course page, audio description (WCAG 2.2 SC 1.2.5), uploads.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const pl = (n, one, many) => (n === 1 ? one : many);
const rulesFile = process.argv[2] ?? "rules.md";
const out = outputs[0]?.path ?? "check-report.md";
const L = en ? "en" : "zh";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") : null);
function readJson(file) {
  const text = read(file);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(t(`${file} 不是合法的 JSON：${err.message}`, `${file} is not valid JSON: ${err.message}`));
  }
}

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

const timeline = readJson("timeline.json") ?? { segments: [] };
const manifest = readJson(path.join("video", "manifest.json"));
if (!manifest) fail(t("找不到 video/manifest.json，先跑「生成视频」", "video/manifest.json not found; run the render stage first"));
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const has = (tool) => {
  const r = spawnSync(tool, ["-version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
};
const hasProbe = has("ffprobe");
const hasFfmpeg = has("ffmpeg");
const fmt = (n, digits = 1) => (Math.round(n * 10 ** digits) / 10 ** digits).toString();
const clock = (seconds) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const segTimeline = (id) => list(timeline.segments).find((s) => s.id === id);

const video = rules.video ?? {};
const loud = rules.loudness ?? {};
const maxMinutes = Number(rules.segments?.maxMinutes) || 6;
const capRules = rules.captions?.[L] ?? {};
const lineMax = Number(capRules.lineMax) || (en ? 42 : 16);
const maxLines = Number(capRules.lines) || (en ? 2 : 1);
const cpsMax = Number(capRules.cpsMax) || (en ? 20 : 9);
const minSeconds = Number(rules.captions?.minSeconds) || 0.833;

const formatIssues = [];
const lengthIssues = [];
const soundIssues = [];
const captionIssues = [];
const aiIssues = [];
const pictureIssues = [];
const notes = [];
const rows = [];

if (!hasProbe) notes.push(t("没装 FFmpeg（ffprobe），视频的规格和响度没有量。", "FFmpeg (ffprobe) is not installed, so format and loudness were not measured."));

function probe(file) {
  if (!hasProbe) return null;
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,channels:format=duration,size", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function loudness(file) {
  if (!hasFfmpeg) return null;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const summary = String(r.stderr ?? "").split("Summary:").pop() ?? "";
  const lufs = Number(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary)?.[1]);
  const peakRaw = /True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?|-inf)\s+dBFS/.exec(summary)?.[1];
  if (!Number.isFinite(lufs) || peakRaw == null) return null;
  return { lufs, peak: peakRaw === "-inf" ? -Infinity : Number(peakRaw), peakRaw };
}

/** SRT or WebVTT cues with their times and lines. */
function parseCaptions(text) {
  const time = (s) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(s);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : NaN;
  };
  const cues = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const words = lines
      .slice(at + 1)
      .map((l) => l.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    cues.push({ start: time(a), end: time(b), lines: words });
  }
  return cues;
}

const listNums = (nums) => (nums.length > 6 ? `${nums.slice(0, 6).join(t("、", ", "))}${t(" 等", " …")}` : nums.join(t("、", ", ")));
let aiUsed = false;
let totalSeconds = 0;

for (const m of list(manifest.segments)) {
  const id = String(m.id);
  const file = String(m.file ?? "");
  const tl = segTimeline(id) ?? {};
  if (!file || !fs.existsSync(file)) {
    formatIssues.push(t(`${id}：没有视频文件 ${file || ""}。`, `${id}: the video ${file || ""} is missing.`));
    continue;
  }
  const info = probe(file);
  const streams = list(info?.streams);
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const seconds = Number(info?.format?.duration) || Number(m.seconds) || 0;
  totalSeconds += seconds;
  if (info) {
    const w = Number(v?.width) || 0;
    const h = Number(v?.height) || 0;
    if (!v) formatIssues.push(t(`${id}：没有画面。`, `${id}: no video stream.`));
    else {
      if (w < (video.minWidth ?? 1280) || h < (video.minHeight ?? 720))
        formatIssues.push(t(`${id}：${w}×${h}，低于 ${video.minWidth ?? 1280}×${video.minHeight ?? 720}，Udemy 会拒收。`, `${id}: ${w}×${h}, below ${video.minWidth ?? 1280}×${video.minHeight ?? 720}; Udemy rejects it.`));
      if (h && Math.abs(w / h - 16 / 9) > 0.01) formatIssues.push(t(`${id}：画面比例 ${w}:${h}，不是 16:9。`, `${id}: the aspect ratio is ${w}:${h}, not 16:9.`));
      if (!["h264", "hevc"].includes(String(v.codec_name))) formatIssues.push(t(`${id}：视频编码是 ${v.codec_name}，用 H.264 或 HEVC。`, `${id}: the video codec is ${v.codec_name}; use H.264 or HEVC.`));
    }
    if (!a) formatIssues.push(t(`${id}：没有音轨。`, `${id}: no audio track.`));
    else {
      if (String(a.codec_name) !== "aac") formatIssues.push(t(`${id}：音频编码是 ${a.codec_name}，用 AAC。`, `${id}: the audio codec is ${a.codec_name}; use AAC.`));
      if (Number(a.channels) !== 2) formatIssues.push(t(`${id}：音频是 ${a.channels} 声道，要立体声，两个声道都有声音。`, `${id}: the audio has ${a.channels} channel(s); it should be stereo, with sound in both.`));
    }
    const size = Number(info.format?.size) || 0;
    if (size > (video.maxBytes ?? 4e9)) formatIssues.push(t(`${id}：文件 ${fmt(size / 1e9, 2)} GB，超过 4 GB。`, `${id}: the file is ${fmt(size / 1e9, 2)} GB, over 4 GB.`));
  }
  if (seconds > maxMinutes * 60)
    lengthIssues.push(t(`${id}：${clock(seconds)}，超过 ${maxMinutes} 分钟。拆成两段，学员更容易看完。`, `${id}: ${clock(seconds)}, over ${maxMinutes} minutes. Split it; learners are more likely to finish.`));

  // Sound.
  const source = String(m.audio ?? "none");
  if (source === "ai") aiUsed = true;
  let level = "";
  if (source === "none")
    soundIssues.push(
      m.picture === "recording"
        ? t(`${id}：没有讲解，录屏里没有声音。把讲解录成 recordings/${id}.m4a（或重新录一段带声音的录屏）再重跑。`, `${id}: no narration; the screen recording has no sound. Record the narration as recordings/${id}.m4a (or a new screen recording with sound) and run again.`)
        : t(`${id}：没有讲解，是无声的幻灯片视频。录好 recordings/${id}.m4a（或录屏 ${id}.mp4）再重跑。`, `${id}: no narration; it is a silent slide video. Record recordings/${id}.m4a (or a screen recording ${id}.mp4) and run again.`),
    );
  else if (a) {
    const l = loudness(file);
    if (!l) notes.push(t(`${id}：量不出响度。`, `${id}: loudness could not be measured.`));
    else {
      level = `${fmt(l.lufs)} LUFS / ${l.peakRaw} dBTP`;
      if (l.lufs < (loud.min ?? -17) || l.lufs > (loud.max ?? -15))
        soundIssues.push(t(`${id}：响度 ${fmt(l.lufs)} LUFS，建议 ${loud.target ?? -16}（±1）。`, `${id}: ${fmt(l.lufs)} LUFS; aim for ${loud.target ?? -16} (±1).`));
      if (l.peak > (loud.truePeakMax ?? -1)) soundIssues.push(t(`${id}：真峰值 ${l.peakRaw} dBTP，超过 ${loud.truePeakMax ?? -1}。`, `${id}: true peak ${l.peakRaw} dBTP, over ${loud.truePeakMax ?? -1}.`));
    }
  }

  // Captions.
  const capFile = str(m.captions?.srt) || str(tl.captions?.srt);
  const capText = capFile ? read(capFile) : null;
  if (!capText) captionIssues.push(t(`${id}：没有字幕文件。`, `${id}: no caption file.`));
  else {
    const cues = parseCaptions(capText);
    const long = [];
    const many = [];
    const fast = [];
    const brief = [];
    cues.forEach((c, i) => {
      const n = i + 1;
      if (c.lines.some((line) => [...line].length > lineMax)) long.push(n);
      if (c.lines.length > maxLines) many.push(n);
      const dur = c.end - c.start;
      const chars = [...c.lines.join(en ? " " : "")].length;
      // Caption files keep milliseconds, so allow half of one for rounding.
      if (dur > 0 && chars / (dur + 0.0005) > cpsMax) fast.push(n);
      if (dur < minSeconds - 0.0005) brief.push(n);
    });
    if (!cues.length) captionIssues.push(t(`${id}：${capFile} 里没有字幕。`, `${id}: ${capFile} has no captions.`));
    if (long.length) captionIssues.push(t(`${id}：${long.length} 条字幕有一行超过 ${lineMax} 个字（第 ${listNums(long)} 条）。`, `${id}: ${long.length} ${pl(long.length, "caption has", "captions have")} a line over ${lineMax} characters (#${listNums(long)}).`));
    if (many.length) captionIssues.push(t(`${id}：${many.length} 条字幕超过 ${maxLines} 行（第 ${listNums(many)} 条）。`, `${id}: ${many.length} ${pl(many.length, "caption runs", "captions run")} over ${maxLines} lines (#${listNums(many)}).`));
    if (fast.length) captionIssues.push(t(`${id}：${fast.length} 条字幕每秒超过 ${cpsMax} 个字，读不过来（第 ${listNums(fast)} 条）。`, `${id}: ${fast.length} ${pl(fast.length, "caption goes", "captions go")} faster than ${cpsMax} characters a second (#${listNums(fast)}).`));
    if (brief.length) captionIssues.push(t(`${id}：${brief.length} 条字幕显示不到 ${fmt(minSeconds, 2)} 秒（第 ${listNums(brief)} 条）。`, `${id}: ${brief.length} ${pl(brief.length, "caption stays", "captions stay")} up under ${fmt(minSeconds, 2)}s (#${listNums(brief)}).`));
    const lastEnd = Math.max(0, ...cues.map((c) => c.end).filter(Number.isFinite));
    if (seconds && lastEnd > seconds + 0.5) captionIssues.push(t(`${id}：字幕到 ${clock(lastEnd)} 才完，视频只有 ${clock(seconds)}。`, `${id}: the captions run to ${clock(lastEnd)}, but the video is ${clock(seconds)}.`));
    const capSource = str(m.captions?.source) || str(tl.captions?.source);
    if (source === "recording" && capSource === "script")
      captionIssues.push(
        t(
          `${id}：字幕是按讲稿切的，时间是估的，和你实际说的话不会一字不差。用转写工具导出字幕存成 recordings/${id}.srt，再从「字幕和时间线」重跑。`,
          `${id}: the captions were cut from the script and their timing is estimated, so they won't match what you actually said. Export captions from a transcription tool as recordings/${id}.srt and run again from the captions stage.`,
        ),
      );
    if (source === "ai") {
      const notice = str(rules.aiNotice?.[L]);
      const first = cues.slice(0, 3).map((c) => c.lines.join(" ")).join(" ").replace(/\s+/g, "");
      if (notice && !first.includes(notice.replace(/\s+/g, "").slice(0, 6)) && !/AI/.test(first))
        aiIssues.push(t(`${id}：字幕开头没有 AI 配音的说明。`, `${id}: the captions don't open with the AI voice notice.`));
    }
  }
  if (source === "ai" && !m.aiLabel) aiIssues.push(t(`${id}：用的是 AI 配音，但画面上没有标明。`, `${id}: the voice is AI, but the picture doesn't say so.`));

  // Slides with a visual described but no screenshot.
  if (m.picture === "slides") {
    const missing = list(tl.slides)
      .filter((s) => str(s.visual) && !["png", "jpg", "jpeg", "webp"].some((ext) => fs.existsSync(path.join("images", `${s.id}.${ext}`))))
      .map((s) => s.id);
    if (missing.length)
      pictureIssues.push(
        t(`${id}：${missing.length} 张幻灯片写了要放的画面，但 images/ 里没有图，视频里只有标题和关键词：${missing.join("、")}。`, `${id}: ${missing.length} ${pl(missing.length, "slide describes", "slides describe")} a visual with no image in images/, so the video shows only the headline and phrases: ${missing.join(", ")}.`),
      );
  }

  const soundLabel = { recording: t("录音", "recording"), ai: t("AI 配音", "AI voice"), none: t("无声", "silent") }[source] ?? source;
  rows.push(`| ${file} | ${clock(seconds)} | ${v ? `${v.width}×${v.height}` : "—"} | ${soundLabel}${level ? `${t("，", ", ")}${level}` : ""} | ${m.picture === "recording" ? t("录屏", "screen") : t("幻灯片", "slides")} | ${capFile || "—"} |`);
}

// ---- Things to confirm yourself ----
const segCount = list(manifest.segments).length;
const confirm = [
  t(
    `Udemy 的付费课程整门课至少要有 30 分钟视频、5 个讲座；这节课 ${segCount} 个视频，共 ${fmt(totalSeconds / 60)} 分钟，和其他几节一起算。`,
    `A paid Udemy course needs at least 30 minutes of video and 5 lectures in all; this lesson has ${segCount} videos and ${fmt(totalSeconds / 60)} minutes, counted with the other lessons.`,
  ),
  t(
    "上 Udemy 的话，在课程描述里写明用了 AI：这个流程用模型起草了讲稿和测验" + (aiUsed ? "，配音也是 AI。" : "。"),
    "On Udemy, say in the course description that AI was used: this flow drafted the script and the quiz with a model" + (aiUsed ? ", and the voice is AI." : "."),
  ),
  ...(aiUsed
    ? [t("在国内平台发布时，用平台的 AI 内容标识功能主动声明（《人工智能生成合成内容标识办法》第十条）。", "When publishing on a platform in China, declare the AI content through the platform's labeling feature (Labeling Measures art. 10).")]
    : []),
  t("画面上要看的东西，讲解里都说到了，看不到画面的学员也跟得上（WCAG 2.2 成功标准 1.2.5）。", "Everything learners need to see on screen is also said aloud, so someone who can't see it can follow (WCAG 2.2 SC 1.2.5)."),
  t("把 captions/ 里的字幕和对应的视频一起上传（平台收 .vtt 还是 .srt，就传哪一种）。", "Upload each caption file in captions/ with its video (.vtt or .srt, whichever the platform takes)."),
  t("把 quiz.md 的题放进平台的测验功能，放在最后一个视频后面。", "Put the questions from quiz.md into the platform's quiz tool after the last video."),
  t("截图和录屏里没有露出不该露的个人信息：姓名、手机号、账号、余额。", "Screenshots and recordings show no personal details that shouldn't be there: names, phone numbers, account numbers, balances."),
];

const none = t("没有。", "None.");
const listOf = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 视频规格（Udemy）", "## Video format (Udemy)"), formatIssues],
  [t("## 每段时长（Guo 等 2014）", "## Length of each video (Guo et al. 2014)"), lengthIssues],
  [t("## 声音（AES TD1004）", "## Sound (AES TD1004)"), soundIssues],
  [t("## 字幕（WCAG 2.2 成功标准 1.2.2；Netflix 字幕规范）", "## Captions (WCAG 2.2 SC 1.2.2; Netflix timed text guides)"), captionIssues],
  [t("## AI 配音的标识（《人工智能生成合成内容标识办法》第四条）", "## AI voice labels (China's AI content labeling measures, art. 4)"), aiIssues],
  [t("## 画面", "## Picture"), pictureIssues],
];
const lines = [
  t("# 上架前检查", "# Pre-publish check"),
  "",
  t(`${segCount} 个视频，共 ${clock(totalSeconds)}。`, `${segCount} ${segCount === 1 ? "video" : "videos"}, ${clock(totalSeconds)} in all.`),
  ...notes,
  "",
  t("| 视频 | 时长 | 分辨率 | 声音 | 画面 | 字幕 |", "| Video | Length | Resolution | Sound | Picture | Captions |"),
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  ...sections.flatMap(([heading, items]) => [heading, listOf(items), ""]),
  t("## 上架前自己确认", "## Confirm before you publish"),
  "",
  ...confirm.map((c) => `- [ ] ${c}`),
  "",
  t("这些检查只做提醒，不能代替法律意见和平台审核。", "These checks are reminders only; they don't replace legal advice or platform review."),
  "",
];
fs.writeFileSync(out, `${lines.join("\n")}\n`);
const issues = sections.reduce((n, [, items]) => n + items.length, 0);
console.log(
  issues
    ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`)
    : t(`检查通过，上架前再确认 ${confirm.length} 件事，见 ${out}。`, `All checks passed; confirm ${confirm.length} things before you publish, see ${out}.`),
);
