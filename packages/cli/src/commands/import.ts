import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import {
  type Finding,
  type Flow,
  type ImportFormat,
  findFlowFile,
  findPrivateData,
  flowActions,
  importWorkflow,
  readFlowFile,
  renderFlowText,
  validateFlow,
  writeFlowFile,
} from "@flowgit/core";
import { c } from "../format.js";

export interface ImportCommand {
  /** Absolute path of the Dify DSL or n8n workflow. */
  file: string;
  /** Absolute directory to write into. */
  outDir: string;
  /** `dify` or `n8n`. Anything else is an error. Omitted means detect. */
  format?: string;
  dryRun?: boolean;
  log: (line: string) => void;
}

function formatOf(value: string | undefined): ImportFormat | "invalid" | undefined {
  if (!value) return undefined;
  const text = value.trim().toLowerCase();
  if (text === "dify" || text === "n8n") return text;
  return "invalid";
}

function relativeFiles(flow: Flow, files: Record<string, string>): string[] {
  return ["flow.json", ...Object.keys(files).sort()];
}

function collisions(dir: string, rels: string[]): string[] {
  const found: string[] = [];
  try {
    const existing = findFlowFile(dir);
    if (existing) found.push(existing);
  } catch (err) {
    found.push(err instanceof Error ? err.message : String(err));
  }
  for (const rel of rels) {
    if (rel === "flow.json") continue;
    const abs = path.join(dir, ...rel.split("/"));
    if (fs.existsSync(abs)) found.push(abs);
  }
  return found;
}

function printReport(flow: Flow, files: Record<string, string>, report: { node: string; type: string; became: string; note: string }[], log: (line: string) => void): void {
  log("导入报告 / Import report");
  for (const entry of report) {
    const who = entry.node ? `${entry.node} (${entry.type})` : entry.type;
    log(`  ${who} → ${entry.became}${entry.note ? ` — ${entry.note}` : ""}`);
  }
  log("\n要写入的文件 / files to write:");
  for (const rel of relativeFiles(flow, files)) log(`  ${rel}`);
}

function printFindings(findings: Finding[], log: (line: string) => void): void {
  for (const finding of findings) log(`  ${finding.file}:${finding.line} ${finding.kind} ${finding.preview}`);
}

/** Read a Dify or n8n file, print the report, and write a flow after the privacy check. Returns the exit code. */
export function executeImport(args: ImportCommand): number {
  const format = formatOf(args.format);
  if (format === "invalid") {
    args.log(`${c.red("✗")} --from 只能是 dify 或 n8n，收到 "${args.format}" / --from must be dify or n8n, got "${args.format}"`);
    return 1;
  }
  if (!fs.existsSync(args.file) || !fs.statSync(args.file).isFile()) {
    args.log(`${c.red("✗")} 找不到文件 / file not found: ${args.file}`);
    return 1;
  }
  let text: string;
  try {
    text = fs.readFileSync(args.file, "utf8");
  } catch (err) {
    args.log(`${c.red("✗")} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  let result;
  try {
    result = importWorkflow(text, { filename: args.file, ...(format ? { format } : {}) });
  } catch (err) {
    args.log(`${c.red("✗")} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  printReport(result.flow, result.files, result.report, args.log);
  const rels = relativeFiles(result.flow, result.files);
  const blocked = collisions(args.outDir, rels);
  if (!args.dryRun && blocked.length) {
    args.log(`${c.red("✗")} ${blocked[0]} 已存在，没有覆盖 / already exists; nothing was overwritten`);
    return 1;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-import-"));
  try {
    const flowAbs = path.join(tmp, "flow.json");
    fs.writeFileSync(flowAbs, renderFlowText(result.flow, flowAbs));
    for (const [rel, content] of Object.entries(result.files)) {
      const abs = path.join(tmp, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const findings = findPrivateData(tmp, rels);
    const keys = findings.filter((finding) => finding.severity === "high");
    if (keys.length) {
      args.log(`${c.red("✗")} 发现密钥，什么都没写 / A key was found, so nothing was written`);
      printFindings(keys, args.log);
      return 1;
    }
    const issues = validateFlow(readFlowFile(flowAbs), { dir: tmp }).filter((issue) => issue.level === "error");
    if (issues.length) {
      args.log(`${c.red("✗")} 转换结果没有通过校验，什么都没写 / the import did not validate, so nothing was written`);
      for (const issue of issues) args.log(`  ${issue.path}: ${issue.message}`);
      return 1;
    }
    const medium = findings.filter((finding) => finding.severity === "medium");
    if (medium.length) {
      args.log(`${c.yellow("!")} 这些不是密钥，仍会写入 / these are not keys; the files are still written`);
      printFindings(medium, args.log);
    }
    if (args.dryRun) {
      if (blocked.length) {
        args.log(`${c.yellow("!")} 这些文件已存在，真正导入时不会覆盖 / these files already exist; a real import will not overwrite them`);
        for (const file of blocked) args.log(`  ${file}`);
      }
      args.log("只是预演，什么都没写 / dry run, nothing was written");
      return 0;
    }
    fs.mkdirSync(args.outDir, { recursive: true });
    const flow = readFlowFile(flowAbs) as Flow;
    writeFlowFile(path.join(args.outDir, "flow.json"), flow);
    for (const rel of rels) {
      if (rel === "flow.json") continue;
      const from = path.join(tmp, ...rel.split("/"));
      const to = path.join(args.outDir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    const shown = /\s/.test(args.outDir) ? `"${args.outDir}"` : args.outDir;
    args.log(`${c.green("✓")} 已写入 / wrote ${rels.join(", ")}`);
    args.log(`  来源 / source: ${flow.forkedFrom?.source ?? ""}`);
    const next = [`cd ${shown}`, "flowgit status"];
    if (flowActions(flow).length) next.splice(1, 0, "flowgit trust");
    args.log(`  下一步 / next:\n    ${next.join("\n    ")}`);
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function registerImport(program: Command, fail: (err: unknown) => never): void {
  program
    .command("import")
    .description("把 Dify 或 n8n 的工作流变成流程 / turn a Dify or n8n workflow into a flow")
    .argument("<file>", "Dify DSL（.yml）或 n8n 工作流（.json）/ a Dify DSL (.yml) or an n8n workflow (.json)")
    .option("--from <format>", "dify 或 n8n；不写则按内容识别 / dify or n8n; detected from the file when omitted")
    .option("--out <dir>", "写入的目录，默认同 -C / directory to write (default: -C)")
    .option("--dry-run", "只打印报告和文件列表 / print the report and the file list only")
    .action((file: string, opts: { from?: string; out?: string; dryRun?: boolean }) => {
      try {
        const code = executeImport({
          file: path.resolve(file),
          outDir: path.resolve(opts.out ?? program.opts<{ dir: string }>().dir ?? "."),
          ...(opts.from ? { format: opts.from } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
          log: (line) => console.log(line),
        });
        if (code !== 0) process.exitCode = code;
      } catch (err) {
        fail(err);
      }
    });
}
