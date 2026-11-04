#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Command, Help } from "commander";
import {
  FLOW_FILE,
  FLOW_MD_FILE,
  FlowNotFoundError,
  findFlowFile,
  readFlowFile,
  renderFlowText,
  writeFlowFile,
  FlowValidationError,
  addStage,
  promptSkeleton,
  removeStage,
  HumanInputNeededError,
  LOCAL_FILE,
  MissingInputsError,
  UpstreamNotReadyError,
  coerceFlowInput,
  doctor,
  findPrivateData,
  flowActions,
  flowFiles,
  flowInputProblem,
  flowToMermaid,
  effectiveProvider,
  globalProvidersFile,
  diffRuns,
  formatByteSize,
  listRuns,
  listMcpTools,
  listPlugins,
  loadFlow,
  loadProviders,
  providerKeyState,
  loadFlowInputs,
  flowLog,
  imageKeyState,
  imagePresetList,
  planModelCalls,
  planPrune,
  planRunAll,
  prune,
  resolveFlowInputs,
  renderSkillMd,
  resolveFlowDir,
  requireStage,
  restoreStage,
  runAll,
  runStage,
  runsDirBytes,
  runsPruneHint,
  saveFlowInputs,
  stageStatus,
  statusAll,
  TokenBudgetError,
  TrustNeededError,
  trustFlow,
  trustState,
  validateFlow,
  usageTokens,
  type FlowAction,
  type TrustState,
  type AddableStageType,
  type AgentName,
  type Finding,
  type Flow,
  type ForkedFrom,
  type LoadedFlow,
  type Output,
  type ValidationIssue,
  type PlanAction,
  type PlanStep,
  type OutputDiff,
  type RunDiff,
  type RunEvent,
  type RunRecord,
  type RunOptions,
} from "@flowgit/core";
import { openBrowser, parseOrigin, startBoard, WEB_APP_ORIGIN } from "@flowgit/web";
import { runBatch } from "./batch.js";
import { registerNew } from "./commands/new.js";
import { registerServeMcp } from "./commands/serve-mcp.js";
import { registerPublish } from "./commands/publish.js";
import { registerTest } from "./commands/test.js";
import { registerSite } from "./commands/site.js";
import { buildGallery } from "./gallery.js";
import { bilingualCliError, c, colorizeUnifiedDiff, nextHint, statusBoard, table, width } from "./format.js";
import { restoreProxyChild, routeThroughProxy } from "./proxy.js";
import { loadCommunityRegistry, splitGitFragment, type CommunityEntry } from "./registry.js";

restoreProxyChild();

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string }).version;

function parseRunConcurrency(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`并发必须是不小于 1 的整数，收到 "${raw}" / concurrency must be an integer of at least 1, got "${raw}"`);
  }
  return Number(raw);
}

function parseMaxTokens(raw: string): number {
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`--max-tokens 必须是不小于 0 的整数，收到 "${raw}" / --max-tokens must be an integer of at least 0, got "${raw}"`);
  }
  return Number(raw);
}

function parseKv(pairs: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const i = p.indexOf("=");
    if (i <= 0) throw new Error(`要写成 key=value，例如 topic=猫 / expected key=value, e.g. topic=cats, got "${p}"`);
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
/** "用量合计 / total usage: 12 输入 input + 7 输出 output tokens（2 次模型调用 / model calls）" */
function usageLine(label: string, t: { input: number; output: number; calls: number }): string {
  return `${label}: ${t.input} 输入 input + ${t.output} 输出 output tokens（${t.calls} 次模型调用 / model calls）`;
}

/** Add a run's model usage to the run-all total; a schema repair makes it two calls. */
function addUsage(params: Record<string, unknown> | undefined): void {
  const tokens = usageTokens(params?.usage as Record<string, unknown> | undefined);
  if (!tokens) return;
  used.input += tokens.input;
  used.output += tokens.output;
  used.calls += Array.isArray(params?.llmCalls) ? params.llmCalls.length : 1;
}

function printUsageTotal(gap = false): void {
  if (used.calls < 2) return;
  console.log(c.dim(`${gap ? "\n" : ""}${usageLine("用量合计 / total usage", used)}`));
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
      console.log(c.dim(`    [${e.stage.id}] ${e.line}`));
      break;
    case "stage:done": {
      console.log(`${c.green("✓")} ${e.stage.name} ${c.dim(`→ runs/${e.stage.id}/${e.n}/`)}`);
      addUsage(e.record.params);
      break;
    }
    case "stage:error":
      console.log(`${c.red("✗")} ${e.stage.name} ${c.dim(`(${e.stage.id})`)}`);
      // a failed stage can still have paid for model calls (e.g. a schema repair that didn't pass)
      addUsage(e.record?.params);
      break;
  }
}

function fail(err: unknown, ctx: { inputFlags?: string[] } = {}): never {
  const e = err as Error;
  // run all can stop (at a person, or on an error) after paying for model calls: end with what they used
  const exit = (code: number): never => {
    printUsageTotal(true);
    process.exit(code);
  };
  if (e instanceof HumanInputNeededError) {
    if (e.subflowStage) {
      console.log(`\n${c.yellow("⏸")} ${e.message}`);
      if (e.instructions) console.log(`  ${e.instructions}`);
      console.log(`  放好文件后重新运行 / when the file is in place: flowgit run ${e.stage.id}`);
    } else {
      console.log(`\n${c.yellow("⏸")} 「${e.stage.name}」在等你 / waiting for you: ${e.missing.join(", ")}`);
      if (e.instructions) console.log(`  ${e.instructions}`);
      console.log(`  放好文件后运行 / when ready: flowgit run ${e.stage.id}   (或 / or: flowgit run ${e.stage.id} --from <path>)`);
    }
    // --input lasts one run, so the command above would stop at "missing flow inputs".
    if (ctx.inputFlags?.length) {
      const pairs = ctx.inputFlags.map((kv) => (/\s/.test(kv) ? `"${kv}"` : kv)).join(" ");
      console.log(`  --input 只管这一次，先存下来再接着跑 / --input lasts one run; save it before you continue: flowgit inputs set ${pairs}`);
    }
    exit(2);
  }
  if (e instanceof FlowNotFoundError) {
    console.error(`${c.red("✗")} ${e.message}`);
    console.error(`  新建一个 / create one: flowgit init <目录 dir>`);
    console.error(`  已经有了 / have one: 先 cd 进流程目录，或者加 / cd into it, or add: -C <流程目录 flow dir>`);
    return exit(1);
  }
  if (e instanceof TrustNeededError) {
    console.error(`${c.red("✗")} ${e.message}`);
    console.error(`  也可以在 run 后面加 --yes，确认并运行 / or add --yes to run to confirm and run`);
    return exit(1);
  }
  if (e instanceof UpstreamNotReadyError) {
    console.error(`${c.red("✗")} ${e.message}\n  先运行 / run first: ${e.missing.map((m) => `flowgit run ${m}`).join(", ")}`);
    exit(1);
  }
  if (e instanceof MissingInputsError) {
    console.error(`${c.red("✗")} 缺少流程输入 / missing flow inputs: ${e.missing.join(", ")}`);
    console.error(`  保存下来 / save it: flowgit inputs set ${e.missing[0]}=...`);
    console.error(`  只用这一次 / just this run: flowgit run <stage> --input ${e.missing[0]}=...`);
    exit(1);
  }
  if (e instanceof FlowValidationError) {
    console.error(`${c.red("✗")} ${e.message}`);
    exit(1);
  }
  console.error(`${c.red("✗")} ${e.message ?? String(err)}`);
  if (process.env.FLOWGIT_DEBUG && e.stack) console.error(e.stack);
  return exit(1);
}

/** Commander's built-in help headings, bilingual like everything else. */
const HELP_TITLES: Record<string, string> = {
  "Usage:": "用法 / Usage:",
  "Arguments:": "参数 / Arguments:",
  "Options:": "选项 / Options:",
  "Commands:": "命令 / Commands:",
  "Global Options:": "全局选项 / Global Options:",
};
const bilingualDefault = (s: string) => s.replace(/\(default: /g, "(默认 / default: ");

function parseRunArg(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`版本号必须是正整数，收到 "${raw}" / Version must be a positive integer, got "${raw}"`);
  }
  return Number(raw);
}

function formatOutputDiff(out: OutputDiff): string {
  if (out.kind === "text") {
    if (out.same) return `${c.bold(out.path)}\n${c.dim("  相同 / same")}`;
    return `${c.bold(out.path)}\n${colorizeUnifiedDiff(out.diff).replace(/\n$/, "")}`;
  }
  if (out.kind === "binary") {
    const label = out.same ? c.dim("二进制相同 / binary same") : c.yellow("二进制不同 / binary differs");
    return `${c.bold(out.path)}  ${label}`;
  }
  const lines = [c.bold(`${out.path}/`)];
  if (out.same) lines.push(c.dim("  文件夹相同 / directory same"));
  else {
    if (out.added.length) lines.push(`  ${c.green("新增 / added")}: ${out.added.join(", ")}`);
    if (out.removed.length) lines.push(`  ${c.red("删除 / removed")}: ${out.removed.join(", ")}`);
    if (out.changed.length) lines.push(`  ${c.yellow("改动 / changed")}: ${out.changed.join(", ")}`);
  }
  return lines.join("\n");
}

function formatRunDiff(diff: RunDiff, stageName: string): string {
  const right = diff.b === null ? "当前文件 current" : `v${diff.b}`;
  const body = diff.outputs.map(formatOutputDiff).join("\n\n");
  return `${c.bold(stageName)} ${c.dim(`(${diff.stage})`)}  v${diff.a} → ${right}\n\n${body}`;
}

const program = new Command();
program
  // set before any subcommand is added, so every subcommand inherits them
  .configureOutput({ outputError: (str, write) => write(bilingualCliError(str)) })
  .configureHelp({
    styleTitle: (title) => HELP_TITLES[title] ?? title,
    // CJK characters take two columns, so help text wraps where it should
    displayWidth: width,
    optionDescription(option) {
      return bilingualDefault(Help.prototype.optionDescription.call(this, option));
    },
    argumentDescription(argument) {
      return bilingualDefault(Help.prototype.argumentDescription.call(this, argument));
    },
  })
  .helpOption("-h, --help", "显示帮助 / show help")
  .helpCommand("help [command]", "显示某个命令的帮助 / show help for a command")
  .name("flowgit")
  .description("Flowgit: 万物皆可流程化。Turn anything into a visual, staged, forkable flow.")
  .version(VERSION, "-V, --version", "显示版本号 / show the version number")
  .option("-C, --dir <dir>", "流程目录（含 flow.json 或 flow.md）/ flow directory (contains flow.json or flow.md)", ".");

// run, batch, board, serve and test (--live) call models and services: send those through the user's proxy, if there is one.
program.hook("preAction", async (_program, action) => {
  if (!["run", "batch", "board", "serve", "test"].includes(action.name())) return;
  const code = await routeThroughProxy();
  if (code !== undefined) process.exit(code);
});

const dirOf = () => resolveFlowDir(program.opts<{ dir: string }>().dir);

const templatesDir = path.join(here, "..", "templates");
const DEFAULT_TEMPLATE = "short-video";

/** The flow file (flow.json or flow.md) in dir, or undefined; never throws. */
function flowFileIn(dir: string): string | undefined {
  try {
    return findFlowFile(dir);
  } catch {
    return path.join(dir, FLOW_FILE);
  }
}

/** The templates installed with the CLI, from their flow files. */
function bundledTemplates(): { id: string; flow: Flow }[] {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir)
    .filter((id) => flowFileIn(path.join(templatesDir, id)))
    .sort((a, b) => (a === DEFAULT_TEMPLATE ? -1 : b === DEFAULT_TEMPLATE ? 1 : a.localeCompare(b)))
    .map((id) => ({ id, flow: readFlowFile(findFlowFile(path.join(templatesDir, id))!) as Flow }));
}

function isGitUrl(source: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(source);
}

/** A bundled template name, not a path and not a Git URL. */
function bundledDir(name: string): string | undefined {
  if (!name || name.includes("/") || name.includes("\\") || isGitUrl(name)) return undefined;
  const dir = path.join(templatesDir, name);
  return flowFileIn(dir) ? dir : undefined;
}

/**
 * The URL without credentials, safe to print and to store in flow.json.
 * https://TOKEN@host/... and https://user:pass@host/... lose the user info; ssh:// keeps the user name but not a password.
 */
function publicGitUrl(url: string): string {
  if (!/^(https?|ssh):\/\//.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.protocol === "ssh:") u.password = "";
    else {
      u.username = "";
      u.password = "";
    }
    return u.href;
  } catch {
    return url;
  }
}

function gitMissing(): Error {
  return new Error(
    [
      "没有找到 git。请先安装 Git：https://git-scm.com/downloads",
      "Git was not found. Install it from https://git-scm.com/downloads",
      "  Windows: winget install Git.Git",
      "  macOS: brew install git",
      "  Debian/Ubuntu: sudo apt install git",
    ].join("\n"),
  );
}

function runGit(args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string; missing: boolean } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    missing: !!r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT",
  };
}

/** git clone --depth 1 into a temp directory. Caller deletes it. */
function cloneFlowRepo(url: string, ref?: string): { dir: string; commit: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-clone-"));
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push("--", url, dir);
  const cloned = runGit(args);
  if (cloned.missing) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw gitMissing();
  }
  if (cloned.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    const detail = (cloned.stderr || cloned.stdout).trim();
    throw new Error(`克隆失败 / clone failed: ${publicGitUrl(url)}${ref ? ` (${ref})` : ""}${detail ? `\n${detail}` : ""}`);
  }
  const rev = runGit(["rev-parse", "HEAD"], dir);
  if (rev.missing || rev.status !== 0 || !rev.stdout.trim()) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (rev.missing) throw gitMissing();
    throw new Error(`读不到提交号 / could not read the commit: ${(rev.stderr || rev.stdout).trim()}`);
  }
  return { dir, commit: rev.stdout.trim() };
}

function copyListed(src: string, target: string, rels: string[]): void {
  for (const rel of rels) {
    const from = path.join(src, ...rel.split("/"));
    const to = path.join(target, ...rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/** Declared outputs that exist in the source, so we can say they were skipped. */
function presentOutputs(src: string, flow: Flow): string[] {
  const found: string[] = [];
  for (const stage of flow.stages ?? []) {
    for (const out of stage.outputs ?? []) {
      const rel = out.path.replace(/\\/g, "/").replace(/\/+$/, "");
      if (rel && fs.existsSync(path.join(src, ...rel.split("/")))) found.push(out.path);
    }
  }
  return found;
}

function readSourceFlow(file: string): Flow {
  const data = readFlowFile(file);
  if (!data || typeof data !== "object" || !Array.isArray((data as Flow).stages)) {
    throw new Error(`${file} 不是一个流程 / is not a flow`);
  }
  return data as Flow;
}

/** Resolve an --out file in the flow directory, refusing the flow file's own names. */
function notFlowFile(dir: string, out: string): string {
  const file = path.resolve(dir, out);
  if (path.dirname(file) === path.resolve(dir) && [FLOW_FILE, FLOW_MD_FILE].includes(path.basename(file))) {
    throw new Error(`${path.basename(file)} 是流程文件的名字，换一个文件名，例如 graph.md / ${path.basename(file)} is the flow file's name; pick another, e.g. graph.md`);
  }
  return file;
}

type FlowFormat = "json" | "md";

function parseFormat(value: string | undefined): FlowFormat | undefined {
  if (value === undefined) return undefined;
  if (value === "json" || value === "md") return value;
  fail(new Error(`格式只能是 json 或 md，收到 "${value}" / format must be json or md, got "${value}"`));
}

const formatFile = (format: FlowFormat) => (format === "md" ? FLOW_MD_FILE : FLOW_FILE);

/**
 * Rewrite dir's flow file in the other format and remove the old one.
 * The new text must read back as the same flow before the old file goes.
 */
function convertFlowFile(dir: string, to: FlowFormat): { from: string; to: string } | undefined {
  const from = findFlowFile(dir);
  if (!from) throw new FlowNotFoundError(dir);
  const target = path.join(dir, formatFile(to));
  if (from === target) return undefined;
  const flow = readSourceFlow(from);
  const text = renderFlowText(flow, target);
  fs.writeFileSync(target, text);
  try {
    if (!isDeepStrictEqual(readFlowFile(target), flow)) {
      throw new Error(`转换后内容不一致，没有改动 / the converted file does not read back the same; nothing was changed`);
    }
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw err;
  }
  fs.rmSync(from);
  return { from: path.basename(from), to: path.basename(target) };
}

/** One line per command, agent, service, MCP server, plugin or sub-flow. */
function printActionRows(actions: FlowAction[]): void {
  const width = Math.max(...actions.map((a) => a.stage.length));
  for (const a of actions) {
    const env = a.env?.length
      ? a.kind === "mcp"
        ? `  · 环境变量 / env: ${a.env.join(", ")}`
        : `  · 请求头里带上 / sends in headers: ${a.env.join(", ")}`
      : "";
    console.log(`  ${a.kind.padEnd(8)} ${a.stage.padEnd(width)}  ${a.detail}${env}`);
  }
}

/** For a flow copied from somewhere else: the commands it runs, the agents it starts, the services it calls, the MCP servers it starts and the plugins it loads. */
function printActions(flow: Flow, dir: string): FlowAction[] {
  const actions = flowActions(flow, dir);
  if (!actions.length) return actions;
  console.log(`${c.yellow("!")} 运行前请看一眼，这个流程会在你的电脑上做这些事 / Before you run it, look at what this flow does on your computer:`);
  printActionRows(actions);
  return actions;
}

/** What a copied flow would be confirmed for. */
function printTrustList(state: TrustState): void {
  console.log(
    state.reason === "changed"
      ? `${c.yellow("!")} 这个流程要运行的命令和你上次确认的不一样了，现在是 / This flow's commands changed since you confirmed them. Now it does:`
      : `${c.yellow("!")} 这个流程是从 ${state.source ?? "?"} 复制来的，会在你的电脑上做这些事 / This flow was copied from ${state.source ?? "?"} and does this on your computer:`,
  );
  printActionRows(state.actions);
}

const TRUST_REMEMBERED = "已确认。命令不变就不会再问 / Confirmed. You won't be asked again unless the commands change.";

/**
 * Before a run: a flow copied from a Git URL that hasn't been confirmed on this computer
 * shows what it does and asks once. --yes confirms without asking; with no terminal to
 * ask in, it stops and says how to confirm.
 */
async function ensureTrusted(loaded: LoadedFlow, yes?: boolean): Promise<void> {
  const state = trustState(loaded);
  if (!state.needed) return;
  printTrustList(state);
  if (!yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new TrustNeededError(loaded, state);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answer = "";
    try {
      answer = (await rl.question("确认后运行吗？/ Confirm and run? [y/N] ")).trim().toLowerCase();
    } catch {
      // input closed (Ctrl+D): treat as no
    } finally {
      rl.close();
    }
    if (!["y", "yes", "是"].includes(answer)) throw new Error("没有确认，什么都没运行 / Not confirmed; nothing ran");
  }
  trustFlow(loaded, state.fingerprint);
  console.log(`${c.green("✓")} ${TRUST_REMEMBERED}\n`);
}

// Two lines rather than `cd … && flowgit status`: Windows PowerShell 5.1 has no `&&`.
function nextStepLine(target: string): string {
  const rel = path.relative(process.cwd(), target);
  const shown = rel === "" ? "." : rel.startsWith("..") || path.isAbsolute(rel) ? target : rel;
  return `  下一步 / next:\n    cd ${/\s/.test(shown) ? `"${shown}"` : shown}\n    flowgit status`;
}

/** A community id becomes its Git URL. Bundled names, Git URLs and real directories stay as they are. */
async function resolveCommunityTemplate(template: string): Promise<{ template: string; entry?: CommunityEntry; note?: string; ids: string[] }> {
  if (bundledDir(template) || isGitUrl(template) || path.isAbsolute(template) || template.includes("/") || template.includes("\\") || fs.existsSync(path.resolve(template))) {
    return { template, ids: [] };
  }
  const loaded = await loadCommunityRegistry();
  if (!loaded.ok) return { template, note: loaded.note, ids: [] };
  const entry = loaded.entries.find((item) => item.id === template);
  if (!entry) return { template, ids: loaded.entries.map((item) => item.id) };
  return { template: entry.git, entry, ids: [] };
}

program
  .command("init")
  .description("从模板、社区模板、本地目录或 Git 地址新建流程（默认 short-video）/ create a flow from a template, a community template, a local directory or a Git URL (default: short-video)")
  .argument("[dir]", "目标目录 / target directory", ".")
  .option("-t, --template <name>", "模板、目录或 Git 地址 / template, directory or Git URL", DEFAULT_TEMPLATE)
  .option("--ref <ref>", "Git 分支或标签 / Git branch or tag")
  .option("--path <subdir>", "仓库里的子目录；也可以写在地址末尾 #path=子目录 / subdirectory inside the repo, or #path=<subdir> on the URL")
  .option("--with-outputs", "连产物一起复制 / also copy stage outputs")
  .option("--format <format>", "流程文件写成 json（flow.json）还是 md（flow.md），默认跟来源一样 / write the flow file as json (flow.json) or md (flow.md); defaults to the source's format")
  .option("--force", "覆盖已有的流程文件 / overwrite an existing flow file")
  .action(async (dir: string, opts: { template: string; ref?: string; path?: string; withOutputs?: boolean; format?: string; force?: boolean }) => {
    const target = path.resolve(dir);
    const format = parseFormat(opts.format);
    const existing = [FLOW_FILE, FLOW_MD_FILE].map((f) => path.join(target, f)).filter((f) => fs.existsSync(f));
    if (existing.length && !opts.force) {
      fail(new Error(`${existing[0]} 已存在，加 --force 覆盖 / already exists (use --force to overwrite)`));
    }
    /** After the copy: drop a leftover flow file in the other format (--force), then convert if asked. */
    const finish = (copied: string) => {
      try {
        for (const name of [FLOW_FILE, FLOW_MD_FILE]) {
          if (name !== copied && fs.existsSync(path.join(target, name))) fs.rmSync(path.join(target, name));
        }
        if (!format) return;
        convertFlowFile(target, format);
      } catch (err) {
        fail(err);
      }
    };
    const builtin = bundledDir(opts.template);
    if (builtin) {
      if (opts.ref || opts.path) fail(new Error(`--ref 和 --path 只用于 Git 地址 / --ref and --path are only for a Git URL`));
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(builtin, target, {
        recursive: true,
        filter: (p) => {
          const rel = path.relative(builtin, p).split(path.sep)[0];
          return !["runs", "node_modules", "flowgit.local.json", ".flowgit"].includes(rel);
        },
      });
      finish(path.basename(findFlowFile(builtin)!));
      console.log(`${c.green("✓")} 已创建流程 / created flow in ${target}`);
      console.log(nextStepLine(target));
      return;
    }

    const resolved = await resolveCommunityTemplate(opts.template);
    const template = resolved.template;
    const ref = opts.ref ?? resolved.entry?.ref;
    const split = splitGitFragment(template);
    if (split.path === "") fail(new Error(`#path= 后面要写子目录 / #path= needs a subdirectory`));
    if (opts.path && split.path && opts.path !== split.path) {
      fail(new Error(`--path 和地址里的 #path= 不一致：「${opts.path}」和「${split.path}」 / --path and #path= in the URL disagree: "${opts.path}" and "${split.path}"`));
    }
    const pathInRepo = opts.path ?? split.path;
    if ((ref || pathInRepo) && !isGitUrl(split.url)) {
      fail(new Error(`--ref 和 --path 只用于 Git 地址 / --ref and --path are only for a Git URL`));
    }

    let src = "";
    let cleanup: string | undefined;
    let forked: ForkedFrom | undefined;
    try {
      try {
        if (isGitUrl(split.url)) {
          const cloned = cloneFlowRepo(split.url, ref);
          cleanup = cloned.dir;
          src = path.resolve(cloned.dir, pathInRepo ?? ".");
          // Resolve symlinks too, so a link in the repository can't point --path or #path= outside it.
          const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : p);
          const escaped = path.relative(real(cloned.dir), real(src));
          if (escaped.startsWith("..") || path.isAbsolute(escaped)) {
            throw new Error(`--path 必须在仓库里面 / --path must stay inside the repository`);
          }
          forked = { source: publicGitUrl(split.url), ...(ref ? { ref } : {}), commit: cloned.commit };
        } else {
          src = path.resolve(split.url);
        }
        const srcFile = findFlowFile(src);
        if (!srcFile) {
          const names = bundledTemplates().map((t) => t.id).join(", ");
          const where = pathInRepo ? `${template} (${pathInRepo})` : template;
          const lines = [`找不到流程 / Flow not found: ${where}`];
          if (resolved.note) lines.push(`  ${resolved.note}`);
          lines.push(`  自带的模板 / bundled templates: ${names}（flowgit templates 查看说明 / see flowgit templates）`);
          if (resolved.ids.length) lines.push(`  社区模板 / community templates: ${resolved.ids.join(", ")}（flowgit templates --all）`);
          throw new Error(lines.join("\n"));
        }
        const sourceFlow = readSourceFlow(srcFile);
        const withOutputs = !!opts.withOutputs;
        const rels = flowFiles({ dir: src, file: srcFile, flow: sourceFlow }, { withOutputs });
        fs.mkdirSync(target, { recursive: true });
        copyListed(src, target, rels);
        if (forked) {
          const file = path.join(target, path.basename(srcFile));
          const flow = readSourceFlow(file);
          flow.forkedFrom = forked;
          writeFlowFile(file, flow);
        }
        finish(path.basename(srcFile));
        const skipped = withOutputs ? [] : presentOutputs(src, sourceFlow);
        const shown = isGitUrl(split.url) ? publicGitUrl(split.url) : opts.template;
        console.log(`${c.green("✓")} 已创建流程 / created flow in ${target}`);
        console.log(`  来源 / source: ${shown}${pathInRepo ? ` (${pathInRepo})` : ""}`);
        if (resolved.entry) console.log(`  社区模板 / community template: ${resolved.entry.id}`);
        console.log(`  复制了 ${rels.length} 个文件 / copied ${rels.length} file(s)`);
        console.log(skipped.length ? `  跳过的产物 / skipped outputs: ${skipped.join(", ")}` : `  没有跳过产物 / no outputs skipped`);
        const actions = printActions(sourceFlow, src);
        if (forked && actions.length) {
          console.log(c.dim("  第一次运行前会请你确认这些，也可以先运行 flowgit trust / the first run asks you to confirm these; or run flowgit trust first"));
        }
        console.log(nextStepLine(target));
      } finally {
        if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
      }
    } catch (err) {
      fail(err);
    }
  });

const FINDING_LABEL: Record<string, string> = {
  "sk-key": "sk- 密钥 / sk- key",
  "aws-key": "AWS 密钥 / AWS key",
  "github-token": "GitHub 令牌 / GitHub token",
  "slack-token": "Slack 令牌 / Slack token",
  "private-key": "私钥 / private key",
  "google-key": "Google API 密钥 / Google API key",
  "bearer-token": "Bearer 令牌 / bearer token",
  "url-credentials": "地址里的账号密码 / credentials in a URL",
  "secret-assignment": "密钥赋值 / secret assignment",
  email: "邮箱 / email",
  "local-path": "本机路径 / local path",
};

function formatFinding(finding: Finding): string {
  return `  ${finding.file}:${finding.line}  ${FINDING_LABEL[finding.kind] ?? finding.kind}  ${finding.preview}`;
}

program
  .command("share")
  .description("复制一份可以分享的流程，先检查密钥、邮箱和本机路径 / copy a flow that is safe to share, after checking for keys, emails and local paths")
  .argument("<dir>", "输出目录 / output directory")
  .option("--with-outputs", "连产物一起复制 / also copy stage outputs")
  .option("--force", "输出目录不是空的也写入 / write even if the output directory is not empty")
  .action((dir: string, opts: { withOutputs?: boolean; force?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      const target = path.resolve(dir);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory() && fs.readdirSync(target).length > 0 && !opts.force) {
        fail(new Error(`${target} 不是空目录，加 --force 才会写入 / is not empty, pass --force to write anyway`));
      }
      if (path.relative(loaded.dir, target) === "") {
        fail(new Error(`输出目录不能是流程目录本身 / the output directory can't be the flow directory itself`));
      }
      // A share folder inside the flow (e.g. "flowgit share dist") is never copied into itself.
      const inside = path.relative(loaded.dir, target).split(path.sep).join("/");
      const nested = !inside.startsWith("..") && !path.isAbsolute(inside);
      const rels = flowFiles(loaded, { withOutputs: !!opts.withOutputs }).filter((f) => !nested || (f !== inside && !f.startsWith(`${inside}/`)));
      const findings = findPrivateData(loaded.dir, rels);
      const high = findings.filter((f) => f.severity === "high");
      if (high.length) {
        console.error(`${c.red("✗")} 发现可能的密钥，没有写入任何文件 / Found possible secrets, nothing was written`);
        for (const finding of high) console.error(formatFinding(finding));
        process.exit(1);
      }
      const medium = findings.filter((f) => f.severity === "medium");
      fs.mkdirSync(target, { recursive: true });
      copyListed(loaded.dir, target, rels);
      const skipped = opts.withOutputs ? [] : presentOutputs(loaded.dir, loaded.flow);
      if (medium.length) {
        console.log(`${c.yellow("!")} 这些内容请你自己看一眼 / Please look at these yourself:`);
        for (const finding of medium) console.log(formatFinding(finding));
      }
      console.log(`${c.green("✓")} 已写到 / wrote ${target}`);
      console.log(`  复制了 ${rels.length} 个文件 / copied ${rels.length} file(s)`);
      console.log(`  永远不会复制 / never copied: runs/、flowgit.local.json、.env*、.flowgit/`);
      console.log(skipped.length ? `  跳过的产物 / skipped outputs: ${skipped.join(", ")}` : `  没有跳过产物 / no outputs skipped`);
      console.log(`  下一步 / next: 在这个目录里 git init，提交后推到 GitHub / in that directory, git init, commit, and push it to GitHub`);
    } catch (err) {
      fail(err);
    }
  });

function bundledTemplateJson(list: { id: string; flow: Flow }[]) {
  return list.map(({ id, flow }) => ({
    id,
    name: flow.name,
    description: flow.description ?? "",
    default: id === DEFAULT_TEMPLATE,
    stages: flow.stages.map((s) => ({ id: s.id, name: s.name, executor: s.executor.type })),
  }));
}

program
  .command("templates")
  .description("列出自带的模板；--all 连社区模板 / list the bundled templates; --all adds community templates")
  .option("--json", "输出 JSON / machine-readable output")
  .option("--all", "连社区模板一起列出 / also list community templates")
  .action(async (opts: { json?: boolean; all?: boolean }) => {
    const list = bundledTemplates();
    const loaded = opts.all ? await loadCommunityRegistry() : undefined;
    const community = loaded?.ok ? loaded.entries : [];
    const note = loaded && !loaded.ok ? loaded.note : undefined;
    if (opts.json) {
      console.log(
        opts.all
          ? JSON.stringify(
              {
                bundled: bundledTemplateJson(list).map((item) => ({ ...item, source: "bundled" })),
                community: community.map((entry) => ({ ...entry, source: "community" })),
                ...(note ? { note } : {}),
              },
              null,
              2,
            )
          : JSON.stringify(bundledTemplateJson(list), null, 2),
      );
      return;
    }
    const rows = [[c.dim("模板 template"), c.dim("名称 name"), c.dim("阶段 stages")]];
    for (const { id, flow } of list) {
      rows.push([`${id}${id === DEFAULT_TEMPLATE ? c.dim(" (默认 default)") : ""}`, flow.name, flow.stages.map((s) => `${s.name} ${c.dim(s.executor.type)}`).join(" → ")]);
    }
    console.log(table(rows));
    if (community.length) {
      const communityRows = [[c.dim("模板 template"), c.dim("名称 name"), c.dim("地址 git")]];
      for (const entry of community) communityRows.push([entry.id, entry.name.zh, entry.git]);
      console.log(`\n${c.bold("社区模板 / community templates")}`);
      console.log(table(communityRows));
    }
    if (note) console.log(`\n${note}`);
    console.log(c.dim(`\n用法 / usage: flowgit init <目录 dir> -t <模板 template>${opts.all ? "" : "    flowgit templates --all"}`));
  });

program
  .command("validate")
  .description("按规范检查 flow.json 或 flow.md / check flow.json or flow.md against the spec")
  .action(() => {
    const dir = dirOf();
    let file: string | undefined;
    let data: unknown;
    try {
      file = findFlowFile(dir);
      if (!file) throw new FlowNotFoundError(dir);
      data = readFlowFile(file);
    } catch (err) {
      fail(err);
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
    console.log(`${c.green("✓")} ${path.basename(file!)} 符合规范 / is valid (spec v0.1)${issues.length ? `，${issues.length} 个警告 / ${issues.length} warning(s)` : ""}`);
  });

const STAGE_TYPES = ["human", "llm", "script", "agent"] as const;
const AGENT_NAMES = ["claude-code", "codex", "cursor", "gemini", "custom"] as const;

function outputFromPath(p: string): Output {
  const normalized = p.replace(/\\/g, "/");
  if (normalized.endsWith("/")) return { type: "dir", path: normalized };
  const ext = path.extname(normalized).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return { type: "text/markdown", path: normalized };
  if (ext === ".json") return { type: "application/json", path: normalized };
  if (ext === ".txt") return { type: "text/plain", path: normalized };
  if (ext === ".html" || ext === ".htm") return { type: "text/html", path: normalized };
  return { type: "application/octet-stream", path: normalized };
}

function readFlowRaw(dir: string): { file: string; flow: Flow } {
  let file: string | undefined;
  try {
    file = findFlowFile(dir);
    if (!file) throw new FlowNotFoundError(dir);
    return { file, flow: readSourceFlow(file) };
  } catch (err) {
    fail(err);
  }
}

/** Write back in the file's own format: flow.md stays flow.md. */
function writeFlowRaw(file: string, flow: Flow): void {
  writeFlowFile(file, flow);
}

function printFlowIssues(issues: ValidationIssue[]): void {
  for (const i of issues) {
    const tag = i.level === "error" ? c.red("错误 error") : c.yellow("警告 warning");
    console.log(`${tag} ${i.path || "/"}: ${i.message}`);
  }
}

const stageCmd = program.command("stage").description("加或删一个阶段 / add or remove a stage");

stageCmd
  .command("add")
  .description("加一个阶段 / add a stage")
  .argument("<id>", "阶段 id（小写字母开头）/ stage id (starts with a lowercase letter)")
  .requiredOption("--type <type>", "human、llm、script 或 agent / human, llm, script or agent")
  .option("--name <name>", "显示名称，默认用 id / display name, defaults to the id")
  .option("--after <stage>", "插在这个阶段后面；不写就加在最后 / insert after this stage; omit to append")
  .option("--input <stage>", "上游阶段，可重复；不写就用它前面那个 / upstream stage (repeatable); omit to use the stage before it", collect)
  .option("--output <path>", "产物路径，可重复 / output path (repeatable)", collect)
  .option("--prompt <file>", "提示词文件（llm、agent）/ prompt file (llm, agent)")
  .option("--run <command>", "要执行的命令（script）/ command to run (script)")
  .option("--agent <name>", "agent 名字，默认 claude-code / agent name, default claude-code")
  .action((id: string, opts: { type: string; name?: string; after?: string; input?: string[]; output?: string[]; prompt?: string; run?: string; agent?: string }) => {
    try {
      if (!STAGE_TYPES.includes(opts.type as AddableStageType)) {
        fail(new Error(`--type 只能是 human、llm、script、agent，收到 "${opts.type}" / --type must be human, llm, script or agent, got "${opts.type}"`));
      }
      if (opts.agent && !AGENT_NAMES.includes(opts.agent as AgentName)) {
        fail(new Error(`--agent 只能是 ${AGENT_NAMES.join("、")}，收到 "${opts.agent}" / --agent must be one of ${AGENT_NAMES.join(", ")}, got "${opts.agent}"`));
      }
      const dir = dirOf();
      const { file, flow } = readFlowRaw(dir);
      const type = opts.type as AddableStageType;
      const next = addStage(flow, {
        id,
        type,
        name: opts.name,
        after: opts.after,
        inputs: opts.input,
        outputs: opts.output?.map(outputFromPath),
        prompt: opts.prompt,
        run: opts.run,
        agent: opts.agent as AgentName | undefined,
      });
      const creating = !opts.prompt && (type === "llm" || type === "agent") ? `prompts/${id}.md` : undefined;
      const promptAbs = creating ? path.join(dir, creating) : undefined;
      const willCreate = !!creating && !!promptAbs && !fs.existsSync(promptAbs);
      const issues = validateFlow(next, { dir });
      const errors = issues.filter((i) => {
        if (i.level !== "error") return false;
        return !(willCreate && creating && i.path.endsWith("/executor/prompt") && i.message.includes(creating));
      });
      if (errors.length) {
        printFlowIssues(errors);
        console.error(`\n${c.red("✗")} 没有改任何文件 / nothing was written`);
        process.exit(1);
      }
      const warnings = issues.filter((i) => i.level === "warning");
      if (warnings.length) printFlowIssues(warnings);
      let created: string | undefined;
      try {
        if (willCreate && creating && promptAbs) {
          fs.mkdirSync(path.dirname(promptAbs), { recursive: true });
          const inputKey = Object.keys(flow.inputs ?? {})[0] ?? "name";
          fs.writeFileSync(promptAbs, promptSkeleton(id, inputKey), { flag: "wx" });
          created = promptAbs;
        }
        writeFlowRaw(file, next);
      } catch (err) {
        if (created) fs.rmSync(created, { force: true });
        throw err;
      }
      const where = opts.after ? `，在 ${opts.after} 之后 / after ${opts.after}` : "，加在最后 / at the end";
      console.log(`${c.green("✓")} 已添加阶段 / added stage ${id} (${type})${where}`);
      if (willCreate && creating) console.log(`  已创建提示词 / created prompt ${creating}`);
      else if (creating) console.log(`  提示词已存在，没有覆盖 / prompt already exists, left it as is: ${creating}`);
      console.log(`  下一步 / next: flowgit status`);
    } catch (err) {
      fail(err);
    }
  });

stageCmd
  .command("rm")
  .description("删一个阶段（不删文件）/ remove a stage (keeps its files)")
  .argument("<id>", "阶段 id / stage id")
  .option("--force", "被别的阶段依赖时，一并去掉那些引用 / also drop references when other stages depend on it")
  .action((id: string, opts: { force?: boolean }) => {
    try {
      const dir = dirOf();
      const { file, flow } = readFlowRaw(dir);
      const removed = flow.stages.find((s) => s.id === id);
      const next = removeStage(flow, id, { force: opts.force });
      const issues = validateFlow(next, { dir });
      const errors = issues.filter((i) => i.level === "error");
      if (errors.length) {
        printFlowIssues(errors);
        console.error(`\n${c.red("✗")} 没有改任何文件 / nothing was written`);
        process.exit(1);
      }
      writeFlowRaw(file, next);
      const kept: string[] = [];
      for (const out of removed?.outputs ?? []) {
        const rel = out.path.replace(/\/+$/, "");
        if (fs.existsSync(path.join(dir, rel))) kept.push(out.path);
      }
      const prompt = removed && (removed.executor.type === "llm" || removed.executor.type === "agent") ? removed.executor.prompt : undefined;
      if (prompt && fs.existsSync(path.join(dir, prompt))) kept.push(prompt);
      console.log(`${c.green("✓")} 已删除阶段 / removed stage ${id}${opts.force ? "（已去掉其他阶段对它的引用 / references from other stages were dropped）" : ""}`);
      console.log(`  没有删除任何文件，runs/ 也留着。 / No files were deleted, and runs/ is left in place.`);
      if (kept.length) console.log(`  还在 / still here: ${kept.join(", ")}`);
      console.log(`  下一步 / next: flowgit status`);
    } catch (err) {
      fail(err);
    }
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
                current: s.current ?? null,
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
      console.log(`${c.bold(loaded.flow.name)} ${c.dim(`· ${path.basename(loaded.file)} v${loaded.flow.version} · ${loaded.dir}`)}\n`);
      console.log(statusBoard(statuses));
      if (missingInputs.length) {
        console.log(`\n${c.yellow("!")} 还没填流程输入 / flow inputs not set: ${missingInputs.join(", ")}`);
        console.log(`  flowgit inputs set ${missingInputs[0]}=...`);
      } else {
        const hint = nextHint(statuses);
        if (hint) console.log(`\n${hint}`);
      }
      const runsLine = runsPruneHint(runsDirBytes(loaded.dir));
      if (runsLine) console.log(`\n${runsLine}`);
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
      const defs = loaded.flow.inputs ?? {};
      const unknown = Object.keys(kv).filter((k) => !Object.hasOwn(defs, k));
      if (unknown.length) {
        throw new Error(`没有这个输入 / Unknown input(s): ${unknown.join(", ")}\n  可以填的 / known inputs: ${Object.keys(defs).join(", ")}`);
      }
      // Check each value now, so a typo is caught here rather than at the next run.
      const values = Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, coerceFlowInput(defs[k], v)]));
      const problems = Object.entries(values).flatMap(([k, v]) => flowInputProblem(k, defs[k], v) ?? []);
      if (problems.length) throw new Error(problems.join("\n  "));
      saveFlowInputs(loaded.dir, values);
      console.log(`${c.green("✓")} 已保存到 / saved to flowgit.local.json: ${Object.keys(kv).join(", ")}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("run")
  .description("运行一个阶段，或运行全部（没有依赖的阶段会同时跑） / run one stage, or all stages (independent stages run at the same time)")
  .argument("<stage>", '阶段 id 或 "all" / stage id, or "all"')
  .option("--input <key=value>", "临时覆盖流程输入，可重复 / flow input override (repeatable)", collect)
  .option("--from <path>", "人工阶段：作为产物的文件或文件夹，可重复 / human stage: file/dir to use as an output (repeatable, in output order)", collect)
  .option("--model <model>", "llm 阶段用的模型，可写 provider/model，如 glm/glm-5.3 / model for llm stages, optionally provider/model, e.g. glm/glm-5.3")
  .option("--force", "配合 all：已是最新的阶段也重跑 / with all: re-run stages that are already up to date")
  .option("--dry-run", "配合 all：只说会做什么，不运行、不调用模型 / with all: show what would happen, without running anything or calling a model")
  .option("--concurrency <n>", "配合 all：同时跑几个阶段（至少 1）。不写时用流程里的 concurrency，再没有就是 2 / with all: how many stages to run at once (at least 1). Unset uses the flow's concurrency, then 2")
  .option("--max-tokens <n>", "配合 all：这次运行的 token 上限。超过后停在下一个会调用模型的阶段之前，已完成的版本保留 / with all: token budget for this run. Over it, stop before the next stage that calls a model; finished versions are kept")
  .option("-y, --yes", "从 Git 地址复制来的流程：不再询问，确认它会做的事并运行 / for a flow copied from a Git URL: confirm what it does and run, without asking")
  .action(async (stageId: string, opts: { input?: string[]; from?: string[]; model?: string; force?: boolean; dryRun?: boolean; yes?: boolean; concurrency?: string; maxTokens?: string }) => {
    try {
      const loaded = loadFlow(dirOf());
      const concurrency = opts.concurrency !== undefined ? parseRunConcurrency(opts.concurrency) : undefined;
      const maxTokens = opts.maxTokens !== undefined ? parseMaxTokens(opts.maxTokens) : undefined;
      if ((concurrency !== undefined || maxTokens !== undefined) && stageId !== "all") {
        throw new Error("--concurrency 和 --max-tokens 只能配合 all 使用 / --concurrency and --max-tokens only work with all");
      }
      if (opts.dryRun) {
        if (stageId !== "all") throw new Error("--dry-run 只能配合 all 使用 / --dry-run only works with all: flowgit run all --dry-run");
        const again = [
          "flowgit run all",
          opts.force && "--force",
          concurrency !== undefined && `--concurrency ${concurrency}`,
          maxTokens !== undefined && `--max-tokens ${maxTokens}`,
          opts.model && `--model ${opts.model}`,
          ...(opts.input ?? []).map((kv) => `--input ${/\s/.test(kv) ? `"${kv}"` : kv}`),
        ];
        printPlan(
          planRunAll(loaded, { inputs: parseKv(opts.input), model: opts.model, force: opts.force, concurrency }),
          again.filter(Boolean).join(" "),
        );
        return;
      }
      const options: RunOptions = {
        inputs: parseKv(opts.input),
        from: opts.from,
        model: opts.model,
        force: opts.force,
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        onEvent: printEvent,
      };
      if (stageId !== "all") requireStage(loaded.flow, stageId);
      await ensureTrusted(loaded, opts.yes);
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
      if (err instanceof TokenBudgetError) {
        console.log(`\n${c.yellow("!")} ${err.message}`);
        printUsageTotal(true);
        return;
      }
      fail(err, { inputFlags: opts.input });
    }
  });

program
  .command("batch")
  .description("用 CSV 一次跑很多份：每行一份，表头是流程输入 / run many copies from a CSV: one row each, headers are flow inputs")
  .argument("<file.csv>", "CSV 文件，第一行是流程输入名 / CSV file whose first row names the flow inputs")
  .option("--out <dir>", "输出目录，相对流程目录 / output directory, relative to the flow directory", "batch")
  .option("--concurrency <n>", "同时跑几行（1 到 4）/ how many rows to run at once (1 to 4)", "1")
  .option("--rows <a-b>", "只跑这几行数据（从 1 开始，不含表头）/ only these data rows (1-based, the header is not counted)")
  .option("-y, --yes", "从 Git 地址复制来的流程：不再询问，确认它会做的事并运行 / for a flow copied from a Git URL: confirm what it does and run, without asking")
  .action(async (file: string, opts: { out: string; concurrency: string; rows?: string; yes?: boolean }) => {
    try {
      // Every row is a copy of this flow, so a flow copied from a Git URL is confirmed once, here.
      await ensureTrusted(loadFlow(dirOf()), opts.yes);
      const code = await runBatch({
        flowDir: dirOf(),
        csvPath: path.resolve(file),
        out: opts.out,
        concurrency: opts.concurrency,
        rows: opts.rows,
      });
      if (code !== 0) process.exit(code);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("trust")
  .description("确认从 Git 地址复制来的流程会做的事，之后运行就不再问 / confirm what a flow copied from a Git URL does, so runs stop asking")
  .action(() => {
    try {
      const loaded = loadFlow(dirOf());
      const state = trustState(loaded);
      if (state.reason === "not-forked") {
        console.log("这个流程不是从 Git 地址复制来的，不用确认 / This flow wasn't copied from a Git URL; there is nothing to confirm.");
        return;
      }
      if (state.reason === "no-actions") {
        console.log("这个流程只调用模型或等人，不在你的电脑上运行命令，不用确认 / This flow only calls models or waits for people and runs nothing on your computer; there is nothing to confirm.");
        return;
      }
      printTrustList(state);
      if (state.reason === "trusted") {
        console.log(`${c.green("✓")} 已经确认过，命令没变 / Already confirmed; the commands haven't changed.`);
        return;
      }
      trustFlow(loaded, state.fingerprint);
      console.log(`${c.green("✓")} ${TRUST_REMEMBERED}`);
    } catch (err) {
      fail(err);
    }
  });

const PLAN_LABEL: Record<PlanAction, string> = {
  skip: c.dim("· 跳过，已是最新 / skip, up to date"),
  "keep-edit": c.cyan("✎ 保留你的手动修改 / keep your edit"),
  run: c.green("▶ 运行 / run"),
  wait: c.yellow("⏸ 停下等你 / stops for you"),
  "cannot-run": c.red("✗ 不能运行 / can't run"),
  "not-reached": c.dim("· 走不到 / not reached"),
};

/** The table for `run all --dry-run`, then how many model calls it would make at most. */
function printPlan(steps: PlanStep[], runCommand: string): void {
  console.log(c.dim("预演：不会运行任何阶段 / dry run: nothing runs\n"));
  const rows = [[c.dim("#"), c.dim("阶段 stage"), c.dim("会怎样 action"), c.dim("详情 details")]];
  steps.forEach((s, i) => rows.push([String(i + 1), `${s.stage.name} ${c.dim(s.stage.id)}`, PLAN_LABEL[s.action], s.detail ?? ""]));
  console.log(table(rows));
  const waves = new Map<number, string[]>();
  for (const step of steps) {
    if (step.action !== "run" || step.together === undefined) continue;
    const ids = waves.get(step.together) ?? [];
    ids.push(step.stage.id);
    waves.set(step.together, ids);
  }
  for (const ids of waves.values()) {
    if (ids.length > 1) console.log(`同时运行 / run together: ${ids.join(", ")}`);
  }
  const calls = planModelCalls(steps);
  console.log(
    `\n${
      calls
        ? `最多 ${calls} 次模型调用 / at most ${calls} model call(s)${c.dim("（上游产物没变的阶段到时会跳过 / stages whose upstream output comes out the same are skipped）")}`
        : "不会调用模型 / no model calls"
    }`,
  );
  if (steps.some((s) => s.action === "run" || s.action === "keep-edit")) console.log(c.dim(`真的运行 / to run it: ${runCommand}`));
}

/** " · 19 tokens" for an llm run that reported usage. */
function tokenNote(usage: unknown): string {
  const t = usageTokens(usage as Record<string, unknown> | undefined);
  return t ? ` · ${t.input + t.output} tokens` : "";
}

/** The details column of `flowgit log`: model, command, agent, or what a person provided. */
function runDetail(r: RunRecord): string {
  const p = r.params ?? {};
  if (r.status === "error") return `${c.red((r.error ?? "").split("\n")[0].slice(0, 80))}${tokenNote(p.usage)}`;
  const took = p.durationMs ? ` · ${Math.round(Number(p.durationMs) / 1000)}s` : "";
  if (r.executor === "llm") return `${p.provider && p.provider !== "anthropic" ? `${p.provider}/` : ""}${p.model ?? ""}${took}${tokenNote(p.usage)}`;
  if (r.executor === "script") return String(p.run ?? "");
  if (r.executor === "agent") return `${p.agent ?? ""}${took}`;
  if (r.executor === "workflow") return String(p.file ?? "");
  if (r.executor === "image") {
    const model = p.provider && p.model ? `${p.provider}/${p.model}` : String(p.model ?? "");
    const size = p.size ? ` ${p.size}` : "";
    const count = p.count ?? "";
    return `${model}${size} · ${count} 张 / ${count} image(s)${took}`;
  }
  return String(p.provided ?? "");
}

const finished = (r: RunRecord) => r.finishedAt.replace("T", " ").slice(0, 19);
const runResult = (r: RunRecord) => (r.status === "ok" ? c.green("ok") : c.red("error"));

/** Every run of every stage, newest first, with the model usage they add up to. */
function logAll(loaded: LoadedFlow): void {
  const names = new Map(loaded.flow.stages.map((s) => [s.id, s.name]));
  const logged = flowLog(loaded);
  console.log(`${c.bold(loaded.flow.name)} ${c.dim(`· ${logged.runs.length} 个版本 / run(s)`)}\n`);
  if (!logged.runs.length) {
    console.log(c.dim("还没有运行过。/ Nothing has run yet."));
    return;
  }
  const rows = [[c.dim("完成时间 finished"), c.dim("阶段 stage"), c.dim("版本 v"), c.dim("结果 status"), c.dim("执行 executor"), c.dim("详情 details")]];
  for (const r of logged.runs) {
    rows.push([finished(r), `${names.get(r.stage)} ${c.dim(r.stage)}`, `v${r.n}`, runResult(r), r.executor, runDetail(r)]);
  }
  console.log(table(rows));
  if (logged.total.calls) console.log(c.dim(`\n${usageLine("模型用量合计 / total model usage", logged.total)}`));
  console.log(c.dim(`\n一个阶段的历史 / one stage: flowgit log <stage>`));
}

program
  .command("log")
  .description("历史版本：一个阶段的，不写阶段就列出整个流程的 / version history of one stage, or of the whole flow when no stage is given")
  .argument("[stage]", "阶段 id，不写就是全部阶段 / stage id (omit for every stage)")
  .action((stageId: string | undefined) => {
    try {
      const loaded = loadFlow(dirOf());
      if (!stageId) {
        logAll(loaded);
        return;
      }
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
        rows.push([`v${r.n}`, runResult(r), finished(r), r.executor, runDetail(r)]);
      }
      console.log(table(rows));
      console.log(c.dim(`\n快照 / snapshots: runs/${stageId}/<n>/outputs/   对比 / diff: flowgit diff ${stageId} <a> [b]   回退 / restore: flowgit restore ${stageId} <n>`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("diff")
  .description("对比两个版本的产物；省略第二个版本则和当前文件比 / diff two versions, or a version against the current files")
  .argument("<stage>", "阶段 id / stage id")
  .argument("<a>", "版本号 / run number")
  .argument("[b]", "另一个版本号；省略则对比当前文件 / other run number; omit to compare with the current files")
  .option("--json", "输出 JSON / machine-readable output")
  .action((stageId: string, a: string, b: string | undefined, opts: { json?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      const diff = diffRuns(loaded.dir, loaded.flow, stageId, parseRunArg(a), b === undefined ? undefined : parseRunArg(b));
      if (opts.json) {
        console.log(JSON.stringify(diff, null, 2));
        return;
      }
      console.log(formatRunDiff(diff, loaded.flow.stages.find((s) => s.id === stageId)?.name ?? stageId));
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
      if (!/^\d+$/.test(n)) throw new Error(`版本号要写数字，例如 flowgit restore ${stageId} 2 / the version is a number, e.g. flowgit restore ${stageId} 2`);
      const { run, kept } = restoreStage(loaded, stageId, Number(n));
      if (kept) console.log(c.dim(`  你的手动修改已存为 / your manual edit was saved as v${kept.n}`));
      console.log(`${c.green("✓")} 已回退到 / restored ${stageId} v${run.n}: ${run.outputs.map((o) => o.path).join(", ")}`);
      console.log(c.dim("  下游阶段会显示为需重跑 / downstream stages will show as stale"));
    } catch (err) {
      fail(err);
    }
  });

/** The image presets: provider, example model, endpoint, and whether the key variable is set. */
function printImageProviders(): void {
  console.log(`\n${c.bold("生图 / Image")}`);
  const rows = [[c.dim("provider"), c.dim("示例模型 example"), c.dim("地址 baseUrl"), c.dim("密钥 key")]];
  for (const preset of imagePresetList()) {
    const state = imageKeyState(preset);
    const key = `${preset.apiKeyEnv} ${state === "set" ? c.green("✓ 已设置 set") : c.yellow("✗ 未设置 not set")}`;
    rows.push([preset.id, preset.exampleModel, preset.baseUrl, key]);
  }
  console.log(table(rows));
  console.log(c.dim("用法 / usage: executor.type 为 image，model 写成 provider/model，例如 zhipu/cogview-4。说明见 docs/image.md / type image, model is provider/model, e.g. zhipu/cogview-4. See docs/image.md"));
}

function parseKeep(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`--keep 至少是 1，收到 "${raw}" / --keep must be at least 1, got "${raw}"`);
  }
  return Number(raw);
}

/** y or yes. Anything else, including an empty answer, is no. */
function answeredYes(answer: string): boolean {
  return /^(y|yes)$/i.test(answer.trim());
}

async function askOnce(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } catch {
    return ""; // input closed (Ctrl+D): treat as no
  } finally {
    rl.close();
  }
}

function printPrunePlan(plan: { delete: { stage: string; n: number; bytes: number }[]; bytes: number }, dryRun: boolean): void {
  if (!plan.delete.length) {
    console.log("没有要删除的版本 / Nothing to delete.");
    return;
  }
  if (dryRun) console.log(c.dim("预演：不会删除任何版本 / dry run: nothing will be deleted\n"));
  const rows = [[c.dim("阶段 stage"), c.dim("版本 v"), c.dim("大小 size")]];
  for (const item of plan.delete) rows.push([item.stage, `v${item.n}`, formatByteSize(item.bytes)]);
  console.log(table(rows));
  console.log(`\n释放 ${formatByteSize(plan.bytes)} / frees ${formatByteSize(plan.bytes)}`);
}

program
  .command("prune")
  .description("清理旧版本。每个阶段留下最新的几个、所有手动修改、和当前文件一致的版本，以及最近一次成功的运行 / delete old versions, keeping the newest few, every manual edit, the version matching the current files, and the newest success")
  .option("--keep <n>", "每个阶段保留的最新版本数，至少 1 / newest versions to keep per stage, at least 1", "5")
  .option("--stage <id>", "只清理这个阶段 / only this stage")
  .option("--dry-run", "只列出将删除的版本和能腾出的空间，不删除 / list what would be deleted and how much space it frees, without deleting")
  .option("--yes", "不询问，直接删除 / delete without asking")
  .action(async (opts: { keep?: string; stage?: string; dryRun?: boolean; yes?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      const keep = parseKeep(opts.keep ?? "5");
      const stage = opts.stage?.trim() || undefined;
      const plan = planPrune(loaded.dir, loaded.flow, { keep, stage });
      printPrunePlan(plan, Boolean(opts.dryRun));
      if (!plan.delete.length || opts.dryRun) return;
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          console.log("不在终端里，没有删除。确认删除请加上 --yes / Not a terminal, so nothing was deleted. Add --yes to delete.");
          process.exitCode = 1;
          return;
        }
        const answer = await askOnce("删除这些版本？/ Delete these versions? [y/N] ");
        if (!answeredYes(answer)) {
          console.log("已取消，没有删除 / Cancelled, nothing deleted.");
          return;
        }
      }
      const deleted = prune(loaded.dir, loaded.flow, { keep, stage });
      console.log(
        `${c.green("✓")} 已删除 ${deleted.delete.length} 个版本，释放 ${formatByteSize(deleted.bytes)} / deleted ${deleted.delete.length} version(s), freed ${formatByteSize(deleted.bytes)}`,
      );
    } catch (err) {
      fail(err);
    }
  });

program
  .command("providers")
  .description("列出可用的模型供应商和生图供应商，以及密钥有没有设置 / list model and image providers and whether their keys are set")
  .option("--json", "输出 JSON / machine-readable output")
  .action((opts: { json?: boolean }) => {
    try {
      const dir = dirOf();
      const inFlow = !!flowFileIn(dir);
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
              imageProviders: imagePresetList().map((p) => ({
                id: p.id,
                exampleModel: p.exampleModel,
                baseUrl: p.baseUrl,
                apiKeyEnv: p.apiKeyEnv,
                key: imageKeyState(p),
                docs: p.docs,
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
      printImageProviders();
    } catch (err) {
      fail(err);
    }
  });

program
  .command("doctor")
  .description("检查这台电脑能不能跑这个流程：Node、流程输入、密钥、要用的命令、agent 和插件 / check this machine can run the flow: Node, inputs, keys, programs, agents and plugins")
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
      console.log(
        warnings
          ? `\n${c.yellow("!")} 没有必须先解决的问题，但先看看上面的 ${warnings} 个提醒 / nothing blocking, but check the ${warnings} warning(s) above`
          : `\n${c.green("✓")} 可以运行 / ready to run`,
      );
      console.log(c.dim(`  先预演一下 / preview it first: flowgit run all --dry-run${opts.model ? ` --model ${opts.model}` : ""}`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("graph")
  .description("把流程画成 Mermaid 流程图，GitHub 和 Obsidian 都能直接显示 / draw the flow as a Mermaid diagram that GitHub and Obsidian render")
  .option("--status", "按每个阶段现在的状态上色 / color each stage by its current state")
  .option("--md", "包进 ```mermaid 代码块，直接贴进 Markdown / wrap it in a ```mermaid block to paste into Markdown")
  .option("-o, --out <file>", "写进文件（UTF-8，相对流程目录）；.md 文件自动包进代码块 / write to a file (UTF-8, relative to the flow directory); .md files get the code block")
  .action((opts: { status?: boolean; md?: boolean; out?: string }) => {
    try {
      const loaded = loadFlow(dirOf());
      const statuses = opts.status ? statusAll(loaded, resolveFlowInputs(loaded.dir, loaded.flow)) : undefined;
      const diagram = flowToMermaid(loaded.flow, statuses);
      const md = opts.md || (opts.out !== undefined && /\.(md|markdown)$/i.test(opts.out));
      const text = md ? `\`\`\`mermaid\n${diagram}\n\`\`\`` : diagram;
      if (!opts.out) {
        console.log(text);
        return;
      }
      // a file written by Node is UTF-8, unlike `>` in Windows PowerShell 5, which writes UTF-16
      const file = notFlowFile(loaded.dir, opts.out);
      fs.writeFileSync(file, `${text}\n`);
      console.log(`${c.green("✓")} 已写入 / wrote ${path.relative(process.cwd(), file) || file}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("convert")
  .description("在 flow.json 和 flow.md 之间转换，内容不变 / switch between flow.json and flow.md; the flow stays the same")
  .requiredOption("--to <format>", "json 或 md / json or md")
  .action((opts: { to: string }) => {
    try {
      const to = parseFormat(opts.to)!;
      const dir = dirOf();
      const done = convertFlowFile(dir, to);
      if (!done) {
        console.log(`${c.green("✓")} 已经是 ${formatFile(to)}，不用转换 / already ${formatFile(to)}; nothing to do`);
        return;
      }
      console.log(`${c.green("✓")} 已把 ${done.from} 换成 ${done.to} / converted ${done.from} to ${done.to}`);
      console.log(`  runs/ 和产物都没动，不需要重跑。 / runs/ and outputs are untouched; nothing needs a re-run.`);
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
      const md = renderSkillMd(loaded.flow, path.basename(loaded.file));
      if (opts.out === "-") {
        process.stdout.write(md);
        return;
      }
      const file = notFlowFile(loaded.dir, opts.out);
      fs.writeFileSync(file, md);
      console.log(`${c.green("✓")} 已写入 / wrote ${path.relative(process.cwd(), file) || file}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("board")
  .description("在浏览器打开本地看板，可查看、修改、运行、填写输入、看历史、对比和回退 / open a local board in the browser to view, edit, run, fill in inputs, browse history, compare, and restore")
  .option("--port <port>", "端口，只绑定 127.0.0.1 / port, bound to 127.0.0.1 only", "4747")
  .option("--no-open", "不打开浏览器 / do not open a browser")
  .option(
    "--allow-origin <origin>",
    "另外允许这个网页（比如自己部署的网页版）带令牌调用看板，可以写多次；默认只允许 https://flowgit.dev / also let this web page (such as your own copy of the web app) call the board with the token; repeatable; by default only https://flowgit.dev",
    (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
  )
  .action(async (opts: { port: string; open: boolean; allowOrigin?: string[] }) => {
    try {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`端口不合法 / invalid port: ${opts.port}`);
      }
      const dir = loadFlow(dirOf()).dir; // fail early, with the usual hint, when there is no flow file
      const allowOrigins = [WEB_APP_ORIGIN, ...(opts.allowOrigin ?? []).map(parseOrigin)];
      const board = await startBoard({ dir, port, open: false, allowOrigins });
      console.log(`${c.green("✓")} 看板 / board: ${board.url}`);
      console.log(c.dim("绑定 127.0.0.1。可以修改产物，也可以运行、填写输入、看历史、对比和回退。按 Ctrl+C 停止 / bound to 127.0.0.1. Outputs can be edited; you can also run stages, edit inputs, browse history, compare, and restore. Press Ctrl+C to stop"));
      if (opts.open) openBrowser(board.url);
    } catch (err) {
      fail(err);
    }
  });

function printMcpTools(server: string, tools: { name: string; description?: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }[]): void {
  console.log(`${c.bold(server)} ${c.dim(`${tools.length} 个工具 / tool(s)`)}`);
  if (!tools.length) {
    console.log("  这个服务器没有工具 / this server has no tools");
    return;
  }
  for (const tool of tools) {
    console.log(`\n${c.bold(tool.name)}`);
    if (tool.description) console.log(`  ${tool.description}`);
    const props = tool.inputSchema.properties ?? {};
    const names = Object.keys(props);
    const required = new Set(tool.inputSchema.required ?? []);
    if (!names.length) {
      console.log(c.dim("  无参数 / no parameters"));
      continue;
    }
    console.log(c.dim("  参数 / parameters:"));
    for (const name of names) {
      const schema = props[name];
      const type = schema && typeof schema === "object" && typeof (schema as { type?: unknown }).type === "string" ? (schema as { type: string }).type : "any";
      const description = schema && typeof schema === "object" && typeof (schema as { description?: unknown }).description === "string" ? (schema as { description: string }).description : "";
      const need = required.has(name) ? "必填 / required" : "可选 / optional";
      console.log(`    ${name} (${type}, ${need})${description ? ` — ${description}` : ""}`);
    }
  }
}

program
  .command("plugins")
  .description("列出这个流程用到的插件、解析到的路径和版本 / list the plugins this flow uses, with the resolved path and version")
  .option("--json", "输出 JSON / machine-readable output")
  .action((opts: { json?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      const plugins = listPlugins(loaded);
      const missing = plugins.some((plugin) => plugin.missing);
      if (opts.json) {
        console.log(JSON.stringify({ plugins }, null, 2));
        if (missing) process.exitCode = 1;
        return;
      }
      if (!plugins.length) {
        console.log("这个流程没有插件阶段 / this flow has no plugin stages");
        return;
      }
      console.log(`${c.bold(loaded.flow.name)} ${c.dim("· 插件 / plugins")}\n`);
      for (const plugin of plugins) {
        const mark = plugin.missing ? c.red("✗") : c.green("✓");
        console.log(`  ${mark} ${plugin.stage}: ${plugin.message}`);
        if (plugin.hint) console.log(c.dim(`      ${plugin.hint}`));
      }
      if (missing) {
        console.log(`\n${c.red("✗")} 有插件没找到 / a plugin was not found`);
        process.exitCode = 1;
      }
    } catch (err) {
      fail(err);
    }
  });

const mcpCmd = program.command("mcp").description("查看流程里配置的 MCP 服务器 / inspect the MCP servers configured in this flow");

mcpCmd
  .command("tools")
  .description("列出一个 MCP 服务器的工具和参数 / list one MCP server's tools and their parameters")
  .argument("<server>", "mcpServers 里的名字 / name in mcpServers")
  .option("--json", "输出 JSON / machine-readable output")
  .option("-y, --yes", "从 Git 地址复制来的流程：不再询问，确认它会做的事再启动服务器 / for a flow copied from a Git URL: confirm what it does and start the server, without asking")
  .action(async (server: string, opts: { json?: boolean; yes?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      // Listing tools starts the server's command, so a copied flow is confirmed first, like a run.
      await ensureTrusted(loaded, opts.yes);
      const tools = await listMcpTools(loaded.dir, loaded.flow.mcpServers, server);
      if (opts.json) {
        console.log(JSON.stringify({ server, tools }, null, 2));
        return;
      }
      printMcpTools(server, tools);
    } catch (err) {
      fail(err);
    }
  });

const galleryCmd = program.command("gallery").description("静态模板画廊 / static template gallery");

galleryCmd
  .command("build")
  .description("生成静态页面到一个目录，不部署 / write a static site into a directory, without deploying")
  .option("--out <dir>", "输出目录 / output directory", "gallery-dist")
  .action(async (opts: { out: string }) => {
    try {
      const result = await buildGallery({ outDir: opts.out });
      console.log(`${c.green("✓")} 已生成模板画廊 / wrote the template gallery: ${result.outDir}`);
      console.log(`  ${result.pages.length} 个模板页 / ${result.pages.length} template page(s)`);
      if (result.note) console.log(result.note);
    } catch (err) {
      fail(err);
    }
  });

registerNew(program, fail);
registerServeMcp(program, { version: VERSION, dirOf, fail });
registerSite(program, fail);
registerPublish(program, fail);
registerTest(program, dirOf, fail);

program.parseAsync(process.argv).catch(fail);
