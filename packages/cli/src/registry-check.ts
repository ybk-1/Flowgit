import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFlowFile, findPrivateData, readFlowFile, validateFlow } from "@flowgit/core";
import { splitGitFragment, validateCommunityRegistry, type CommunityEntry } from "./registry.js";

const LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "COPYING.md"];

export interface EntryCheck {
  id: string;
  ok: boolean;
  reasons: string[];
}

/**
 * No hooks; symlinks check out as plain files, so nothing in the clone points
 * outside it; and only https is allowed as a transport.
 * https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks
 * https://git-scm.com/docs/git-config#Documentation/git-config.txt-protocolallow
 */
const SAFE_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.symlinks=false", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always"];

export interface CheckOptions {
  /** Tests clone local bare repositories. The workflow never sets this. */
  allowFileUrls?: boolean;
}

function git(args: string[], cwd: string, opts: CheckOptions = {}): void {
  const extra = opts.allowFileUrls ? ["-c", "protocol.file.allow=always"] : [];
  const result = spawnSync("git", [...SAFE_GIT, ...extra, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git failed").trim());
  }
}

/**
 * Shallow, read-only fetch of one ref. No hook runs, no install, no stage.
 * A missing ref uses the remote HEAD.
 */
export function cloneReadOnly(url: string, ref: string | undefined, dest: string, opts: CheckOptions = {}): void {
  if (ref?.startsWith("-")) throw new Error("ref 不能以 - 开头 / ref must not start with -");
  fs.mkdirSync(dest, { recursive: true });
  git(["init"], dest, opts);
  git(["remote", "add", "origin", url], dest, opts);
  git(["fetch", "--depth", "1", "origin", ref || "HEAD"], dest, opts);
  git(["checkout", "--detach", "FETCH_HEAD"], dest, opts);
}

function listFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** The flow folder's LICENSE, or the nearest one above it up to the repository root (a flow in a subfolder). */
function licensePath(dir: string, root: string): string | undefined {
  let current = dir;
  for (;;) {
    const found = LICENSE_NAMES.map((name) => path.join(current, name)).find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
    if (found) return found;
    const rel = path.relative(root, current);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    current = path.dirname(current);
  }
}

/**
 * Clone the entry, then validate, scan for secrets with findPrivateData, and
 * check the license. Nothing in the clone is executed and nothing is installed.
 */
export function checkEntryRepository(entry: CommunityEntry, opts: CheckOptions = {}): EntryCheck {
  const schema = validateCommunityRegistry([entry]);
  if (!schema.ok) return { id: entry.id || "?", ok: false, reasons: schema.errors };
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-registry-"));
  const reasons: string[] = [];
  try {
    const split = splitGitFragment(entry.git);
    if (!/^https:\/\//i.test(split.url) && !(opts.allowFileUrls && /^file:\/\//i.test(split.url))) {
      return { id: entry.id, ok: false, reasons: ["检查只克隆 https 地址 / the check only clones https URLs"] };
    }
    try {
      cloneReadOnly(split.url, entry.ref, dest, opts);
    } catch (err) {
      return { id: entry.id, ok: false, reasons: [`克隆失败 / clone failed: ${err instanceof Error ? err.message : String(err)}`] };
    }
    const flowDir = split.path ? path.resolve(dest, split.path) : dest;
    const rel = path.relative(dest, flowDir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { id: entry.id, ok: false, reasons: ["#path= 跑到仓库外面了 / #path= leaves the repository"] };
    }
    let data: unknown;
    try {
      const file = findFlowFile(flowDir);
      if (!file) throw new Error("没有 flow.json 或 flow.md / no flow.json or flow.md");
      data = readFlowFile(file);
    } catch (err) {
      return { id: entry.id, ok: false, reasons: [err instanceof Error ? err.message : String(err)] };
    }
    for (const issue of validateFlow(data, { dir: flowDir })) {
      if (issue.level === "error") reasons.push(`校验 / validate ${issue.path || "/"}: ${issue.message}`);
    }
    for (const finding of findPrivateData(flowDir, listFiles(flowDir))) {
      reasons.push(`${finding.file}:${finding.line} ${finding.kind} ${finding.preview}`);
    }
    const license = licensePath(flowDir, dest);
    if (!license) reasons.push("没有 LICENSE / no LICENSE file");
    else if (fs.statSync(license).size === 0) reasons.push("LICENSE 是空的 / LICENSE is empty");
    const flowLicense = data && typeof data === "object" && "license" in data ? (data as { license?: unknown }).license : undefined;
    if (typeof flowLicense === "string" && flowLicense.trim() && flowLicense.trim() !== entry.license) {
      reasons.push(`许可证不一致：流程是 ${flowLicense}，登记是 ${entry.license} / license mismatch: the flow says ${flowLicense}, the entry says ${entry.license}`);
    }
    return { id: entry.id, ok: reasons.length === 0, reasons };
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

/** One bilingual comment for every checked entry. */
export function renderRegistryComment(results: EntryCheck[]): string {
  const lines = ["## 社区登记检查 / Community registry check", ""];
  if (!results.length) {
    lines.push("没有新增或修改的条目。 / No added or changed entries.");
    return lines.join("\n");
  }
  for (const result of results) {
    lines.push(`### ${result.id}`);
    if (result.ok) lines.push("通过：校验、密钥扫描和许可证都没问题。只读了仓库，没有运行阶段，也没有安装依赖。 / Passed validation, the secret scan and the license check. The repository was only read: no stage ran and nothing was installed.");
    else {
      lines.push("没通过 / Failed:");
      for (const reason of result.reasons) lines.push(`- ${reason}`);
    }
    lines.push("");
  }
  const bad = results.filter((result) => !result.ok).length;
  lines.push(bad ? `${bad} 个条目没通过 / ${bad} failed.` : "全部通过 / All passed.");
  return `${lines.join("\n")}\n`;
}

export function checkEntryFile(file: string, opts: CheckOptions = {}): EntryCheck[] {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    return [{ id: path.basename(file, ".json"), ok: false, reasons: [`不是合法的 JSON / is not valid JSON: ${(err as Error).message}`] }];
  }
  const items = Array.isArray(data) ? data : [data];
  const schema = validateCommunityRegistry(items);
  if (!schema.ok) return [{ id: path.basename(file, ".json"), ok: false, reasons: schema.errors }];
  return schema.entries.map((entry) => checkEntryRepository(entry, opts));
}

export function changedCommunityFiles(cwd: string, base: string): string[] {
  const result = spawnSync("git", ["diff", "--name-only", "--diff-filter=AM", base, "HEAD", "--", "registry/community"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".json"));
}
