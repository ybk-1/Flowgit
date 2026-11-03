#!/usr/bin/env node
// "check" stage: check-report.md. Every content problem is a warning; the
// stage fails only when messaging.json, posts.json or rules.md has the wrong
// shape. The numbers and word lists are the JSON block in rules.md (passed on
// the command line so Flowgit hashes that file); which source backs which
// rule is the README section "依据 / Sources".
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const out = outputs[0]?.path ?? "check-report.md";
const rulesFile = process.argv[2] ?? "rules.md";
const sep = t("、", ", ");
// In Chinese text a Latin name gets a space before the Han that follows it ("LinkedIn 里").
const zhName = (name) => (/[A-Za-z0-9]$/.test(name) ? `${name} ` : name);

function writeReport(lines) {
  const text = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  fs.writeFileSync(out, text);
  return text;
}

function fail(message) {
  const text = writeReport([t("# 发布物料检查", "# Launch check"), "", t("格式错误，这次没有做内容检查。", "Format error. Content checks did not run."), "", message, ""]);
  console.error(text);
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null);

// ---- Rules and the two JSON assets: a bad shape fails the stage ----
let rules;
{
  const fenced = read(rulesFile)?.match(/```json\n([\s\S]*?)\n```/);
  if (!fenced) fail(t(`${rulesFile} 里没有 JSON 规则块。`, `${rulesFile} has no JSON rules block.`));
  try {
    rules = JSON.parse(fenced[1]);
  } catch (err) {
    fail(t(`${rulesFile} 的 JSON 不合法：${err.message}`, `The JSON in ${rulesFile} is invalid: ${err.message}`));
  }
}
function readJson(file) {
  const raw = read(file);
  if (raw === null) fail(t(`没有 ${file}。`, `${file} is missing.`));
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(t(`${file} 不是合法的 JSON：${err.message}`, `${file} is not valid JSON: ${err.message}`));
  }
}
const messaging = readJson("messaging.json");
const posts = readJson("posts.json");
{
  const problems = [];
  const ph = posts?.productHunt;
  if (!ph || typeof ph !== "object" || Array.isArray(ph)) problems.push(t("posts.json 要有一个 productHunt 对象。", "posts.json needs a productHunt object."));
  else {
    for (const key of ["name", "tagline", "description", "firstComment"]) {
      if (typeof ph[key] !== "string") problems.push(t(`productHunt.${key} 不是字符串。`, `productHunt.${key} is not a string.`));
    }
  }
  for (const key of ["x", "linkedin"]) if (typeof posts?.[key] !== "string") problems.push(t(`${key} 不是字符串。`, `${key} is not a string.`));
  if (!messaging || typeof messaging !== "object" || Array.isArray(messaging)) problems.push(t("messaging.json 要是一个对象。", "messaging.json must be an object."));
  if (problems.length) fail(problems.map((p) => `- ${p}`).join("\n"));
}

// ---- Text helpers ----
// URLs stop at the first character outside printable ASCII, so "https://a.example店" is one URL and one Han character.
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/gi;
const codePoints = (s) => [...String(s)].length;
const squash = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const englishWords = (s) => String(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const zhLength = (s) => (String(s).match(/\p{Script=Han}|[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/gu) ?? []).length;
const lengthOf = (s) => (en ? englishWords(s) : zhLength(s));
const hasHan = (s) => /\p{Script=Han}/u.test(String(s));
const paragraphs = (s) => String(s).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function quotesIn(text, min = 4) {
  const re = /「([^」]+)」|“([^”]+)”|"([^"]+)"|『([^』]+)』/g;
  return [...String(text).matchAll(re)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]).trim()).filter((q) => codePoints(q) >= min);
}

/**
 * Terms found in the text, skipping ones right after a negation such as 不 / no / not,
 * and ones in a sentence that rules them out, before the term ("不要说「全自动」",
 * "don't say \"the only\"", "能不能说「首款」？") or after it in the same phrase
 * ("「首款」「唯一」同样不写", "\"the only\" is off-limits").
 */
function findTerms(text, terms) {
  const hay = String(text).toLowerCase();
  const found = [];
  for (const term of terms ?? []) {
    if (!term) continue;
    const needle = term.toLowerCase();
    const latin = /^[a-z0-9#]/.test(needle);
    let at = hay.indexOf(needle);
    while (at !== -1) {
      const before = hay.slice(Math.max(0, at - 20), at);
      const after = hay[at + needle.length] ?? "";
      const bounded = !latin || (!/[a-z0-9]/.test(hay[at - 1] ?? "") && !/[a-z0-9]/.test(after));
      const negated =
        /[不没无别勿非][^，。！？；,.!?;\n]{0,2}$/.test(before) ||
        /\b(?:no|not|never|without|don't|doesn't|isn't|aren't|won't|can't|cannot|didn't)\s+(?:\w+\s+)?$/.test(before);
      const clause = hay.slice(0, at).split(/[。！？；\n.!?;]/).pop();
      const ruledOut = /不要说|不要写|不要用|不要提|不能说|不能写|别说|别写|禁止|避免|do not say|don't say|never say|do not use|don't use|do not write|don't write|do not claim|don't claim|avoid|can (?:we|i|you) (?:say|use|write|claim|call)/.test(clause);
      const tail = hay.slice(at + needle.length).split(/[，,。！？；\n.!?;]/)[0];
      const ruledOutAfter = /不写|不说|不能说|不能写|不要说|不要写|不要用|别说|别写|不提|都不行|\b(?:is|are)\s+(?:also\s+)?(?:off-limits|not allowed|banned)\b/.test(tail);
      if (bounded && !negated && !ruledOut && !ruledOutAfter) {
        found.push(term);
        break;
      }
      at = hay.indexOf(needle, at + 1);
    }
  }
  return [...new Set(found)];
}

// ---- The fact file ----
const facts = read("materials/facts.md") ?? "";
const sections = facts
  .split(/^##\s+/m)
  .slice(1)
  .map((part) => ({ title: part.split("\n")[0].trim(), body: part.slice(part.indexOf("\n") + 1).trim() }));
const section = (pattern) => sections.find((s) => pattern.test(s.title))?.body ?? "";
const bullets = (body) => body.split("\n").map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ""));
const halves = (text) => String(text ?? "").split(" / ").map((s) => s.trim()).filter(Boolean);
function field(body, pattern) {
  const line = bullets(body).find((l) => pattern.test(l.split(/[:：]/)[0]));
  return line ? line.slice(line.search(/[:：]/) + 1).trim() : "";
}
const DO_NOT_SAY = /不要说|不要写|不能说|do not say|don't say|avoid/i;
const doNotSay = section(DO_NOT_SAY);
// What the facts allow: everything except the "do not say" section.
const factsAllowed = facts
  .split(/^(?=##\s)/m)
  .filter((part) => !(/^##\s/.test(part) && DO_NOT_SAY.test(part.split("\n")[0])))
  .join("");
const factsSquashed = squash(factsAllowed);
const banned = [...new Set(quotesIn(doNotSay, 2))];

const englishName = field(section(/产品是什么|What it is/i), /英文名|English name/i);
const sender = section(/发件信息|Sender/i);
const senderNames = halves(field(sender, /发件人|From/i));
const addresses = halves(field(sender, /地址|address/i));
const spokes = section(/发言人|Spokesperson/i);
const spokesNames = halves(field(spokes, /姓名|Name/i));
const spokesTitles = halves(field(spokes, /职位|Title/i));

// Customers quoted under "Proof": "「…」——Name, detail, tie." in either half.
const TIE_WORDS = ["免费", "赠送", "付费", "报酬", "员工", "同事", "朋友", "亲友", "家人", "投资", "free", "gifted", "paid", "compensated", "employee", "friend", "family", "investor", "sponsored"];
const customers = [];
for (const line of bullets(section(/证据|Proof/i))) {
  for (const half of halves(line)) {
    const m = /(?:——|—|--)\s*([^，,、。.]+?)\s*[，,]\s*(.+?)\s*[。.]?\s*$/.exec(half);
    if (!m || !quotesIn(half, 4).length) continue;
    customers.push({ name: m[1].trim(), detail: m[2].trim(), ties: TIE_WORDS.filter((w) => m[2].toLowerCase().includes(w)) });
  }
}

// ---- The plan's fact sheet ----
const sheet = read("fact-sheet.md") ?? "";
const plan = read("launch-plan.md") ?? "";
const sheetField = (pattern) => {
  const line = sheet.split("\n").find((l) => pattern.test(l.trim()));
  return line ? line.trim().replace(pattern, "").trim() : "";
};
const releaseLine = sheetField(/^-\s*(新闻稿第一行|Release line)\s*[:：]/i);
const dateline = sheetField(/^-\s*(电头|Dateline)\s*[:：]/i);
const tier = Number(messaging?.tier?.level);

// ---- The launch date ----
const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(flowInputs.launchDate ?? "").trim());
const launch = dm ? { y: Number(dm[1]), m: Number(dm[2]), d: Number(dm[3]) } : null;
const launchDow = launch ? new Date(Date.UTC(launch.y, launch.m - 1, launch.d)).getUTCDay() : null;
const showDate = (y, m, d) => (en ? `${y ? `${y}-` : ""}${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : `${y ? `${y}年` : ""}${m}月${d}日`);

// ---- The assets ----
const ph = posts.productHunt;
const press = read("press-release.md");
const email = read("email.md");
const faq = read("faq.md");
const assets = [
  { id: "press", name: t("新闻稿", "Press release"), file: "press-release.md", text: press },
  { id: "email", name: t("邮件", "Email"), file: "email.md", text: email },
  { id: "ph", name: "Product Hunt", text: [ph.name, ph.tagline, ph.description, ph.firstComment].join("\n\n") },
  { id: "x", name: "X", text: posts.x },
  { id: "linkedin", name: "LinkedIn", text: posts.linkedin },
  { id: "faq", name: t("常见问题", "FAQ"), file: "faq.md", text: faq },
];
const present = assets.filter((a) => typeof a.text === "string");
const missingFiles = assets.filter((a) => a.text === null).map((a) => t(`没有 ${a.file}`, `${a.file} is missing`));

// ======================= Checks =======================

// Release line and dateline.
const release = [];
if (press !== null) {
  const first = press.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (releaseLine && first !== releaseLine) {
    release.push(t(`新闻稿第一行是「${first}」，媒体资料里是「${releaseLine}」`, `The press release starts with "${first}"; the fact sheet says "${releaseLine}"`));
  }
  if (dateline && !press.includes(dateline)) {
    release.push(t(`新闻稿里没有电头「${dateline}」：导语要从它开始`, `The press release has no dateline "${dateline}"; the lede starts with it`));
  }
}

// Dates and weekdays that differ from the launch date.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const EN_DATE = /\b(Jan(?:uary|\.)?|Feb(?:ruary|\.)?|March|Mar\.|April|Apr\.|May|June|July|Aug(?:ust|\.)?|Sept?(?:ember|\.)?|Oct(?:ober|\.)?|Nov(?:ember|\.)?|Dec(?:ember|\.)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/g;
const ZH_DATE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const WEEK_ZH = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const WEEK_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEK_SHOW_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const dates = [];
if (launch) {
  for (const a of present) {
    const found = [];
    for (const m of a.text.matchAll(ZH_DATE)) found.push({ y: m[1] ? Number(m[1]) : null, m: Number(m[2]), d: Number(m[3]) });
    for (const m of a.text.matchAll(EN_DATE)) found.push({ y: m[3] ? Number(m[3]) : null, m: MONTHS[m[1].slice(0, 3).toLowerCase()], d: Number(m[2]) });
    for (const m of a.text.matchAll(ISO_DATE)) found.push({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
    const wrong = found.filter((f) => f.m !== launch.m || f.d !== launch.d || (f.y !== null && f.y !== launch.y));
    for (const f of [...new Map(wrong.map((f) => [showDate(f.y, f.m, f.d), f])).keys()]) {
      dates.push(
        t(
          `${zhName(a.name)}写了 ${f}，发布日期是 ${showDate(launch.y, launch.m, launch.d)}：核对一下`,
          `${a.name} says ${f}; the launch date is ${showDate(launch.y, launch.m, launch.d)}. Check it`,
        ),
      );
    }
    if (a.id === "faq") continue; // support hours and the like name weekdays too
    const days = new Set();
    for (const m of a.text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])(?![次遍回趟])/g)) days.add(WEEK_ZH[m[1]]);
    for (const m of a.text.toLowerCase().matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) days.add(WEEK_EN.indexOf(m[1]));
    for (const day of days) {
      if (day === launchDow) continue;
      dates.push(
        t(
          `${zhName(a.name)}写了${WEEK_SHOW_ZH[day]}，发布日是${WEEK_SHOW_ZH[launchDow]}`,
          `${a.name} names a ${WEEK_EN[day][0].toUpperCase()}${WEEK_EN[day].slice(1)}; launch day is a ${WEEK_EN[launchDow][0].toUpperCase()}${WEEK_EN[launchDow].slice(1)}`,
        ),
      );
    }
  }
}

// The press release's structure and length.
const pressNotes = [];
let spokesQuoted = false;
if (press !== null) {
  const p = rules.press;
  const headline = press.split("\n").find((l) => /^#\s+/.test(l))?.replace(/^#\s+/, "").trim() ?? "";
  if (!headline) pressNotes.push(t("没有 `# 标题`", "No `# Headline`"));
  else if (codePoints(headline) > p.headlineMax) {
    pressNotes.push(t(`标题 ${codePoints(headline)} 个字符，超过 ${p.headlineMax}`, `The headline is ${codePoints(headline)} characters, over ${p.headlineMax}`));
  }
  const body = press.split("\n").slice(1).join("\n");
  const n = lengthOf(body);
  const [min, max] = en ? [p.minWords, p.maxWords] : [p.minChars, p.maxChars];
  if (n < min || n > max) {
    pressNotes.push(t(`正文约 ${n} 个字，建议 ${min} 到 ${max} 个字`, `About ${n} words; aim for ${min} to ${max}`));
  }
  const parts = press.split(/^(?=##\s)/m);
  const about = parts.find((part) => /^##\s*(关于|About)/i.test(part));
  const boilerplate = String(messaging.boilerplate ?? "").trim();
  if (!about) pressNotes.push(t("没有「## 关于…」一节", 'No "## About …" section'));
  else if (boilerplate && squash(about.slice(about.indexOf("\n") + 1)) !== squash(boilerplate)) {
    pressNotes.push(t("「关于」一节和 messaging.json 的 boilerplate 不一样：照抄原文", 'The "About" section differs from the boilerplate in messaging.json; copy it word for word'));
  }
  const bn = lengthOf(boilerplate);
  const bmax = en ? p.boilerplateMaxWords : p.boilerplateMaxChars;
  if (bn > bmax) pressNotes.push(t(`关于公司的一段约 ${bn} 个字，超过 ${bmax}`, `The boilerplate is about ${bn} words, over ${bmax}`));
  const contact = parts.find((part) => /^##\s*(媒体联系人|Media contact)/i.test(part));
  if (!contact) pressNotes.push(t("没有「## 媒体联系人」一节", 'No "## Media contact" section'));
  else if (!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\+?\d[\d\s()-]{6,}\d/.test(contact)) {
    pressNotes.push(t("媒体联系人里没有邮箱或电话", "The media contact has no email or phone number"));
  }
  if (spokesNames.length) {
    const paras = paragraphs(press).filter((para) => spokesNames.some((name) => para.includes(name)));
    const quoted = paras.filter((para) => quotesIn(para, 6).length);
    spokesQuoted = quoted.length > 0;
    if (!paras.length) pressNotes.push(t(`没有发言人${spokesNames[0]}的引语`, `No quote from the spokesperson, ${spokesNames.at(-1)}`));
    else if (quoted.length && spokesTitles.length && !quoted.some((para) => spokesTitles.some((title) => squash(para).includes(squash(title))))) {
      pressNotes.push(t(`引语后面没写${spokesNames[0]}的职位（资料：${spokesTitles[0]}）`, `The quote does not give ${spokesNames.at(-1)}'s title (the facts: ${spokesTitles.at(-1)})`));
    }
  }
}

// The email: subject, preview text, one call to action, and the footer.
const emailNotes = [];
if (email !== null) {
  const lines = email.split("\n").map((l) => l.trim());
  const value = (pattern) => {
    const line = lines.find((l) => pattern.test(l));
    return line === undefined ? null : line.replace(pattern, "").trim();
  };
  const subject = value(/^(主题|Subject)\s*[:：]/i);
  const preview = value(/^(预览文字|Preview text)\s*[:：]/i);
  if (subject === null) emailNotes.push(t("没有「主题：」一行", 'No "Subject:" line'));
  else {
    if (codePoints(subject) > rules.email.subjectMax) {
      emailNotes.push(t(`主题 ${codePoints(subject)} 个字符，超过 ${rules.email.subjectMax}`, `The subject is ${codePoints(subject)} characters, over ${rules.email.subjectMax}`));
    }
    if (/^(re|fw|fwd)\s*[:：]|^(回复|转发)\s*[:：]/i.test(subject)) {
      emailNotes.push(t("主题装成回信或转发：CAN-SPAM 不允许误导人的主题", "The subject poses as a reply or forward; CAN-SPAM bans misleading subject lines"));
    }
  }
  if (preview === null) emailNotes.push(t("没有「预览文字：」一行", 'No "Preview text:" line'));
  else if (codePoints(preview) > rules.email.previewMax) {
    emailNotes.push(t(`预览文字 ${codePoints(preview)} 个字符，超过 ${rules.email.previewMax}`, `The preview text is ${codePoints(preview)} characters, over ${rules.email.previewMax}`));
  } else if (subject !== null && squash(preview) === squash(subject)) {
    emailNotes.push(t("预览文字和主题一样：用它补充主题没说的事", "The preview text repeats the subject; use it to add what the subject doesn't say"));
  }
  const buttons = lines.filter((l) => /^(按钮|Button)\s*[:：]/i.test(l)).length;
  if (!buttons) emailNotes.push(t("没有「按钮：」一行", 'No "Button:" line'));
  else if (buttons > 1) emailNotes.push(t(`有 ${buttons} 个按钮：一封信只请人做一件事`, `${buttons} buttons; one email asks for one thing`));
  const cut = lines.lastIndexOf("---");
  const footer = cut >= 0 ? lines.slice(cut + 1).join("\n") : "";
  if (!footer.trim()) emailNotes.push(t("没有页脚（最后一行 `---` 下面）", "No footer (below the last `---`)"));
  else {
    if (senderNames.length && !senderNames.some((name) => footer.includes(name))) {
      emailNotes.push(t(`页脚没写发件人「${senderNames[0]}」`, `The footer does not name the sender, "${senderNames.at(-1)}"`));
    }
    if (addresses.length && !addresses.some((a) => squash(footer).includes(squash(a)))) {
      emailNotes.push(t(`页脚没写地址「${addresses[0]}」`, `The footer does not give the postal address, "${addresses.at(-1)}"`));
    }
    if (!/退订|取消订阅|unsubscribe|opt out|opt-out/i.test(footer)) emailNotes.push(t("页脚没写怎么退订", "The footer does not say how to unsubscribe"));
  }
}

// Product Hunt, X and LinkedIn.
const listing = [];
{
  const p = rules.productHunt;
  if (codePoints(ph.tagline) > p.taglineMax) listing.push(t(`标语 ${codePoints(ph.tagline)} 个字符，超过 ${p.taglineMax}`, `The tagline is ${codePoints(ph.tagline)} characters, over ${p.taglineMax}`));
  if (codePoints(ph.description) > p.descriptionMax) {
    listing.push(t(`简介 ${codePoints(ph.description)} 个字符，超过 ${p.descriptionMax}`, `The description is ${codePoints(ph.description)} characters, over ${p.descriptionMax}`));
  }
  const chinese = ["name", "tagline", "description", "firstComment"].filter((key) => hasHan(ph[key]));
  if (chinese.length) listing.push(t(`Product Hunt 只收英文：${chinese.join(sep)} 里有汉字`, `Product Hunt takes English only: ${chinese.join(sep)} contains Chinese`));
  if (englishName && ph.name.trim() !== englishName) {
    listing.push(t(`名称是「${ph.name.trim()}」，资料里的英文名是「${englishName}」`, `The name is "${ph.name.trim()}"; the English name in the facts is "${englishName}"`));
  } else if (/\p{Extended_Pictographic}/u.test(ph.name)) listing.push(t("名称里有表情：只写产品名", "The name has an emoji; use the product name only"));
}
const socialLengths = [];
function xWeighted(text) {
  const cfg = rules.x;
  let urls = 0;
  const rest = String(text).replace(URL_RE, () => {
    urls += 1;
    return "";
  });
  let raw = urls * cfg.transformedURLLength * cfg.scale;
  for (const ch of rest) {
    const cp = ch.codePointAt(0);
    const range = cfg.ranges.find((r) => cp >= r.start && cp <= r.end);
    raw += range ? range.weight : cfg.defaultWeight;
  }
  return Math.round((raw / cfg.scale) * 10) / 10;
}
const xn = xWeighted(posts.x);
if (xn > rules.x.maxWeightedTweetLength) socialLengths.push(t(`X 加权 ${xn}，超过 ${rules.x.maxWeightedTweetLength}`, `X post: ${xn} on the weighted count, over ${rules.x.maxWeightedTweetLength}`));
if (codePoints(posts.linkedin) > rules.linkedin.textMax) {
  socialLengths.push(t(`LinkedIn ${codePoints(posts.linkedin)} 个字符，超过 ${rules.linkedin.textMax}`, `LinkedIn post: ${codePoints(posts.linkedin)} characters, over ${rules.linkedin.textMax}`));
}

const perAsset = (terms, phrases, keep = () => true, only = present) =>
  only
    .map((a) => [a, findTerms(a.text, [...(terms ?? []), ...(phrases ?? [])]).filter(keep)])
    .filter(([, hits]) => hits.length)
    .map(([a, hits]) => `${a.name}${t("：", ": ")}${hits.map((h) => t(`「${h}」`, `"${h}"`)).join(sep)}`);

const votes = perAsset(rules.votes, rules.votePhrases, () => true, present.filter((a) => a.id !== "faq"));

// The launch headline: every asset leads with it, so it has to fit an email
// subject and a Product Hunt tagline.
const headlineNotes = [];
{
  const headline = String(messaging.headline ?? "").trim();
  const max = Math.min(rules.email.subjectMax, rules.productHunt.taglineMax);
  if (!headline) headlineNotes.push(t("messaging.json 没有 `headline`", "messaging.json has no `headline`"));
  else if (codePoints(headline) > max) {
    headlineNotes.push(
      t(
        `「${headline}」${codePoints(headline)} 个字符，超过 ${max}：邮件主题和 Product Hunt 标语都放不下`,
        `"${headline}" is ${codePoints(headline)} characters, over ${max}: too long for an email subject or a Product Hunt tagline`,
      ),
    );
  }
}

// Every claim rests on a line of the facts. A bilingual line may come back as
// both halves, in either order ("en / zh"), so each half is looked up.
const inFacts = (line) => line.split(/\s+\/\s+/).every((half) => factsSquashed.includes(squash(half)));
const claims = [];
for (const claim of Array.isArray(messaging.claims) ? messaging.claims : []) {
  const source = String(claim?.source ?? "").trim();
  if (!source || !inFacts(source)) {
    claims.push(t(`「${String(claim?.claim ?? "").trim()}」的出处在资料里找不到：「${source}」`, `The source of "${String(claim?.claim ?? "").trim()}" is not in the facts: "${source}"`));
  }
}
for (const pillar of Array.isArray(messaging.pillars) ? messaging.pillars : []) {
  const proof = String(pillar?.proof ?? "").trim();
  if (proof && !inFacts(proof)) {
    claims.push(t(`信息支柱「${String(pillar?.title ?? "").trim()}」的证据在资料里找不到：「${proof}」`, `The proof for the pillar "${String(pillar?.title ?? "").trim()}" is not in the facts: "${proof}"`));
  }
}

// Numbers, URLs and email addresses that are not in the facts.
const numbersIn = (text) =>
  (String(text)
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .match(/\d+(?:\.\d+)?/g) ?? []).map((n) => (n.includes(".") ? String(Number(n)) : String(Number(n))));
const known = new Set(numbersIn(`${factsAllowed}\n${Object.values(flowInputs).join("\n")}\n${plan}`));
const EN_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
EN_NUMBERS.forEach((word, n) => {
  if (new RegExp(`\\b${word}\\b`, "i").test(factsAllowed)) known.add(String(n));
});
[..."零一二三四五六七八九十"].forEach((ch, n) => {
  if (factsAllowed.includes(ch)) known.add(String(n));
});
if (factsAllowed.includes("两")) known.add("2");
const hostOf = (u) => {
  try {
    return new URL(u.replace(/[.,;:!?。，；：！？]+$/, "")).host.toLowerCase();
  } catch {
    return u;
  }
};
const knownHosts = new Set([...factsAllowed.matchAll(URL_RE)].map((m) => hostOf(m[0])));
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const knownEmails = new Set([...factsAllowed.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()));
const unknown = [];
for (const a of present) {
  const text = a.text.replace(URL_RE, " ").replace(EMAIL_RE, " ");
  const numbers = [...new Set(numbersIn(text))].filter((n) => !known.has(n));
  const urls = [...new Set([...a.text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?。，；：！？]+$/, "")))].filter((u) => !knownHosts.has(hostOf(u)));
  const mails = [...new Set([...a.text.matchAll(EMAIL_RE)].map((m) => m[0]))].filter((m) => !knownEmails.has(m.toLowerCase()));
  if (numbers.length) unknown.push(t(`${zhName(a.name)}的数字 ${numbers.join(sep)}：资料里没有，核实后再发`, `${a.name}: ${numbers.join(sep)} not in the facts; verify before it goes out`));
  if (urls.length) unknown.push(t(`${zhName(a.name)}的网址 ${urls.join(sep)}：资料里没有，不要编网址`, `${a.name}: ${urls.join(sep)} is not in the facts; don't invent URLs`));
  if (mails.length) unknown.push(t(`${zhName(a.name)}的邮箱 ${mails.join(sep)}：资料里没有`, `${a.name}: ${mails.join(sep)} is not in the facts`));
}

// Customer quotes: word for word, with the tie disclosed.
const quotes = [];
for (const a of present) {
  const all = paragraphs(a.text);
  for (const c of customers) {
    const at = all.map((para, i) => (para.includes(c.name) ? i : -1)).filter((i) => i >= 0);
    if (!at.length) continue;
    // The tie may sit next door: an attribution line ("——Name, …") under its quote,
    // or the answer under an FAQ heading that names the customer.
    const near = at
      .flatMap((i) => [i, ...(/^(——|—|--)/.test(all[i]) ? [i - 1] : []), ...(/^#/.test(all[i]) ? [i + 1] : [])])
      .filter((i) => i >= 0 && i < all.length)
      .map((i) => all[i]);
    for (const para of at.map((i) => all[i])) {
      for (const q of quotesIn(para, 6)) {
        if (!factsSquashed.includes(squash(q))) {
          quotes.push(t(`${zhName(a.name)}里${c.name}的话和资料对不上，客户的话要一字不改：「${q}」`, `${a.name}: ${c.name}'s words differ from the facts; quote customers word for word: "${q}"`));
        }
      }
    }
    if (c.ties.length && !near.some((para) => c.ties.some((w) => para.toLowerCase().includes(w)))) {
      quotes.push(t(`${zhName(a.name)}引用了${c.name}，但没写明关系（资料：${c.detail}）`, `${a.name} quotes ${c.name} without saying how they are tied to you (the facts: ${c.detail})`));
    }
  }
}

// Wording.
// A term the facts rule out is listed once, under "Things the facts say not to say".
const bannedLower = new Set(banned.map((b) => b.toLowerCase()));
const notBanned = (term) => !bannedLower.has(term.toLowerCase());
const absolute = perAsset(rules.absolute, rules.absolutePhrases, notBanned);
const proofTerms = perAsset(rules.needsProof, rules.needsProofPhrases, (term) => notBanned(term) && !findTerms(factsAllowed, [term]).length);
const urgency = perAsset(rules.urgency, rules.urgencyPhrases, (term) => notBanned(term) && !findTerms(factsAllowed, [term]).length);
const said = perAsset(banned, []);

// Answers to confirm and placeholders.
const confirm = [];
for (const a of present) {
  const markers = rules.toConfirm ?? [];
  if (!markers.some((m) => a.text.includes(m))) continue;
  if (a.id === "faq") {
    const asks = a.text
      .split(/^(?=###\s)/m)
      .filter((part) => /^###\s/.test(part) && markers.some((m) => part.includes(m)))
      .map((part) => markers.reduce((heading, m) => heading.split(m).join(""), part.split("\n")[0].replace(/^###\s+/, "")).trim());
    for (const ask of asks) confirm.push(`${a.name}${t("：", ": ")}${ask}`);
  } else confirm.push(t(`${zhName(a.name)}里有待确认的内容`, `${a.name} has something marked to confirm`));
}
const placeholders = [];
for (const a of present) {
  const hits = [];
  for (const token of rules.placeholders ?? []) {
    if (/^[A-Z]+$/.test(token)) {
      if (new RegExp(`\\b${token}\\b`).test(a.text)) hits.push(token);
    } else if (a.text.includes(token)) hits.push(token);
  }
  for (const m of a.text.matchAll(/(?<![A-Za-z])(XX|YY)(?![A-Za-z])/g)) hits.push(m[1]);
  for (const token of ["（城市）", "(CITY)"]) if (a.text.includes(token)) hits.push(token);
  if (hits.length) placeholders.push(`${a.name}${t("：", ": ")}${[...new Set(hits)].join(sep)}`);
}

// The landing page: its own check, and whether its main heading matches the launch headline.
const landing = [];
{
  const report = read("landing-check.md");
  const summary = report?.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
  if (report === null) landing.push(t("没有 landing-check.md", "landing-check.md is missing"));
  else if (summary && !/^(没有问题|No problems)/.test(summary)) landing.push(t(`落地页检查：${summary}（见 landing-check.md）`, `Landing page check: ${summary} (see landing-check.md)`));
  const html = read("site/index.html");
  const h1 = html
    ?.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  const headline = String(messaging.headline ?? "").trim();
  if (html === null) landing.push(t("没有 site/index.html", "site/index.html is missing"));
  else if (h1 !== undefined && headline && !squash(h1).includes(squash(headline)) && !squash(headline).includes(squash(h1))) {
    landing.push(
      t(
        `页面主标题「${h1}」和发布标题「${headline}」不一样：从邮件和帖子点进来的人可能对不上`,
        `The page's main heading "${h1}" differs from the launch headline "${headline}"; people who click through from the email and posts may not recognize it`,
      ),
    );
  }
}

// ======================= Report =======================
const checks = [
  { title: t("缺的文件", "Missing files"), basis: "", items: missingFiles },
  { title: t("新闻稿第一行和电头", "Release line and dateline"), basis: "PR Newswire", items: release },
  { title: t("日期和星期", "Dates and weekdays"), basis: "", items: dates },
  { title: t("新闻稿的结构和长度", "Press release structure and length"), basis: t("PR Newswire；Business Wire", "PR Newswire; Business Wire"), items: pressNotes },
  { title: t("邮件", "Email"), basis: t("Mailchimp；CAN-SPAM；《广告法》第四十三条；英国 PECR", "Mailchimp; CAN-SPAM; Advertising Law art. 43 (China); UK PECR"), items: emailNotes },
  { title: "Product Hunt", basis: "Product Hunt", items: listing },
  { title: t("X 和 LinkedIn 的长度", "X and LinkedIn length"), basis: t("X；LinkedIn", "X; LinkedIn"), items: socialLengths },
  { title: t("请人点赞或投票", "Asking for votes"), basis: "Product Hunt", items: votes },
  { title: t("发布标题", "Launch headline"), basis: t("Mailchimp；Product Hunt", "Mailchimp; Product Hunt"), items: headlineNotes },
  { title: t("说法的出处", "Sources of claims"), basis: "", items: claims },
  { title: t("资料里没有的数字、网址和邮箱", "Numbers, URLs and emails not in the facts"), basis: t("FTC 广告证据政策", "FTC substantiation policy"), items: unknown },
  { title: t("客户原话", "Customer quotes"), basis: t("FTC 背书指南；16 CFR 465", "FTC Endorsement Guides; 16 CFR 465"), items: quotes },
  { title: t("绝对化用语", "Absolute claims"), basis: t("《广告法》第九条", "Advertising Law art. 9 (China)"), items: absolute },
  { title: t("要有证据的说法", "Claims that need proof"), basis: t("FTC 广告证据政策；《广告法》第九条", "FTC substantiation policy; Advertising Law art. 9 (China)"), items: proofTerms },
  { title: t("紧迫感用语", "Urgency wording"), basis: t("UCPD 附件一第 7 项；FTC 暗黑模式报告", "UCPD annex I point 7; FTC dark patterns report"), items: urgency },
  { title: t("资料里说不要写的话", "Things the facts say not to say"), basis: "", items: said },
  { title: t("待确认的回答", "Answers to confirm"), basis: "", items: confirm },
  { title: t("占位符", "Placeholders"), basis: "", items: placeholders },
  { title: t("落地页", "Landing page"), basis: t("落地页检查；Unbounce 的 message match", "Landing page check; Unbounce on message match"), items: landing },
];
const total = checks.reduce((n, c) => n + c.items.length, 0);
const summary = total
  ? t(`有 ${total} 处要看一下。`, `${total} ${total === 1 ? "thing" : "things"} to look at.`)
  : t("没有发现问题。", "No problems found.");

const before = [
  t(
    "邮件只发给同意接收的人；在邮件平台里打开一键退订（List-Unsubscribe）。每天给 Gmail 发 5000 封以上时这是要求，退订要在 48 小时内处理。",
    "Send the email only to people who agreed to it, and turn on one-click unsubscribe (List-Unsubscribe) in your email platform. Gmail requires it of senders of 5,000 or more messages a day, with unsubscribes honored within 48 hours.",
  ),
  ...(spokesQuoted
    ? [t(`新闻稿里${spokesNames[0]}的引语是起草的：发之前请本人确认。`, `${spokesNames.at(-1)}'s quote in the press release is a draft; have them approve it before it goes out.`)]
    : []),
  t("每一条事实说法在发布前都要有证据（FTC 广告证据政策）。", "Every factual claim needs its proof in hand before launch (FTC substantiation policy)."),
  ...(tier === 3
    ? []
    : [
        t(
          "Product Hunt：已经排期；缩略图 240×240（3 MB 以内），图集至少 2 张 1270×760；第一条评论准备好，上线马上发。",
          "Product Hunt: the launch is scheduled; the thumbnail is 240 × 240 (under 3 MB) and the gallery has at least two 1270 × 760 images; the first comment is ready to post the moment it goes live.",
        ),
      ]),
  ...(flowInputs.embargo === true || flowInputs.embargo === "true"
    ? [t("禁发：给记者的邮件正文里也写明禁发到什么时候、哪个时区。", "Embargo: the email to reporters also says when the embargo lifts, with the time zone.")]
    : []),
];

function details() {
  const found = checks.filter((c) => c.items.length);
  if (!found.length) return [t("没有。", "None."), ""];
  return found.flatMap((c) => [`### ${c.title}${c.basis ? t(`（${c.basis}）`, ` (${c.basis})`) : ""}`, "", ...c.items.map((item) => `- ${item}`), ""]);
}

const lines = [
  t("# 发布物料检查", "# Launch check"),
  "",
  summary,
  "",
  t(
    "规则来自 rules.md，依据见 README 的「依据 / Sources」。这里只提醒，不会让这一步失败。",
    'Rules come from rules.md; the sources are in the README under "依据 / Sources". These are warnings and do not fail the stage.',
  ),
  "",
  t("## 要看一下", "## To look at"),
  "",
  ...details(),
  t("## 发布前确认", "## Confirm before launch"),
  "",
  t("脚本看不到的事，发布前逐项确认：", "Things this script cannot see; confirm each before launch:"),
  "",
  ...before.map((item) => `- [ ] ${item}`),
  "",
  t("## 检查了什么", "## What was checked"),
  "",
  t("| 检查 | 依据 | 结果 |", "| Check | Basis | Result |"),
  "| --- | --- | --- |",
  ...checks.map((c) => `| ${c.title} | ${c.basis || "-"} | ${c.items.length ? t(`${c.items.length} 处`, `${c.items.length}`) : t("通过", "passed")} |`),
  "",
  t(
    "这些检查只做提醒，不能代替法律意见。规则会变，发布前以官方原文为准。",
    "These checks are reminders and do not replace legal advice. Rules change: check the official texts before launch.",
  ),
  "",
];

writeReport(lines);
console.log(summary);
