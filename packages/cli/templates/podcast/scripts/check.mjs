// "check" stage: before publishing. Warns only; the report says what to fix and why.
//
// Rules and where they come from (README "依据 / Sources"):
// - Title: no show name, episode number or date, 150 characters at most (Apple Podcasts for Creators).
// - Chapters: the first at 00:00, at least three, in order (Apple, Spotify, YouTube); two minutes or more
//   each, at most six an hour, titles under five words and 45 characters (Apple), under 40 (Spotify).
//   Each time starts a block in transcript.md, so it lands where something was said.
// - The sponsor is labelled in the show notes too: FTC Endorsement Guides 16 CFR 255;
//   Internet Advertising Measures art. 9 (a purchase link means "广告").
// - Numbers come from the notes or the transcript: SPJ Code of Ethics.
// - A transcript with speakers: WCAG 2.2 SC 1.2.1; Apple Podcasts shows speakers only from a VTT.
// - Loudness about -16 LUFS (±1) with true peak at most -1 dBFS: Apple Podcasts audio requirements.
// - The episode description fits Apple Podcasts Connect's 10,000 characters.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 30;
const show = String(flowInputs.show ?? "").trim();
const sponsor = String(flowInputs.sponsor ?? "").trim();
const interview = (flowInputs.format ?? "interview") !== "solo";
const host = String(flowInputs.host ?? "").trim();
// "沈禾，半亩书店创始人" or "Shen He, founder of …" → the name before the first comma or bracket
const guest = String(flowInputs.guest ?? "").split(/[，,（(]/)[0].trim();

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const notes = read("materials/notes.md");
const transcript = read("transcript.md");
const vtt = read("publish/transcript.vtt");
const shownotes = read("shownotes.md");

/** "30:40", "1:02:03" or "06:40" → seconds, or null. */
function seconds(stamp) {
  const parts = String(stamp).trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
/** 400 → "06:40", 3723 → "1:02:03" */
function clock(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round(total % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const length = seconds(/^(?:时长|Length)[:：]\s*(\d+(?::\d{2}){1,2})/m.exec(transcript)?.[1] ?? "");
const blockStarts = new Set([...transcript.matchAll(/^\[(\d+(?::\d{2}){1,2})\]/gm)].map((m) => seconds(m[1])));
const speakers = (/^(?:说话人|Speakers)[:：]\s*(.+)$/m.exec(transcript)?.[1] ?? "")
  .split(/[、,，]/)
  .map((s) => s.trim())
  .filter((s) => s && !/^[（(]/.test(s));

// Length against the target: more than 15% off is worth a look.
const lengthIssues = [];
if (length == null) lengthIssues.push(t("transcript.md 里没有时长。", "transcript.md gives no length."));
else if (Math.abs(length / 60 - target) > target * 0.15) {
  lengthIssues.push(t(`实际 ${clock(length)}，目标 ${target} 分钟，差了 15% 以上。`, `${clock(length)} long against a ${target}-minute target, more than 15% off.`));
}

const speakerIssues = [];
if (!speakers.length) speakerIssues.push(t("文字稿没有标出说话人。", "The transcript names no speakers."));
else {
  if (host && !speakers.includes(host)) speakerIssues.push(t(`主持人 ${host} 不在说话人里（${speakers.join("、")}）。`, `The host ${host} is not among the speakers (${speakers.join(", ")}).`));
  if (interview && guest && !speakers.includes(guest)) speakerIssues.push(t(`嘉宾 ${guest} 不在说话人里（${speakers.join("、")}）。`, `The guest ${guest} is not among the speakers (${speakers.join(", ")}).`));
}

// Title
const title = (/^#\s+(.+)$/m.exec(shownotes)?.[1] ?? "").trim();
const episodeNumber = /第\s*[0-9一二三四五六七八九十百]+\s*[期集]|\b(?:ep|episode)\.?\s*\d+|#\s*\d+|\bS\d+\s*E\d+\b/i;
const dateLike = /\d{4}\s*[-/.年]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/;
const titleIssues = [];
if (!title) titleIssues.push(t("简介第一行不是 `# 标题`。", "The show notes don't start with a `# Title`."));
else {
  if (show && title.toLowerCase().includes(show.toLowerCase())) titleIssues.push(t("标题里有节目名，应用会另外显示。", "The title has the show name, which apps show separately."));
  if (episodeNumber.test(title)) titleIssues.push(t("标题里有期数，期数放在单集编号里。", "The title has an episode number; that goes in the episode number field."));
  if (dateLike.test(title)) titleIssues.push(t("标题里有日期。", "The title has a date."));
  if ([...title].length > 150) titleIssues.push(t(`标题 ${[...title].length} 个字符，超过 Apple 的 150。`, `The title is ${[...title].length} characters, over Apple's 150.`));
}

// Short words that title case leaves lowercase unless they come first or last.
const smallWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "off", "on", "or", "per", "so", "the", "to", "up", "via", "vs", "with", "yet"]);
/** "Pricing the Annual Pass" yes, "Pricing the annual pass" no. Words that start with a digit are skipped. */
function titleCased(title) {
  const words = title.split(/\s+/).filter(Boolean);
  return words.every((word, index) => {
    const first = word.replace(/^[^\p{L}\p{N}]+/u, "")[0];
    if (!first || !/\p{L}/u.test(first)) return true;
    const edge = index === 0 || index === words.length - 1;
    if (!edge && smallWords.has(word.toLowerCase().replace(/[^a-z]/g, ""))) return true;
    return first === first.toUpperCase();
  });
}

// Chapters: "06:40 Title", "(06:40) Title", "- 06:40 Title"
const chapterLine = /^\s*(?:[-*]\s*)?\(?(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*[-–—:：]?\s+(.+?)\s*$/;
const chapters = shownotes
  .split("\n")
  .map((line) => chapterLine.exec(line))
  .filter(Boolean)
  .map((m) => ({ stamp: m[1], at: seconds(m[1]), title: m[2].trim() }));
const chapterIssues = [];
if (chapters.length < 3) chapterIssues.push(t(`只有 ${chapters.length} 个章节，至少要 3 个。`, `Only ${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}; at least 3 are needed.`));
if (chapters.length && chapters[0].at !== 0) chapterIssues.push(t(`第一个章节从 ${chapters[0].stamp} 开始，要从 00:00 开始。`, `The first chapter starts at ${chapters[0].stamp}; it has to start at 00:00.`));
chapters.forEach((chapter, index) => {
  const next = chapters[index + 1];
  if (next && next.at <= chapter.at) chapterIssues.push(t(`${next.stamp} 排在 ${chapter.stamp} 后面，时间要越来越晚。`, `${next.stamp} comes after ${chapter.stamp}; times have to increase.`));
  const end = next ? next.at : length;
  if (end != null && end > chapter.at && end - chapter.at < 120) {
    chapterIssues.push(t(`${chapter.stamp} ${chapter.title}：只有 ${clock(end - chapter.at)}，不到 2 分钟。`, `${chapter.stamp} ${chapter.title}: only ${clock(end - chapter.at)}, under 2 minutes.`));
  }
  if (chapter.at !== 0 && !blockStarts.has(chapter.at)) {
    chapterIssues.push(t(`${chapter.stamp} 不是文字稿里任何一段的开头。`, `${chapter.stamp} does not start a block in the transcript.`));
  }
  if (length != null && chapter.at >= length) chapterIssues.push(t(`${chapter.stamp} 超过了时长 ${clock(length)}。`, `${chapter.stamp} is past the end (${clock(length)}).`));
  const chars = [...chapter.title].length;
  const words = chapter.title.split(/\s+/).filter(Boolean).length;
  if (chars > 40) chapterIssues.push(t(`${chapter.stamp} 的章节名 ${chars} 个字符，超过 40。`, `${chapter.stamp}: the title is ${chars} characters, over 40.`));
  if (en && words >= 5) chapterIssues.push(`${chapter.stamp}: "${chapter.title}" is ${words} words; Apple suggests fewer than five.`);
  if (/^\d+\s*[.、)\-–]/.test(chapter.title)) chapterIssues.push(t(`${chapter.stamp} 的章节名带编号。`, `${chapter.stamp}: the title is numbered.`));
  if (en && !titleCased(chapter.title)) chapterIssues.push(`${chapter.stamp}: "${chapter.title}" is not in title case; Apple suggests title casing, such as "Pricing the Annual Pass".`);
});
// Apple also suggests not repeating words across chapter titles. English only: Chinese has no spaces to split words on.
if (en) {
  const seen = new Map();
  for (const chapter of chapters) {
    for (const word of new Set(chapter.title.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [])) {
      if (!smallWords.has(word)) seen.set(word, (seen.get(word) ?? 0) + 1);
    }
  }
  const repeated = [...seen].filter(([, count]) => count > 1).map(([word]) => `"${word}"`);
  if (repeated.length) chapterIssues.push(`${repeated.join(", ")} ${repeated.length === 1 ? "appears" : "appear"} in more than one chapter title; Apple suggests not repeating words across chapters.`);
}
const maxChapters = length != null ? Math.max(3, Math.ceil(length / 600)) : null;
if (maxChapters != null && chapters.length > maxChapters) {
  chapterIssues.push(t(`${chapters.length} 个章节，时长 ${clock(length)} 最多 ${maxChapters} 个（每小时不超过 6 个）。`, `${chapters.length} chapters; ${clock(length)} allows at most ${maxChapters} (no more than six an hour).`));
}

// The sponsor is labelled where it appears.
const sponsorIssues = [];
if (sponsor) {
  if (!shownotes.toLowerCase().includes(sponsor.toLowerCase())) sponsorIssues.push(t(`简介里没有提到赞助商 ${sponsor}。`, `The show notes don't name the sponsor ${sponsor}.`));
  const labelled = en ? /\b(?:ad|advertisement|sponsor|sponsored|paid)\b/i.test(shownotes) : /广告/.test(shownotes);
  if (!labelled) sponsorIssues.push(t("简介里的赞助没有标明“广告”。", "The show notes don't label the sponsorship as an ad."));
}

const absolute = ["国家级", "世界级", "最高级", "最佳", "最好", "最强", "最低价", "全网最低", "最便宜", "全网最", "史上最", "顶级", "极品", "独一无二", "万能", "保证", "100%", "百分百", "No.1", "NO.1"];
// "第一" claims a rank ("销量第一"), but "第一，……第二，……" and "第一个月" only count.
const firstRank = /第一(?![，,、：:；;\s]|[个次天周月年期步批章页句段集季回轮件条点])/;
const absoluteEn = [/\bbest\b/i, /\bnumber one\b/i, /#1\b/, /\bno\.\s*1\b/i, /\btop-rated\b/i, /\bguarantee[sd]?\b/i, /\bunbeatable\b/i];
const absoluteHits = [...absolute.filter((word) => shownotes.includes(word)), ...(firstRank.test(shownotes) ? ["第一"] : []), ...absoluteEn.filter((re) => re.test(shownotes)).map((re) => shownotes.match(re)[0])];

const normalize = (text) => text.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
const numbersIn = (text) =>
  normalize(text)
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .match(/\d+(?:\.\d+)?/g) ?? [];
const known = new Set(numbersIn(`${notes}\n${transcript}\n${Object.values(flowInputs).join("\n")}`));
const unknownNumbers = [...new Set(numbersIn(shownotes))].filter((n) => !known.has(n));

const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填|\bXX\b/i;
const otherIssues = [];
if (!shownotes.trim()) otherIssues.push(t("shownotes.md 是空的。", "shownotes.md is empty."));
if (placeholder.test(shownotes)) otherIssues.push(t("简介里还有占位符。", "The show notes still have a placeholder."));
if ([...shownotes].length > 10000) otherIssues.push(t(`简介 ${[...shownotes].length} 个字符，超过 Apple 单集描述的 10000。`, `The show notes are ${[...shownotes].length} characters, over Apple's 10,000 for an episode description.`));
if (!vtt.trim()) otherIssues.push(t("没有 publish/transcript.vtt。", "There is no publish/transcript.vtt."));
else if (!/<v\s/.test(vtt)) otherIssues.push(t("transcript.vtt 没有标出说话人。", "transcript.vtt names no speakers."));

// Loudness of the final audio, when it is in recording/ and FFmpeg is installed.
const audioExts = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"]);
const audio = fs.existsSync("recording") ? fs.readdirSync("recording").filter((name) => audioExts.has(path.extname(name).toLowerCase())).sort() : [];
const loudnessIssues = [];
const loudnessNotes = [];
if (!audio.length) loudnessNotes.push(t("recording/ 里没有成品音频，跳过响度检查。", "No final audio in recording/, so loudness was not measured."));
else {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) loudnessNotes.push(t("没装 FFmpeg，跳过响度检查。", "FFmpeg is not installed, so loudness was not measured."));
  else {
    for (const name of audio) {
      const run = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", path.join("recording", name), "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const summary = String(run.stderr ?? "").split("Summary:").pop() ?? "";
      const lufs = Number(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary)?.[1]);
      const peakRaw = /True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?|-inf)\s+dBFS/.exec(summary)?.[1];
      if (!Number.isFinite(lufs) || peakRaw == null) {
        loudnessIssues.push(t(`${name}：量不出响度。`, `${name}: loudness could not be measured.`));
        continue;
      }
      const peak = peakRaw === "-inf" ? -Infinity : Number(peakRaw);
      loudnessNotes.push(t(`${name}：响度 ${lufs} LUFS，真峰值 ${peakRaw} dBFS。`, `${name}: ${lufs} LUFS, true peak ${peakRaw} dBFS.`));
      if (lufs < -17 || lufs > -15) loudnessIssues.push(t(`${name}：响度 ${lufs} LUFS，Apple 建议 -16（±1）。`, `${name}: ${lufs} LUFS; Apple recommends -16 (±1).`));
      if (peak > -1) loudnessIssues.push(t(`${name}：真峰值 ${peakRaw} dBFS，Apple 建议不超过 -1。`, `${name}: true peak ${peakRaw} dBFS; Apple recommends -1 at most.`));
    }
  }
}

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const report = [
  [t("## 时长", "## Length"), lengthIssues],
  [t("## 说话人", "## Speakers"), speakerIssues],
  [t("## 标题（Apple Podcasts）", "## Title (Apple Podcasts)"), titleIssues],
  [t("## 章节（Apple Podcasts、Spotify、YouTube）", "## Chapters (Apple Podcasts, Spotify, YouTube)"), chapterIssues],
  [t("## 赞助标明（FTC 背书指南；《互联网广告管理办法》第九条）", "## Sponsor label (FTC Endorsement Guides; China's Internet Advertising Measures art. 9)"), sponsorIssues],
  [t("## 绝对化用语（《广告法》第九条）", "## Absolute claims (China's Advertising Law art. 9)"), absoluteHits],
  [t("## 资料和文字稿里找不到的数字（核实后再发）", "## Numbers not in the notes or the transcript (verify before publishing)"), unknownNumbers],
  [t("## 响度（Apple Podcasts）", "## Loudness (Apple Podcasts)"), loudnessIssues],
  [t("## 其他", "## Other"), otherIssues],
];
const chapterList = chapters.map((c) => c.stamp).join(t("、", ", "));
const lines = [
  t("# 发布检查", "# Publish check"),
  "",
  length != null ? t(`时长 ${clock(length)}（目标 ${target} 分钟）。`, `Length ${clock(length)} (target ${target} minutes).`) : t("时长不明。", "Length unknown."),
  t(`章节 ${chapters.length} 个${chapters.length ? `：${chapterList}` : ""}。`, `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}${chapters.length ? `: ${chapterList}` : ""}.`),
  ...loudnessNotes,
  "",
  ...report.flatMap(([heading, items]) => [heading, list(items), ""]),
  t("这些检查只做提醒，不能代替法律意见和平台审核。", "These checks are reminders only; they do not replace legal advice or platform review."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = report.reduce((n, [, items]) => n + items.length, 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
