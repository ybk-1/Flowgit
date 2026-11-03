// "check" stage. Content problems are warnings. A bad posts.json shape exits 1.
//
// The numbers and word lists are the JSON block in rules.md (passed on the
// command line so Flowgit hashes that file). Which source backs which rule
// is the README section "依据 / Sources".
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const out = outputs[0]?.path ?? "check-report.md";

const labels = {
  xiaohongshu: ["小红书", "Xiaohongshu"],
  weibo: ["微博", "Weibo"],
  x: ["X", "X"],
  douyin: ["抖音", "Douyin"],
  linkedin: ["LinkedIn", "LinkedIn"],
  "wechat-moments": ["微信朋友圈", "WeChat Moments"],
};
const label = (id) => (labels[id] ? (en ? labels[id][1] : labels[id][0]) : id);
const enCount = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const codePoints = (s) => [...s].length;

function write(lines, code = 0) {
  const text = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  fs.writeFileSync(out, text);
  console.log(text);
  if (code) process.exit(code);
}

function fail(message) {
  write(
    [
      t("# 帖子检查", "# Post check"),
      "",
      t("格式错误，这次没有做内容检查。", "Format error. Content checks did not run."),
      "",
      message,
      "",
    ],
    1,
  );
}

function loadRules() {
  let raw;
  try {
    raw = fs.readFileSync("rules.md", "utf8");
  } catch (err) {
    fail(t(`读不到 rules.md：${err.message}`, `Could not read rules.md: ${err.message}`));
  }
  const fenced = raw.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!fenced) fail(t("rules.md 里没有 JSON 规则块。", "rules.md has no JSON rules block."));
  try {
    return JSON.parse(fenced[1]);
  } catch (err) {
    fail(t(`rules.md 的 JSON 不合法：${err.message}`, `The JSON in rules.md is invalid: ${err.message}`));
  }
}

function loadPosts() {
  let raw;
  try {
    raw = fs.readFileSync("posts.json", "utf8");
  } catch (err) {
    fail(t(`没有 posts.json：${err.message}`, `posts.json is missing: ${err.message}`));
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail(t(`posts.json 不是合法的 JSON：${err.message}`, `posts.json is not valid JSON: ${err.message}`));
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.posts)) {
    fail(t("posts.json 需要一个 posts 数组。", "posts.json needs a posts array."));
  }
  const problems = [];
  data.posts.forEach((post, i) => {
    const n = i + 1;
    if (!post || typeof post !== "object" || Array.isArray(post)) {
      problems.push(t(`第 ${n} 条不是对象。`, `Item ${n} is not an object.`));
      return;
    }
    for (const key of ["platform", "title", "body", "imageIdea", "suggestedTime"]) {
      if (typeof post[key] !== "string") {
        problems.push(t(`第 ${n} 条的 ${key} 不是字符串。`, `Item ${n} field ${key} is not a string.`));
      }
    }
    if (typeof post.body === "string" && !post.body.trim()) problems.push(t(`第 ${n} 条正文是空的。`, `Item ${n} has an empty body.`));
    if (typeof post.imageIdea === "string" && !post.imageIdea.trim()) problems.push(t(`第 ${n} 条没有画面。`, `Item ${n} has no image idea.`));
    if (typeof post.suggestedTime === "string" && !post.suggestedTime.trim()) problems.push(t(`第 ${n} 条没有建议时间。`, `Item ${n} has no suggested time.`));
    if (!Array.isArray(post.hashtags) || post.hashtags.some((tag) => typeof tag !== "string" || !tag.trim())) {
      problems.push(t(`第 ${n} 条的 hashtags 必须是非空字符串组成的数组。`, `Item ${n} hashtags must be an array of non-empty strings.`));
    }
  });
  if (problems.length) fail(problems.map((item) => `- ${item}`).join("\n"));
  return data.posts;
}

const rules = loadRules();
const posts = loadPosts();
const known = new Set(Object.keys(rules.platforms ?? {}));
const requested = String(flowInputs.platforms ?? "xiaohongshu,weibo,x")
  .split(/[,，]/)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const byPlatform = new Map();
const duplicates = [];
for (const post of posts) {
  const id = post.platform.trim();
  if (byPlatform.has(id)) duplicates.push(id);
  else byPlatform.set(id, post);
}

function hashForm(platform, tag) {
  if (platform === "weibo") return `#${tag}#`;
  if (platform === "wechat-moments") return tag;
  return `#${tag}`;
}

function containsTag(post, tag) {
  return post.body.includes(tag) || post.title.includes(tag);
}

function withTags(platform, post) {
  const extra = post.hashtags.filter((tag) => !containsTag(post, tag)).map((tag) => hashForm(platform, tag));
  return [post.title, post.body, extra.join(" ")].map((part) => part.trim()).filter(Boolean).join("\n");
}

function weiboBody(post) {
  const extra = post.hashtags.filter((tag) => !post.body.includes(tag)).map((tag) => `#${tag}#`);
  return extra.length ? `${post.body}${extra.join("")}` : post.body;
}

function xUnits(text) {
  const cfg = rules.x;
  let raw = 0;
  let urls = 0;
  const rest = text.replace(/https?:\/\/[^\s)]+/gi, () => {
    urls += 1;
    return "";
  });
  raw += urls * cfg.transformedURLLength * cfg.scale;
  for (const ch of rest) {
    const cp = ch.codePointAt(0);
    const range = cfg.ranges.find((item) => cp >= item.start && cp <= item.end);
    raw += range ? range.weight : cfg.defaultWeight;
  }
  return raw / cfg.scale;
}

function wechatUnits(text) {
  let ascii = 0;
  let units = 0;
  for (const ch of text) {
    if (/[0-9A-Za-z]/.test(ch)) ascii += 1;
    else units += 1;
  }
  return units + Math.ceil(ascii / 2);
}

function countOf(spec, text) {
  if (spec.count === "x-weighted") return xUnits(text);
  if (spec.count === "wechat-units") return wechatUnits(text);
  return codePoints(text);
}

function showCount(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function lengthOf(platform, post, spec) {
  if (spec.titleMax) {
    const titleN = codePoints(post.title);
    const bodyN = codePoints(post.body);
    return {
      over: titleN > spec.titleMax || bodyN > spec.bodyMax,
      line: t(
        `${label(platform)}: 标题 ${titleN}/${spec.titleMax}，正文 ${bodyN}/${spec.bodyMax}`,
        `${label(platform)}: title ${titleN}/${spec.titleMax}, body ${bodyN}/${spec.bodyMax}`,
      ),
    };
  }
  const text = platform === "weibo" ? weiboBody(post) : withTags(platform, post);
  const max = spec.count === "x-weighted" ? rules.x.maxWeightedTweetLength : platform === "weibo" ? spec.bodyMax : spec.textMax;
  const n = countOf(spec, text);
  const shown = showCount(n);
  const kind =
    spec.count === "x-weighted"
      ? t(`加权 ${shown}/${max}`, `weighted ${shown}/${max}`)
      : spec.count === "wechat-units"
        ? t(`约 ${shown}/${max}`, `about ${shown}/${max}`)
        : `${shown}/${max}`;
  return { over: n > max, line: `${label(platform)}: ${kind}` };
}

function phraseHits(text, words, phrases) {
  const found = [];
  for (const word of words ?? []) if (word && text.includes(word)) found.push(word);
  for (const phrase of phrases ?? []) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, "i");
    if (re.test(text)) found.push(phrase);
  }
  return found;
}

function placeholderHits(text) {
  const found = [];
  for (const token of rules.placeholders ?? []) {
    if (token === "TODO" || token === "TBD") {
      if (new RegExp(`\\b${token}\\b`, "i").test(text)) found.push(token);
    } else if (text.includes(token)) found.push(token);
  }
  return found;
}

function linkHits(text) {
  const found = [];
  for (const marker of rules.linkMarkers ?? []) {
    if (text.toLowerCase().includes(marker.toLowerCase())) found.push(marker);
  }
  if (rules.phonePattern) {
    const match = text.match(new RegExp(`(?<!\\d)(?:${rules.phonePattern})(?!\\d)`));
    if (match) found.push(match[0]);
  }
  if (rules.emailPattern) {
    const match = text.match(new RegExp(rules.emailPattern, "i"));
    if (match) found.push(match[0]);
  }
  return found;
}

function scanned(post) {
  return [post.title, post.body, post.hashtags.join("\n"), post.imageIdea, post.suggestedTime].join("\n");
}

const lengthLines = [];
const hashtagLines = [];
const shapeLines = [];
const absoluteLines = [];
const medicalLines = [];
const linkLines = [];
const placeholderLines = [];
let issues = 0;

const unknown = requested.filter((id) => !known.has(id));
const missing = requested.filter((id) => known.has(id) && !byPlatform.has(id));
issues += unknown.length + missing.length + duplicates.length;

for (const id of requested) {
  if (!known.has(id) || !byPlatform.has(id)) continue;
  const post = byPlatform.get(id);
  const spec = rules.platforms[id];
  const length = lengthOf(id, post, spec);
  lengthLines.push(`${length.over ? "⚠️ " : ""}${length.line}`);
  if (length.over) issues += 1;

  if (id === "wechat-moments") {
    if (post.hashtags.length) {
      hashtagLines.push(
        t(
          `${label(id)}: 写了 ${post.hashtags.length} 个话题。朋友圈没有话题栏，这些词算进正文字数。`,
          `${label(id)}: ${enCount(post.hashtags.length, "tag", "tags")}. Moments has no hashtag field, so these words count toward the text.`,
        ),
      );
      issues += 1;
    }
  } else if (spec.hashtagMax && post.hashtags.length > spec.hashtagMax) {
    hashtagLines.push(
      id === "weibo"
        ? t(
            `${label(id)}: 话题 ${post.hashtags.length} 个，多于 ${spec.hashtagMax} 个（从第三个起不计入贡献度）`,
            `${label(id)}: ${enCount(post.hashtags.length, "topic", "topics")}, more than ${spec.hashtagMax} (from the third they stop counting toward contribution)`,
          )
        : t(
            `${label(id)}: 话题 ${post.hashtags.length} 个，多于 ${spec.hashtagMax} 个`,
            `${label(id)}: ${enCount(post.hashtags.length, "hashtag", "hashtags")}, more than ${spec.hashtagMax}`,
          ),
    );
    issues += 1;
  } else if (spec.hashtagMax) {
    hashtagLines.push(
      t(
        `${label(id)}: 话题 ${post.hashtags.length} 个，上限 ${spec.hashtagMax} 个`,
        `${label(id)}: ${enCount(post.hashtags.length, "hashtag", "hashtags")}, cap ${spec.hashtagMax}`,
      ),
    );
  } else {
    hashtagLines.push(
      t(
        `${label(id)}: 话题 ${post.hashtags.length} 个（官方没有写条数上限）`,
        `${label(id)}: ${enCount(post.hashtags.length, "hashtag", "hashtags")} (no official count cap)`,
      ),
    );
  }

  if (spec.hashtagMinLen) {
    for (const tag of post.hashtags) {
      const n = codePoints(tag);
      if (n < spec.hashtagMinLen || n > spec.hashtagMaxLen) {
        shapeLines.push(
          t(
            `${label(id)}: 「${tag}」有 ${n} 个字，要在 ${spec.hashtagMinLen} 到 ${spec.hashtagMaxLen} 之间`,
            `${label(id)}: "${tag}" is ${n} characters; keep it between ${spec.hashtagMinLen} and ${spec.hashtagMaxLen}`,
          ),
        );
        issues += 1;
      }
      const forbidden = [...(spec.hashtagForbidden ?? "")].filter((ch) => tag.includes(ch));
      if (forbidden.length) {
        shapeLines.push(
          t(
            `${label(id)}: 「${tag}」含有不能出现在话题词里的字符`,
            `${label(id)}: "${tag}" contains a character a topic word cannot include`,
          ),
        );
        issues += 1;
      }
      const at = post.body.indexOf(tag);
      if (at < 0) {
        shapeLines.push(t(`${label(id)}: 正文前 140 个字里没有「${tag}」`, `${label(id)}: "${tag}" is not in the body`));
        issues += 1;
      } else if (codePoints(post.body.slice(0, at)) >= spec.hashtagWithin) {
        shapeLines.push(
          t(
            `${label(id)}: 「${tag}」在前 ${spec.hashtagWithin} 个字之后，不计入贡献度`,
            `${label(id)}: "${tag}" starts after the first ${spec.hashtagWithin} characters, so it does not count toward contribution`,
          ),
        );
        issues += 1;
      }
    }
  }

  const text = scanned(post);
  const absolute = phraseHits(text, rules.absolute, rules.absolutePhrases);
  if (absolute.length) {
    absoluteLines.push(`${label(id)}: ${absolute.join(en ? ", " : "、")}`);
    issues += absolute.length;
  }
  const medical = phraseHits(text, rules.medical, rules.medicalPhrases);
  if (medical.length) {
    medicalLines.push(`${label(id)}: ${medical.join(en ? ", " : "、")}`);
    issues += medical.length;
  }
  if (spec.flagLinks) {
    const links = linkHits(text);
    if (links.length) {
      linkLines.push(`${label(id)}: ${links.join(en ? ", " : "、")}`);
      issues += links.length;
    }
  }
  const blanks = placeholderHits(text);
  if (blanks.length) {
    placeholderLines.push(`${label(id)}: ${blanks.join(en ? ", " : "、")}`);
    issues += blanks.length;
  }
}

const linkPlatforms = requested.filter((id) => rules.platforms[id]?.flagLinks);
const list = (items) => (items.length ? items.map((item) => `- ${item}`).join("\n") : t("没有。", "None."));
const lines = [
  t("# 帖子检查", "# Post check"),
  "",
  t("规则来自 rules.md。内容问题写在这里，不拦截发布；格式不对才会让这个阶段失败。", "Rules come from rules.md. Content problems are listed here and do not block posting. A bad JSON shape fails this stage."),
  "",
  t("## 长度", "## Length"),
  list(lengthLines),
  "",
  t("## 话题数量", "## Hashtag count"),
  list(hashtagLines),
  "",
  t("## 话题格式", "## Hashtag shape"),
  list(shapeLines),
  "",
  t("## 绝对化用语（《广告法》第九条第三项）", "## Absolute claims (Advertising Law art. 9(3))"),
  list(absoluteLines),
  "",
  t("## 医疗用语（《广告法》第十七条；抖音未认证账号不能写诊疗）", "## Medical claims (Advertising Law art. 17; uncertified Douyin accounts cannot post treatment)"),
  list(medicalLines),
  "",
  t("## 导流痕迹（联系方式、网址、二维码）", "## Diversion traces (contact details, URLs, QR codes)"),
  linkPlatforms.length ? list(linkLines) : t("这次的平台没有这条检查。", "None of this run's platforms use this check."),
  "",
  t("## 占位符", "## Placeholders"),
  list(placeholderLines),
  "",
  t("## 缺的平台", "## Missing platforms"),
  list(missing.map((id) => label(id))),
  "",
  t("## 不认识的平台", "## Unknown platforms"),
  list(unknown),
  "",
  t("## 重复的平台", "## Duplicate platforms"),
  list([...new Set(duplicates)].map((id) => label(id))),
  "",
  issues
    ? t(
        `有 ${issues} 处要看一下。脚本不能判断绝对化用语是不是执法指南里的例外，所以只提醒。发出去之前请再核对官方规则，规则会变。`,
        `${enCount(issues, "thing", "things")} to look at. The script cannot tell whether an absolute term is one of the enforcement guide's exceptions, so it only warns. Check the official rules again before posting; they change.`,
      )
    : t("检查通过。发出去之前请再核对官方规则，规则会变。", "Checks passed. Check the official rules again before posting; they change."),
  "",
];

write(lines);
