// "check" stage. Warns only; the report says what to fix and why.
//
// What it checks and where the rules come from (see README "参考资料 / References"):
// - Pace: two or three main sights a day with time to rest beat a box-ticking rush. The 60 free minutes a day
//   is this flow's own default, not from a standard.
// - Timing: each stop starts no earlier than the last one's start + time there + transfer.
// - A rainy-day or sold-out backup for every day.
// - Facts that change (hours, closing days, prices, booking rules) go on a "check before you go" list,
//   to be confirmed through official channels.
// - The budget per person.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);
const paceLimit = { relaxed: 2, normal: 3, packed: 4 }[flowInputs.pace] ?? 3;
const cap = Number(flowInputs.budget) > 0 ? Number(flowInputs.budget) : 0;
const wantDays = Number(flowInputs.days) > 0 ? Number(flowInputs.days) : 0;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
const json = (file) => JSON.parse(read(file) || "{}");
const places = Array.isArray(json("places.json").places) ? json("places.json").places : [];
const itinerary = json("itinerary.json");
const days = Array.isArray(itinerary.days) ? itinerary.days : [];
const guide = read("guide.md");
const byId = new Map(places.map((p) => [String(p.id), p]));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nameOf = (id) => byId.get(String(id))?.name ?? String(id);
const minutesOf = (hhmm) => {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const clock = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const dayLabel = (d) => t(`第 ${d.day} 天`, `Day ${d.day}`);

const paceNotes = [];
const timing = [];
const unknown = [];
const noBackup = [];
const lowFree = [];
const summary = [];
for (const d of days) {
  const items = Array.isArray(d.items) ? d.items : [];
  const sights = items.filter((i) => byId.get(String(i.place))?.type === "sight");
  if (sights.length > paceLimit) paceNotes.push(t(`${dayLabel(d)}有 ${sights.length} 个主要景点，超过这个节奏的 ${paceLimit} 个。`, `${dayLabel(d)} has ${sights.length} main sights, more than this pace's ${paceLimit}.`));
  if (num(d.free) < 60) lowFree.push(t(`${dayLabel(d)}只留了 ${num(d.free)} 分钟空闲。`, `${dayLabel(d)} leaves only ${num(d.free)} free minutes.`));
  if (!String(d.backup ?? "").trim()) noBackup.push(dayLabel(d));
  for (const i of items) if (!byId.has(String(i.place))) unknown.push(`${dayLabel(d)}${t("：", ": ")}${i.place}`);
  for (let k = 0; k + 1 < items.length; k++) {
    const start = minutesOf(items[k].time);
    const next = minutesOf(items[k + 1].time);
    if (Number.isNaN(start) || Number.isNaN(next)) continue;
    const ready = start + num(items[k].minutes) + num(items[k].transport?.minutes);
    if (next < ready) timing.push(t(`${dayLabel(d)}：${nameOf(items[k].place)} ${items[k].time} 开始，玩 ${num(items[k].minutes)} 分钟、路上 ${num(items[k].transport?.minutes)} 分钟，最早 ${clock(ready)} 才能到${nameOf(items[k + 1].place)}，但写的是 ${items[k + 1].time}。`, `${dayLabel(d)}: ${nameOf(items[k].place)} starts ${items[k].time}, ${num(items[k].minutes)} min there and ${num(items[k].transport?.minutes)} min on the way, so ${nameOf(items[k + 1].place)} can't start before ${clock(ready)}, not ${items[k + 1].time}.`));
    const areaA = byId.get(String(items[k].place))?.area;
    const areaB = byId.get(String(items[k + 1].place))?.area;
    if (areaA && areaB && areaA !== areaB && !num(items[k].transport?.minutes)) timing.push(t(`${dayLabel(d)}：从${nameOf(items[k].place)}到${nameOf(items[k + 1].place)}跨了区域，却没写交通时间。`, `${dayLabel(d)}: ${nameOf(items[k].place)} to ${nameOf(items[k + 1].place)} changes area with no transfer time.`));
  }
  const first = minutesOf(items[0]?.time);
  const last = items.at(-1);
  const end = Number.isNaN(minutesOf(last?.time)) ? NaN : minutesOf(last.time) + num(last.minutes);
  summary.push(t(`${dayLabel(d)}（${d.area ?? ""}）：${items.length} 站，主要景点 ${sights.length} 个${Number.isNaN(first) || Number.isNaN(end) ? "" : `，${clock(first)}–${clock(end)}`}，空闲 ${num(d.free)} 分钟。`, `${dayLabel(d)} (${d.area ?? ""}): ${items.length} stops, ${sights.length} main sights${Number.isNaN(first) || Number.isNaN(end) ? "" : `, ${clock(first)}–${clock(end)}`}, ${num(d.free)} free minutes.`));
}

const budgetLines = Array.isArray(itinerary.budget) ? itinerary.budget : [];
const perPerson = budgetLines.reduce((sum, b) => sum + num(b.perPerson), 0);
const budgetNote = cap ? (perPerson > cap ? t(`⚠️ 每人预算合计 ${perPerson}，超过 ${cap}。`, `⚠️ The budget comes to ${perPerson} per person, over ${cap}.`) : t(`每人预算合计 ${perPerson}，在 ${cap} 以内。`, `The budget comes to ${perPerson} per person, within ${cap}.`)) : t(`每人预算合计 ${perPerson}。`, `The budget comes to ${perPerson} per person.`);

// The checklist in the guide: every place that needs booking, and every place with things to verify, by name.
const checklist = guide.split(/^(?=##\s)/m).find((part) => /^##\s*(出发前核实|核实|check before you go)/im.test(part)) ?? "";
const used = new Set(days.flatMap((d) => (Array.isArray(d.items) ? d.items.map((i) => String(i.place)) : [])));
const mustCheck = places.filter((p) => used.has(String(p.id)) && (p.booking === true || (Array.isArray(p.verify) && p.verify.length)));
// Names are matched loosely: "Kinkaku-ji (Golden Pavilion)" is listed as "Kinkaku-ji", "鲤城区西街附近住宿" as "西街附近住宿".
const variants = (name) => {
  const out = new Set([name]);
  let v = name.replace(/[（(][^)）]*[)）]/g, "").trim();
  out.add(v);
  v = v.replace(/\s+(?:and|&)\s+.*$/i, "").trim();
  out.add(v);
  for (let i = 0; i < 3; i++) v = v.replace(/\s+(?:temple|shrine|garden|gardens|castle|museum|park|market|district|alley|street|tower)$/i, "").trim();
  out.add(v);
  out.add(v.replace(/^[\u4e00-\u9fff]{1,3}[区县市]/, ""));
  return [...out].filter((x) => x.length >= 2);
};
const listedIn = (text, name) => variants(String(name)).some((v) => text.toLowerCase().includes(v.toLowerCase()));
const notListed = mustCheck.filter((p) => !listedIn(checklist, p.name)).map((p) => `${p.name}${p.booking ? t("（要预约）", " (booking)") : ""}`);
const statedHours = guide.replace(checklist, "").match(/\d{1,2}[:：]\d{2}\s*[-–~至到]\s*\d{1,2}[:：]\d{2}\s*(?:开放|营业|open)/gi) ?? [];

const none = t("没有。", "None.");
const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t(`## 节奏太赶（这个节奏每天最多 ${paceLimit} 个主要景点）`, `## Too much in a day (this pace allows ${paceLimit} main sights)`), paceNotes],
  [t("## 空闲时间不到 60 分钟", "## Less than 60 free minutes"), lowFree],
  [t("## 时间和交通接不上", "## Times and transfers that don't fit"), timing],
  [t("## 没有雨天或满约备选的日子", "## Days with no rainy-day or sold-out backup"), noBackup],
  [t("## 行程里有、备选地点里没有的地方", "## Stops that are not in the candidate places"), unknown],
  [t("## 没进“出发前核实”清单的地点", "## Places missing from the check-before-you-go list"), notListed],
  [t("## 正文里写死的开放时间（应该放进核实清单）", "## Opening hours stated as fact (belong on the checklist)"), statedHours],
];
const report = [
  t("# 旅行攻略检查", "# Travel guide check"),
  "",
  t(`${days.length} 天行程${wantDays && days.length !== wantDays ? `（要的是 ${wantDays} 天）` : ""}，备选地点 ${places.length} 个。`, `${days.length} days planned${wantDays && days.length !== wantDays ? ` (${wantDays} wanted)` : ""}, ${places.length} candidate places.`),
  budgetNote,
  "",
  t("## 每天", "## Each day"),
  list(summary),
  "",
  ...sections.flatMap(([heading, xs]) => [heading, list(xs), ""]),
  t("开放时间、门票和预约规则以景区和场馆的官方渠道为准，出发前一两天再确认一次。", "Hours, prices and booking rules follow the official channels of each site; confirm again a day or two before you go."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${report.join("\n")}\n`);
console.log(report.join("\n"));
const issues = sections.reduce((n, [, xs]) => n + xs.length, 0) + (cap && perPerson > cap ? 1 : 0) + (wantDays && days.length !== wantDays ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} things to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
