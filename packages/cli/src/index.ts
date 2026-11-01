#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  FLOW_FILE,
  FlowValidationError,
  HumanInputNeededError,
  LOCAL_FILE,
  MissingInputsError,
  UpstreamNotReadyError,
  doctor,
  effectiveProvider,
  globalProvidersFile,
  listRuns,
  loadFlow,
  loadProviders,
  providerKeyState,
  loadFlowInputs,
  resolveFlowInputs,
  renderSkillMd,
  resolveFlowDir,
  restoreRun,
  runAll,
  runStage,
  saveFlowInputs,
  stageStatus,
  statusAll,
  validateFlow,
  usageTokens,
  type Flow,
  type RunEvent,
  type RunOptions,
} from "@flowgit/core";
import { c, nextHint, statusBoard, table } from "./format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string }).version;

function parseKv(pairs: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const i = p.indexOf("=");
    if (i <= 0) throw new Error(`--input 要写成 key=value / --input expects key=value, got "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

/** Tokens the llm stages of this command used, for the closing total. */
const used = { input: 0, output: 0, calls: 0 };

/** One line with the total when more than one model call was made (each call already logs its own). */
function printUsageTotal(): void {
  if (used.calls < 2) return;
  console.log(c.dim(`用量合计 / total usage: ${used.input} 输入 input + ${used.output} 输出 output tokens（${used.calls} 次模型调用 / model calls）`));
}

function printEvent(e: RunEvent): void {
  switch (e.type) {
    case "stage:start":
      console.log(`${c.bold("▶")} ${e.stage.name} ${c.dim(`(${e.stage.id}, ${e.stage.executor.type})`)}`);
      break;
    case "stage:skip":
      console.log(`${c.dim("·")} ${e.stage.name} ${c.dim(`(${e.stage.id}) 跳过 / skipped: ${e.reason}`)}`);
      break;
    case "stage:log":
      console.log(c.dim(`    ${e.line}`));
      break;
    case "stage:done": {
      console.log(`${c.green("✓")} ${e.stage.name} ${c.dim(`→ runs/${e.stage.id}/${e.n}/`)}`);
      const tokens = usageTokens(e.record.params?.usage as Record<string, unknown> | undefined);
      if (tokens) {
        used.input += tokens.input;
        used.output += tokens.output;
        used.calls += 1;
      }
      break;
    }
    case "stage:error":
      console.log(`${c.red("✗")} ${e.stage.name} ${c.dim(`(${e.stage.id})`)}`);
      break;
  }
}

function fail(err: unknown): never {
  const e = err as Error;
  if (e instanceof HumanInputNeededError) {
    console.log(`\n${c.yellow("⏸")} 「${e.stage.name}」在等你 / waiting for you: ${e.missing.join(", ")}`);
    if (e.instructions) console.log(`  ${e.instructions}`);
    console.log(`  放好文件后运行 / when ready: flowgit run ${e.stage.id}   (或 / or: flowgit run ${e.stage.id} --from <path>)`);
    process.exit(2);
  }
  if (e instanceof UpstreamNotReadyError) {
    console.error(`${c.red("✗")} ${e.message}\n  先运行 / run first: ${e.missing.map((m) => `flowgit run ${m}`).join(", ")}`);
    process.exit(1);
  }
  if (e instanceof MissingInputsError) {
    console.error(`${c.red("✗")} 缺少流程输入 / missing flow inputs: ${e.missing.join(", ")}`);
    console.error(`  保存下来 / save it: flowgit inputs set ${e.missing[0]}=...`);
    console.error(`  只用这一次 / just this run: flowgit run <stage> --input ${e.missing[0]}=...`);
    process.exit(1);
  }
  if (e instanceof FlowValidationError) {
    console.error(`${c.red("✗")} ${e.message}`);
    process.exit(1);
  }
  console.error(`${c.red("✗")} ${e.message ?? String(err)}`);
  if (process.env.FLOWGIT_DEBUG && e.stack) console.error(e.stack);
  process.exit(1);
}

const program = new Command();
program
  .name("flowgit")
  .description("Flowgit: 万物皆可流程化。Turn anything into a visual, staged, forkable flow.")
  .version(VERSION)
  .option("-C, --dir <dir>", "流程目录（含 flow.json）/ flow directory (contains flow.json)", ".");

const dirOf = () => resolveFlowDir(program.opts<{ dir: string }>().dir);

const templatesDir = path.join(here, "..", "templates");
const DEFAULT_TEMPLATE = "short-video";

/** The templates installed with the CLI, from their flow.json files. */
function bundledTemplates(): { id: string; flow: Flow }[] {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir)
    .filter((id) => fs.existsSync(path.join(templatesDir, id, FLOW_FILE)))
    .sort((a, b) => (a === DEFAULT_TEMPLATE ? -1 : b === DEFAULT_TEMPLATE ? 1 : a.localeCompare(b)))
    .map((id) => ({ id, flow: JSON.parse(fs.readFileSync(path.join(templatesDir, id, FLOW_FILE), "utf8")) as Flow }));
}

program
  .command("init")
  .description("从模板新建流程（默认 short-video）/ create a new flow from a template (default: short-video)")
  .argument("[dir]", "目标目录 / target directory", ".")
  .option("-t, --template <name>", "模板名（flowgit templates 查看）或流程目录路径 / template name (see flowgit templates) or path to a flow directory", DEFAULT_TEMPLATE)
  .option("--force", "覆盖已有的 flow.json / overwrite an existing flow.json")
  .action((dir: string, opts: { template: string; force?: boolean }) => {
    const target = path.resolve(dir);
    const builtin = path.join(templatesDir, opts.template);
    const src = fs.existsSync(builtin) ? builtin : path.resolve(opts.template);
    if (!fs.existsSync(path.join(src, FLOW_FILE))) {
      const names = bundledTemplates().map((t) => t.id).join(", ");
      fail(new Error(`找不到模板 / Template not found: ${opts.template}\n  自带的模板 / bundled templates: ${names}（flowgit templates 查看说明 / see flowgit templates）`));
    }
    if (fs.existsSync(path.join(target, FLOW_FILE)) && !opts.force) {
      fail(new Error(`${path.join(target, FLOW_FILE)} 已存在，加 --force 覆盖 / already exists (use --force to overwrite)`));
    }
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(src, target, {
      recursive: true,
      filter: (p) => {
        const rel = path.relative(src, p).split(path.sep)[0];
        return !["runs", "node_modules", "flowgit.local.json"].includes(rel);
      },
    });
    console.log(`${c.green("✓")} 已创建流程 / created flow in ${target}`);
    // A short relative path when the flow is below the current folder, the full path otherwise.
    const rel = path.relative(process.cwd(), target);
    const shown = rel === "" ? "." : rel.startsWith("..") || path.isAbsolute(rel) ? target : rel;
    console.log(`  下一步 / next: cd ${/\s/.test(shown) ? `"${shown}"` : shown} && flowgit status`);
  });

program
  .command("templates")
  .description("列出自带的模板 / list the bundled templates")
  .option("--json", "输出 JSON / machine-readable output")
  .action((opts: { json?: boolean }) => {
    const list = bundledTemplates();
    if (opts.json) {
      console.log(
        JSON.stringify(
          list.map(({ id, flow }) => ({
            id,
            name: flow.name,
            description: flow.description ?? "",
            default: id === DEFAULT_TEMPLATE,
            stages: flow.stages.map((s) => ({ id: s.id, name: s.name, executor: s.executor.type })),
          })),
          null,
          2,
        ),
      );
      return;
    }
    const rows = [[c.dim("模板 template"), c.dim("名称 name"), c.dim("阶段 stages")]];
    for (const { id, flow } of list) {
      rows.push([`${id}${id === DEFAULT_TEMPLATE ? c.dim(" (默认 default)") : ""}`, flow.name, flow.stages.map((s) => `${s.name} ${c.dim(s.executor.type)}`).join(" → ")]);
    }
    console.log(table(rows));
    console.log(c.dim("\n用法 / usage: flowgit init <目录 dir> -t <模板 template>"));
  });

program
  .command("validate")
  .description("按规范检查 flow.json / check flow.json against the spec")
  .action(() => {
    const dir = dirOf();
    const file = path.join(dir, FLOW_FILE);
    if (!fs.existsSync(file)) fail(new Error(`${dir} 里没有 ${FLOW_FILE} / No ${FLOW_FILE} in ${dir}`));
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      fail(new Error(`${file} 不是合法的 JSON / is not valid JSON: ${(err as Error).message}`));
    }
    const issues = validateFlow(data, { dir });
    for (const i of issues) {
      const tag = i.level === "error" ? c.red("错误 error") : c.yellow("警告 warning");
      console.log(`${tag} ${i.path || "/"}: ${i.message}`);
    }
    const errors = issues.filter((i) => i.level === "error").length;
    if (errors) {
      console.log(`\n${c.red("✗")} ${errors} 个错误 / ${errors} error(s)`);
      process.exit(1);
    }
    console.log(`${c.green("✓")} ${FLOW_FILE} 符合规范 / is valid (spec v0.1)${issues.length ? `，${issues.length} 个警告 / ${issues.length} warning(s)` : ""}`);
  });

program
  .command("status")
  .description("看板：每个阶段的状态、最新版本、产物 / show every stage as a board: state, latest version, outputs")
  .option("--input <key=value>", "临时覆盖流程输入 / flow input override", collect)
  .option("--json", "输出 JSON / machine-readable output")
  .action((opts: { input?: string[]; json?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      let flowInputs: Record<string, unknown> = {};
      let missingInputs: string[] = [];
      try {
        flowInputs = loadFlowInputs(loaded.dir, loaded.flow, parseKv(opts.input));
      } catch (err) {
        if (!(err instanceof MissingInputsError)) throw err;
        missingInputs = err.missing;
        flowInputs = resolveFlowInputs(loaded.dir, loaded.flow, parseKv(opts.input));
      }
      const statuses = statusAll(loaded, flowInputs);
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              flow: { name: loaded.flow.name, version: loaded.flow.version, dir: loaded.dir },
              missingInputs,
              stages: statuses.map((s) => ({
                id: s.stage.id,
                name: s.stage.name,
                executor: s.stage.executor.type,
                state: s.state,
                runs: s.runs,
                latest: s.latest ? { n: s.latest.n, status: s.latest.status, finishedAt: s.latest.finishedAt } : null,
                missingUpstream: s.missingUpstream,
                outputs: s.stage.outputs,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`${c.bold(loaded.flow.name)} ${c.dim(`· ${FLOW_FILE} v${loaded.flow.version} · ${loaded.dir}`)}\n`);
      console.log(statusBoard(statuses));
      if (missingInputs.length) {
        console.log(`\n${c.yellow("!")} 还没填流程输入 / flow inputs not set: ${missingInputs.join(", ")}`);
        console.log(`  flowgit inputs set ${missingInputs[0]}=...`);
      } else {
        const hint = nextHint(statuses);
        if (hint) console.log(`\n${hint}`);
      }
    } catch (err) {
      fail(err);
    }
  });

const inputs = program.command("inputs").description("查看或填写流程输入（存在 flowgit.local.json）/ view or set flow inputs (stored in flowgit.local.json)");
inputs
  .command("show", { isDefault: true })
  .description("显示流程输入和当前值 / show flow inputs and their values")
  .action(() => {
    try {
      const loaded = loadFlow(dirOf());
      const values = resolveFlowInputs(loaded.dir, loaded.flow);
      const defs = loaded.flow.inputs ?? {};
      const rows = [[c.dim("名称 name"), c.dim("类型 type"), c.dim("值 value"), c.dim("说明 description")]];
      for (const [k, def] of Object.entries(defs)) {
        const v = values[k];
        const type = def.enum ? `${def.type} (${def.enum.join(" | ")})` : def.type;
        rows.push([`${k}${def.required ? c.red("*") : ""}`, type, v === undefined ? c.dim("(未填 unset)") : String(v), def.description ?? ""]);
      }
      console.log(Object.keys(defs).length ? table(rows) : "这个流程没有输入 / This flow has no inputs.");
    } catch (err) {
      fail(err);
    }
  });
inputs
  .command("set")
  .description("填写输入：flowgit inputs set topic=... duration=30 / set one or more inputs")
  .argument("<pairs...>", "key=value 键值对 / key=value pairs")
  .action((pairs: string[]) => {
    try {
      const loaded = loadFlow(dirOf());
      const kv = parseKv(pairs);
      const unknown = Object.keys(kv).filter((k) => !(loaded.flow.inputs ?? {})[k]);
      if (unknown.length) throw new Error(`没有这个输入 / Unknown input(s): ${unknown.join(", ")}`);
      saveFlowInputs(loaded.dir, kv);
      console.log(`${c.green("✓")} 已保存到 / saved to flowgit.local.json: ${Object.keys(kv).join(", ")}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("run")
  .description("运行一个阶段，或按顺序运行全部 / run one stage, or all stages in order")
  .argument("<stage>", '阶段 id 或 "all" / stage id, or "all"')
  .option("--input <key=value>", "临时覆盖流程输入，可重复 / flow input override (repeatable)", collect)
  .option("--from <path>", "人工阶段：作为产物的文件或文件夹，可重复 / human stage: file/dir to use as an output (repeatable, in output order)", collect)
  .option("--model <model>", "llm 阶段用的模型，可写 provider/model，如 glm/glm-5.3 / model for llm stages, optionally provider/model, e.g. glm/glm-5.3")
  .option("--force", "配合 all：已是最新的阶段也重跑 / with all: re-run stages that are already up to date")
  .action(async (stageId: string, opts: { input?: string[]; from?: string[]; model?: string; force?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      const options: RunOptions = {
        inputs: parseKv(opts.input),
        from: opts.from,
        model: opts.model,
        force: opts.force,
        onEvent: printEvent,
      };
      if (stageId === "all") {
        const records = await runAll(loaded, options);
        printUsageTotal();
        console.log(`\n${c.green("✓")} ${records.length ? `处理了 ${records.length} 个阶段 / ran ${records.length} stage(s)` : "没有要跑的，全部已是最新 / nothing to do, all stages up to date"}`);
      } else {
        await runStage(loaded, stageId, options);
        const flowInputs = loadFlowInputs(loaded.dir, loaded.flow, options.inputs);
        const hint = nextHint(statusAll(loaded, flowInputs));
        if (hint) console.log(`\n${hint}`);
      }
    } catch (err) {
      // run all can stop at a human stage after paying for model calls: still show what they used
      printUsageTotal();
      fail(err);
    }
  });

/** " · 19 tokens" for an llm run that reported usage. */
function tokenNote(usage: unknown): string {
  const t = usageTokens(usage as Record<string, unknown> | undefined);
  return t ? ` · ${t.input + t.output} tokens` : "";
}

program
  .command("log")
  .description("列出一个阶段的历史版本 / list the versions (runs) of a stage")
  .argument("<stage>", "阶段 id / stage id")
  .action((stageId: string) => {
    try {
      const loaded = loadFlow(dirOf());
      const status = stageStatus(loaded, stageId, (() => {
        try {
          return loadFlowInputs(loaded.dir, loaded.flow);
        } catch {
          return {};
        }
      })());
      const runs = listRuns(loaded.dir, stageId);
      console.log(`${c.bold(status.stage.name)} ${c.dim(`(${stageId}) · ${runs.length} 个版本 / run(s)`)}\n`);
      if (!runs.length) return;
      const rows = [[c.dim("版本 v"), c.dim("结果 status"), c.dim("完成时间 finished"), c.dim("执行 executor"), c.dim("详情 details")]];
      for (const r of [...runs].reverse()) {
        const p = r.params ?? {};
        const detail =
          r.status === "error"
            ? c.red((r.error ?? "").split("\n")[0].slice(0, 80))
            : r.executor === "llm"
              ? `${p.provider && p.provider !== "anthropic" ? `${p.provider}/` : ""}${p.model ?? ""}${p.durationMs ? ` · ${Math.round(Number(p.durationMs) / 1000)}s` : ""}${tokenNote(p.usage)}`
              : r.executor === "script"
                ? String(p.run ?? "")
                : r.executor === "agent"
                  ? `${p.agent ?? ""}${p.durationMs ? ` · ${Math.round(Number(p.durationMs) / 1000)}s` : ""}`
                  : String(p.provided ?? "");
        rows.push([`v${r.n}`, r.status === "ok" ? c.green("ok") : c.red("error"), r.finishedAt.replace("T", " ").slice(0, 19), r.executor, detail]);
      }
      console.log(table(rows));
      console.log(c.dim(`\n快照 / snapshots: runs/${stageId}/<n>/outputs/   回退 / restore: flowgit restore ${stageId} <n>`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("restore")
  .description("回退：把某个历史版本的产物放回原位 / put the outputs of an earlier version back in place")
  .argument("<stage>", "阶段 id / stage id")
  .argument("<n>", "版本号 / run number")
  .action((stageId: string, n: string) => {
    try {
      const loaded = loadFlow(dirOf());
      const run = restoreRun(loaded.dir, loaded.flow, stageId, Number(n));
      console.log(`${c.green("✓")} 已回退到 / restored ${stageId} v${run.n}: ${run.outputs.map((o) => o.path).join(", ")}`);
      console.log(c.dim("  下游阶段会显示为需重跑 / downstream stages will show as stale"));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("providers")
  .description("列出可用的模型供应商，以及密钥有没有设置 / list model providers and whether their keys are set")
  .option("--json", "输出 JSON / machine-readable output")
  .action((opts: { json?: boolean }) => {
    try {
      const dir = dirOf();
      const inFlow = fs.existsSync(path.join(dir, FLOW_FILE));
      const providers = Object.values(loadProviders(inFlow ? dir : undefined));
      const globalFile = globalProvidersFile();
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              files: { global: globalFile, flow: inFlow ? path.join(dir, LOCAL_FILE) : null },
              providers: providers.map((p) => ({
                id: p.id,
                protocol: p.protocol,
                baseUrl: effectiveProvider(p).baseUrl,
                apiKeyEnv: p.apiKeyEnv ?? null,
                key: providerKeyState(p),
                source: p.source,
                docs: p.docs ?? null,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }
      const sourceLabel = { preset: "预设 preset", global: "全局 global", flow: "本流程 flow" } as const;
      const rows = [[c.dim("provider"), c.dim("协议 protocol"), c.dim("地址 baseUrl"), c.dim("密钥 key"), c.dim("来源 source")]];
      for (const p of providers) {
        const state = providerKeyState(p);
        const key =
          state === "none"
            ? c.dim("不需要 not needed")
            : `${p.apiKeyEnv} ${state === "set" ? c.green("✓ 已设置 set") : c.yellow("✗ 未设置 not set")}`;
        rows.push([p.id, p.protocol, effectiveProvider(p).baseUrl, key, sourceLabel[p.source]]);
      }
      console.log(table(rows));
      console.log(c.dim(`\n全局配置 / global config: ${globalFile}${fs.existsSync(globalFile) ? "" : " （还没有 / not created yet）"}`));
      if (inFlow) console.log(c.dim(`本流程配置 / this flow: ${LOCAL_FILE} → providers`));
      console.log(c.dim("用法 / usage: 在 flow.json 的 model 或 --model 里写 provider/model / write provider/model in flow.json \"model\" or --model, e.g. glm/glm-5.3"));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("doctor")
  .description("检查这台电脑能不能跑这个流程：Node、流程输入、密钥、要用的命令和 agent / check this machine can run the flow: Node, inputs, keys, programs and agents")
  .option("--input <key=value>", "临时覆盖流程输入，可重复 / flow input override (repeatable)", collect)
  .option("--model <model>", "按这个模型检查 llm 阶段，同 run --model / check llm stages against this model, as with run --model")
  .option("--json", "输出 JSON / machine-readable output")
  .action((opts: { input?: string[]; model?: string; json?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      const checks = doctor(loaded, { inputs: parseKv(opts.input), model: opts.model });
      const errors = checks.filter((ch) => ch.level === "error").length;
      const warnings = checks.filter((ch) => ch.level === "warn").length;
      if (opts.json) {
        console.log(JSON.stringify({ ok: errors === 0, checks }, null, 2));
        if (errors) process.exitCode = 1;
        return;
      }
      console.log(`${c.bold(loaded.flow.name)} ${c.dim("· 检查运行环境 / checking what this flow needs")}\n`);
      for (const ch of checks) {
        const mark = ch.level === "ok" ? c.green("✓") : ch.level === "warn" ? c.yellow("!") : c.red("✗");
        console.log(`  ${mark} ${ch.stage ? `${ch.stage}: ` : ""}${ch.message}`);
        for (const line of ch.hint?.split("\n") ?? []) console.log(c.dim(`      ${line}`));
      }
      if (errors) {
        console.log(`\n${c.red("✗")} ${errors} 个问题要先解决 / ${errors} problem(s) to fix first`);
        process.exit(1);
      }
      console.log(`\n${c.green("✓")} 可以运行 / ready to run${warnings ? `（${warnings} 个提醒 / ${warnings} warning(s)）` : ""}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("export-skill")
  .description("生成 SKILL.md，让 AI 工具不用界面也能跑这个流程 / write a SKILL.md so AI agents can run this flow without the UI")
  .option("-o, --out <file>", "输出文件（\"-\" 表示打印出来）/ output file (\"-\" for stdout)", "SKILL.md")
  .action((opts: { out: string }) => {
    try {
      const loaded = loadFlow(dirOf());
      const md = renderSkillMd(loaded.flow);
      if (opts.out === "-") {
        process.stdout.write(md);
        return;
      }
      const file = path.resolve(loaded.dir, opts.out);
      fs.writeFileSync(file, md);
      console.log(`${c.green("✓")} 已写入 / wrote ${path.relative(process.cwd(), file) || file}`);
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv).catch(fail);
