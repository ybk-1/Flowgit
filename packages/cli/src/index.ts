#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Help } from "commander";
import {
  FLOW_FILE,
  FlowNotFoundError,
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
  flowFiles,
  flowInputProblem,
  flowToMermaid,
  effectiveProvider,
  globalProvidersFile,
  diffRuns,
  listRuns,
  loadFlow,
  loadProviders,
  providerKeyState,
  loadFlowInputs,
  planRunAll,
  resolveFlowInputs,
  renderSkillMd,
  resolveFlowDir,
  restoreStage,
  runAll,
  runStage,
  saveFlowInputs,
  stageStatus,
  statusAll,
  validateFlow,
  usageTokens,
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
import { openBrowser, startBoard } from "@flowgit/web";
import { bilingualCliError, c, colorizeUnifiedDiff, nextHint, statusBoard, table, width } from "./format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string }).version;

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

function fail(err: unknown, ctx: { inputFlags?: string[] } = {}): never {
  const e = err as Error;
  // run all can stop (at a person, or on an error) after paying for model calls: end with what they used
  const exit = (code: number): never => {
    printUsageTotal(true);
    process.exit(code);
  };
  if (e instanceof HumanInputNeededError) {
    console.log(`\n${c.yellow("⏸")} 「${e.stage.name}」在等你 / waiting for you: ${e.missing.join(", ")}`);
    if (e.instructions) console.log(`  ${e.instructions}`);
    console.log(`  放好文件后运行 / when ready: flowgit run ${e.stage.id}   (或 / or: flowgit run ${e.stage.id} --from <path>)`);
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

function isGitUrl(source: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(source);
}

/** A bundled template name, not a path and not a Git URL. */
function bundledDir(name: string): string | undefined {
  if (!name || name.includes("/") || name.includes("\\") || isGitUrl(name)) return undefined;
  const dir = path.join(templatesDir, name);
  return fs.existsSync(path.join(dir, FLOW_FILE)) ? dir : undefined;
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

function readSourceFlow(src: string): Flow {
  const file = path.join(src, FLOW_FILE);
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    throw new Error(`${file} 不是合法的 JSON / is not valid JSON: ${(err as Error).message}`);
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as Flow).stages)) {
    throw new Error(`${file} 不是一个流程 / is not a flow`);
  }
  return data as Flow;
}

// Two lines rather than `cd … && flowgit status`: Windows PowerShell 5.1 has no `&&`.
function nextStepLine(target: string): string {
  const rel = path.relative(process.cwd(), target);
  const shown = rel === "" ? "." : rel.startsWith("..") || path.isAbsolute(rel) ? target : rel;
  return `  下一步 / next:\n    cd ${/\s/.test(shown) ? `"${shown}"` : shown}\n    flowgit status`;
}

program
  .command("init")
  .description("从模板、本地目录或 Git 地址新建流程（默认 short-video）/ create a flow from a template, a local directory or a Git URL (default: short-video)")
  .argument("[dir]", "目标目录 / target directory", ".")
  .option("-t, --template <name>", "模板、目录或 Git 地址 / template, directory or Git URL", DEFAULT_TEMPLATE)
  .option("--ref <ref>", "Git 分支或标签 / Git branch or tag")
  .option("--path <subdir>", "仓库里的子目录 / subdirectory inside the repo")
  .option("--with-outputs", "连产物一起复制 / also copy stage outputs")
  .option("--force", "覆盖已有的 flow.json / overwrite an existing flow.json")
  .action((dir: string, opts: { template: string; ref?: string; path?: string; withOutputs?: boolean; force?: boolean }) => {
    const target = path.resolve(dir);
    if (fs.existsSync(path.join(target, FLOW_FILE)) && !opts.force) {
      fail(new Error(`${path.join(target, FLOW_FILE)} 已存在，加 --force 覆盖 / already exists (use --force to overwrite)`));
    }
    const builtin = bundledDir(opts.template);
    if (builtin) {
      if (opts.ref || opts.path) fail(new Error(`--ref 和 --path 只用于 Git 地址 / --ref and --path are only for a Git URL`));
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(builtin, target, {
        recursive: true,
        filter: (p) => {
          const rel = path.relative(builtin, p).split(path.sep)[0];
          return !["runs", "node_modules", "flowgit.local.json"].includes(rel);
        },
      });
      console.log(`${c.green("✓")} 已创建流程 / created flow in ${target}`);
      console.log(nextStepLine(target));
      return;
    }
    if ((opts.ref || opts.path) && !isGitUrl(opts.template)) {
      fail(new Error(`--ref 和 --path 只用于 Git 地址 / --ref and --path are only for a Git URL`));
    }

    let src = "";
    let cleanup: string | undefined;
    let forked: ForkedFrom | undefined;
    try {
      try {
        if (isGitUrl(opts.template)) {
          const cloned = cloneFlowRepo(opts.template, opts.ref);
          cleanup = cloned.dir;
          src = path.resolve(cloned.dir, opts.path ?? ".");
          // Resolve symlinks too, so a link in the repository can't point --path outside it.
          const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : p);
          const escaped = path.relative(real(cloned.dir), real(src));
          if (escaped.startsWith("..") || path.isAbsolute(escaped)) {
            throw new Error(`--path 必须在仓库里面 / --path must stay inside the repository`);
          }
          forked = { source: publicGitUrl(opts.template), ...(opts.ref ? { ref: opts.ref } : {}), commit: cloned.commit };
        } else {
          src = path.resolve(opts.template);
        }
        if (!fs.existsSync(path.join(src, FLOW_FILE))) {
          const names = bundledTemplates().map((t) => t.id).join(", ");
          const where = opts.path ? `${opts.template} (${opts.path})` : opts.template;
          throw new Error(`找不到流程 / Flow not found: ${where}\n  自带的模板 / bundled templates: ${names}（flowgit templates 查看说明 / see flowgit templates）`);
        }
        const sourceFlow = readSourceFlow(src);
        const withOutputs = !!opts.withOutputs;
        const rels = flowFiles({ dir: src, file: path.join(src, FLOW_FILE), flow: sourceFlow }, { withOutputs });
        fs.mkdirSync(target, { recursive: true });
        copyListed(src, target, rels);
        if (forked) {
          const file = path.join(target, FLOW_FILE);
          const flow = JSON.parse(fs.readFileSync(file, "utf8")) as Flow;
          flow.forkedFrom = forked;
          fs.writeFileSync(file, `${JSON.stringify(flow, null, 2)}\n`);
        }
        const skipped = withOutputs ? [] : presentOutputs(src, sourceFlow);
        console.log(`${c.green("✓")} 已创建流程 / created flow in ${target}`);
        console.log(`  来源 / source: ${isGitUrl(opts.template) ? publicGitUrl(opts.template) : opts.template}${opts.path ? ` (${opts.path})` : ""}`);
        console.log(`  复制了 ${rels.length} 个文件 / copied ${rels.length} file(s)`);
        console.log(skipped.length ? `  跳过的产物 / skipped outputs: ${skipped.join(", ")}` : `  没有跳过产物 / no outputs skipped`);
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
      console.log(`  永远不会复制 / never copied: runs/、flowgit.local.json、.env*`);
      console.log(skipped.length ? `  跳过的产物 / skipped outputs: ${skipped.join(", ")}` : `  没有跳过产物 / no outputs skipped`);
      console.log(`  下一步 / next: 在这个目录里 git init，提交后推到 GitHub / in that directory, git init, commit, and push it to GitHub`);
    } catch (err) {
      fail(err);
    }
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
  const file = path.join(dir, FLOW_FILE);
  if (!fs.existsSync(file)) fail(new Error(`${dir} 里没有 ${FLOW_FILE} / No ${FLOW_FILE} in ${dir}`));
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    fail(new Error(`${file} 不是合法的 JSON / is not valid JSON: ${(err as Error).message}`));
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as Flow).stages)) {
    fail(new Error(`${file} 不是一个流程 / is not a flow`));
  }
  return { file, flow: data as Flow };
}

function writeFlowRaw(file: string, flow: Flow): void {
  fs.writeFileSync(file, `${JSON.stringify(flow, null, 2)}\n`);
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
      const defs = loaded.flow.inputs ?? {};
      const unknown = Object.keys(kv).filter((k) => !defs[k]);
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
  .description("运行一个阶段，或按顺序运行全部 / run one stage, or all stages in order")
  .argument("<stage>", '阶段 id 或 "all" / stage id, or "all"')
  .option("--input <key=value>", "临时覆盖流程输入，可重复 / flow input override (repeatable)", collect)
  .option("--from <path>", "人工阶段：作为产物的文件或文件夹，可重复 / human stage: file/dir to use as an output (repeatable, in output order)", collect)
  .option("--model <model>", "llm 阶段用的模型，可写 provider/model，如 glm/glm-5.3 / model for llm stages, optionally provider/model, e.g. glm/glm-5.3")
  .option("--force", "配合 all：已是最新的阶段也重跑 / with all: re-run stages that are already up to date")
  .option("--dry-run", "配合 all：只说会做什么，不运行、不调用模型 / with all: show what would happen, without running anything or calling a model")
  .action(async (stageId: string, opts: { input?: string[]; from?: string[]; model?: string; force?: boolean; dryRun?: boolean }) => {
    try {
      const loaded = loadFlow(dirOf());
      if (opts.dryRun) {
        if (stageId !== "all") throw new Error("--dry-run 只能配合 all 使用 / --dry-run only works with all: flowgit run all --dry-run");
        const again = ["flowgit run all", opts.force && "--force", opts.model && `--model ${opts.model}`, ...(opts.input ?? []).map((kv) => `--input ${/\s/.test(kv) ? `"${kv}"` : kv}`)];
        printPlan(planRunAll(loaded, { inputs: parseKv(opts.input), model: opts.model, force: opts.force }), again.filter(Boolean).join(" "));
        return;
      }
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
      fail(err, { inputFlags: opts.input });
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
  const calls = steps.filter((s) => s.callsModel).length;
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
  if (r.status === "error") return c.red((r.error ?? "").split("\n")[0].slice(0, 80));
  const took = p.durationMs ? ` · ${Math.round(Number(p.durationMs) / 1000)}s` : "";
  if (r.executor === "llm") return `${p.provider && p.provider !== "anthropic" ? `${p.provider}/` : ""}${p.model ?? ""}${took}${tokenNote(p.usage)}`;
  if (r.executor === "script") return String(p.run ?? "");
  if (r.executor === "agent") return `${p.agent ?? ""}${took}`;
  return String(p.provided ?? "");
}

const finished = (r: RunRecord) => r.finishedAt.replace("T", " ").slice(0, 19);
const runResult = (r: RunRecord) => (r.status === "ok" ? c.green("ok") : c.red("error"));

/** Every run of every stage, newest first, with the model usage they add up to. */
function logAll(loaded: LoadedFlow): void {
  const names = new Map(loaded.flow.stages.map((s) => [s.id, s.name]));
  const runs = loaded.flow.stages
    .flatMap((s) => listRuns(loaded.dir, s.id))
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  console.log(`${c.bold(loaded.flow.name)} ${c.dim(`· ${runs.length} 个版本 / run(s)`)}\n`);
  if (!runs.length) {
    console.log(c.dim("还没有运行过。/ Nothing has run yet."));
    return;
  }
  const rows = [[c.dim("完成时间 finished"), c.dim("阶段 stage"), c.dim("版本 v"), c.dim("结果 status"), c.dim("执行 executor"), c.dim("详情 details")]];
  const total = { input: 0, output: 0, calls: 0 };
  for (const r of runs) {
    rows.push([finished(r), `${names.get(r.stage)} ${c.dim(r.stage)}`, `v${r.n}`, runResult(r), r.executor, runDetail(r)]);
    const t = usageTokens(r.params?.usage as Record<string, unknown> | undefined);
    if (t) {
      total.input += t.input;
      total.output += t.output;
      total.calls += 1;
    }
  }
  console.log(table(rows));
  if (total.calls) console.log(c.dim(`\n${usageLine("模型用量合计 / total model usage", total)}`));
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
      const file = path.resolve(loaded.dir, opts.out);
      fs.writeFileSync(file, `${text}\n`);
      console.log(`${c.green("✓")} 已写入 / wrote ${path.relative(process.cwd(), file) || file}`);
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

program
  .command("board")
  .description("在浏览器打开本地看板，可查看、修改、运行、填写输入、看历史、对比和回退 / open a local board in the browser to view, edit, run, fill in inputs, browse history, compare, and restore")
  .option("--port <port>", "端口，只绑定 127.0.0.1 / port, bound to 127.0.0.1 only", "4747")
  .option("--no-open", "不打开浏览器 / do not open a browser")
  .action(async (opts: { port: string; open: boolean }) => {
    try {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`端口不合法 / invalid port: ${opts.port}`);
      }
      const dir = loadFlow(dirOf()).dir; // fail early, with the usual hint, when there is no flow.json
      const board = await startBoard({ dir, port, open: false });
      console.log(`${c.green("✓")} 看板 / board: ${board.url}`);
      console.log(c.dim("绑定 127.0.0.1。可以修改产物，也可以运行、填写输入、看历史、对比和回退。按 Ctrl+C 停止 / bound to 127.0.0.1. Outputs can be edited; you can also run stages, edit inputs, browse history, compare, and restore. Press Ctrl+C to stop"));
      if (opts.open) openBrowser(board.url);
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv).catch(fail);
