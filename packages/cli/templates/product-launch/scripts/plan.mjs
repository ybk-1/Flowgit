#!/usr/bin/env node
// "plan" stage: the launch timeline and a one-page fact sheet, from the launch
// date, time and time zone, the tier in messaging.json and materials/facts.md.
//
// - Product Hunt: launches can be scheduled up to a month ahead, go live at
//   12:01 a.m. Pacific (the homepage runs on a Pacific-time day), and the
//   maker's first comment shows right under the gallery. The listing must be
//   in English. Thumbnail 240 x 240 (under 3 MB); gallery 1270 x 760, at
//   least two images.
// - An embargo names the date, the time and the time zone (PR Newswire).
// - Opt-outs: within 10 business days under CAN-SPAM; Gmail asks bulk senders
//   to honor unsubscribes within 48 hours.
// - Launch tiers follow the Product Marketing Alliance write-ups: tier 1 gets
//   every asset and press, tier 2 the basics, tier 3 a note to current users.
// Everything else in the timeline is the template's suggested rhythm.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Inputs ----
const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(flowInputs.launchDate ?? "").trim());
if (!dateMatch) fail(`launchDate 要写成 YYYY-MM-DD，例如 2026-12-01 / launchDate must be YYYY-MM-DD, e.g. 2026-12-01: "${flowInputs.launchDate ?? ""}"`);
const [year, month, day] = dateMatch.slice(1).map(Number);
const check = new Date(Date.UTC(year, month - 1, day));
if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
  fail(`launchDate 不是一个真实的日期 / launchDate is not a real date: ${flowInputs.launchDate}`);
}
const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(flowInputs.launchTime ?? "09:00").trim());
if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
  fail(`launchTime 要写成 24 小时制的 HH:MM，例如 09:00 / launchTime must be HH:MM on a 24-hour clock, e.g. 09:00: "${flowInputs.launchTime}"`);
}
const [hour, minute] = timeMatch.slice(1).map(Number);
const zone = String(flowInputs.timezone ?? "Asia/Shanghai").trim() || "Asia/Shanghai";
try {
  new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
} catch {
  fail(`timezone 要写 IANA 名称，例如 Asia/Shanghai、America/New_York / timezone must be an IANA name such as Asia/Shanghai or America/New_York: "${zone}"`);
}
const embargo = flowInputs.embargo === true || flowInputs.embargo === "true";
const product = String(flowInputs.product ?? "").trim();

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
const messaging = readJson("messaging.json");
if (!messaging) fail("messaging.json 不存在或不是合法的 JSON / messaging.json is missing or not valid JSON");
const facts = fs.existsSync("materials/facts.md") ? fs.readFileSync("materials/facts.md", "utf8") : "";

// ---- The fact file: "## 中文 / English" sections of "- label / Label: value" lines ----
const sections = facts
  .split(/^##\s+/m)
  .slice(1)
  .map((part) => ({ title: part.split("\n")[0].trim(), body: part.slice(part.indexOf("\n") + 1).trim() }));
const section = (pattern) => sections.find((s) => pattern.test(s.title))?.body ?? "";
/** "中文 / English" → the half in the output language. */
const pick = (text) => {
  const parts = String(text ?? "").split(" / ").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return String(text ?? "").trim();
  return en ? parts[parts.length - 1] : parts[0];
};
const bullets = (body) => body.split("\n").map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ""));
function field(body, pattern) {
  const line = bullets(body).find((l) => pattern.test(l.split(/[:：]/)[0]));
  if (!line) return "";
  return line.slice(line.search(/[:：]/) + 1).trim();
}

const englishName = field(section(/产品是什么|What it is/i), /英文名|English name/i) || product;
const company = pick(field(section(/发件信息|Sender/i), /发件人|From/i)) || product;
const city = pick(field(section(/公司简介|About the company/i), /电头|Dateline/i));
const spokesBody = section(/发言人|Spokesperson/i);
const spokesperson = [pick(field(spokesBody, /姓名|Name/i)), pick(field(spokesBody, /职位|Title/i))].filter(Boolean).join(t("，", ", "));
const contactLines = bullets(section(/媒体联系人|Media contact/i)).map(pick);
const priceLines = bullets(section(/价格和购买方式|Price and availability/i)).map(pick);

// ---- Time zones: a wall-clock time in an IANA zone → an instant ----
function offsetMinutes(timeZone, instant) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round((Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - instant) / 60000);
}
function zonedInstant(y, m, d, h, min, timeZone) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let instant = wall;
  for (let i = 0; i < 3; i++) instant = wall - offsetMinutes(timeZone, instant) * 60000;
  return instant;
}
function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}
function zoneName(instant, timeZone) {
  const fmt = new Intl.DateTimeFormat(en ? "en-US" : "zh-CN", { timeZone, timeZoneName: en ? "short" : "long" });
  return fmt.formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

// AP style: Jan., Feb., Aug., Sept., Oct., Nov. and Dec. are abbreviated; 9 a.m., 4:01 p.m.
const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const apDate = (y, m, d) => `${AP_MONTHS[m - 1]} ${d}, ${y}`;
const apTime = (h, min) => `${h % 12 === 0 ? 12 : h % 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "a.m." : "p.m."}`;
const zhDate = (y, m, d) => `${y}年${m}月${d}日`;
const zhTime = (h, min) => `${h}:${String(min).padStart(2, "0")}`;
const showWhen = (instant, timeZone) => {
  const w = wallClock(instant, timeZone);
  return en ? `${apDate(w.y, w.m, w.d)}, ${apTime(w.h, w.min)} ${zoneName(instant, timeZone)}` : `${zhDate(w.y, w.m, w.d)} ${zhTime(w.h, w.min)}（${zoneName(instant, timeZone)}）`;
};

const launchAt = zonedInstant(year, month, day, hour, minute, zone);
const phAt = zonedInstant(year, month, day, 0, 1, "America/Los_Angeles");
const launchZone = zoneName(launchAt, zone);
const releaseLine = embargo
  ? t(`禁发至 ${zhDate(year, month, day)} ${zhTime(hour, minute)}（${launchZone}）`, `EMBARGOED UNTIL ${apDate(year, month, day)}, ${apTime(hour, minute)} ${launchZone}`)
  : t("即时发布", "FOR IMMEDIATE RELEASE");
const datelineCity = city ? (en ? city.toUpperCase() : city) : t("（城市）", "(CITY)");
const dateline = t(`${datelineCity}，${zhDate(year, month, day)}——`, `${datelineCity}, ${apDate(year, month, day)} —`);

// ---- Tier ----
const tier = [1, 2, 3].includes(Number(messaging?.tier?.level)) ? Number(messaging.tier.level) : 2;
const tierWhy = String(messaging?.tier?.why ?? "").trim();
const tierText = {
  1: t("一级：新产品、新市场或方向的大变化。全套物料，加媒体。", "Tier 1: a new product, a new market or a big change of direction. Every asset, plus press."),
  2: t("二级：影响很多用户的功能。网页、邮件、帖子和 Product Hunt，新闻稿可选。", "Tier 2: a feature that matters to many users. Web page, email, posts and Product Hunt; the press release is optional."),
  3: t("三级：小改进。邮件或应用内通知、帖子和常见问题告诉现有用户；不用新闻稿和 Product Hunt。", "Tier 3: a small improvement. Tell current users with an email or in-app note, posts and the FAQ; no press release or Product Hunt."),
}[tier];

// ---- Timeline ----
const DAY = 86400000;
const launchDay = Date.UTC(year, month - 1, day);
const addDays = (n) => launchDay + n * DAY;
function addBusinessDays(n) {
  let at = launchDay;
  let left = n;
  while (left > 0) {
    at += DAY;
    const dow = new Date(at).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return at;
}
const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const showDay = (at) => {
  const d = new Date(at);
  const iso = d.toISOString().slice(0, 10);
  return en ? `${iso} (${WEEK_EN[d.getUTCDay()]})` : `${iso}（${WEEK_ZH[d.getUTCDay()]}）`;
};
const phLocal = showWhen(phAt, zone);
const gapHours = Math.round((phAt - launchAt) / 3600000);

const rows = [
  {
    at: addDays(-30),
    tiers: [1, 2, 3],
    what: t("定稿 messaging.json：发布标题、三条信息和每条说法的出处；以后所有物料都照它写。", "Lock messaging.json: the launch headline, the three pillars and the source of every claim; every asset follows it."),
    basis: t("模板建议", "template suggestion"),
  },
  {
    at: addDays(-30),
    tiers: [1, 2],
    what: t(
      "在 Product Hunt 上排期（最多提前一个月）。准备缩略图 240×240（3 MB 以内）和至少 2 张图集（1270×760）。文案只能用英文。",
      "Schedule the Product Hunt launch (up to a month ahead). Prepare a 240 × 240 thumbnail (under 3 MB) and at least two gallery images (1270 × 760). The listing must be in English.",
    ),
    basis: "Product Hunt",
  },
  ...(embargo
    ? [
        {
          at: addDays(-14),
          tiers: [1, 2],
          what: t(`把新闻稿发给记者，第一行写明：${releaseLine}。说清楚禁发到什么时候、哪个时区。`, `Send the press release to reporters, starting with: ${releaseLine}. Say exactly when the embargo lifts, with the time zone.`),
          basis: "PR Newswire",
        },
      ]
    : []),
  {
    at: addDays(-7),
    tiers: [1, 2, 3],
    what: t(
      "邮件定稿并排期：只发给同意接收的人；底部写明发件人、地址和退订方式；营销邮件加一键退订（List-Unsubscribe 头）。",
      "Finish and schedule the email: only to people who agreed to it, with the sender, postal address and how to unsubscribe at the bottom, and one-click unsubscribe (the List-Unsubscribe header) on marketing mail.",
    ),
    basis: t("CAN-SPAM；《广告法》第四十三条；ICO；Gmail", "CAN-SPAM; Advertising Law art. 43 (China); ICO; Gmail"),
  },
  {
    at: addDays(-7),
    tiers: [1, 2, 3],
    what: t("把 faq.md 的内部问答发给客服和销售。", "Send the internal Q&A in faq.md to support and sales."),
    basis: t("模板建议", "template suggestion"),
  },
  {
    at: addDays(-1),
    tiers: [1, 2, 3],
    what: t(
      "看 check-report.md 和 landing-check.md，把要确认的都处理掉；发言人确认新闻稿里的引语。",
      "Go through check-report.md and landing-check.md; the spokesperson approves the quote in the press release.",
    ),
    basis: t("模板建议", "template suggestion"),
  },
  {
    at: launchDay,
    instant: launchAt,
    when: showWhen(launchAt, zone),
    tiers: [1, 2, 3],
    what:
      tier === 3
        ? t("公开发布：邮件发出，X 和 LinkedIn 发帖，常见问题上线。", "Launch: send the email, post on X and LinkedIn, publish the FAQ.")
        : t(
            `公开发布：${embargo ? "禁发解除，" : ""}发新闻稿，落地页上线，邮件发出，X 和 LinkedIn 发帖。`,
            `Launch: ${embargo ? "the embargo lifts, " : ""}publish the press release, put the landing page live, send the email, post on X and LinkedIn.`,
          ),
    basis: "",
  },
  {
    at: launchDay,
    instant: phAt,
    when: phLocal,
    tiers: [1, 2],
    what: t(
      "Product Hunt 上线（太平洋时间 0:01）。maker 马上发第一条评论；可以分享链接，不要请人点赞。",
      "Product Hunt goes live (12:01 a.m. Pacific). Post the maker's first comment right away; share the link, but don't ask for upvotes.",
    ),
    basis: "Product Hunt",
  },
  {
    at: addDays(2),
    tiers: [1, 2, 3],
    what: t("发布后收到的退订，48 小时内处理完（Gmail 对批量发件人的要求）。", "Honor the unsubscribes that come in within 48 hours (Gmail's ask of bulk senders)."),
    basis: "Gmail",
  },
  {
    at: addBusinessDays(10),
    tiers: [1, 2, 3],
    what: t("CAN-SPAM：每一条退订都要在 10 个工作日内生效，这是发布当天收到的退订的最晚日期。", "CAN-SPAM: every opt-out takes effect within 10 business days; this is the latest date for the ones that come in on launch day."),
    basis: "CAN-SPAM",
  },
  {
    at: addDays(14),
    tiers: [1, 2, 3],
    what: t(
      "复盘：哪些渠道带来了落地页的留资，客服问得最多的是什么，下次改什么。",
      "Review: which channels brought sign-ups to the landing page, what support was asked most, and what to change next time.",
    ),
    basis: t("模板建议", "template suggestion"),
  },
].filter((row) => row.tiers.includes(tier));
rows.sort((a, b) => (a.instant ?? a.at) - (b.instant ?? b.at));

const assets = [
  [t("新闻稿", "Press release"), "press-release.md", tier === 1 ? t("要", "yes") : tier === 2 ? t("可选", "optional") : t("不用", "no")],
  [t("落地页", "Landing page"), "site/index.html", tier === 3 ? t("可选", "optional") : t("要", "yes")],
  [t("发布邮件", "Launch email"), "email.md", t("要", "yes")],
  ["Product Hunt", "posts.json", tier === 3 ? t("不用", "no") : t("要", "yes")],
  [t("X 和 LinkedIn", "X and LinkedIn"), "posts.json", t("要", "yes")],
  [t("常见问题", "FAQ"), "faq.md", t("要", "yes")],
  [t("媒体资料", "Fact sheet"), "fact-sheet.md", tier === 3 ? t("不用", "no") : t("要", "yes")],
];

const plan = [
  t(`# 发布计划：${product}`, `# Launch plan: ${product}`),
  "",
  t(`公开发布：${showWhen(launchAt, zone)}。`, `Public launch: ${showWhen(launchAt, zone)}.`),
  ...(tier === 3
    ? []
    : [
        t(
          `Product Hunt 上线：太平洋时间 ${zhDate(year, month, day)} 0:01，也就是 ${phLocal}${gapHours ? `，比公开发布${gapHours > 0 ? "晚" : "早"} ${Math.abs(gapHours)} 小时` : ""}。`,
          `Product Hunt goes live: 12:01 a.m. Pacific on ${apDate(year, month, day)}, which is ${phLocal}${gapHours ? `, ${Math.abs(gapHours)} ${Math.abs(gapHours) === 1 ? "hour" : "hours"} ${gapHours > 0 ? "after" : "before"} the public launch` : ""}.`,
        ),
      ]),
  t(`新闻稿第一行：${releaseLine}`, `Release line: ${releaseLine}`),
  "",
  t("## 发布分级", "## Launch tier"),
  "",
  tierText,
  ...(tierWhy ? ["", t(`为什么：${tierWhy}`, `Why: ${tierWhy}`)] : []),
  "",
  t("| 物料 | 文件 | 这一级要不要 |", "| Asset | File | Needed at this tier |"),
  "| --- | --- | --- |",
  ...assets.map(([name, file, need]) => `| ${name} | ${file} | ${need} |`),
  "",
  t("## 时间表", "## Timeline"),
  "",
  t("| 日期 | 做什么 | 依据 |", "| Date | What | Basis |"),
  "| --- | --- | --- |",
  ...rows.map((row) => `| ${row.when ?? showDay(row.at)} | ${row.what} | ${row.basis || "—"} |`),
  "",
  t(
    "「模板建议」是这个模板建议的节奏，按你的团队改；其他行的依据见 README 的「依据 / Sources」。",
    "\"Template suggestion\" rows are this template's suggested rhythm; change them to suit your team. The other rows' sources are in the README under \"依据 / Sources\".",
  ),
  "",
];

const claims = Array.isArray(messaging?.claims) ? messaging.claims : [];
const sheet = [
  t(`# 媒体资料：${product}`, `# Fact sheet: ${product}`),
  "",
  t(`- 产品：${product}${englishName && englishName !== product ? `（英文名 ${englishName}）` : ""}`, `- Product: ${product}${englishName && englishName !== product ? ` (English name: ${englishName})` : ""}`),
  t(`- 一句话：${messaging.headline ?? ""}。${messaging.subhead ?? ""}`.replace(/。。/, "。"), `- In one line: ${messaging.headline ?? ""}. ${messaging.subhead ?? ""}`.replace(/\.\./, ".")),
  t(`- 发布：${showWhen(launchAt, zone)}`, `- Launch: ${showWhen(launchAt, zone)}`),
  t(`- 新闻稿第一行：${releaseLine}`, `- Release line: ${releaseLine}`),
  t(`- 电头：${dateline}`, `- Dateline: ${dateline}`),
  "",
  t("## 价格和购买方式", "## Price and availability"),
  "",
  ...(priceLines.length ? priceLines.map((l) => `- ${l}`) : [t("- （资料里没有，发布前补上）", "- (Not in the facts; add it before launch)")]),
  "",
  t("## 关键事实", "## Key facts"),
  "",
  ...(claims.length ? claims.map((c) => `- ${String(c.claim ?? "").trim()}`) : [t("- （没有）", "- (None)")]),
  "",
  t(`## 关于${company}`, `## About ${company}`),
  "",
  String(messaging.boilerplate ?? "").trim(),
  "",
  t("## 发言人", "## Spokesperson"),
  "",
  spokesperson || t("（资料里没有）", "(Not in the facts)"),
  "",
  t("## 媒体联系人", "## Media contact"),
  "",
  ...(contactLines.length ? contactLines : [t("（资料里没有）", "(Not in the facts)")]),
  "",
  t("## 要准备的图", "## Images to prepare"),
  "",
  t("- Product Hunt 缩略图：240×240，3 MB 以内。", "- Product Hunt thumbnail: 240 × 240, under 3 MB."),
  t("- Product Hunt 图集：至少 2 张，1270×760。", "- Product Hunt gallery: at least two images, 1270 × 760."),
  t("- 落地页的图：文件名见 subflows/landing-page/structure.json 每个区块的 image。", "- Landing page images: file names are each block's image in subflows/landing-page/structure.json."),
  t("- 给媒体：产品截图、标志和发言人照片。", "- For the press: product screenshots, the logo and a photo of the spokesperson."),
  "",
];

const planOut = outputs[0]?.path ?? "launch-plan.md";
const sheetOut = outputs[1]?.path ?? "fact-sheet.md";
fs.writeFileSync(planOut, `${plan.join("\n")}\n`);
fs.writeFileSync(sheetOut, `${sheet.join("\n")}\n`);
console.log(
  t(
    `写好了 ${planOut} 和 ${sheetOut}：${tierText.split("：")[0]}，时间表 ${rows.length} 项。公开发布 ${showWhen(launchAt, zone)}${tier === 3 ? "" : `；Product Hunt ${phLocal}`}。`,
    `Wrote ${planOut} and ${sheetOut}: ${tierText.split(":")[0]}, ${rows.length} timeline rows. Public launch ${showWhen(launchAt, zone)}${tier === 3 ? "" : `; Product Hunt ${phLocal}`}.`,
  ),
);
