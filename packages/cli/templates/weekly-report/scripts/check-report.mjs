// "check" stage: make sure the draft is a usable weekly report. Writes
// check.json and exits 1 if a check fails, so the stage shows as failed and you
// either fix report.md by hand or re-run the draft stage.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const inputs = JSON.parse(process.env.FLOWGIT_INPUTS ?? "[]");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const reportPath = inputs.find((i) => i.path.endsWith(".md"))?.path ?? "report.md";
const checkPath = outputs[0]?.path ?? "check.json";
const text = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
const lines = text.split(/\r?\n/);

// The three sections the prompt asks for, in order.
const wanted = en ? ["Done this week", "Next week", "Need help"] : ["本周完成", "下周计划", "需要帮助"];
const headings = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
const inOrder = wanted.every((h, i) => headings[i] === h) && headings.length === wanted.length;

// Every section needs at least one bullet.
const empty = wanted.filter((h) => {
  const start = lines.findIndex((l) => l.trim() === `## ${h}`);
  if (start < 0) return true;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("#"));
  return !(end < 0 ? rest : rest.slice(0, end)).some((l) => /^\s*[-*]\s+\S/.test(l));
});

const placeholders = [...text.matchAll(/\bTODO\b|\bTBD\b|待补充|待填|\bx{3,}\b/gi)].map((m) => m[0]);
const chars = [...text].length;

const checks = [
  { name: t("周报存在", "report exists"), ok: text.length > 0, detail: reportPath },
  {
    name: t("有标题", "has a title"),
    ok: lines[0]?.startsWith("# ") ?? false,
    detail: lines[0] || t("第一行应该是 # 标题", "the first line should be # Title"),
  },
  {
    name: t("三个小节，顺序正确", "three sections, in order"),
    ok: inOrder,
    detail: headings.length ? headings.join(" / ") : t("没有找到 ## 小节", "no ## sections found"),
  },
  {
    name: t("每个小节都有要点", "every section has a bullet"),
    ok: empty.length === 0,
    detail: empty.length ? t(`没有要点：${empty.join("、")}`, `no bullets: ${empty.join(", ")}`) : t("都有", "all have one"),
  },
  {
    name: t("没有占位符", "no placeholders"),
    ok: placeholders.length === 0,
    detail: placeholders.length ? [...new Set(placeholders)].join(", ") : t("没有", "none"),
  },
  { name: t("长度合适", "sane length"), ok: chars >= 40 && chars <= 4000, detail: t(`${chars} 字`, `${chars} characters`) },
];
const ok = checks.every((c) => c.ok);

fs.writeFileSync(checkPath, JSON.stringify({ ok, report: reportPath, checks }, null, 2) + "\n");
for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
if (!ok) {
  console.error(t("检查没通过：直接改 report.md，或者重跑 draft 阶段。", "Checks failed: fix report.md by hand or re-run the draft stage."));
  process.exit(1);
}
console.log(t("检查通过。", "All checks passed."));
