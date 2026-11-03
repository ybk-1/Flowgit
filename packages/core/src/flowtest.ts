import { host, path, withHost } from "./host/current.js";
import type { Host, HostEnv } from "./host/types.js";
import { requireStage, topoOrder } from "./graph.js";
import { loadFlow, resolveFlowDir, writeFlowFile } from "./load.js";
import { planRunAll } from "./plan.js";
import { loadFlowInputs, stageStatus } from "./runs.js";
import { recordManualEdit, runAll, runStage } from "./run.js";
import { schemaProblems } from "./schema-check.js";
import { assertTrusted } from "./trust.js";
import type { Flow, LoadedFlow, Stage } from "./types.js";
import type { RunOptions } from "./executors/types.js";
import { isSafeRelative, outputRel, staysInside } from "./util.js";

/**
 * Run the cases in `<flow>/tests/*.json` and check the outputs.
 *
 * The flow is copied to a temporary directory (without runs/, node_modules/,
 * .git/, .flowgit/ or flowgit.local.json) and every read or write goes through
 * the Host. The original directory is never written. Trust is checked on the
 * original directory; after it passes, the copy's flow is written without
 * `forkedFrom`, so `runAll` does not ask again (a copy lives in a different
 * directory, so the original confirmation would not cover it).
 *
 * Skipped stages are recorded with `recordManualEdit` once their upstreams have
 * finished, then `runAll` runs the rest and leaves those manual versions in
 * place. `run.ts` has no skip hook and is left unchanged.
 *
 * Model and picture replies come from the host environment
 * (`FLOWGIT_LLM_MOCK_DIR`, `FLOWGIT_IMAGE_MOCK_DIR`), never from `process.env`.
 */

const SKIP_COPY = new Set(["runs", "node_modules", ".git", ".flowgit"]);
const PREVIEW = 200;

const CASE_KEYS = new Set(["name", "inputs", "replies", "images", "files", "skip", "expect"]);
const CHECK_KEYS = new Set([
  "file", "exists", "contains", "notContains", "matches", "minChars", "maxChars",
  "json", "jsonPath", "equals", "min", "max", "length",
]);

export interface FlowTestCheckResult {
  stage: string;
  file: string;
  ok: boolean;
  /** Bilingual description of what the check required. */
  expected: string;
  /** First 200 characters of the file when the check failed. */
  actual?: string;
}

export interface FlowTestCaseResult {
  /** File name without `.json`. */
  id: string;
  /** `name` from the case, or `id` when the case has none. */
  name: string;
  /** File name, e.g. `sample.json`. */
  file: string;
  ok: boolean;
  /** Run or case error. Absent when the case ran and only checks were evaluated. */
  error?: string;
  checks: FlowTestCheckResult[];
  /** Temporary copy, set when `keep` is on. */
  dir?: string;
}

export interface FlowTestReport {
  ok: boolean;
  cases: FlowTestCaseResult[];
  /** Set when `live` is on: at most how many model calls the selected cases would make. */
  modelCalls?: number;
}

export interface FlowTestOptions {
  /** File names (with or without `.json`) or a case's `name`. Omit to run every case. */
  names?: string[];
  /** Call real models. Otherwise llm and image stages use canned files and never call out. */
  live?: boolean;
  /** `<model>` or `<provider>/<model>`, passed to the run when `live` is set. */
  model?: string;
  /** Leave the temporary copy in place and return its path on each case. */
  keep?: boolean;
  /** Called once, before any case runs, when `live` is set. */
  onPlan?: (info: { modelCalls: number }) => void;
}

interface FlowTestCheck {
  file: string;
  exists?: boolean;
  contains?: string[];
  notContains?: string[];
  matches?: string;
  minChars?: number;
  maxChars?: number;
  json?: true;
  jsonPath?: string;
  equals?: unknown;
  hasEquals: boolean;
  min?: number;
  max?: number;
  length?: number;
}

interface FlowTestCase {
  name?: string;
  inputs?: Record<string, unknown>;
  replies?: string;
  images?: string;
  files?: Record<string, string>;
  skip?: string[];
  expect: Record<string, FlowTestCheck[]>;
}

interface Selected {
  id: string;
  file: string;
  testCase?: FlowTestCase;
  parseError?: string;
}

interface Prepared {
  selected: Selected;
  tmp?: string;
  loaded?: LoadedFlow;
  error?: string;
}

/** Run every selected case. Throws when the flow itself is missing, untrusted, or a name matches nothing. */
export async function runFlowTests(dir: string, opts: FlowTestOptions = {}): Promise<FlowTestReport> {
  const root = resolveFlowDir(dir);
  const original = loadFlow(root);
  // The confirmation belongs to the original directory. The copy is a different folder.
  assertTrusted(original);

  const selected = selectCases(root, opts.names);
  const prepared = selected.map((item) => prepareCase(root, item));

  let modelCalls: number | undefined;
  if (opts.live) {
    modelCalls = await withHost(hostWithEnv({ FLOWGIT_LLM_MOCK_DIR: undefined, FLOWGIT_IMAGE_MOCK_DIR: undefined }), async () => {
      let total = 0;
      for (const item of prepared) {
        if (!item.loaded || !item.selected.testCase) continue;
        total += countModelCalls(item.loaded, item.selected.testCase, opts.model);
      }
      return total;
    });
    opts.onPlan?.({ modelCalls });
  }

  const cases: FlowTestCaseResult[] = [];
  for (const item of prepared) cases.push(await runPrepared(item, opts));
  return { ok: cases.every((item) => item.ok), cases, ...(modelCalls !== undefined ? { modelCalls } : {}) };
}

function selectCases(root: string, names: string[] | undefined): Selected[] {
  const testsDir = path.join(root, "tests");
  if (!host().exists(testsDir)) return filterNames([], names);
  if (!host().stat(testsDir).isDirectory()) {
    throw new Error("tests 应该是文件夹 / tests should be a directory");
  }
  const files = host().readdir(testsDir).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b));
  const all = files.map((file) => loadCase(root, file));
  return filterNames(all, names);
}

function filterNames(all: Selected[], names: string[] | undefined): Selected[] {
  if (!names?.length) return all;
  const picked = all.filter((item) => names.some((want) => matchesName(item, want)));
  const missing = names.filter((want) => !all.some((item) => matchesName(item, want)));
  if (missing.length) {
    const have = all.map((item) => (item.testCase?.name && item.testCase.name !== item.id ? `${item.id} (${item.testCase.name})` : item.id));
    throw new Error(
      `没有这个测试：${missing.join(", ")} / No such test: ${missing.join(", ")}（现有 / have: ${have.join(", ") || "无 / none"}）`,
    );
  }
  return picked;
}

function matchesName(item: Selected, want: string): boolean {
  const stem = want.endsWith(".json") ? want.slice(0, -".json".length) : want;
  return item.id === want || item.id === stem || item.testCase?.name === want;
}

function loadCase(root: string, file: string): Selected {
  const id = file.slice(0, -".json".length);
  const abs = path.join(root, "tests", file);
  let data: unknown;
  try {
    data = JSON.parse(host().readFile(abs, "utf8")) as unknown;
  } catch (err) {
    return { id, file, parseError: `${file} 不是合法的 JSON / ${file} is not valid JSON: ${(err as Error).message}` };
  }
  try {
    return { id, file, testCase: parseFlowTest(data, file) };
  } catch (err) {
    return { id, file, parseError: (err as Error).message };
  }
}

function prepareCase(root: string, selected: Selected): Prepared {
  if (selected.parseError || !selected.testCase) {
    return { selected, error: selected.parseError ?? `${selected.file} 无法读取 / ${selected.file} could not be read` };
  }
  try {
    validateCasePaths(root, selected.testCase);
  } catch (err) {
    return { selected, error: (err as Error).message };
  }
  const tmp = makeTemp();
  try {
    copyFlowTree(root, tmp);
    stripForkedFrom(tmp);
    const loaded = loadFlow(tmp);
    assertCaseFits(loaded, selected.testCase);
    placeFiles(tmp, selected.testCase.files ?? {});
    loadFlowInputs(tmp, loaded.flow, selected.testCase.inputs ?? {});
    return { selected, tmp, loaded };
  } catch (err) {
    return { selected, tmp, error: (err as Error).message };
  }
}

async function runPrepared(item: Prepared, opts: FlowTestOptions): Promise<FlowTestCaseResult> {
  const testCase = item.selected.testCase;
  const result: FlowTestCaseResult = {
    id: item.selected.id,
    name: testCase?.name || item.selected.id,
    file: item.selected.file,
    ok: false,
    checks: [],
  };
  if (item.error || !item.loaded || !testCase || !item.tmp) {
    result.error = item.error ?? `${item.selected.file} 无法准备 / ${item.selected.file} could not be prepared`;
    if (item.tmp) finishTemp(item.tmp, opts.keep, result);
    return result;
  }
  const loaded = item.loaded;
  const tmp = item.tmp;
  try {
    await withHost(hostWithEnv(mockEnv(tmp, testCase, !!opts.live)), async () => {
      await executeCase(loaded, testCase, opts.model);
      result.checks = evaluateChecks(loaded, testCase);
      result.ok = result.checks.every((check) => check.ok);
    });
  } catch (err) {
    result.ok = false;
    result.error = (err as Error).message;
    result.checks = [];
  } finally {
    finishTemp(tmp, opts.keep, result);
  }
  return result;
}

function finishTemp(tmp: string, keep: boolean | undefined, result: FlowTestCaseResult): void {
  if (keep) {
    result.dir = tmp;
    return;
  }
  host().rm(tmp, { recursive: true, force: true });
}

function mockEnv(copyDir: string, testCase: FlowTestCase, live: boolean): Record<string, string | undefined> {
  if (live) return { FLOWGIT_LLM_MOCK_DIR: undefined, FLOWGIT_IMAGE_MOCK_DIR: undefined };
  // Always set both, even when the directory is absent, so a stage cannot call the network.
  return {
    FLOWGIT_LLM_MOCK_DIR: path.resolve(copyDir, testCase.replies ?? "demo-replies"),
    FLOWGIT_IMAGE_MOCK_DIR: path.resolve(copyDir, testCase.images ?? "demo-pictures"),
  };
}

function countModelCalls(loaded: LoadedFlow, testCase: FlowTestCase, model: string | undefined): number {
  const skip = new Set(testCase.skip ?? []);
  const steps = planRunAll(loaded, { inputs: testCase.inputs ?? {}, ...(model ? { model } : {}) });
  let total = 0;
  for (const step of steps) {
    if (skip.has(step.stage.id)) continue;
    total += step.modelCalls ?? (step.callsModel ? 1 : 0);
  }
  return total;
}

/**
 * Record each skipped stage as a manual run after its upstreams are done, then
 * `runAll`. Already-ok stages (the manual ones, and ancestors just run) are skipped.
 */
async function executeCase(loaded: LoadedFlow, testCase: FlowTestCase, model: string | undefined): Promise<void> {
  const skip = new Set(testCase.skip ?? []);
  const options: RunOptions = { inputs: testCase.inputs ?? {}, ...(model ? { model } : {}) };
  const flowInputs = loadFlowInputs(loaded.dir, loaded.flow, options.inputs);
  const done = new Set<string>();
  const stack = new Set<string>();

  const finishDeps = async (id: string): Promise<void> => {
    if (done.has(id)) return;
    if (stack.has(id)) throw new Error(`阶段成环 / stages form a cycle at "${id}"`);
    stack.add(id);
    const stage = requireStage(loaded.flow, id);
    for (const dep of stage.inputs ?? []) await finishDeps(dep);
    if (skip.has(id)) {
      assertSkipOutputs(loaded, stage, testCase.files ?? {});
      recordManualEdit(loaded, id, flowInputs);
      done.add(id);
      stack.delete(id);
      return;
    }
    const status = stageStatus(loaded, id, flowInputs);
    if (status.state === "ok") {
      done.add(id);
    } else if (status.state === "edited") {
      recordManualEdit(loaded, id, flowInputs);
      done.add(id);
    } else {
      await runStage(loaded, id, options);
      done.add(id);
    }
    stack.delete(id);
  };

  for (const id of topoOrder(loaded.flow)) {
    if (skip.has(id)) await finishDeps(id);
  }
  await runAll(loaded, options);
}

function assertSkipOutputs(loaded: LoadedFlow, stage: Stage, files: Record<string, string>): void {
  const keys = new Set(Object.keys(files).map(norm));
  const needed = stage.outputs.filter((out) => !keys.has(norm(out.path)) && !keys.has(norm(outputRel(out)))).map((out) => out.path);
  if (needed.length) {
    throw new Error(
      `skip 的阶段 "${stage.id}" 的产物要在 files 里提供：${needed.join(", ")} / skip stage "${stage.id}" needs its outputs in files: ${needed.join(", ")}`,
    );
  }
  const absent = stage.outputs.map((out) => outputRel(out)).filter((rel) => !host().exists(path.join(loaded.dir, rel)));
  if (absent.length) {
    throw new Error(
      `skip 的阶段 "${stage.id}" 的产物不存在：${absent.join(", ")} / skip stage "${stage.id}" is missing outputs: ${absent.join(", ")}`,
    );
  }
}

function assertCaseFits(loaded: LoadedFlow, testCase: FlowTestCase): void {
  const ids = new Set(loaded.flow.stages.map((stage) => stage.id));
  for (const id of testCase.skip ?? []) {
    if (!ids.has(id)) throw new Error(`skip 里没有这个阶段 "${id}" / skip lists an unknown stage "${id}"`);
  }
  for (const id of Object.keys(testCase.expect)) {
    if (!ids.has(id)) throw new Error(`expect 里没有这个阶段 "${id}" / expect lists an unknown stage "${id}"`);
  }
  for (const id of testCase.skip ?? []) {
    const stage = requireStage(loaded.flow, id);
    const keys = new Set(Object.keys(testCase.files ?? {}).map(norm));
    const needed = stage.outputs.filter((out) => !keys.has(norm(out.path)) && !keys.has(norm(outputRel(out)))).map((out) => out.path);
    if (needed.length) {
      throw new Error(
        `skip 的阶段 "${id}" 的产物要在 files 里提供：${needed.join(", ")} / skip stage "${id}" needs its outputs in files: ${needed.join(", ")}`,
      );
    }
  }
}

function validateCasePaths(dir: string, testCase: FlowTestCase): void {
  if (testCase.replies) assertInside(dir, testCase.replies, "replies");
  if (testCase.images) assertInside(dir, testCase.images, "images");
  for (const [dest, src] of Object.entries(testCase.files ?? {})) {
    assertInside(dir, dest, "files");
    const abs = assertInside(dir, src, "files");
    if (!host().exists(abs)) throw new Error(`files 里的路径不存在：${src} / files path does not exist: ${src}`);
  }
  for (const checks of Object.values(testCase.expect)) {
    for (const check of checks) assertInside(dir, check.file, "expect");
  }
}

function assertInside(dir: string, rel: string, kind: string): string {
  const abs = path.resolve(dir, rel);
  // isSafeRelative rejects ".." and absolute paths. staysInside follows a symlink that leaves the flow.
  if (!isSafeRelative(rel) || !staysInside(dir, abs)) {
    throw new Error(`${kind} 的路径必须留在流程目录里：${rel} / ${kind} path must stay inside the flow directory: ${rel}`);
  }
  return abs;
}

function placeFiles(dir: string, files: Record<string, string>): void {
  for (const [destRel, srcRel] of Object.entries(files)) {
    const src = assertInside(dir, srcRel, "files");
    const dest = assertInside(dir, destRel, "files");
    if (!host().exists(src)) throw new Error(`files 里的路径不存在：${srcRel} / files path does not exist: ${srcRel}`);
    if (path.resolve(src) === path.resolve(dest)) continue;
    if (host().exists(dest)) host().rm(dest, { recursive: true, force: true });
    host().mkdir(path.dirname(dest), { recursive: true });
    host().copy(src, dest);
  }
}

function stripForkedFrom(dir: string): void {
  const loaded = loadFlow(dir);
  if (!loaded.flow.forkedFrom) return;
  const flow: Flow = { ...loaded.flow };
  delete flow.forkedFrom;
  writeFlowFile(loaded.file, flow);
}

function copyFlowTree(src: string, dest: string): void {
  host().mkdir(dest, { recursive: true });
  const walk = (from: string, to: string) => {
    for (const name of host().readdir(from)) {
      if (SKIP_COPY.has(name) || name === "flowgit.local.json") continue;
      const fromAbs = path.join(from, name);
      const toAbs = path.join(to, name);
      const stat = host().lstat(fromAbs);
      if (stat.isSymbolicLink()) {
        host().mkdir(path.dirname(toAbs), { recursive: true });
        host().copy(fromAbs, toAbs);
      } else if (stat.isDirectory()) {
        host().mkdir(toAbs, { recursive: true });
        walk(fromAbs, toAbs);
      } else if (stat.isFile()) {
        host().mkdir(path.dirname(toAbs), { recursive: true });
        host().copy(fromAbs, toAbs);
      }
    }
  };
  walk(src, dest);
}

function makeTemp(): string {
  const env = host().env;
  const base = env.TMPDIR || env.TEMP || env.TMP || (host().platform === "win32" ? path.join(host().homedir(), "AppData", "Local", "Temp") : "/tmp");
  const dir = path.join(base, `flowgit-test-${host().pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  host().mkdir(dir, { recursive: true });
  return dir;
}

function hostWithEnv(changes: Record<string, string | undefined>): Host {
  const base = host();
  const env: Record<string, string | undefined> = {};
  for (const key of Object.keys(base.env)) env[key] = base.env[key];
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const readFile = ((file: string, encoding?: "utf8") => (encoding ? base.readFile(file, encoding) : base.readFile(file))) as Host["readFile"];
  const readdir = ((file: string, options?: { withFileTypes: true }) => (options ? base.readdir(file, options) : base.readdir(file))) as Host["readdir"];
  return {
    name: base.name,
    get platform() {
      return base.platform;
    },
    get pid() {
      return base.pid;
    },
    path: base.path,
    readFile,
    writeFile: (file, data) => base.writeFile(file, data),
    readdir,
    stat: (file) => base.stat(file),
    lstat: (file) => base.lstat(file),
    mkdir: (file, options) => base.mkdir(file, options),
    rm: (file, options) => base.rm(file, options),
    rename: (from, to) => base.rename(from, to),
    exists: (file) => base.exists(file),
    realpath: (file) => base.realpath(file),
    copy: (from, to) => base.copy(from, to),
    hash: () => base.hash(),
    exec: (options) => base.exec(options),
    which: (program, whichEnv) => base.which(program, whichEnv),
    resolveModule: (parentFile, spec) => base.resolveModule(parentFile, spec),
    importModule: (abs) => base.importModule(abs),
    fetch: (input, init) => base.fetch(input, init),
    get env() {
      return env as HostEnv;
    },
    homedir: () => base.homedir(),
    now: () => base.now(),
  };
}

type Content = { kind: "missing" } | { kind: "dir" } | { kind: "file"; text: string };

function evaluateChecks(loaded: LoadedFlow, testCase: FlowTestCase): FlowTestCheckResult[] {
  const results: FlowTestCheckResult[] = [];
  for (const [stageId, checks] of Object.entries(testCase.expect)) {
    const stage = requireStage(loaded.flow, stageId);
    for (const check of checks) results.push(evaluateCheck(loaded, stage, check));
  }
  return results;
}

function evaluateCheck(loaded: LoadedFlow, stage: Stage, check: FlowTestCheck): FlowTestCheckResult {
  const content = readContent(loaded.dir, check.file);
  const assertions: { pass: boolean; expected: string }[] = [];
  if (check.exists !== undefined) {
    const present = content.kind !== "missing";
    assertions.push({
      pass: check.exists ? present : !present,
      expected: check.exists ? "文件存在 / file exists" : "文件不存在 / file does not exist",
    });
  }
  if (check.contains) {
    assertions.push({
      pass: content.kind === "file" && check.contains.every((part) => content.text.includes(part)),
      expected: `包含 / contains ${check.contains.map((part) => JSON.stringify(part)).join("、")}`,
    });
  }
  if (check.notContains) {
    assertions.push({
      pass: content.kind === "file" && check.notContains.every((part) => !content.text.includes(part)),
      expected: `不包含 / does not contain ${check.notContains.map((part) => JSON.stringify(part)).join("、")}`,
    });
  }
  if (check.matches !== undefined) {
    let pass = false;
    let expected = `匹配 / matches ${JSON.stringify(check.matches)}`;
    if (content.kind === "file") {
      try {
        pass = new RegExp(check.matches).test(content.text);
      } catch (err) {
        expected = `正则不合法 / invalid regular expression: ${(err as Error).message}`;
      }
    }
    assertions.push({ pass, expected });
  }
  if (check.minChars !== undefined) {
    const chars = content.kind === "file" ? Array.from(content.text).length : -1;
    assertions.push({ pass: chars >= check.minChars, expected: `至少 ${check.minChars} 个字符 / at least ${check.minChars} characters` });
  }
  if (check.maxChars !== undefined) {
    const chars = content.kind === "file" ? Array.from(content.text).length : Number.POSITIVE_INFINITY;
    assertions.push({ pass: chars <= check.maxChars, expected: `至多 ${check.maxChars} 个字符 / at most ${check.maxChars} characters` });
  }
  if (check.json) {
    const output = stage.outputs.find((out) => norm(outputRel(out)) === norm(check.file) || norm(out.path) === norm(check.file));
    if (output?.schema) {
      let problems: { message: string }[] = [];
      try {
        problems = schemaProblems(loaded.dir, stage).filter((problem) => norm(problem.file) === norm(check.file));
      } catch (err) {
        problems = [{ message: (err as Error).message }];
      }
      const detail = problems[0]?.message;
      assertions.push({
        pass: problems.length === 0 && content.kind === "file",
        expected: detail
          ? `是合法的 JSON，并符合 ${output.schema} / is valid JSON and matches ${output.schema}（${detail}）`
          : `是合法的 JSON，并符合 ${output.schema} / is valid JSON and matches ${output.schema}`,
      });
    } else {
      assertions.push({
        pass: content.kind === "file" && tryParse(content.text) !== undefined,
        expected: "是合法的 JSON / is valid JSON",
      });
    }
  }
  if (check.jsonPath) {
    const parsed = content.kind === "file" ? tryParse(content.text) : undefined;
    if (parsed === undefined) {
      assertions.push({ pass: false, expected: jsonPathExpected(check) });
    } else {
      const found = atPath(parsed, check.jsonPath);
      if (!found.found) {
        assertions.push({ pass: false, expected: jsonPathExpected(check) });
      } else {
        if (check.hasEquals) {
          assertions.push({ pass: sameJson(found.value, check.equals), expected: `${check.jsonPath} 等于 / equals ${JSON.stringify(check.equals)}` });
        }
        if (check.min !== undefined) {
          assertions.push({
            pass: typeof found.value === "number" && Number.isFinite(found.value) && found.value >= check.min,
            expected: `${check.jsonPath} 不小于 / at least ${check.min}`,
          });
        }
        if (check.max !== undefined) {
          assertions.push({
            pass: typeof found.value === "number" && Number.isFinite(found.value) && found.value <= check.max,
            expected: `${check.jsonPath} 不大于 / at most ${check.max}`,
          });
        }
        if (check.length !== undefined) {
          const len = valueLength(found.value);
          assertions.push({ pass: len === check.length, expected: `${check.jsonPath} 的长度是 / length ${check.length}` });
        }
      }
    }
  }
  const failed = assertions.filter((item) => !item.pass);
  const shown = failed.length ? failed : assertions;
  return {
    stage: stage.id,
    file: check.file,
    ok: failed.length === 0,
    expected: shown.map((item) => item.expected).join("；"),
    ...(failed.length ? { actual: contentActual(content) } : {}),
  };
}

function jsonPathExpected(check: FlowTestCheck): string {
  const parts: string[] = [];
  if (check.hasEquals) parts.push(`${check.jsonPath} 等于 / equals ${JSON.stringify(check.equals)}`);
  if (check.min !== undefined) parts.push(`${check.jsonPath} 不小于 / at least ${check.min}`);
  if (check.max !== undefined) parts.push(`${check.jsonPath} 不大于 / at most ${check.max}`);
  if (check.length !== undefined) parts.push(`${check.jsonPath} 的长度是 / length ${check.length}`);
  return parts.join("；") || `${check.jsonPath} 不存在 / ${check.jsonPath} was not found`;
}

function contentActual(content: Content): string {
  if (content.kind === "missing") return "（没有这个文件 / file is missing）";
  if (content.kind === "dir") return "（是文件夹 / is a directory）";
  return preview(content.text);
}

function preview(text: string): string {
  const chars = Array.from(text);
  return chars.length <= PREVIEW ? text : chars.slice(0, PREVIEW).join("");
}

function readContent(dir: string, rel: string): Content {
  if (!isSafeRelative(rel)) return { kind: "missing" };
  const abs = path.resolve(dir, rel);
  if (!staysInside(dir, abs) || !host().exists(abs)) return { kind: "missing" };
  if (host().stat(abs).isDirectory()) return { kind: "dir" };
  return { kind: "file", text: host().readFile(abs, "utf8") };
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function atPath(value: unknown, dotted: string): { found: true; value: unknown } | { found: false } {
  let current = value;
  for (const part of dotted.split(".")) {
    if (part === "length" && (typeof current === "string" || Array.isArray(current))) {
      current = current.length;
      continue;
    }
    if (Array.isArray(current) && /^[0-9]+$/.test(part)) {
      const index = Number(part);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (current && typeof current === "object" && !Array.isArray(current) && Object.hasOwn(current, part)) {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return { found: false };
  }
  return { found: true, value: current };
}

function valueLength(value: unknown): number | undefined {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  return undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameJson(item, b[index]));
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
  return aKeys.every((key) => sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function parseFlowTest(data: unknown, file: string): FlowTestCase {
  if (!isObject(data)) fail(file, "测试用例必须是 JSON 对象 / a test case must be a JSON object");
  for (const key of Object.keys(data)) {
    if (!CASE_KEYS.has(key)) fail(file, `测试用例有不认识的字段 ${key} / the test case has an unknown field "${key}"`);
  }
  if (!Object.hasOwn(data, "expect")) fail(file, "测试用例缺少 expect / the test case is missing expect");
  const testCase: FlowTestCase = { expect: {} };
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || !data.name) fail(file, "name 必须是非空字符串 / name must be a non-empty string");
    testCase.name = data.name;
  }
  if (data.inputs !== undefined) {
    if (!isObject(data.inputs)) fail(file, "inputs 必须是对象 / inputs must be an object");
    testCase.inputs = data.inputs;
  }
  if (data.replies !== undefined) {
    if (typeof data.replies !== "string" || !data.replies) fail(file, "replies 必须是非空字符串 / replies must be a non-empty string");
    testCase.replies = data.replies;
  }
  if (data.images !== undefined) {
    if (typeof data.images !== "string" || !data.images) fail(file, "images 必须是非空字符串 / images must be a non-empty string");
    testCase.images = data.images;
  }
  if (data.files !== undefined) {
    if (!isObject(data.files)) fail(file, "files 必须是对象 / files must be an object");
    const files: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.files)) {
      if (!key || typeof value !== "string" || !value) fail(file, `files 的每一项都要是非空路径 / every files entry must be a non-empty path (${key})`);
      files[key] = value;
    }
    testCase.files = files;
  }
  if (data.skip !== undefined) {
    if (!Array.isArray(data.skip) || data.skip.some((id) => typeof id !== "string" || !id)) {
      fail(file, "skip 必须是阶段 id 的数组 / skip must be an array of stage ids");
    }
    if (new Set(data.skip).size !== data.skip.length) fail(file, "skip 里有重复的阶段 / skip lists a stage more than once");
    testCase.skip = data.skip as string[];
  }
  if (!isObject(data.expect)) fail(file, "expect 必须是对象 / expect must be an object");
  const expect: Record<string, FlowTestCheck[]> = {};
  for (const [stageId, checks] of Object.entries(data.expect)) {
    if (!stageId) fail(file, "expect 的阶段 id 不能是空的 / an expect stage id must not be empty");
    if (!Array.isArray(checks)) fail(file, `expect.${stageId} 必须是检查的数组 / expect.${stageId} must be an array of checks`);
    expect[stageId] = checks.map((check, index) => parseCheck(check, file, `${stageId}[${index}]`));
  }
  testCase.expect = expect;
  return testCase;
}

function parseCheck(data: unknown, file: string, at: string): FlowTestCheck {
  if (!isObject(data)) fail(file, `${at} 必须是对象 / ${at} must be an object`);
  for (const key of Object.keys(data)) {
    if (!CHECK_KEYS.has(key)) fail(file, `${at} 有不认识的字段 ${key} / ${at} has an unknown field "${key}"`);
  }
  if (typeof data.file !== "string" || !data.file) fail(file, `${at} 缺少 file / ${at} is missing file`);
  const check: FlowTestCheck = { file: data.file, hasEquals: false };
  const flags = ["exists", "contains", "notContains", "matches", "minChars", "maxChars", "json", "jsonPath"] as const;
  if (!flags.some((key) => data[key] !== undefined)) fail(file, `${at} 没有任何检查 / ${at} has no check`);
  if (data.exists !== undefined) {
    if (typeof data.exists !== "boolean") fail(file, `${at} 的 exists 必须是 true 或 false / ${at} exists must be true or false`);
    check.exists = data.exists;
  }
  if (data.contains !== undefined) check.contains = stringOrList(data.contains, file, `${at}.contains`);
  if (data.notContains !== undefined) check.notContains = stringOrList(data.notContains, file, `${at}.notContains`);
  if (data.matches !== undefined) {
    if (typeof data.matches !== "string" || !data.matches) fail(file, `${at} 的 matches 必须是非空字符串 / ${at} matches must be a non-empty string`);
    check.matches = data.matches;
  }
  if (data.minChars !== undefined) check.minChars = nonNegativeInt(data.minChars, file, `${at}.minChars`);
  if (data.maxChars !== undefined) check.maxChars = nonNegativeInt(data.maxChars, file, `${at}.maxChars`);
  if (data.json !== undefined) {
    if (data.json !== true) fail(file, `${at} 的 json 只能是 true / ${at} json must be true`);
    check.json = true;
  }
  if (data.jsonPath !== undefined) {
    if (typeof data.jsonPath !== "string" || !data.jsonPath) fail(file, `${at} 的 jsonPath 必须是非空字符串 / ${at} jsonPath must be a non-empty string`);
    check.jsonPath = data.jsonPath;
    const has = ["equals", "min", "max", "length"].some((key) => Object.hasOwn(data, key));
    if (!has) fail(file, `${at} 的 jsonPath 需要 equals、min、max 或 length / ${at} jsonPath needs equals, min, max or length`);
  } else if (["equals", "min", "max", "length"].some((key) => Object.hasOwn(data, key))) {
    fail(file, `${at} 的 equals、min、max、length 要和 jsonPath 一起用 / ${at} equals, min, max and length need jsonPath`);
  }
  if (Object.hasOwn(data, "equals")) {
    check.hasEquals = true;
    check.equals = data.equals;
  }
  if (data.min !== undefined) {
    if (typeof data.min !== "number" || !Number.isFinite(data.min)) fail(file, `${at} 的 min 必须是数字 / ${at} min must be a number`);
    check.min = data.min;
  }
  if (data.max !== undefined) {
    if (typeof data.max !== "number" || !Number.isFinite(data.max)) fail(file, `${at} 的 max 必须是数字 / ${at} max must be a number`);
    check.max = data.max;
  }
  if (data.length !== undefined) check.length = nonNegativeInt(data.length, file, `${at}.length`);
  return check;
}

function stringOrList(value: unknown, file: string, at: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")) return value;
  fail(file, `${at} 必须是字符串或字符串数组 / ${at} must be a string or an array of strings`);
}

function nonNegativeInt(value: unknown, file: string, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(file, `${at} 必须是不小于 0 的整数 / ${at} must be an integer of at least 0`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function norm(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}
