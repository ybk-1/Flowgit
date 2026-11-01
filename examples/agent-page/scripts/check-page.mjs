// "check" stage: verify the page the agent wrote. Writes check.json and exits 1
// if any check fails, so the stage fails and you re-run the page stage.
import fs from "node:fs";

const flowInputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? "{}");
const inputs = JSON.parse(process.env.FLOWGIT_INPUTS ?? "[]");
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const en = flowInputs.language === "en";
const t = (zh, english) => (en ? english : zh);

const pagePath = inputs.find((i) => i.path.endsWith(".html"))?.path ?? "index.html";
const reportPath = outputs[0]?.path ?? "check.json";
const html = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
const wantLang = en ? "en" : "zh";

// Tags that would load something from the network: <script src>, <link href>, <img src>, etc.
const external = [...html.matchAll(/<(script|link|img|iframe|video|audio|source|embed|object)\b[^>]*\b(?:src|href|data)\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi)].map(
  (m) => `<${m[1].toLowerCase()}> ${m[2]}`,
);
// CSS @import / url() pointing at the network.
const cssExternal = [...html.matchAll(/(?:@import\s+(?:url\()?|url\()\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi)].map((m) => `css ${m[1]}`);
const lang = /<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i.exec(html)?.[1] ?? "";
const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
const kb = Math.round(Buffer.byteLength(html) / 1024);

const checks = [
  { name: t("网页存在", "page exists"), ok: html.length > 0, detail: pagePath },
  { name: t("有标题", "has a title"), ok: title.length > 0, detail: title || t("缺少 <title>", "missing <title>") },
  {
    name: t("语言正确", "right language"),
    ok: lang.toLowerCase().startsWith(wantLang),
    detail: lang ? `lang="${lang}"` : t('缺少 <html lang="...">', 'missing <html lang="...">'),
  },
  {
    name: t("没有外部资源", "no external resources"),
    ok: external.length + cssExternal.length === 0,
    detail: [...external, ...cssExternal].join(", ") || t("全部内联", "everything is inline"),
  },
  { name: t("大小合理", "sane size"), ok: kb <= 200, detail: `${kb} KB` },
];
const ok = checks.every((c) => c.ok);

fs.writeFileSync(reportPath, JSON.stringify({ ok, page: pagePath, checks }, null, 2) + "\n");
for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
if (!ok) {
  console.error(t("检查没通过：改一下 index.html 或重跑 page 阶段。", "Checks failed: fix index.html or re-run the page stage."));
  process.exit(1);
}
console.log(t("检查通过。", "All checks passed."));
