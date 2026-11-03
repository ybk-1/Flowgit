// "export" stage. One markdown section per requested platform.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const out = outputs[0]?.path ?? "posts.md";

const labels = {
  xiaohongshu: ["小红书", "Xiaohongshu"],
  weibo: ["微博", "Weibo"],
  x: ["X", "X"],
  douyin: ["抖音", "Douyin"],
  linkedin: ["LinkedIn", "LinkedIn"],
  "wechat-moments": ["微信朋友圈", "WeChat Moments"],
};
const label = (id) => (labels[id] ? (en ? labels[id][1] : labels[id][0]) : id);

let raw;
try {
  raw = fs.readFileSync("posts.json", "utf8");
} catch (err) {
  console.error(t(`没有 posts.json：${err.message}`, `posts.json is missing: ${err.message}`));
  process.exit(1);
}
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error(t(`posts.json 不是合法的 JSON：${err.message}`, `posts.json is not valid JSON: ${err.message}`));
  process.exit(1);
}
if (!data || typeof data !== "object" || !Array.isArray(data.posts)) {
  console.error(t("posts.json 需要一个 posts 数组。", "posts.json needs a posts array."));
  process.exit(1);
}

const byPlatform = new Map();
for (const post of data.posts) {
  if (post && typeof post.platform === "string" && !byPlatform.has(post.platform.trim())) byPlatform.set(post.platform.trim(), post);
}

const requested = String(flowInputs.platforms ?? "xiaohongshu,weibo,x")
  .split(/[,，]/)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

function showTags(platform, tags) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.length) return t("（无）", "(none)");
  if (platform === "weibo") return list.map((tag) => `#${tag}#`).join(" ");
  if (platform === "wechat-moments") return list.join(en ? ", " : "、");
  return list.map((tag) => `#${String(tag).replace(/^#/, "")}`).join(" ");
}

const sections = requested.map((id) => {
  const post = byPlatform.get(id);
  const heading = `## ${label(id)}`;
  if (!post) return [heading, "", t("（posts.json 里没有这个平台）", "(no post for this platform in posts.json)"), ""].join("\n");
  return [
    heading,
    "",
    t("**标题**", "**Title**"),
    "",
    post.title?.trim() ? post.title.trim() : t("（无单独标题）", "(no separate title)"),
    "",
    t("**正文**", "**Body**"),
    "",
    String(post.body ?? "").trim(),
    "",
    t("**话题**", "**Hashtags**"),
    "",
    showTags(id, post.hashtags),
    "",
    t("**画面**", "**Image**"),
    "",
    String(post.imageIdea ?? "").trim(),
    "",
    t("**建议发布时间**", "**Suggested time**"),
    "",
    String(post.suggestedTime ?? "").trim(),
    "",
  ].join("\n");
});

const text = [`# ${t("帖子", "Posts")}`, "", ...sections].join("\n");
fs.writeFileSync(out, text.endsWith("\n") ? text : `${text}\n`);
console.log(t(`已写入 ${out}，${requested.length} 个平台。`, `Wrote ${out}, ${requested.length} platforms.`));
