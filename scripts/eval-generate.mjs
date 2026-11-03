// 用真实模型评测 `flowgit new`：把一组描述各生成一个流程，看它能不能通过校验和预演，再查几种常见问题。
// Evaluates `flowgit new` on a real model: generates a flow from each description in a test set,
// checks that it passes validation and its dry run, and looks for common problems.
// Run after `pnpm build`:
//
//   node scripts/eval-generate.mjs                          # all 10 descriptions on DeepSeek
//   node scripts/eval-generate.mjs --only trip,contract --repeat 2
//
// Options: --model <provider/model> (default deepseek/deepseek-chat), --only a,b, --repeat <n>,
// --concurrency <n> (default 3), --out <dir>. DeepSeek reads its key from DEEPSEEK_API_KEY.
// --rescore --out <dir> checks the flows an earlier run saved there again, without calling the model.
// --retry-failed --out <dir> generates again only the cases whose generation failed there (a busy
// provider, a dropped stream) and keeps the rest of that run.
//
// Generation goes through generateFlow(), the function `flowgit new` calls, with every model call
// recorded (tokens, time, repairs). Then the built CLI runs `flowgit validate` and
// `flowgit run all --dry-run` in the new folder, with required inputs filled the way `flowgit new`
// fills them for its preview. A second dry run puts a placeholder file at every human stage's output,
// so the stages after it are planned too. Each flow stays in <out>/<case>[-<n>]/ for reading; the
// numbers go to <out>/results.json and <out>/summary.md. Grading the flows is done by reading them;
// docs/template-eval.md records that.
import { spawnSync } from "node:child_process";
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
const core = await import(pathToFileURL(coreEntry).href);

// The test set: everyday jobs from different fields, half in Chinese and half in English.
// `asks` names the executors a description asks for in so many words; nothing else may use them.
const CASES = [
  {
    id: "xhs-note",
    language: "zh",
    description: "把我写的产品试用笔记改成一篇小红书种草笔记，配 5 个话题标签，发之前检查有没有夸大和违禁词。",
  },
  {
    id: "video",
    language: "zh",
    description: "做一条 60 秒的抖音口播视频脚本：先定选题和开头三秒的钩子，再写分镜和口播稿，最后列出要拍的镜头清单。",
  },
  {
    id: "sales-week",
    language: "zh",
    description: "每周一把上周的销售数据 CSV 做成周报：用脚本算出各区域的销售额和环比，再写结论和下周建议。",
    asks: ["script"],
  },
  {
    id: "interviews",
    language: "zh",
    description: "整理 8 场用户访谈的记录：逐场提炼要点，归纳共同的痛点，最后给产品经理写一页结论和建议。",
  },
  {
    id: "contract",
    language: "zh",
    description: "帮法务审一份采购合同：标出风险条款并给出修改建议，再写一封发给对方的修订说明邮件。",
  },
  {
    id: "grant",
    language: "en",
    description:
      "Write a grant proposal for a community garden: gather the facts, draft each section to the funder's guidelines, and score it against the funder's rubric before submitting.",
  },
  {
    id: "support",
    language: "en",
    description:
      "Answer a customer complaint email: sort out what the customer wants, check it against the refund policy I paste in, draft a polite reply, and flag anything a manager has to approve.",
  },
  {
    id: "release",
    language: "en",
    description:
      "Write release notes from the list of merged pull requests, with a coding agent that reads the repository to fill in the details, then a short announcement for our blog.",
    asks: ["agent"],
  },
  {
    id: "trip",
    language: "en",
    description: "Plan a family trip with two young kids: take the city and the number of days as inputs, then write a day-by-day itinerary and a packing list.",
  },
  {
    id: "interview-prep",
    language: "en",
    description: "Help me prepare for a job interview: from the job ad and my resume, list the likely questions, draft answers in the STAR format, and make a one-page cheat sheet.",
  },
];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const model = option("--model", "deepseek/deepseek-chat");
const only = option("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const repeat = Math.max(1, Number(option("--repeat", "1")) || 1);
const concurrency = Math.max(1, Number(option("--concurrency", "3")) || 3);
const rescoring = args.includes("--rescore");
const retrying = args.includes("--retry-failed");
if ((rescoring || retrying) && !args.includes("--out")) {
  console.error(`${rescoring ? "--rescore" : "--retry-failed"} 要和 --out 一起用 / ${rescoring ? "--rescore" : "--retry-failed"} needs --out`);
  process.exit(1);
}
const out = path.resolve(option("--out", fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-eval-generate-"))));

const unknown = only.filter((id) => !CASES.some((c) => c.id === id));
if (unknown.length) {
  console.error(`没有这些描述 / unknown cases: ${unknown.join(", ")} (${CASES.map((c) => c.id).join(", ")})`);
  process.exit(1);
}
const jobs = [];
for (const c of CASES.filter((c) => !only.length || only.includes(c.id))) {
  for (let n = 1; n <= repeat; n += 1) jobs.push({ ...c, dir: path.join(out, repeat > 1 ? `${c.id}-${n}` : c.id) });
}
fs.mkdirSync(out, { recursive: true });

const HAN = /\p{Script=Han}/u;
const PLACEHOLDER = /\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g;

/** Whether text names the file rel as a whole name, the way generate.ts reads prompts: points.md is not in pain_points.md. */
function mentions(text, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w/-])`).test(text);
}

/** Values for required inputs without a default, the way `flowgit new` fills them for its preview. */
function placeholders(flow) {
  const inputs = {};
  for (const [key, def] of Object.entries(flow.inputs ?? {})) {
    if (def.required !== true || (def.default !== undefined && def.default !== "")) continue;
    if (Array.isArray(def.enum) && def.enum.length) inputs[key] = def.enum[0];
    else if (def.type === "number") inputs[key] = 1;
    else if (def.type === "boolean") inputs[key] = false;
    else inputs[key] = key;
  }
  return inputs;
}

function cliRun(dir, argv) {
  const res = spawnSync(process.execPath, [cli, ...argv], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
  return { code: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function dryRun(dir, flow) {
  const inputs = placeholders(flow);
  const argv = ["run", "all", "--dry-run", ...Object.entries(inputs).flatMap(([k, v]) => ["--input", `${k}=${v}`])];
  const shown = cliRun(dir, argv);
  const steps = core.planRunAll(core.loadFlow(dir), { model, inputs });
  return { code: shown.code, out: shown.out, actions: steps.map((s) => ({ id: s.stage.id, action: s.action, detail: s.detail })) };
}

/** Puts a placeholder at every human output (a file, or a folder with one file) so later stages get planned. */
function fillHumanOutputs(dir, flow) {
  for (const stage of flow.stages) {
    if (stage.executor.type !== "human") continue;
    for (const output of stage.outputs ?? []) {
      const abs = path.join(dir, output.path);
      if (fs.existsSync(abs)) continue;
      if (output.path.endsWith("/") || output.type === "directory") {
        fs.mkdirSync(abs, { recursive: true });
        fs.writeFileSync(path.join(abs, "sample.txt"), "sample\n");
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "sample\n");
      }
    }
  }
}

/** Problems a reader would catch at a glance, found by rule. Grading the rest is done by reading. */
function findings(job, flow, prompts) {
  const list = [];
  const en = job.language === "en";
  if (flow.language !== job.language) list.push(`language is ${flow.language ?? "unset"}, the description is ${job.language}`);
  const texts = [
    ["name", flow.name],
    ["description", flow.description],
    ...Object.entries(flow.inputs ?? {}).map(([k, d]) => [`input ${k}`, d.description]),
    ...flow.stages.flatMap((s) => [
      [`stage ${s.id} name`, s.name],
      [`stage ${s.id} description`, s.description],
      [`stage ${s.id} instructions`, s.executor.instructions],
    ]),
    ...Object.entries(prompts).map(([file, text]) => [file, text]),
  ].filter(([, text]) => typeof text === "string" && text.trim());
  if (en) {
    const han = texts.filter(([, text]) => HAN.test(text)).map(([where]) => where);
    if (han.length) list.push(`Chinese in an English flow: ${han.join(", ")}`);
  } else {
    const english = Object.entries(prompts)
      .filter(([, text]) => !HAN.test(text))
      .map(([file]) => file);
    if (english.length) list.push(`prompt with no Chinese: ${english.join(", ")}`);
  }
  const types = flow.stages.map((s) => s.executor.type);
  for (const type of ["script", "agent"]) {
    const asked = (job.asks ?? []).includes(type);
    if (asked && !types.includes(type)) list.push(`asked for a ${type} stage, got none`);
    if (!asked && types.includes(type)) list.push(`${type} stage nobody asked for`);
  }
  if (flow.stages.length < 2 || flow.stages.length > 6) list.push(`${flow.stages.length} stages (2 to 6 expected)`);
  const declared = Object.keys(flow.inputs ?? {});
  const used = new Set();
  for (const text of Object.values(prompts)) for (const m of text.matchAll(PLACEHOLDER)) used.add(m[1]);
  const humanText = flow.stages.map((s) => s.executor.instructions ?? "").join("\n");
  for (const key of declared) {
    if (!used.has(key)) list.push(`input ${key} is in no prompt${new RegExp(`\\b${key}\\b`).test(humanText) ? " (only in a person's instructions)" : ""}: the model never sees it`);
  }
  for (const key of used) if (!declared.includes(key)) list.push(`{{inputs.${key}}} is not a declared input`);
  const byId = new Map(flow.stages.map((s) => [s.id, s]));
  const dependents = new Set(flow.stages.flatMap((s) => s.inputs ?? []));
  for (const stage of flow.stages) {
    const ex = stage.executor;
    if (ex.type === "human" && !ex.instructions?.trim()) list.push(`human stage ${stage.id} has no instructions`);
    if (ex.type === "human" && /\{\{\s*inputs\./.test(ex.instructions ?? "")) list.push(`human stage ${stage.id} has {{inputs.…}} in its instructions, which nobody fills in`);
    if (ex.type === "human" && (stage.inputs ?? []).length && !dependents.has(stage.id)) list.push(`human stage ${stage.id} at the end only reviews the result`);
    if (ex.type !== "llm" && ex.type !== "agent") continue;
    const text = prompts[ex.prompt] ?? "";
    // A prompt that names another stage's file sees that file only when it depends on the stage.
    for (const other of flow.stages) {
      if (other.id === stage.id || (stage.inputs ?? []).includes(other.id)) continue;
      for (const output of other.outputs ?? []) {
        if (output.path.length > 3 && !output.path.endsWith("/") && mentions(text, output.path)) list.push(`${ex.prompt} names ${output.path} from ${other.id}, a stage it does not depend on`);
      }
    }
    for (const dep of stage.inputs ?? []) {
      for (const output of byId.get(dep)?.outputs ?? []) {
        if (ex.type === "llm" && output.path.endsWith("/")) list.push(`${stage.id} reads the folder ${output.path}: an llm stage sees only its file names`);
      }
    }
  }
  for (const [key, def] of Object.entries(flow.inputs ?? {})) {
    if (def.type === "file" || def.type === "text") list.push(`input ${key} is a ${def.type}: a document belongs to a human stage`);
    if (def.required === false && def.default === undefined) list.push(`optional input ${key} has no default, so its prompt gets an empty value`);
  }
  for (const [file, text] of Object.entries(prompts)) {
    const size = [...text.trim()].length;
    if (size < (en ? 300 : 120)) list.push(`thin prompt ${file} (${size} characters)`);
  }
  return list;
}

/**
 * Runs each script stage once on the placeholder human outputs. "sample" is not real data, so a
 * good script stops with a message of its own; a stack trace means it crashed.
 */
function scriptSmoke(dir, flow) {
  const list = [];
  const scripts = flow.stages.filter((s) => s.executor.type === "script");
  if (!scripts.length) return list;
  const inputs = Object.entries(placeholders(flow)).flatMap(([k, v]) => ["--input", `${k}=${v}`]);
  for (const stage of flow.stages.filter((s) => s.executor.type === "human")) cliRun(dir, ["run", stage.id, ...inputs]);
  for (const stage of scripts) {
    const res = cliRun(dir, ["run", stage.id, ...inputs]);
    if (/\n\s+at .+:\d+:\d+|\b(?:SyntaxError|TypeError|ReferenceError|RangeError)\b/.test(res.out)) {
      const line = res.out.split(/\r?\n/).find((l) => /Error/.test(l)) ?? "";
      list.push(`script stage ${stage.id} crashed on a placeholder input: ${line.trim().slice(0, 160)}`);
    }
  }
  return list;
}

/** Script files the flow's script stages run that are not in the folder after writing. */
function missingScripts(dir, flow) {
  const missing = [];
  for (const stage of flow.stages) {
    if (stage.executor.type !== "script") continue;
    for (const word of stage.executor.run.split(/\s+/)) {
      if (/\.(?:mjs|cjs|js|ts|py|sh|ps1)$/i.test(word) && !fs.existsSync(path.join(dir, word))) missing.push(`script stage ${stage.id} runs ${word}, which the flow does not have`);
    }
  }
  return missing;
}

/**
 * DeepSeek answers 503 "Service is too busy" at busy hours, after the SDK's own retries. That says
 * nothing about the prompts, so the call waits 30, 60, then 120 seconds and tries again.
 */
async function busyRetry(call, waits) {
  for (const wait of [30, 60, 120, 0]) {
    try {
      return await call();
    } catch (err) {
      if (!wait || !/\b503\b|too busy/i.test(String(err?.message ?? err))) throw err;
      waits.push(wait);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }
}

async function evaluate(job) {
  const calls = [];
  const waits = [];
  const llm = async (req) => {
    const start = Date.now();
    const before = waits.reduce((n, w) => n + w, 0);
    const res = await busyRetry(() => core.providerComplete(req), waits);
    const waited = waits.reduce((n, w) => n + w, 0) - before;
    const tokens = core.usageTokens(res.usage);
    calls.push({ stage: req.stageId, repair: Boolean(req.repair), seconds: (Date.now() - start) / 1000 - waited, input: tokens?.input ?? 0, output: tokens?.output ?? 0 });
    fs.writeFileSync(path.join(job.dir, `.reply-${calls.length}-${req.stageId}${req.repair ? "-repair" : ""}.txt`), res.text);
    return res;
  };
  fs.mkdirSync(job.dir, { recursive: true });
  const started = Date.now();
  const result = await core.generateFlow(job.description, { dir: job.dir, model, llm, write: true });
  const row = {
    case: job.id,
    dir: path.relative(out, job.dir),
    language: job.language,
    ok: result.ok,
    // Waiting out a busy provider is not the flow's time.
    seconds: (Date.now() - started) / 1000 - waits.reduce((n, w) => n + w, 0),
    busyRetries: waits.length,
    calls: calls.length,
    repairs: calls.filter((c) => c.repair).length,
    input: calls.reduce((n, c) => n + c.input, 0),
    output: calls.reduce((n, c) => n + c.output, 0),
  };
  if (!result.ok) return { ...row, errors: result.errors, findings: ["generation failed"] };
  return { ...row, ...check(job, result.flow, result.prompts, result.scripts ?? {}) };
}

/** Validation, the two dry runs and the findings for a flow that is written in job.dir. */
function check(job, flow, prompts, scripts) {
  const validate = cliRun(job.dir, ["validate"]);
  const first = dryRun(job.dir, flow);
  fillHumanOutputs(job.dir, flow);
  const filled = dryRun(job.dir, flow);
  const list = [...findings(job, flow, prompts), ...missingScripts(job.dir, flow), ...scriptSmoke(job.dir, flow)];
  if (validate.code !== 0) list.push("flowgit validate failed");
  if (first.code !== 0) list.push("the dry run failed");
  for (const step of [...first.actions, ...filled.actions]) {
    if (step.action === "cannot-run") list.push(`dry run: ${step.id} cannot run (${step.detail ?? ""})`);
  }
  if (filled.actions.some((s) => s.action === "not-reached")) list.push(`dry run with the human outputs in place still stops: ${filled.actions.map((s) => `${s.id}=${s.action}`).join(", ")}`);
  return {
    name: flow.name,
    stages: flow.stages.map((s) => `${s.id}:${s.executor.type}`),
    inputs: Object.keys(flow.inputs ?? {}),
    validate: { code: validate.code, warnings: (validate.out.match(/⚠|warning/gi) ?? []).length },
    dryRun: first.actions,
    dryRunFilled: filled.actions,
    promptChars: Object.fromEntries(Object.entries(prompts).map(([file, text]) => [file, [...text.trim()].length])),
    scripts: Object.keys(scripts),
    findings: [...new Set(list)],
  };
}

/** Checks a flow saved by an earlier run again, with today's checks, without calling the model. */
function rescore(old) {
  const job = { ...CASES.find((c) => c.id === old.case), dir: path.join(out, old.dir) };
  if (!old.ok) return old;
  const flow = core.loadFlow(job.dir).flow;
  const prompts = {};
  for (const stage of flow.stages) {
    const file = stage.executor.prompt;
    if (file && fs.existsSync(path.join(job.dir, file))) prompts[file] = fs.readFileSync(path.join(job.dir, file), "utf8");
  }
  const scripts = {};
  for (const stage of flow.stages) {
    if (stage.executor.type !== "script") continue;
    for (const word of stage.executor.run.split(/\s+/)) {
      if (/\.(?:mjs|cjs|js)$/.test(word) && fs.existsSync(path.join(job.dir, word))) scripts[word] = fs.readFileSync(path.join(job.dir, word), "utf8");
    }
  }
  return { ...old, ...check(job, flow, prompts, scripts) };
}

/** Runs fn over items, size at a time, and calls save with the results so far after each one. */
async function pool(items, size, fn, save) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = { case: items[i].id, dir: path.relative(out, items[i].dir), language: items[i].language, ok: false, errors: [String(err?.message ?? err)], findings: ["the evaluation crashed"] };
      }
      const r = results[i];
      console.log(`${r.ok ? "✓" : "✗"} ${r.dir}: ${r.findings.length ? r.findings.join("; ") : "no findings"}`);
      // Saved as it goes, so a run stopped halfway still leaves its numbers.
      save(results);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

const resultsFile = path.join(out, "results.json");
const writeResults = (data) => fs.writeFileSync(resultsFile, `${JSON.stringify(data, null, 2)}\n`);
let results;
if (rescoring) {
  const saved = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  results = saved.results.map(rescore);
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.dir}: ${r.findings.length ? r.findings.join("; ") : "no findings"}`);
  writeResults({ ...saved, rescored: new Date().toISOString(), results });
} else if (retrying) {
  const saved = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  const failed = saved.results.filter((r) => !r.ok);
  const retry = failed.map((r) => ({ ...CASES.find((c) => c.id === r.case), dir: path.join(out, r.dir) }));
  // A failed generation wrote no flow, only the replies it got; they go, so the folder holds one attempt.
  for (const job of retry) fs.rmSync(job.dir, { recursive: true, force: true });
  console.log(`${retry.length} 次生成重试 / generations retried, ${model}, → ${out}`);
  const merged = (fresh) =>
    saved.results.map((r) => {
      const i = failed.indexOf(r);
      return i >= 0 && fresh[i] ? { ...fresh[i], retried: true, firstErrors: r.errors ?? [] } : r;
    });
  results = merged(await pool(retry, concurrency, evaluate, (fresh) => writeResults({ ...saved, partial: true, results: merged(fresh) })));
  writeResults({ ...saved, retried: new Date().toISOString(), results });
} else {
  console.log(`${jobs.length} 次生成 / generations, ${model}, → ${out}`);
  results = await pool(jobs, concurrency, evaluate, (so) => writeResults({ model, date: new Date().toISOString(), partial: true, results: so.filter(Boolean) }));
  writeResults({ model, date: new Date().toISOString(), results });
}

const lines = [
  `# flowgit new · ${model}`,
  "",
  "| Case | Lang | OK | Stages | Inputs | Calls | Repairs | In | Out | Secs | Validate | Dry run | Findings |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const r of results) {
  const types = (r.stages ?? []).map((s) => s.split(":")[1][0]).join("");
  const dry = r.dryRun ? r.dryRun.map((s) => s.action).join(" ") : "-";
  lines.push(
    `| ${r.dir} | ${r.language} | ${r.ok ? "yes" : "no"} | ${types || "-"} | ${(r.inputs ?? []).join(" ") || "-"} | ${r.calls ?? 0} | ${r.repairs ?? 0} | ${(r.input ?? 0).toLocaleString("en-US")} | ${(r.output ?? 0).toLocaleString("en-US")} | ${(r.seconds ?? 0).toFixed(1)} | ${r.validate ? (r.validate.code === 0 ? "ok" : "fail") : "-"} | ${dry} | ${r.findings.length} |`,
  );
}
lines.push("", "Stage letters: h human, l llm, s script, a agent.", "");
for (const r of results) {
  if (!r.findings.length && r.ok && !r.retried) continue;
  const first = r.retried ? (r.firstErrors?.length ? r.firstErrors : ["?"]).map((e) => `- first try failed: ${e}`) : [];
  lines.push(`## ${r.dir}`, "", ...first, ...(r.errors ?? []).map((e) => `- error: ${e}`), ...r.findings.map((f) => `- ${f}`), "");
}
fs.writeFileSync(path.join(out, "summary.md"), `${lines.join("\n")}\n`);
const failed = results.filter((r) => !r.ok || r.findings.some((f) => /validate failed|dry run failed|cannot run/.test(f))).length;
console.log(`\n${results.length - failed}/${results.length} 通过校验和预演 / passed validation and the dry run. ${path.join(out, "summary.md")}`);
