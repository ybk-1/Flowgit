import path from "node:path";
import readline from "node:readline/promises";
import type { Command } from "commander";
import { findFlowFile, generateFlow, RUNS_ON_COMPUTER, writeGeneratedFlow, type GeneratePlanStep, type GenerateResult } from "@flowgit/core";
import { c, table } from "../format.js";

export const CONFIRM_QUESTION = "写入这些文件？/ Write these files? [y/N] ";

/** y, yes, or 是. Anything else, including an empty answer, is no. */
export function confirmationAccepted(answer: string): boolean {
  const text = answer.trim().toLowerCase();
  return text === "y" || text === "yes" || answer.trim() === "是";
}

const PLAN_LABEL: Record<string, string> = {
  skip: "· 跳过，已是最新 / skip, up to date",
  "keep-edit": "✎ 保留你的手动修改 / keep your edit",
  run: "▶ 运行 / run",
  wait: "⏸ 停下等你 / stops for you",
  "cannot-run": "✗ 不能运行 / can't run",
  "not-reached": "· 走不到 / not reached",
};

export interface NewCommand {
  description: string;
  /** Absolute directory to write into. */
  dir: string;
  model?: string;
  language?: string;
  md?: boolean;
  yes?: boolean;
  /** False when there is no terminal to ask in. */
  tty: boolean;
  ask: (question: string) => Promise<string>;
  log: (line: string) => void;
}

/** Generate a flow, print the dry run and the file list, and write after confirmation. Returns the exit code. */
export async function executeNew(args: NewCommand): Promise<number> {
  const language = args.language?.trim() || undefined;
  if (language && language !== "zh" && language !== "en") {
    args.log(`${c.red("✗")} --language 只能是 zh 或 en，收到 "${language}" / --language must be zh or en, got "${language}"`);
    return 1;
  }
  try {
    const existing = findFlowFile(args.dir);
    if (existing) {
      args.log(`${c.red("✗")} ${existing} 已存在，没有覆盖 / already exists; nothing was overwritten`);
      return 1;
    }
  } catch (err) {
    args.log(`${c.red("✗")} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const result = await generateFlow(args.description, {
    dir: args.dir,
    ...(args.model ? { model: args.model } : {}),
    ...(language ? { language: language as "zh" | "en" } : {}),
    ...(args.md ? { md: true } : {}),
    write: false,
  });
  if (!result.ok) {
    for (const line of result.errors) args.log(`${c.red("✗")} ${line}`);
    args.log("什么都没写 / nothing was written");
    return 1;
  }
  printPreview(result, args.log);
  if (!args.yes) {
    if (!args.tty) {
      args.log("不在终端里，什么都没写。确认写入请加上 --yes / Not a terminal, so nothing was written. Add --yes to write.");
      return 1;
    }
    const answer = await args.ask(CONFIRM_QUESTION);
    if (!confirmationAccepted(answer)) {
      args.log("已取消，什么都没写 / Cancelled, nothing was written.");
      return 1;
    }
  }
  try {
    writeGeneratedFlow(args.dir, result);
  } catch (err) {
    args.log(`${c.red("✗")} ${err instanceof Error ? err.message : String(err)}`);
    args.log("什么都没写 / nothing was written");
    return 1;
  }
  const shown = /\s/.test(args.dir) ? `"${args.dir}"` : args.dir;
  args.log(`${c.green("✓")} 已写入 / wrote ${result.files.map((file) => file.path).join(", ")}`);
  args.log(`  下一步 / next:\n    cd ${shown}\n    flowgit status`);
  return 0;
}

function printPreview(result: Extract<GenerateResult, { ok: true }>, log: (line: string) => void): void {
  log(c.dim("预演：不会运行任何阶段 / dry run: nothing runs\n"));
  const rows = [[c.dim("#"), c.dim("阶段 stage"), c.dim("会怎样 action"), c.dim("详情 details")]];
  result.plan.forEach((step, index) => rows.push(planRow(step, index)));
  log(table(rows));
  log(
    `\n${
      result.modelCalls
        ? `最多 ${result.modelCalls} 次模型调用 / at most ${result.modelCalls} model call(s)`
        : "不会调用模型 / no model calls"
    }`,
  );
  log("\n要写入的文件 / files to write:");
  for (const file of result.files) log(`  ${file.path}`);
  const commands = result.plan.filter((step) => step.runsCommands);
  if (commands.length) {
    log(`\n${RUNS_ON_COMPUTER}:`);
    for (const step of commands) {
      const command = step.detail?.split(" — ")[0];
      log(`  ${step.id}${command ? `: ${command}` : ""}`);
    }
  }
}

function planRow(step: GeneratePlanStep, index: number): string[] {
  return [String(index + 1), `${step.name} ${c.dim(step.id)}`, PLAN_LABEL[step.action] ?? step.action, step.detail ?? ""];
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

export function registerNew(program: Command, fail: (err: unknown) => never): void {
  program
    .command("new")
    .description("用一句话生成流程 / generate a flow from one sentence")
    .argument("<text>", "这个流程要做什么，一句话 / what the flow should do, in one sentence")
    .argument("[dir]", "目标目录，默认当前目录 / target directory (default: the current directory)", ".")
    .option("--model <provider/model>", "生成时用的模型，写成 provider/model / model that writes the flow, as provider/model")
    .option("--language <lang>", "流程和提示词的语言：zh 或 en / language of the flow and its prompts: zh or en")
    .option("--md", "写成 flow.md / write flow.md")
    .option("-y, --yes", "不再询问，直接写入 / write the files without asking")
    .action(async (description: string, dir: string, opts: { model?: string; language?: string; md?: boolean; yes?: boolean }) => {
      try {
        const code = await executeNew({
          description,
          dir: path.resolve(dir),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.language ? { language: opts.language } : {}),
          ...(opts.md ? { md: true } : {}),
          ...(opts.yes ? { yes: true } : {}),
          tty: Boolean(process.stdin.isTTY),
          ask: askOnce,
          log: (line) => console.log(line),
        });
        if (code !== 0) process.exitCode = code;
      } catch (err) {
        fail(err);
      }
    });
}
