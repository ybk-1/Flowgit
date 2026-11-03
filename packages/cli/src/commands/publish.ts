import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import type { Command } from "commander";
import { FlowValidationError, findFlowFile, findPrivateData, flowFiles, loadFlow, readFlowFile, validateFlow, type Flow, type LoadedFlow } from "@flowgit/core";
import { splitBilingual } from "../gallery.js";
import { c } from "../format.js";
import { isSourcesHeading } from "../markdown.js";
import { validateCommunityRegistry, type CommunityEntry } from "../registry.js";

/**
 * GitHub documents query parameters for the new-repository form (`name`,
 * `description`, `visibility`, `owner`), not for the new-file editor:
 * https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository#creating-a-new-repository-from-a-url-query
 * The new-file page itself only describes the buttons in the UI:
 * https://docs.github.com/en/repositories/working-with-files/managing-files/creating-new-files
 * Those docs do not list `filename` or `value`, so this command does not build
 * a prefilled URL and does not call the GitHub API.
 */
export function githubNewFileUrl(): null {
  return null;
}

export const REGISTRY_REPO = "https://github.com/cgold9820-dotcom/Flowgit";

/** Where the entry file goes, and the folder to open in the browser. */
export function communityEntryLocation(id: string): { path: string; treeUrl: string } {
  return {
    path: `registry/community/${id}.json`,
    treeUrl: `${REGISTRY_REPO}/tree/main/registry/community`,
  };
}

export function publishInstructions(entry: CommunityEntry): string {
  const where = communityEntryLocation(entry.id);
  return [
    "条目 / entry:",
    JSON.stringify(entry, null, 2),
    "",
    `文件 / file: ${where.path}`,
    `目录 / folder: ${where.treeUrl}`,
    "",
    "GitHub 的新建文件页面没有写明可以预填内容的网址参数，所以这里不打开带内容的链接，也不调用 GitHub API。",
    "GitHub's new-file page does not document URL parameters that prefill the editor, so this does not open a prefilled link and does not call the GitHub API.",
    "说明 / docs: https://docs.github.com/en/repositories/working-with-files/managing-files/creating-new-files",
    "",
    "手动步骤 / Do this by hand:",
    `1. 打开 / Open ${where.treeUrl}`,
    `2. Add file → Create new file，文件名填 / file name: ${where.path}`,
    "3. 把上面的 JSON 贴进去，提交并打开 Pull Request。 / Paste the JSON above, commit, and open a pull request.",
  ].join("\n");
}

const LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "COPYING.md"];

const FINDING_LABEL: Record<string, string> = {
  "sk-key": "密钥 / API key",
  "aws-key": "AWS 密钥 / AWS key",
  "github-token": "GitHub 令牌 / GitHub token",
  "slack-token": "Slack 令牌 / Slack token",
  "private-key": "私钥 / private key",
  "google-key": "Google 密钥 / Google key",
  "bearer-token": "Bearer 令牌 / bearer token",
  "url-credentials": "地址里的账号密码 / credentials in a URL",
  "secret-assignment": "密钥赋值 / secret assignment",
  email: "邮箱 / email",
  "local-path": "本机路径 / local path",
};

export interface PublishArgs {
  dir: string;
  git?: string;
  author?: string;
  tags?: string[];
  languages?: string[];
  ref?: string;
  id?: string;
  license?: string;
  yes?: boolean;
  tty: boolean;
  ask: (question: string) => Promise<string>;
  log: (line: string) => void;
}

function flowLanguages(flow: Flow): ("zh" | "en")[] {
  const set = new Set<"zh" | "en">();
  if (flow.language === "zh" || flow.language === "en") set.add(flow.language);
  const input = flow.inputs?.language;
  if (input && Array.isArray(input.enum)) {
    for (const value of input.enum) if (value === "zh" || value === "en") set.add(value);
  }
  return [...set];
}

function parseLanguages(text: string): ("zh" | "en")[] | undefined {
  const parts = text.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => part !== "zh" && part !== "en")) return undefined;
  if (new Set(parts).size !== parts.length) return undefined;
  return parts as ("zh" | "en")[];
}

function hasSources(md: string): boolean {
  return md.split(/\r?\n/).some((line) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    return heading ? isSourcesHeading(heading[2] ?? "") : false;
  });
}

/** Whether `dir` is inside a Git repository (a `.git` in it or above it). */
function insideGitRepo(dir: string): boolean {
  for (let current = dir; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    if (path.dirname(current) === current) return false;
  }
}

/**
 * The flow folder's LICENSE, or, inside a Git repository, the nearest one above
 * it up to the repository root (a flow in a subfolder, like examples/agent-page).
 * Outside a repository only the flow folder counts.
 */
function licenseFile(dir: string): string | undefined {
  const here = (folder: string) =>
    LICENSE_NAMES.map((name) => path.join(folder, name)).find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!insideGitRepo(dir)) return here(dir);
  for (let current = dir; ; current = path.dirname(current)) {
    const found = here(current);
    if (found) return found;
    if (fs.existsSync(path.join(current, ".git")) || path.dirname(current) === current) return undefined;
  }
}

function walkFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "runs" || entry.name === ".flowgit") continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function collectReasons(dir: string, loaded: LoadedFlow | undefined, licenseName: string): string[] {
  const reasons: string[] = [];
  if (loaded) {
    for (const issue of validateFlow(loaded.flow, { dir: loaded.dir })) {
      if (issue.level === "error") reasons.push(`校验 / validate ${issue.path || "/"}: ${issue.message}`);
    }
  }
  const license = licenseFile(dir);
  if (!license) reasons.push("没有 LICENSE / no LICENSE file");
  else if (fs.statSync(license).size === 0) reasons.push("LICENSE 是空的 / LICENSE is empty");
  if (!licenseName) reasons.push("说不清许可证。在 flow.json 写 license，或加上 --license / No license name. Set license in flow.json or pass --license");
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) reasons.push("没有 README.md / no README.md");
  else if (!hasSources(fs.readFileSync(readme, "utf8"))) reasons.push("README 没有「依据 / Sources」一节 / the README has no 依据 / Sources section");
  if (fs.existsSync(path.join(dir, "runs"))) reasons.push("含有 runs/，发布前请删掉运行历史 / runs/ is present; delete the run history before publishing");
  const files = loaded ? flowFiles(loaded, { withOutputs: true }) : walkFiles(dir);
  for (const finding of findPrivateData(dir, files)) {
    const label = FINDING_LABEL[finding.kind] ?? finding.kind;
    reasons.push(`${finding.file}:${finding.line} ${label} ${finding.preview}`);
  }
  return reasons;
}

function printReasons(log: (line: string) => void, reasons: string[]): void {
  log(`${c.red("✗")} 不能发布 / Cannot publish`);
  for (const reason of reasons) log(`- ${reason}`);
}

/** Privacy check, then validate, LICENSE, sources, runs/ and keys. On success, print the entry and the manual GitHub steps. */
export async function executePublish(args: PublishArgs): Promise<number> {
  const dir = path.resolve(args.dir);
  let loaded: LoadedFlow | undefined;
  const reasons: string[] = [];
  try {
    loaded = loadFlow(dir);
  } catch (err) {
    if (err instanceof FlowValidationError) {
      for (const issue of err.issues) {
        if (issue.level === "error") reasons.push(`校验 / validate ${issue.path || "/"}: ${issue.message}`);
      }
    } else if (!findFlowFile(dir)) {
      args.log(`${c.red("✗")} ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    } else {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  let licenseName = args.license?.trim() || "";
  if (!licenseName && loaded && typeof loaded.flow.license === "string") licenseName = loaded.flow.license.trim();
  if (!licenseName) {
    try {
      const file = findFlowFile(dir);
      if (file) {
        const data = readFlowFile(file) as { license?: unknown };
        if (typeof data.license === "string") licenseName = data.license.trim();
      }
    } catch {
      // the validation errors already say the file could not be read
    }
  }
  reasons.push(...collectReasons(dir, loaded, licenseName));
  if (reasons.length) {
    printReasons(args.log, reasons);
    return 1;
  }
  if (!loaded) return 1;

  const id = (args.id?.trim() || (typeof loaded.flow.id === "string" ? loaded.flow.id.trim() : "") || path.basename(loaded.dir)).trim();
  let git = args.git?.trim() || "";
  let author = args.author?.trim() || loaded.flow.author?.name?.trim() || "";
  const tags = args.tags?.map((tag) => tag.trim()).filter(Boolean) ?? (loaded.flow.tags ?? []).filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim());
  let languages = parseLanguages((args.languages ?? []).join(",")) ?? flowLanguages(loaded.flow);

  const needAsk = !args.yes && args.tty;
  if (!git) {
    if (!needAsk) {
      args.log("没有 Git 地址。加上 --git，或在终端里运行以便询问 / No Git URL. Pass --git, or run in a terminal so it can ask.");
      return 1;
    }
    git = (await args.ask("Git 地址 / Git URL: ")).trim();
  }
  if (!author) {
    if (!needAsk) {
      args.log("没有作者。加上 --author，或在 flow.json 里写 author.name / No author. Pass --author, or set author.name in flow.json.");
      return 1;
    }
    author = (await args.ask("作者 / Author: ")).trim();
  }
  if (!languages.length) {
    if (!needAsk) {
      args.log("没有语言。加上 --language zh 或 --language en / No language. Pass --language zh or --language en.");
      return 1;
    }
    const answer = await args.ask("语言 zh、en 或 zh,en / Languages zh, en, or zh,en: ");
    const parsed = parseLanguages(answer);
    if (!parsed) {
      args.log("语言只能是 zh 和 en / languages must be zh and en only");
      return 1;
    }
    languages = parsed;
  }
  if (!git || !author) {
    args.log("Git 地址和作者都不能空 / The Git URL and the author are both required");
    return 1;
  }

  const entry: CommunityEntry = {
    id,
    name: splitBilingual(loaded.flow.name),
    description: splitBilingual(loaded.flow.description || loaded.flow.name),
    git,
    author,
    tags,
    language: languages,
    license: licenseName,
  };
  if (args.ref?.trim()) entry.ref = args.ref.trim();
  const checked = validateCommunityRegistry([entry]);
  if (!checked.ok) {
    printReasons(args.log, checked.errors);
    return 1;
  }
  args.log(publishInstructions(checked.entries[0] ?? entry));
  return 0;
}

async function askOnce(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } catch {
    return "";
  } finally {
    rl.close();
  }
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

export function registerPublish(program: Command, fail: (err: unknown) => never): void {
  program
    .command("publish")
    .description("检查流程并打印社区登记条目 / check a flow and print a community registry entry")
    .argument("[dir]", "流程目录，默认当前目录 / flow directory (default: the current directory)", ".")
    .option("--git <url>", "Git 地址，子目录用 #path= / Git URL; a subdirectory is #path=")
    .option("--author <name>", "作者 / author")
    .option("--tag <tag>", "标签，可重复 / tag, repeatable", collect)
    .option("--language <lang>", "zh 或 en，可重复 / zh or en, repeatable", collect)
    .option("--ref <ref>", "分支、标签或提交 / branch, tag or commit")
    .option("--id <id>", "登记 id，默认用流程的 id / registry id, defaulting to the flow id")
    .option("--license <name>", "许可证名字，默认用流程里的 / license name, defaulting to the flow's")
    .option("-y, --yes", "不再询问 / do not ask")
    .action(async (dir: string, opts: { git?: string; author?: string; tag?: string[]; language?: string[]; ref?: string; id?: string; license?: string; yes?: boolean }) => {
      try {
        const code = await executePublish({
          dir,
          ...(opts.git ? { git: opts.git } : {}),
          ...(opts.author ? { author: opts.author } : {}),
          ...(opts.tag ? { tags: opts.tag } : {}),
          ...(opts.language ? { languages: opts.language } : {}),
          ...(opts.ref ? { ref: opts.ref } : {}),
          ...(opts.id ? { id: opts.id } : {}),
          ...(opts.license ? { license: opts.license } : {}),
          ...(opts.yes ? { yes: true } : {}),
          tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
          ask: askOnce,
          log: (line) => console.log(line),
        });
        if (code !== 0) process.exitCode = code;
      } catch (err) {
        fail(err);
      }
    });
}
