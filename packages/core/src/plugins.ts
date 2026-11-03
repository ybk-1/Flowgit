import { host, path } from "./host/current.js";
import type { LoadedFlow } from "./types.js";
import { hashPath, isSafeRelative, staysInside } from "./util.js";

/**
 * Plugin contract version this Flowgit accepts.
 * Any other `flowgitPlugin` value is an error: upgrade Flowgit or the plugin.
 */
export const FLOWGIT_PLUGIN_API = 1;

/** npm package name, scoped or not. Not a path. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** One output as a plugin sees it. `path` is relative to the flow directory. */
export interface PluginOutput {
  type: string;
  path: string;
  description?: string;
}

/** The stage a plugin is running. A plain copy, not a live internal object. */
export interface PluginStage {
  id: string;
  name: string;
  description?: string;
  /** Upstream stage ids. */
  inputs?: string[];
  outputs: PluginOutput[];
}

/**
 * Upstream outputs the plugin may read.
 * `paths` are relative to the flow directory. `read` returns UTF-8 text.
 */
export interface PluginUpstream {
  paths: string[];
  read(rel: string): string;
}

/**
 * What a plugin's `executor.run` receives. Stable public contract.
 * Plugins must not import Flowgit internals; they only use this object.
 */
export interface PluginContext {
  /** Absolute path of the flow directory. */
  flowDir: string;
  stage: PluginStage;
  /** `executor.config`, or an empty object. */
  config: Record<string, unknown>;
  /** Flow input values for this run. */
  inputs: Record<string, unknown>;
  upstream: PluginUpstream;
  /**
   * Write one declared output. `rel` is relative to the flow directory.
   * A directory output accepts a file inside it.
   */
  writeOutput(rel: string, data: string | Uint8Array): void;
  /** Append a line to this run's log. */
  log(line: string): void;
  /** Aborted when `timeoutSec` elapses. Never aborted when `timeoutSec` is unset. */
  signal: AbortSignal;
}

/** Default export of a plugin module. */
export interface FlowgitPlugin {
  flowgitPlugin: 1;
  name: string;
  executor: {
    run(ctx: PluginContext): void | Promise<void>;
  };
}

export interface ResolvedPlugin {
  spec: string;
  kind: "package" | "folder";
  /** Package root, plugin directory, or the directory containing a single-file plugin. */
  root: string;
  /** File that is imported. */
  entry: string;
  /** Directory or file hashed for staleness. Packages use `version` instead. */
  fingerprint: string;
  version?: string;
}

export interface PluginReport {
  stage: string;
  plugin: string;
  missing: boolean;
  /** Absolute package root or plugin directory, or null when missing. */
  resolved: string | null;
  /** Path relative to the flow directory when it stays inside. */
  path: string | null;
  version: string | null;
  message: string;
  hint?: string;
}

export function isPackageName(spec: string): boolean {
  return PACKAGE_NAME.test(spec);
}

/** A `./` path, `../`, or anything absolute. Package names are not paths. */
export function isPathPlugin(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("\\") || path.isAbsolute(spec);
}

function outsidePluginError(spec: string): Error {
  return new Error(`插件路径必须留在流程目录内 / plugin path must stay inside the flow directory: "${spec}"`);
}

/** Bilingual error that names the install command. */
export function missingPluginError(name: string): Error {
  return new Error(
    `找不到插件 "${name}"。在流程目录里运行 npm install ${name} / Plugin "${name}" was not found. Run npm install ${name} in the flow directory`,
  );
}

function installHint(name: string): string {
  return `npm install ${name}`;
}

function readVersion(root: string): string | undefined {
  const file = path.join(root, "package.json");
  if (!host().exists(file)) return undefined;
  try {
    const pkg = JSON.parse(host().readFile(file, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function packageRoot(flowDir: string, name: string): string {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return path.join(flowDir, "node_modules", scope!, pkg!);
  }
  return path.join(flowDir, "node_modules", name);
}

/**
 * True when `entry` lives inside `root` after one realpath, so a symlink
 * from this flow's node_modules to a package store still counts, and a
 * file outside that package does not.
 */
function entryInside(root: string, entry: string): boolean {
  try {
    const realRoot = host().realpath(root);
    const realEntry = host().realpath(entry);
    const rel = path.relative(realRoot, realEntry);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function showInside(flowDir: string, abs: string): string {
  const rel = path.relative(flowDir, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return abs;
  return rel.split(path.sep).join("/");
}

/**
 * Resolve `spec` from a flow directory.
 * Package names use `createRequire(<flowDir>/package.json)` and are accepted
 * only when the package is installed in that directory's node_modules.
 * Node would also walk parent directories and global folders
 * (https://nodejs.org/api/module.html#modulecreaterequirefilename); those hits
 * are not installed plugins.
 */
export function resolveFlowPlugin(flowDir: string, spec: string): ResolvedPlugin {
  if (isPathPlugin(spec)) return resolveFolderPlugin(flowDir, spec);
  if (!isPackageName(spec)) {
    throw new Error(`插件要写成包名或 ./ 相对路径 / plugin must be a package name or a ./ path: "${spec}"`);
  }
  return resolvePackagePlugin(flowDir, spec);
}

function resolveFolderPlugin(flowDir: string, spec: string): ResolvedPlugin {
  const posix = spec.replace(/\\/g, "/");
  if (!posix.startsWith("./") || !isSafeRelative(posix)) throw outsidePluginError(spec);
  const abs = path.resolve(flowDir, spec);
  if (!host().exists(abs)) throw new Error(`找不到插件 "${spec}" / plugin "${spec}" was not found`);
  if (!staysInside(flowDir, abs)) throw new Error(`插件路径指向流程目录外面 / plugin path points outside the flow directory: "${spec}"`);
  let entry: string;
  try {
    // Parent filename is the flow's package.json path even when that file is absent.
    entry = host().resolveModule(path.join(flowDir, "package.json"), posix);
  } catch (err) {
    throw new Error(`找不到插件 "${spec}" 的入口文件 / plugin "${spec}" has no entry file (${(err as Error).message})`);
  }
  if (!staysInside(flowDir, entry)) {
    throw new Error(`插件 "${spec}" 的入口指向流程目录外面 / plugin "${spec}" entry points outside the flow directory`);
  }
  const directory = host().stat(abs).isDirectory();
  const root = directory ? abs : path.dirname(abs);
  return {
    spec,
    kind: "folder",
    root,
    entry,
    fingerprint: directory ? abs : entry,
    version: readVersion(root),
  };
}

function resolvePackagePlugin(flowDir: string, name: string): ResolvedPlugin {
  const root = packageRoot(flowDir, name);
  // Missing here means missing. Do not call resolve(), which would walk upward.
  if (!host().exists(root)) throw missingPluginError(name);
  let entry: string;
  try {
    entry = host().resolveModule(path.join(flowDir, "package.json"), name);
  } catch {
    throw missingPluginError(name);
  }
  if (!entryInside(root, entry)) {
    throw new Error(
      `插件 "${name}" 没有从流程目录的 node_modules 解析出来 / plugin "${name}" did not resolve from the flow directory's node_modules`,
    );
  }
  return { spec: name, kind: "package", root, entry, fingerprint: root, version: readVersion(root) };
}

/**
 * Why `spec` cannot be saved, or undefined when it is a package name or a
 * `./` path inside the flow directory. A package that is not installed yet
 * is still valid: install is checked by doctor and at run time.
 */
export function pluginPathProblem(spec: string, dir?: string): string | undefined {
  try {
    if (isPathPlugin(spec)) {
      if (dir) resolveFlowPlugin(dir, spec);
      else {
        const posix = spec.replace(/\\/g, "/");
        if (!posix.startsWith("./") || !isSafeRelative(posix)) throw outsidePluginError(spec);
      }
      return undefined;
    }
    if (!isPackageName(spec)) {
      return `插件要写成包名或 ./ 相对路径 / plugin must be a package name or a ./ path: "${spec}"`;
    }
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

/** Version (package) or file hash (folder), plus config. Missing plugins hash as missing. */
export function pluginFingerprint(dir: string, spec: string, config: unknown): unknown {
  const base = { plugin: spec, config: config ?? null };
  try {
    const resolved = resolveFlowPlugin(dir, spec);
    if (resolved.kind === "package") return { ...base, version: resolved.version ?? null };
    return { ...base, files: hashPath(resolved.fingerprint).sha256 };
  } catch {
    return { ...base, missing: true };
  }
}

export function inspectPlugin(dir: string, spec: string): Omit<PluginReport, "stage"> {
  try {
    const resolved = resolveFlowPlugin(dir, spec);
    const shown = showInside(dir, resolved.root);
    const version = resolved.version ?? null;
    const versionText = version ? ` ${version}` : "";
    return {
      plugin: spec,
      missing: false,
      resolved: resolved.root,
      path: shown,
      version,
      message: `插件 ${spec}${versionText}，路径 ${shown} / plugin ${spec}${versionText} at ${shown}`,
    };
  } catch (err) {
    const hint = isPackageName(spec) ? installHint(spec) : `确认这个路径是对的 / check that path`;
    return {
      plugin: spec,
      missing: true,
      resolved: null,
      path: null,
      version: null,
      message: (err as Error).message,
      hint,
    };
  }
}

/** Plugin stages in this flow file, with the resolved path, version, or the missing-plugin error. */
export function listPlugins(loaded: LoadedFlow): PluginReport[] {
  const reports: PluginReport[] = [];
  for (const stage of loaded.flow.stages ?? []) {
    const ex = stage.executor;
    if (ex.type !== "plugin") continue;
    reports.push({ stage: stage.id, ...inspectPlugin(loaded.dir, ex.plugin) });
  }
  return reports;
}

/** One line for init. Words are "中文 / English"; a path or package name is the same on both sides. */
export function pluginActionDetail(dir: string | undefined, spec: string): string {
  if (!dir) return spec;
  const report = inspectPlugin(dir, spec);
  if (report.missing) {
    const hint = missingActionHint(spec);
    return `${spec}（${hint.zh} / ${hint.en}）`;
  }
  const version = report.version ? ` ${report.version}` : "";
  return `${spec}${version} → ${report.path ?? report.resolved}`;
}

/** The two halves of a missing-plugin line, so the board can show one language. */
function missingActionHint(spec: string): { zh: string; en: string } {
  if (isPackageName(spec)) {
    const cmd = installHint(spec);
    return { zh: `找不到，${cmd}`, en: `not found, ${cmd}` };
  }
  return { zh: "找不到，确认这个路径是对的", en: "not found, check that path" };
}

function showApiVersion(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Load and check a resolved plugin. Does not run it. */
export async function loadFlowgitPlugin(resolved: ResolvedPlugin): Promise<{ name: string; run: (ctx: PluginContext) => void | Promise<void> }> {
  let imported: { default?: unknown };
  try {
    imported = (await host().importModule(resolved.entry)) as { default?: unknown };
  } catch (err) {
    throw new Error(`无法加载插件 "${resolved.spec}" / could not load plugin "${resolved.spec}": ${(err as Error).message}`);
  }
  const value = imported.default;
  if (!value || typeof value !== "object") {
    throw new Error(
      `插件 "${resolved.spec}" 需要默认导出 { flowgitPlugin: 1, name, executor } / plugin "${resolved.spec}" must default-export { flowgitPlugin: 1, name, executor }`,
    );
  }
  const plugin = value as { flowgitPlugin?: unknown; name?: unknown; executor?: { run?: unknown } };
  const who = typeof plugin.name === "string" && plugin.name ? plugin.name : resolved.spec;
  if (plugin.flowgitPlugin !== FLOWGIT_PLUGIN_API) {
    const shown = showApiVersion(plugin.flowgitPlugin);
    throw new Error(
      `插件 "${who}" 的 flowgitPlugin 是 ${shown}，这份 Flowgit 只支持 ${FLOWGIT_PLUGIN_API}。请升级 Flowgit 或这个插件 / plugin "${who}" declares flowgitPlugin ${shown}; this Flowgit only supports ${FLOWGIT_PLUGIN_API}. Upgrade Flowgit or the plugin`,
    );
  }
  if (typeof plugin.name !== "string" || !plugin.name) {
    throw new Error(`插件 "${resolved.spec}" 缺少 name / plugin "${resolved.spec}" is missing name`);
  }
  if (typeof plugin.executor?.run !== "function") {
    throw new Error(`插件 "${resolved.spec}" 缺少 executor.run / plugin "${resolved.spec}" is missing executor.run`);
  }
  return { name: plugin.name, run: plugin.executor.run as (ctx: PluginContext) => void | Promise<void> };
}
