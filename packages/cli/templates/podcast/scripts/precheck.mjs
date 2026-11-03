// "precheck" stage: before recording. Warns only; the report says what to fix and why.
//
// Rules and where they come from (README "依据 / Sources"):
// - Segment minutes add up to the target, with an intro, a close, and an ad only when there is a sponsor.
// - Open questions, one thing at a time: NPR Training ("Casting, coaching and cutting").
// - No show name, episode number or date in a title, 150 characters at most: Apple Podcasts for Creators.
// - The ad says it is an ad in its first sentence: FTC Endorsement Guides 16 CFR 255 (audible disclosure),
//   Advertising Law art. 14 and Internet Advertising Measures art. 9 (labelled "广告").
// - No absolute claims in the ad: Advertising Law art. 9(3).
// - Every number comes from the notes: SPJ Code of Ethics (verify before release).
// - The guest brief asks for consent to record and publish: Civil Code arts. 1019 and 1023; RCFP recording guide.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const target = Number(flowInputs.minutes) > 0 ? Number(flowInputs.minutes) : 30;
const show = String(flowInputs.show ?? "").trim();
const sponsor = String(flowInputs.sponsor ?? "").trim();
const interview = (flowInputs.format ?? "interview") !== "solo";

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const notes = read("materials/notes.md");
const script = read("script.md");
const prep = read("prep.md");

let plan;
try {
  plan = JSON.parse(read("plan.json") || "null");
} catch (err) {
  console.error(`plan.json 不是合法的 JSON / plan.json is not valid JSON: ${err.message}`);
  process.exit(1);
}
if (!plan || !Array.isArray(plan.segments) || !Array.isArray(plan.titles) || !Array.isArray(plan.questions)) {
  console.error("plan.json 缺少 segments、titles 或 questions / plan.json lacks segments, titles or questions");
  process.exit(1);
}

const segments = plan.segments;
const total = Math.round(segments.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0) * 100) / 100;
const totalOk = Math.abs(total - target) < 0.05;
const fmt = (n) => String(Math.round(n * 100) / 100);

const kinds = new Set(segments.map((s) => s.kind));
const missingSegments = [];
if (!kinds.has("intro")) missingSegments.push(t("没有介绍段（intro）", "No intro segment"));
if (!kinds.has("outro")) missingSegments.push(t("没有结尾段（outro）", "No closing segment (outro)"));
if (sponsor && !kinds.has("ad")) missingSegments.push(t(`有赞助（${sponsor}），但没有广告段（ad）`, `There is a sponsor (${sponsor}) but no ad segment`));
if (!sponsor && kinds.has("ad")) missingSegments.push(t("没有填赞助，却有广告段（ad）", "No sponsor is set, but there is an ad segment"));
// Each talk segment becomes a chapter, and Apple suggests at least three chapters and no more than six an hour:
// 3 to L talk segments, L being the target minutes / 10 without the decimals, plus 1 (30 minutes: 4).
const talkCount = segments.filter((s) => s.kind === "talk").length;
const maxTalk = Math.max(3, Math.floor(target / 10) + 1);
if (talkCount < 3) missingSegments.push(t(`访谈段（talk）只有 ${talkCount} 个，至少要 3 个：一个访谈段就是一个章节，Apple 建议至少 3 个章节`, `Only ${talkCount} talk ${talkCount === 1 ? "segment" : "segments"}; each becomes a chapter, and Apple suggests at least 3 chapters`));
if (talkCount > maxTalk) missingSegments.push(t(`访谈段（talk）有 ${talkCount} 个，目标 ${fmt(target)} 分钟最多 ${maxTalk} 个：一个访谈段就是一个章节，Apple 建议每小时不超过 6 个章节`, `${talkCount} talk segments; a ${fmt(target)}-minute target allows at most ${maxTalk}, since each becomes a chapter and Apple suggests no more than six chapters an hour`));

// Yes/no questions: an English auxiliary first, or a Chinese 吗 / A-not-A question.
const closedEn = /^\s*(?:is|are|was|were|do|does|did|can|could|would|will|should|have|has|had|isn't|aren't|wasn't|didn't|don't|doesn't|won't|wouldn't|can't|couldn't)\b/i;
const closedZh = /吗\s*[？?]?\s*$|是不是|有没有|对不对|能不能|会不会|要不要|是否|可不可以|好不好/;
const questionText = (q) => String(q?.question ?? "").trim();
// "你怎么判断他是不是真会员" asks how, so an open question word outranks the 是不是 inside it.
const openZh = /怎么|怎样|如何|为什么|为何|什么|哪|多少|几|谁|讲讲|说说|聊聊/;
const closed = plan.questions
  .filter((q) => closedEn.test(questionText(q)) || (closedZh.test(questionText(q)) && !openZh.test(questionText(q))))
  .map(questionText);
const double = plan.questions.filter((q) => (questionText(q).match(/[？?]/g) ?? []).length > 1).map(questionText);
const talkSegments = segments.filter((s) => s.kind === "talk");
const unasked = interview ? talkSegments.filter((s) => !plan.questions.some((q) => String(q.segment ?? "").trim() === String(s.name ?? "").trim())).map((s) => s.name) : [];

const episodeNumber = /第\s*[0-9一二三四五六七八九十百]+\s*[期集]|\b(?:ep|episode)\.?\s*\d+|#\s*\d+|\bS\d+\s*E\d+\b/i;
const dateLike = /\d{4}\s*[-/.年]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/;
const titleIssues = [];
for (const title of plan.titles.map((x) => String(x))) {
  const why = [];
  if (show && title.toLowerCase().includes(show.toLowerCase())) why.push(t("有节目名", "show name"));
  if (episodeNumber.test(title)) why.push(t("有期数", "episode number"));
  if (dateLike.test(title)) why.push(t("有日期", "date"));
  if ([...title].length > 150) why.push(t(`${[...title].length} 个字符，超过 150`, `${[...title].length} characters, over 150`));
  if (why.length) titleIssues.push(en ? `${title} (${why.join(", ")})` : `${title}（${why.join("、")}）`);
}

// Split the script into "## " sections.
const sections = [];
let current = null;
for (const line of script.split("\n")) {
  if (/^##\s+/.test(line)) {
    current = { heading: line.replace(/^##\s+/, "").trim(), body: [] };
    sections.push(current);
  } else if (current) current.body.push(line);
}
const adSegment = segments.find((s) => s.kind === "ad");
const adWords = /广告|赞助|\bads?\b|\bsponsor/i;
const adSection = sections.find((s) => (adSegment?.name && s.heading.includes(String(adSegment.name))) || adWords.test(s.heading));
const adIssues = [];
let adText = "";
if (sponsor) {
  if (!adSection) adIssues.push(t("台本里找不到广告段。", "The script has no ad section."));
  else {
    adText = adSection.body.join("\n");
    // The first spoken sentence: skip stage directions in brackets and a "Host:" label.
    const firstLine = adSection.body
      .map((line) => line.replace(/^[\s>*_-]+/, "").replace(/[（(][^）)]*[）)]/g, "").replace(/^[^：:\s]{1,20}[：:]\s*/, "").trim())
      .find(Boolean) ?? "";
    // A Chinese full stop ends a sentence anywhere; a period only before a space, so example.com stays whole.
    const first = (firstLine.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/)?.[0] ?? firstLine).trim();
    const disclosed = en ? /\b(?:ad|advert|advertisement|sponsor|sponsored|paid)\b/i.test(first) || /广告/.test(first) : /广告/.test(first);
    if (!disclosed) adIssues.push(t(`第一句没有说明是广告：「${first}」`, `The first sentence doesn't say it is an ad: "${first}"`));
  }
}

const absolute = [
  "国家级", "世界级", "最高级", "最佳", "最好", "最强", "最低价", "全网最低", "最便宜", "全网最", "史上最", "顶级", "极品", "独一无二", "万能", "绝对", "保证", "100%", "百分百", "No.1", "NO.1",
];
// "第一" claims a rank ("销量第一"), but "第一，……第二，……" and "第一个月" only count.
const firstRank = /第一(?![，,、：:；;\s]|[个次天周月年期步批章页句段集季回轮件条点])/;
const absoluteEn = [/\bbest\b/i, /\bnumber one\b/i, /#1\b/, /\bno\.\s*1\b/i, /\bworld'?s best\b/i, /\btop-rated\b/i, /\bguarantee[sd]?\b/i, /\bunbeatable\b/i];
const absoluteHits = sponsor && adText
  ? [...absolute.filter((word) => adText.includes(word)), ...(firstRank.test(adText) ? ["第一"] : []), ...absoluteEn.filter((re) => re.test(adText)).map((re) => adText.match(re)[0])]
  : [];

// Numbers in the script that the notes don't have. Times, headings and lengths are the script's own.
const normalize = (text) => text.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
const numbersIn = (text) =>
  normalize(text)
    .replace(/^#{1,6}\s.*$/gm, "")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .replace(/\d+(?:\.\d+)?\s*(?:分钟|min\b|mins\b|minutes?\b)/gi, "")
    .match(/\d+(?:\.\d+)?/g) ?? [];
const known = new Set(numbersIn(`${notes}\n${Object.values(flowInputs).join("\n")}`));
const unknownNumbers = [...new Set(numbersIn(script))].filter((n) => !known.has(n));

const consentMissing = interview && prep && !/同意|\bconsent|\bagree/i.test(prep);
const placeholder = /\[\.\.\.\]|\[…\]|\bTODO\b|\bTBD\b|待补充|待填|\bXX\b/i;
const placeholders = [["script.md", script], ["prep.md", prep]].filter(([, text]) => placeholder.test(text)).map(([name]) => name);
const missingFiles = [["script.md", script], ["prep.md", prep]].filter(([, text]) => !text.trim()).map(([name]) => name);

const none = t("没有。", "None.");
const list = (items) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const report = [
  [t("## 缺少或多出的段落", "## Missing or extra segments"), missingSegments],
  [t("## 没有问题的访谈段", "## Interview segments with no questions"), unasked],
  [t("## 是非题（一句“是”或“不是”就能答完，NPR Training 建议问开放式问题）", "## Yes/no questions (a yes or a no can end them; NPR Training recommends open questions)"), closed],
  [t("## 一次问了不止一件事", "## More than one question at once"), double],
  [t("## 标题里的节目名、期数、日期或超长（Apple Podcasts）", "## Show name, episode number, date or length in a title (Apple Podcasts)"), titleIssues],
  [t("## 广告没有先说明（FTC 背书指南；《广告法》第十四条；《互联网广告管理办法》第九条）", "## Ad not disclosed first (FTC Endorsement Guides; China's Advertising Law art. 14)"), adIssues],
  [t("## 广告里的绝对化用语（《广告法》第九条）", "## Absolute claims in the ad (China's Advertising Law art. 9)"), absoluteHits],
  [t("## 资料里找不到的数字（核实后再录）", "## Numbers not in the notes (verify before recording)"), unknownNumbers],
  [t("## 给嘉宾的说明没有请对方同意录音和发布", "## The guest brief doesn't ask for consent to record and publish"), consentMissing ? ["prep.md"] : []],
  [t("## 占位符", "## Placeholders"), placeholders],
  [t("## 空文件", "## Empty files"), missingFiles],
];
const lines = [
  t("# 录前检查", "# Pre-record check"),
  "",
  t(
    `分段 ${segments.length} 段，共 ${fmt(total)} 分钟（目标 ${fmt(target)} 分钟）${totalOk ? "，对得上" : `，对不上，差 ${fmt(Math.abs(total - target))} 分钟`}。`,
    `${segments.length} segments, ${fmt(total)} minutes in all (target ${fmt(target)})${totalOk ? ", matches" : `, off by ${fmt(Math.abs(total - target))}`}.`,
  ),
  t(`问题 ${plan.questions.length} 个，事实 ${Array.isArray(plan.facts) ? plan.facts.length : 0} 条。`, `${plan.questions.length} ${plan.questions.length === 1 ? "question" : "questions"}, ${Array.isArray(plan.facts) ? plan.facts.length : 0} facts.`),
  "",
  ...report.flatMap(([title, items]) => [title, list(items), ""]),
  t("这些检查只做提醒，不能代替法律意见和平台审核。", "These checks are reminders only; they do not replace legal advice or platform review."),
  "",
];

const out = outputs[0]?.path ?? "precheck-report.md";
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
const issues = (totalOk ? 0 : 1) + report.reduce((n, [, items]) => n + items.length, 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
