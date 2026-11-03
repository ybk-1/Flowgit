// 用真实模型把每个自带模板从头跑一遍，记下每个阶段的用量、耗时、schema 是否一次通过和修复次数。
// Runs every bundled template end to end on a real model (DeepSeek by default) and records, for each
// stage, tokens, time, whether a JSON schema passed on the first try, and how many repairs it took.
// Run after `pnpm build`:
//
//   node scripts/eval-templates.mjs                                   # every template, zh and en
//   node scripts/eval-templates.mjs --only landing-page,slides --lang en
//   node scripts/eval-templates.mjs --mock                            # the canned demo replies, no model
//
// Options: --model <provider/model> (default deepseek/deepseek-chat), --lang zh,en, --only a,b,
// --concurrency <n> (default 3), --timeout <minutes per run> (default 20), --out <dir>.
// DeepSeek reads its key from DEEPSEEK_API_KEY.
//
// Human stages use each template's own sample materials: an output the template already ships is used
// as is, `sample-<name>` or `example-<name>` next to it is copied in, and an empty folder stands in for
// a folder of uploads. Each run stays in <out>/<template>-<lang>/ for reading; the numbers go to
// <out>/results.json and <out>/summary.md. Grading the outputs against each template's researched
// standard is done by reading them; docs/template-eval.md records that.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "packages", "cli", "dist", "index.js");
const coreEntry = path.join(root, "packages", "core", "dist", "index.js");
if (!fs.existsSync(cli) || !fs.existsSync(coreEntry)) {
  console.error("先运行 pnpm build / Run pnpm build first");
  process.exit(1);
}
const { listRuns, usageTokens } = await import(pathToFileURL(coreEntry).href);

// Sample values for each template's required inputs, from its README and the e2e tests.
const SAMPLES = {
  article: { zh: { topic: "为什么猫喜欢纸箱" }, en: { topic: "Why cats love cardboard boxes" } },
  "business-plan": { zh: { company: "店小算" }, en: { company: "ShopTally" } },
  "data-report": {
    zh: { question: "哪个类目和地区的销售额最高，下一步该补货还是促销？" },
    en: { question: "Which category and region sell the most, and should we restock or run a promotion next?", audience: "regional sales manager" },
  },
  "ecommerce-listing": { zh: { product: "便携榨汁杯" }, en: { product: "portable blender cup" } },
  "event-plan": {
    zh: { event: "咖啡馆五周年市集", attendees: "1200", audience: "public" },
    en: { event: "a café's fifth-anniversary market", attendees: "1200", audience: "public" },
  },
  hiring: { zh: { role: "社群运营", company: "转角咖啡" }, en: { role: "community manager", company: "Corner Café" } },
  "job-application": { zh: { role: "后端工程师" }, en: { role: "backend engineer" } },
  "landing-page": {
    zh: { product: "箱栖", audience: "养猫的人", goal: "留下邮箱" },
    en: { product: "BoxNest", audience: "people who live with a cat", goal: "leave an email" },
  },
  "lesson-plan": { zh: { topic: "分数的初步认识" }, en: { topic: "an introduction to fractions" } },
  "live-selling": { zh: { product: "便携榨汁杯", price: "直播间 99 元" }, en: { product: "portable blender cup", price: "99 yuan in the live room" } },
  "meeting-notes": {
    zh: { meeting: "轻杯 Mini 产品周会", date: "2026-03-04", attendees: "林夏、周衡、沈予" },
    en: { meeting: "Lightcup Mini product weekly", date: "2026-03-04", attendees: "Lin Xia, Zhou Heng, Shen Yu" },
  },
  "novel-serial": { zh: { premise: "好感度眼镜" }, en: { premise: "glasses that show how much people like you" } },
  "online-course": { zh: { topic: "用表格做个人记账", lessons: "4" }, en: { topic: "personal budgeting with a spreadsheet", lessons: "4" } },
  "picture-book": { zh: {}, en: {} },
  podcast: {
    zh: { show: "开店手记", host: "陆遥", topic: "一家独立书店怎么靠会员和活动活下来", guest: "沈禾，半亩书店创始人", sponsor: "店小算" },
    en: { show: "Shop Notes", host: "Lu Yao", topic: "How an independent bookstore lives on members and events", guest: "Shen He, founder of Half Acre Books", sponsor: "ShopTally" },
  },
  "micro-course": {
    zh: { topic: "10 分钟做出你的第一张记账表", audience: "想入门的上班族", minutes: "6" },
    en: { topic: "Make your first budget spreadsheet in 10 minutes", audience: "office workers new to budgeting", minutes: "6" },
  },
  "product-launch": {
    zh: { product: "拍小票", audience: "开小店的人", goal: "留下邮箱，收到下载链接", launchDate: "2026-12-01", embargo: "true" },
    en: { product: "ShopTally Snap", audience: "owners of small shops", goal: "leave an email to get the download link", launchDate: "2026-12-01", embargo: "true" },
  },
  "research-report": { zh: { topic: "为什么猫喜欢纸箱" }, en: { topic: "Why cats love cardboard boxes" } },
  "short-drama": { zh: { premise: "面馆逆袭", episodes: "3", paywallAt: "3" }, en: { premise: "a noodle shop's comeback", episodes: "3", paywallAt: "3" } },
  "short-video": { zh: { topic: "为什么猫喜欢纸箱" }, en: { topic: "Why cats love cardboard boxes" } },
  slides: { zh: { topic: "把周报做成流程" }, en: { topic: "turning the weekly report into a flow" } },
  "social-posts": { zh: { topic: "南风文具社的周末写信会" }, en: { topic: "a weekend letter-writing meetup at South Wind Stationery" } },
  "support-sop": { zh: { product: "澄光台灯" }, en: { product: "Clearlight desk lamp" } },
  "travel-guide": { zh: { destination: "泉州" }, en: { destination: "Quanzhou" } },
  "weekly-report": { zh: { name: "小林" }, en: { name: "Lin" } },
};

function parseArgs(argv) {
  const opts = { model: "deepseek/deepseek-chat", langs: ["zh", "en"], only: null, concurrency: 3, timeout: 20, out: null, mock: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        console.error(`${arg} 需要一个值 / ${arg} needs a value`);
        process.exit(1);
      }
      i += 1;
      return next;
    };
    if (arg === "--mock") opts.mock = true;
    else if (arg === "--model") opts.model = value();
    else if (arg === "--lang") opts.langs = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--only") opts.only = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--concurrency") opts.concurrency = Math.max(1, Math.min(8, Number(value()) || 1));
    else if (arg === "--timeout") opts.timeout = Math.max(1, Number(value()) || 20);
    else if (arg === "--out") opts.out = path.resolve(value());
    else {
      console.error(`不认识的参数 / Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const templatesDir = path.join(root, "packages", "cli", "templates");
const all = fs.readdirSync(templatesDir).filter((t) => fs.existsSync(path.join(templatesDir, t, "flow.json"))).sort();
const unknown = (opts.only ?? []).filter((t) => !all.includes(t));
if (unknown.length) {
  console.error(`没有这些模板 / No such templates: ${unknown.join(", ")}`);
  process.exit(1);
}
const templates = opts.only ?? all;
const out = opts.out ?? fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-eval-"));
fs.mkdirSync(out, { recursive: true });
// Trust confirmations and other per-user state go to a throwaway home, never the real one.
const flowgitHome = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-eval-home-"));

function runCli(args, env = {}, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, NO_COLOR: "1", FLOWGIT_HOME: flowgitHome, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, out: text, timedOut });
    });
  });
}

/** Fills each human stage's outputs from the template's samples. Returns notes on what it did. */
function prepareHumanStages(flow, dir) {
  const notes = [];
  for (const stage of flow.stages.filter((s) => s.executor?.type === "human")) {
    for (const output of stage.outputs ?? []) {
      const rel = output.path.replace(/[\\/]+$/, "");
      const abs = path.join(dir, rel);
      if (fs.existsSync(abs)) continue;
      const parent = path.dirname(abs);
      const base = path.basename(abs);
      const sample = ["sample-", "example-"].map((prefix) => path.join(parent, prefix + base)).find((p) => fs.existsSync(p));
      if (sample) {
        fs.cpSync(sample, abs, { recursive: true });
        notes.push(`${stage.id}: ${path.basename(sample)} → ${output.path}`);
      } else if (output.type === "dir" || /[\\/]$/.test(output.path)) {
        fs.mkdirSync(abs, { recursive: true });
        notes.push(`${stage.id}: ${output.path} (empty / 空)`);
      } else {
        notes.push(`${stage.id}: ${output.path} missing, no sample / 缺少，也没有样例`);
      }
    }
  }
  return notes;
}

const callsOf = (params) => (Array.isArray(params?.llmCalls) ? params.llmCalls : params?.usage ? [params.usage] : []);

/** A flowgit sub-flow keeps its own runs/; the parent's run records no model calls, so read the sub-flow's. */
function subflowCalls(dir, params) {
  if (params.engine !== "flowgit" || typeof params.file !== "string") return [];
  const flowFile = path.join(dir, params.file);
  if (!fs.existsSync(flowFile)) return [];
  const sub = JSON.parse(fs.readFileSync(flowFile, "utf8"));
  return (sub.stages ?? []).flatMap((s) => callsOf(listRuns(path.dirname(flowFile), s.id).at(-1)?.params));
}

function stageResult(dir, stage) {
  const latest = listRuns(dir, stage.id).at(-1);
  const type = stage.executor?.type ?? "?";
  if (!latest) return { id: stage.id, type, status: "not-run" };
  const params = latest.params ?? {};
  const own = callsOf(params);
  const calls = [...own, ...subflowCalls(dir, params)];
  let input = 0;
  let output = 0;
  for (const call of calls) {
    const t = usageTokens(call ?? undefined);
    if (t) {
      input += t.input;
      output += t.output;
    }
  }
  const hasSchema = (stage.outputs ?? []).some((o) => o.schema);
  const repairs = Math.max(0, own.length - 1);
  const schema = !hasSchema ? null : latest.status !== "ok" ? "failed" : repairs ? "repaired" : "first-pass";
  // A script stage's last line is its verdict, e.g. "有 2 处要看一下" / "All checks passed.".
  const said = String(params.output ?? latest.error ?? "").trim().split("\n").filter(Boolean);
  return {
    id: stage.id,
    type,
    status: latest.status,
    executor: latest.executor,
    ms: Math.max(0, Date.parse(latest.finishedAt) - Date.parse(latest.startedAt)) || 0,
    model: params.model ?? null,
    calls: calls.length,
    input,
    output,
    schema,
    repairs,
    stopReason: params.stopReason ?? null,
    summary: type === "script" ? (said.at(-1) ?? null) : null,
    error: latest.error ? String(latest.error).slice(0, 400) : null,
  };
}

async function evalOne(template, lang) {
  const dir = path.join(out, `${template}-${lang}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const result = { template, lang, dir, ok: false, notes: [] };
  const init = await runCli(["init", dir, "-t", template]);
  if (init.code !== 0) return { ...result, error: init.out.trim() };
  const flow = JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8"));
  result.notes = prepareHumanStages(flow, dir);
  const sample = SAMPLES[template]?.[lang];
  if (!sample) return { ...result, error: `scripts/eval-templates.mjs 里没有这个模板的样例输入 / no sample inputs for ${template} (${lang}) in SAMPLES` };
  const inputs = { ...sample, ...(flow.inputs?.language ? { language: lang } : {}) };
  const set = await runCli(["-C", dir, "inputs", "set", ...Object.entries(inputs).map(([k, v]) => `${k}=${v}`)]);
  if (set.code !== 0) return { ...result, error: set.out.trim() };
  result.inputs = inputs;
  // Some templates keep their canned replies per language, in demo-replies/<lang>/.
  const mockDir = [path.join(dir, "demo-replies", lang), path.join(dir, "demo-replies")].find(
    (p) => fs.existsSync(p) && fs.statSync(p).isDirectory() && fs.readdirSync(p).some((f) => /\.(md|txt|json)$/.test(f)),
  );
  const env = opts.mock ? { FLOWGIT_LLM_MOCK_DIR: mockDir ?? path.join(dir, "demo-replies") } : {};
  const started = Date.now();
  const ran = await runCli(["-C", dir, "run", "all", ...(opts.mock ? [] : ["--model", opts.model])], env, opts.timeout * 60_000);
  result.ms = Date.now() - started;
  fs.writeFileSync(path.join(dir, "eval-run.log"), ran.out);
  result.exitCode = ran.code;
  result.timedOut = ran.timedOut;
  result.stages = flow.stages.map((stage) => stageResult(dir, stage));
  result.ok = ran.code === 0 && result.stages.every((s) => s.status === "ok");
  const report = path.join(dir, "check-report.md");
  if (fs.existsSync(report)) result.checkReport = fs.readFileSync(report, "utf8");
  return result;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

const jobs = templates.flatMap((template) => opts.langs.map((lang) => ({ template, lang })));
console.log(
  `评测 ${templates.length} 个模板 × ${opts.langs.join("/")}，${opts.mock ? "固定回复" : opts.model}，输出到 ${out} / ` +
    `Evaluating ${templates.length} template(s) × ${opts.langs.join("/")} on ${opts.mock ? "canned replies" : opts.model}, writing to ${out}`,
);
const results = await pool(jobs, opts.concurrency, async ({ template, lang }) => {
  const r = await evalOne(template, lang);
  const tokens = (r.stages ?? []).reduce((n, s) => n + (s.input ?? 0) + (s.output ?? 0), 0);
  const failed = (r.stages ?? []).filter((s) => s.status !== "ok").map((s) => `${s.id}:${s.status}`);
  console.log(`${r.ok ? "✓" : "✗"} ${template} ${lang}  ${Math.round((r.ms ?? 0) / 1000)}s  ${tokens} tokens${failed.length ? `  ${failed.join(" ")}` : ""}${r.error ? `  ${r.error.split("\n")[0]}` : ""}`);
  return r;
});

const meta = { model: opts.mock ? "mock" : opts.model, date: new Date().toISOString(), langs: opts.langs };
fs.writeFileSync(path.join(out, "results.json"), `${JSON.stringify({ ...meta, results }, null, 2)}\n`);

// summary.md: one row per template and language, then one row per stage.
const sec = (ms) => (ms / 1000).toFixed(1);
const lines = [
  `# 模板评测 / Template evaluation`,
  "",
  `${meta.date} · ${meta.model}`,
  "",
  "| 模板 Template | 语言 Lang | 结果 Result | 模型调用 Calls | 输入 In | 输出 Out | 耗时 Time (s) | schema | 修复 Repairs | 检查 Check |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const r of results) {
  const stages = r.stages ?? [];
  const sum = (key) => stages.reduce((n, s) => n + (s[key] ?? 0), 0);
  const schemaStages = stages.filter((s) => s.schema);
  const schema = schemaStages.length ? `${schemaStages.filter((s) => s.schema === "first-pass").length}/${schemaStages.length}` : "-";
  const state = r.error ? "error" : r.ok ? "ok" : stages.filter((s) => s.status !== "ok").map((s) => `${s.id} ${s.status}`).join(", ");
  // The verdict of the last script stage that ran, usually the check.
  const verdict = stages.filter((s) => s.summary).at(-1)?.summary ?? "-";
  const cell = verdict.replace(/\|/g, "\\|").slice(0, 120);
  lines.push(`| ${r.template} | ${r.lang} | ${state} | ${sum("calls")} | ${sum("input")} | ${sum("output")} | ${sec(r.ms ?? 0)} | ${schema} | ${sum("repairs")} | ${cell} |`);
}
lines.push("", "## 每个阶段 / Per stage", "", "| 模板 Template | 语言 Lang | 阶段 Stage | 类型 Type | 状态 Status | 输入 In | 输出 Out | 耗时 Time (s) | schema | 修复 Repairs |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of results) {
  for (const s of r.stages ?? []) {
    lines.push(`| ${r.template} | ${r.lang} | ${s.id} | ${s.type} | ${s.status} | ${s.input ?? 0} | ${s.output ?? 0} | ${sec(s.ms ?? 0)} | ${s.schema ?? "-"} | ${s.repairs ?? 0} |`);
  }
}
fs.writeFileSync(path.join(out, "summary.md"), `${lines.join("\n")}\n`);

const okCount = results.filter((r) => r.ok).length;
console.log(`${okCount}/${results.length} 跑通 / ran clean. ${path.join(out, "summary.md")}`);
process.exitCode = okCount === results.length ? 0 : 1;
