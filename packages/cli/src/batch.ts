import fs from "node:fs";
import path from "node:path";
import {
  HumanInputNeededError,
  LOCAL_FILE,
  coerceFlowInput,
  flowFiles,
  loadFlow,
  runAll,
  trustFlow,
  trustState,
  usageTokens,
  type FlowInput,
  type LoadedFlow,
  type RunEvent,
  type TrustState,
} from "@flowgit/core";
import { parseCsv } from "./csv.js";
import { c, table } from "./format.js";

/** Characters that are illegal in a file name on Windows or POSIX. */
const ILLEGAL_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;

export interface ModelUsage {
  input: number;
  output: number;
  calls: number;
}

export interface BatchOptions {
  /** Flow directory (already resolved, the same path `-C` uses). */
  flowDir: string;
  /** CSV path. Relative paths are from the current working directory. */
  csvPath: string;
  /** Output directory, relative to the flow directory unless absolute. */
  out: string;
  /** `--concurrency` text. Defaults to 1; the maximum is 4. */
  concurrency?: string;
  /** `--rows a-b`, 1-based data rows, header not counted. */
  rows?: string;
}

interface Job {
  n: number;
  folder: string;
  inputs: Record<string, unknown>;
}

interface RowResult extends Job {
  state: "done" | "waiting" | "failed";
  /** Stage id when waiting, or the first line of the error when failed. */
  detail: string;
  usage: ModelUsage;
}

/** `<3-digit>-<short name>` from the first cell. Illegal characters are removed; the name is at most 40 characters. */
export function rowFolder(n: number, raw: string): string {
  const stripped = raw.replace(ILLEGAL_NAME, "").trim().replace(/[. ]+$/g, "");
  const clipped = Array.from(stripped).slice(0, 40).join("").replace(/[. ]+$/g, "");
  return `${String(n).padStart(3, "0")}-${clipped || "row"}`;
}

/** 1 to 4, or a bilingual error. An omitted value is 1. */
export function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`并发必须是 1 到 4 的整数，收到 "${raw}" / concurrency must be an integer from 1 to 4, got "${raw}"`);
  }
  const n = Number(raw);
  if (n < 1) {
    throw new Error(`并发必须是 1 到 4 的整数，收到 "${raw}" / concurrency must be an integer from 1 to 4, got "${raw}"`);
  }
  if (n > 4) throw new Error(`并发最多 4，收到 ${n} / concurrency is at most 4, got ${n}`);
  return n;
}

/**
 * Inclusive 1-based data-row range. `a-b` only.
 * Throws when the range is outside the CSV.
 */
export function parseRowRange(spec: string, total: number): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec(spec.trim());
  if (!m) {
    throw new Error(`--rows 要写成 a-b，例如 2-10，收到 "${spec}" / --rows must look like a-b, e.g. 2-10, got "${spec}"`);
  }
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start < 1 || end < start) {
    throw new Error(`--rows 要写成 a-b，且 a、b 都是正整数、a 不大于 b，收到 "${spec}" / --rows must be a-b with positive integers and a <= b, got "${spec}"`);
  }
  if (start > total || end > total) {
    throw new Error(`CSV 只有 ${total} 行数据，--rows 是 ${spec} / CSV has ${total} data row(s), --rows is ${spec}`);
  }
  return [start, end];
}

/** Trimmed header names. Empty or repeated names are errors. */
export function columnHeaders(cells: string[]): string[] {
  const headers = cells.map((cell) => cell.trim());
  headers.forEach((name, i) => {
    if (!name) throw new Error(`表头第 ${i + 1} 列是空的 / header column ${i + 1} is empty`);
  });
  const seen = new Set<string>();
  for (const name of headers) {
    if (seen.has(name)) throw new Error(`表头重复 / duplicate column: ${name}`);
    seen.add(name);
  }
  return headers;
}

/** Pad a short row with empty cells. Extra cells are a CSV error, not a row failure. */
export function alignCells(row: string[], width: number, dataRow: number): string[] {
  if (row.length > width) {
    const extra = row.length - width;
    throw new Error(`第 ${dataRow} 行数据多了 ${extra} 列 / data row ${dataRow} has ${extra} extra column(s)`);
  }
  if (row.length === width) return row;
  return [...row, ...Array.from({ length: width - row.length }, () => "")];
}

/**
 * Files copied for one row: the same set as `init -t <dir>` (no outputs,
 * `runs/`, `flowgit.local.json`, `.env*`, `node_modules/` or `.git/`).
 * `skipDir` is the output directory when it sits inside the flow, so a
 * `batch/` folder is not copied into itself.
 */
export function filesToCopy(loaded: LoadedFlow, skipDir?: string): string[] {
  return flowFiles(loaded, { withOutputs: false }).filter((rel) => {
    if (!skipDir) return true;
    return rel !== skipDir && !rel.startsWith(`${skipDir}/`);
  });
}

/** Add one stage's model usage. A call with no reported tokens does not count, matching `run`. */
export function addModelUsage(bucket: ModelUsage, params: Record<string, unknown> | undefined): void {
  const tokens = usageTokens(params?.usage as Record<string, unknown> | undefined);
  if (!tokens) return;
  bucket.input += tokens.input;
  bucket.output += tokens.output;
  bucket.calls += Array.isArray(params?.llmCalls) ? params.llmCalls.length : 1;
}

/** Relative path of `outDir` inside `flowDir`, or undefined when it is outside. The flow directory itself is refused. */
function outputInsideFlow(flowDir: string, outDir: string): string | undefined {
  const rel = path.relative(flowDir, outDir);
  if (rel === "") {
    throw new Error("输出目录不能是流程目录本身 / the output directory can't be the flow directory itself");
  }
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("/");
}

function copyFiles(src: string, dest: string, rels: string[]): void {
  for (const rel of rels) {
    const from = path.join(src, ...rel.split("/"));
    const to = path.join(dest, ...rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/**
 * Replace `inputs` in flowgit.local.json and keep every other key.
 * Empty CSV cells are omitted, so the flow's defaults apply.
 * A null-prototype object keeps a key named "__proto__" as a real key.
 */
function writeInputs(dir: string, inputs: Record<string, unknown>): void {
  const file = path.join(dir, LOCAL_FILE);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${LOCAL_FILE} 不是 JSON 对象 / ${LOCAL_FILE} is not a JSON object`);
    }
    existing = parsed as Record<string, unknown>;
  }
  const safe = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(inputs)) safe[key] = value;
  fs.writeFileSync(file, `${JSON.stringify({ ...existing, inputs: safe }, null, 2)}\n`);
}

function inputsFromRow(headers: string[], cells: string[], defs: Record<string, FlowInput>): Record<string, unknown> {
  const inputs = Object.create(null) as Record<string, unknown>;
  headers.forEach((key, i) => {
    const raw = cells[i] ?? "";
    if (raw === "") return;
    inputs[key] = coerceFlowInput(defs[key], raw);
  });
  return inputs;
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = message.split(/\r?\n/)[0]?.trim() ?? "";
  return line || "未知错误 / unknown error";
}

function formatEvent(e: RunEvent): string | undefined {
  switch (e.type) {
    case "stage:start":
      return `${c.bold("▶")} ${e.stage.name} ${c.dim(`(${e.stage.id}, ${e.stage.executor.type})`)}`;
    case "stage:skip":
      return `${c.dim("·")} ${e.stage.name} ${c.dim(`(${e.stage.id}) 跳过 / skipped: ${e.reason}`)}`;
    case "stage:log":
      return c.dim(`    ${e.line}`);
    case "stage:done":
      return `${c.green("✓")} ${e.stage.name} ${c.dim(`→ runs/${e.stage.id}/${e.n}/`)}`;
    case "stage:error":
      return `${c.red("✗")} ${e.stage.name} ${c.dim(`(${e.stage.id})`)}`;
    default:
      return undefined;
  }
}

function usageLine(t: ModelUsage): string {
  return `用量合计 / total usage: ${t.input} 输入 input + ${t.output} 输出 output tokens（${t.calls} 次模型调用 / model calls）`;
}

function stateCell(row: RowResult): string {
  if (row.state === "done") return c.green("done");
  if (row.state === "waiting") return c.yellow(`waiting: ${row.detail}`);
  return c.red(`failed: ${row.detail}`);
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

function readJobs(text: string, defs: Record<string, FlowInput>, rows: string | undefined): Job[] {
  const tableRows = parseCsv(text);
  if (tableRows.length === 0) throw new Error("CSV 是空的 / CSV is empty");
  const headers = columnHeaders(tableRows[0]!);
  const unknown = headers.filter((name) => !Object.hasOwn(defs, name));
  if (unknown.length) {
    const known = Object.keys(defs);
    const list = known.length ? known.join(", ") : "（这个流程没有输入 / this flow has no inputs）";
    throw new Error(`没有这个输入 / Unknown column(s): ${unknown.join(", ")}\n  可以填的 / known inputs: ${list}`);
  }
  const data = tableRows.slice(1);
  if (data.length === 0) throw new Error("CSV 没有数据行 / CSV has no data rows");
  const jobs = data.map((row, index) => {
    const n = index + 1;
    const cells = alignCells(row, headers.length, n);
    return { n, folder: rowFolder(n, cells[0] ?? ""), inputs: inputsFromRow(headers, cells, defs) };
  });
  const [start, end] = rows ? parseRowRange(rows, jobs.length) : [1, jobs.length];
  return jobs.filter((job) => job.n >= start && job.n <= end);
}

async function runJob(loaded: LoadedFlow, source: TrustState, root: string, rels: string[], job: Job): Promise<RowResult> {
  const dir = path.join(root, job.folder);
  const usage: ModelUsage = { input: 0, output: 0, calls: 0 };
  const log = (line: string) => console.log(`${c.dim(`[${job.folder}]`)} ${line}`);
  try {
    if (fs.existsSync(dir)) {
      if (!fs.statSync(dir).isDirectory()) {
        throw new Error(`${dir} 已有同名文件，没法建文件夹 / a file with this name already exists, so the folder can't be created`);
      }
      log(c.dim("已有这个文件夹，不重新复制 / folder already exists, not copying"));
    } else {
      fs.mkdirSync(dir, { recursive: true });
      copyFiles(loaded.dir, dir, rels);
      log(c.dim(`复制了 ${rels.length} 个文件 / copied ${rels.length} file(s)`));
    }
    writeInputs(dir, job.inputs);
    const copy = loadFlow(dir);
    // A flow copied from a Git URL is confirmed per folder. The source was confirmed before
    // the batch started, so a copy that does exactly the same things runs under that
    // confirmation; one that differs (an older row folder someone edited) is asked for again.
    if (source.reason === "trusted") {
      const own = trustState(copy);
      if (own.needed && own.fingerprint === source.fingerprint) trustFlow(copy, own.fingerprint);
    }
    await runAll(copy, {
      onEvent: (event) => {
        const line = formatEvent(event);
        if (line) log(line);
        if (event.type === "stage:done" || event.type === "stage:error") addModelUsage(usage, event.record?.params);
      },
    });
    return { ...job, state: "done", detail: "", usage };
  } catch (err) {
    if (err instanceof HumanInputNeededError) {
      log(`${c.yellow("⏸")} 「${err.stage.name}」在等你 / waiting for you: ${err.missing.join(", ")}`);
      return { ...job, state: "waiting", detail: err.stage.id, usage };
    }
    const detail = firstLine(err);
    log(`${c.red("✗")} ${detail}`);
    return { ...job, state: "failed", detail, usage };
  }
}

function printSummary(results: RowResult[]): number {
  const rows = [[c.dim("#"), c.dim("文件夹 folder"), c.dim("状态 state"), c.dim("用量 tokens")]];
  const total: ModelUsage = { input: 0, output: 0, calls: 0 };
  for (const row of results) {
    rows.push([String(row.n), row.folder, stateCell(row), String(row.usage.input + row.usage.output)]);
    total.input += row.usage.input;
    total.output += row.usage.output;
    total.calls += row.usage.calls;
  }
  console.log(`\n${table(rows)}`);
  console.log(c.dim(`\n${usageLine(total)}`));
  if (results.some((row) => row.state === "failed")) return 1;
  if (results.some((row) => row.state === "waiting")) return 2;
  return 0;
}

/**
 * Copy the flow once per CSV row, write that row's inputs, and `runAll`.
 * Returns 0 when every selected row finished, 2 when some are waiting and
 * none failed, and 1 when any row failed.
 */
export async function runBatch(opts: BatchOptions): Promise<number> {
  const concurrency = parseConcurrency(opts.concurrency);
  const loaded = loadFlow(opts.flowDir);
  const csvPath = path.resolve(opts.csvPath);
  if (!fs.existsSync(csvPath) || !fs.statSync(csvPath).isFile()) {
    throw new Error(`找不到 CSV 文件 / CSV file not found: ${csvPath}`);
  }
  const jobs = readJobs(fs.readFileSync(csvPath, "utf8"), loaded.flow.inputs ?? {}, opts.rows);
  const root = path.resolve(loaded.dir, opts.out);
  const rels = filesToCopy(loaded, outputInsideFlow(loaded.dir, root));
  fs.mkdirSync(root, { recursive: true });
  const results = new Array<RowResult>(jobs.length);
  const source = trustState(loaded);
  await mapPool(jobs, concurrency, async (job, index) => {
    results[index] = await runJob(loaded, source, root, rels, job);
  });
  return printSummary(results);
}
