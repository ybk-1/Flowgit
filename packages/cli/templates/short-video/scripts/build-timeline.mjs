// 剪辑阶段：把 storyboard.json + assets/ 排成 timeline.json。
// Edit stage: lay out storyboard.json + assets/ as timeline.json.
//
// 时间线可以直接手改（顺序、时长、字幕、素材），改完再运行导出阶段。
// You can hand-edit timeline.json afterwards; the export stage renders whatever is there.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.FLOWGIT_PROJECT_DIR ?? process.cwd();
const lang = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}").language === "en" ? "en" : "zh";
const say = (zh, en) => (lang === "en" ? en : zh);
const storyboard = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"));
const assetsDir = path.join(dir, "assets");
const available = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => !f.startsWith(".")) : [];

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);

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

const [w, h] = (storyboard.aspect ?? "9:16") === "16:9" ? [1920, 1080] : (storyboard.aspect === "1:1" ? [1080, 1080] : [1080, 1920]);
const timeline = {
  format: "flowgit/timeline",
  version: "0.1",
  title: storyboard.title ?? "",
  width: w,
  height: h,
  fps: 30,
  duration: Number(t.toFixed(3)),
  // 镜头之间的转场：type 可以是 "fade" 或 "none"。 / Transition between clips: type "fade" or "none".
  transition: { type: "fade", duration: 0.4 },
  clips,
};

fs.writeFileSync(path.join(dir, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
console.log(
  say(
    `timeline.json：${clips.length} 个镜头，${timeline.duration} 秒，${clips.length - missing} 个有素材，${missing} 个用文字卡`,
    `timeline.json: ${clips.length} clips, ${timeline.duration}s, ${clips.length - missing} with assets, ${missing} as text cards`,
  ),
);
