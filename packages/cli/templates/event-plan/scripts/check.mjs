// "check" stage. Warns only; the report says what to fix and why.
//
// What it checks and where the rules come from (see README "参考资料 / References"):
// - SMART objectives: every target has a number.
// - Run of show: items run back to back (start + minutes = next start) and each has an owner.
// - Budget: qty × price = total, the sum stays within the budget, and a 10%–15% contingency.
// - Risk register: the core categories are covered, each risk has a response and an owner.
// - Large-scale public events (Regulations on the Safety Management of Large-scale Mass Activities, 2007,
//   arts. 2, 12 and 13): 1,000 or more people at an event open to the public needs a public-security permit
//   (county level up to 5,000, city level above), applied for 20 days ahead with a safety plan.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "");
const json = (file) => JSON.parse(read(file) || "{}");
const brief = json("brief.json");
const items = Array.isArray(json("runsheet.json").items) ? json("runsheet.json").items : [];
const budget = json("budget.json");
const risks = Array.isArray(json("risks.json").risks) ? json("risks.json").risks : [];
const proposal = read("proposal.md");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// Objectives.
const objectives = Array.isArray(brief.objectives) ? brief.objectives : [];
const vagueObjectives = objectives.filter((o) => !/\d/.test(`${o.target ?? ""}`)).map((o) => o.text ?? "");

// Run of show.
const minutesOf = (hhmm) => {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const clock = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const timing = [];
for (let i = 0; i < items.length; i++) {
  const start = minutesOf(items[i].start);
  if (Number.isNaN(start)) {
    timing.push(t(`「${items[i].item}」的开始时间不是 HH:MM。`, `"${items[i].item}" has no HH:MM start.`));
    continue;
  }
  const next = items[i + 1];
  if (!next) continue;
  const end = start + num(items[i].minutes);
  const nextStart = minutesOf(next.start);
  if (Number.isNaN(nextStart) || nextStart === end) continue;
  timing.push(
    nextStart > end
      ? t(`「${items[i].item}」${clock(end)} 结束，「${next.item}」${next.start} 才开始，中间空 ${nextStart - end} 分钟。`, `"${items[i].item}" ends at ${clock(end)} but "${next.item}" starts at ${next.start}: a ${nextStart - end}-minute gap.`)
      : t(`「${items[i].item}」${clock(end)} 才结束，和「${next.item}」${next.start} 重叠。`, `"${items[i].item}" runs until ${clock(end)}, overlapping "${next.item}" at ${next.start}.`),
  );
}
const noOwner = items.filter((i) => !String(i.owner ?? "").trim()).map((i) => i.item);
const first = minutesOf(items[0]?.start);
const lastItem = items.at(-1);
const span = items.length && !Number.isNaN(first) ? minutesOf(lastItem.start) + num(lastItem.minutes) - first : 0;

// Budget.
const lines_ = Array.isArray(budget.items) ? budget.items : [];
const arithmetic = lines_.filter((l) => Math.abs(num(l.qty) * num(l.price) - num(l.total)) > 0.5).map((l) => t(`${l.item}：${fmt(num(l.qty))} × ${fmt(num(l.price))} ≠ ${fmt(num(l.total))}`, `${l.item}: ${fmt(num(l.qty))} × ${fmt(num(l.price))} ≠ ${fmt(num(l.total))}`));
const subtotal = lines_.reduce((sum, l) => sum + num(l.total), 0);
const contingency = num(budget.contingency);
const total = subtotal + contingency;
const cap = num(flowInputs.budget);
const share = subtotal ? contingency / subtotal : 0;
const budgetNotes = [...arithmetic];
if (cap && total > cap) budgetNotes.push(t(`各项 ${fmt(subtotal)} + 预备金 ${fmt(contingency)} = ${fmt(total)}，超过总预算 ${fmt(cap)}。`, `Lines ${fmt(subtotal)} + contingency ${fmt(contingency)} = ${fmt(total)}, over the ${fmt(cap)} budget.`));
if (share < 0.1) budgetNotes.push(t(`预备金只占各项合计的 ${(share * 100).toFixed(1)}%，建议 10% 到 15%。`, `Contingency is only ${(share * 100).toFixed(1)}% of the lines; 10% to 15% is the usual advice.`));
const categories = ["venue|场地", "staff|人员|工作人员", "security|insurance|安保|保险"];
const missingCategories = categories.filter((c) => !lines_.some((l) => new RegExp(c, "i").test(`${l.category} ${l.item}`))).map((c) => c.split("|").at(-1));
if (missingCategories.length) budgetNotes.push(t(`预算里没看到：${missingCategories.join("、")}。`, `No budget line for: ${missingCategories.join(", ")}.`));

// Risks.
const required = ["crowd", "fire", "weather", "tech", "medical", "schedule"];
const riskName = { crowd: t("人流", "crowd"), fire: t("消防和安全", "fire and safety"), weather: t("天气", "weather"), tech: t("设备和供电", "equipment and power"), medical: t("医疗", "medical"), schedule: t("延误", "delays") };
const missingRisks = required.filter((c) => !risks.some((r) => r.category === c)).map((c) => riskName[c]);
const incomplete = risks.filter((r) => !String(r.response ?? "").trim() || !String(r.owner ?? "").trim() || !String(r.prevention ?? "").trim()).map((r) => r.risk);
const top = risks.filter((r) => num(r.likelihood) * num(r.impact) >= 15).map((r) => `${r.risk}（${num(r.likelihood)} × ${num(r.impact)}）`);

// Large public events.
const attendees = num(flowInputs.attendees);
const isPublic = flowInputs.audience === "public";
let permit;
let permitMissing = false;
if (isPublic && attendees >= 1000) {
  const level = attendees >= 5000 ? t("设区的市级公安机关", "the city-level public-security bureau") : t("县级公安机关", "the county-level public-security bureau");
  const mentioned = /安全许可|安全工作方案|公安|safety permit|public.security/i.test(proposal);
  permitMissing = !mentioned;
  permit = t(
    `⚠️ 面向社会公众、预计 ${attendees} 人，属于大型群众性活动：要在举办日 20 天前向${level}申请安全许可，并提交安全工作方案。${mentioned ? "方案里提到了。" : "方案里还没写。"}`,
    `⚠️ Open to the public with ${attendees} expected, this is a large-scale mass activity: apply to ${level} for a safety permit 20 days ahead, with a safety plan. ${mentioned ? "The proposal mentions it." : "The proposal does not mention it yet."}`,
  );
} else {
  permit = t("不到 1000 人或不面向社会公众，不属于需要公安许可的大型群众性活动（场地自己的规定照样要遵守）。", "Under 1,000 people or not open to the public, so no large-event permit is needed (the venue's own rules still apply).");
}

const parts = [/概要|summary/i, /目标|objectives/i, /流程|run of show/i, /分工|roles/i, /预算|budget/i, /风险|risks/i, /复盘|评估|review|measuring/i];
const headings = [...proposal.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
const missingParts = parts.filter((re) => !headings.some((h) => re.test(h))).map((re) => re.source.split("|")[0]);

const none = t("没有。", "None.");
const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : none);
const sections = [
  [t("## 量不出来的目标（target 里没有数字）", "## Objectives that can't be measured (no number in the target)"), vagueObjectives],
  [t("## 流程时间接不上", "## Run-of-show timing"), timing],
  [t("## 没有负责人的流程", "## Run-of-show items with no owner"), noOwner],
  [t("## 预算", "## Budget"), budgetNotes],
  [t("## 漏掉的风险类别", "## Missing risk categories"), missingRisks],
  [t("## 缺预防、应对或负责人的风险", "## Risks missing prevention, response or owner"), incomplete],
  [t("## 方案缺的部分", "## Missing proposal parts"), missingParts],
];
const report = [
  t("# 活动方案检查", "# Event plan check"),
  "",
  t(`流程 ${items.length} 项，共 ${span} 分钟；预算各项 ${fmt(subtotal)} + 预备金 ${fmt(contingency)} = ${fmt(total)}${cap ? `（总预算 ${fmt(cap)}）` : ""}；风险 ${risks.length} 条。`, `${items.length} run-of-show items, ${span} minutes; budget lines ${fmt(subtotal)} + contingency ${fmt(contingency)} = ${fmt(total)}${cap ? ` (budget ${fmt(cap)})` : ""}; ${risks.length} risks.`),
  permit,
  "",
  ...sections.flatMap(([title, xs]) => [title, list(xs), ""]),
  t("## 高风险（可能性 × 影响 ≥ 15，开工前要落实预防措施）", "## High risks (likelihood × impact ≥ 15; put prevention in place before the day)"),
  list(top),
  "",
  t("预算单价多是估算，要拿供应商报价核实。安全要求以活动所在地的规定和场地方的要求为准。", "Unit prices are mostly estimates; get supplier quotes. Safety rules follow the local regulations and the venue's own requirements."),
  "",
];

const out = outputs[0]?.path ?? "check-report.md";
fs.writeFileSync(out, `${report.join("\n")}\n`);
console.log(report.join("\n"));
const issues = sections.reduce((n, [, xs]) => n + xs.length, 0) + (permitMissing ? 1 : 0);
console.log(issues ? t(`有 ${issues} 处要看一下，见 ${out}。`, `${issues} ${issues === 1 ? "thing" : "things"} to look at; see ${out}.`) : t("检查通过。", "All checks passed."));
