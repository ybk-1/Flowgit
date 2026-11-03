import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { findCycle } from "./graph.js";
import { outputSchemaIssues } from "./schema-check.js";
import {
  flowFileId,
  flowgitParams,
  normRel,
  resolveSubflowFile,
  subflowEnterProblem,
  subflowStack,
} from "./subflow.js";
import { imageExecutorIssues } from "./image-providers.js";
import { mcpEnvIssues, mcpStageIssues } from "./mcp.js";
import { pluginPathProblem } from "./plugins.js";
import type { ExecutorWorkflow, Flow, LoadedFlow, Output, ValidationIssue } from "./types.js";
import { isSafeRelative, linkOutsideError, outputRel, staysInside } from "./util.js";
import { parseFlowMd, renderFlowMd } from "./flowmd.js";

export const FLOW_FILE = "flow.json";
/** The Markdown way to write the same flow; see flowmd.ts. */
export const FLOW_MD_FILE = "flow.md";
export const FLOW_FILES = [FLOW_FILE, FLOW_MD_FILE] as const;

const schemaUrl = new URL("../schema/flow.schema.json", import.meta.url);
export const flowSchema = JSON.parse(fs.readFileSync(schemaUrl, "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
const validateSchema = ajv.compile(flowSchema);

export class FlowValidationError extends Error {
  constructor(
    public readonly issues: ValidationIssue[],
    public readonly file?: string,
  ) {
    super(
      `${file ?? FLOW_FILE} 有 ${issues.filter((i) => i.level === "error").length} 个错误 / has ${issues.filter((i) => i.level === "error").length} error(s):\n` +
        issues.map((i) => `  [${i.level}] ${i.path || "/"}: ${i.message}`).join("\n"),
    );
    this.name = "FlowValidationError";
  }
}

function schemaIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors) return [];
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const e of errors) {
    // if/then failures repeat the "required" error they wrap
    if (e.keyword === "if") continue;
    let message = e.message ?? "invalid";
    if (e.keyword === "additionalProperties") {
      message = `不认识的字段 / unknown property "${(e.params as { additionalProperty: string }).additionalProperty}"`;
    } else if (e.keyword === "discriminator") {
      message = `executor.type 只能是 human、llm、script、agent、workflow、service、mcp、plugin、image 之一 / executor.type must be one of human, llm, script, agent, workflow, service, mcp, plugin, image`;
    } else if (e.keyword === "required") {
      message = `缺少必填字段 / missing required property "${(e.params as { missingProperty: string }).missingProperty}"`;
    }
    const key = `${e.instancePath}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ level: "error", path: e.instancePath, message });
  }
  return issues;
}

export interface ValidateOptions {
  /** Flow directory; when given, referenced files (prompts) are checked. */
  dir?: string;
  /** @internal Absolute flow.json paths from the outermost flow through this one. */
  flowStack?: string[];
}

/**
 * Validate a parsed flow.json. Returns all issues; errors mean the flow cannot run,
 * warnings are advisory.
 */
export function validateFlow(data: unknown, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!validateSchema(data)) {
    issues.push(...schemaIssues(validateSchema.errors));
    return issues;
  }
  const flow = data as Flow;
  const ids = new Set<string>();
  const outputPaths = new Map<string, string>();
  flow.stages.forEach((stage, i) => {
    const base = `/stages/${i}`;
    if (ids.has(stage.id)) {
      issues.push({ level: "error", path: `${base}/id`, message: `阶段 id 重复 / duplicate stage id "${stage.id}"` });
    }
    ids.add(stage.id);
  });
  flow.stages.forEach((stage, i) => {
    const base = `/stages/${i}`;
    (stage.inputs ?? []).forEach((dep, j) => {
      if (dep === stage.id) {
        issues.push({ level: "error", path: `${base}/inputs/${j}`, message: `阶段不能依赖自己 / stage "${stage.id}" cannot depend on itself` });
      } else if (!ids.has(dep)) {
        issues.push({ level: "error", path: `${base}/inputs/${j}`, message: `没有这个阶段 / unknown stage "${dep}"` });
      }
    });
    stage.outputs.forEach((out, j) => {
      const rel = outputRel(out);
      if (!isSafeRelative(rel)) {
        issues.push({ level: "error", path: `${base}/outputs/${j}/path`, message: `产物路径必须是相对路径，且在流程目录内 / output path must be relative and stay inside the flow directory: "${out.path}"` });
      } else if ((FLOW_FILES as readonly string[]).includes(rel)) {
        issues.push({ level: "error", path: `${base}/outputs/${j}/path`, message: `产物不能叫 ${rel}，这是流程文件的名字 / an output cannot be ${rel}; that name is the flow file` });
      } else if (rel.split("/")[0] === "runs") {
        issues.push({ level: "error", path: `${base}/outputs/${j}/path`, message: `产物不能放在 runs/ 里 / output path must not be inside runs/` });
      }
      const owner = outputPaths.get(rel);
      if (owner && owner !== stage.id) {
        issues.push({ level: "error", path: `${base}/outputs/${j}/path`, message: `"${rel}" 已经由阶段 "${owner}" 产出 / output path "${rel}" is already produced by stage "${owner}"` });
      }
      outputPaths.set(rel, stage.id);
    });
    const ex = stage.executor;
    const checkPrompt = (prompt: string) => {
      if (!isSafeRelative(prompt)) {
        issues.push({ level: "error", path: `${base}/executor/prompt`, message: `提示词路径必须是相对路径 / prompt path must be relative: "${prompt}"` });
      } else if (opts.dir) {
        const abs = path.join(opts.dir, prompt);
        if (!fs.existsSync(abs)) {
          issues.push({ level: "error", path: `${base}/executor/prompt`, message: `找不到提示词文件 / prompt file not found: ${prompt}` });
        } else if (!staysInside(opts.dir, abs)) {
          issues.push({ level: "error", path: `${base}/executor/prompt`, message: linkOutsideError(prompt).message });
        } else {
          const tpl = fs.readFileSync(abs, "utf8");
          for (const m of tpl.matchAll(/\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g)) {
            if (!flow.inputs || !Object.hasOwn(flow.inputs, m[1])) {
              issues.push({ level: "warning", path: `${base}/executor/prompt`, message: `${prompt} 用了 {{inputs.${m[1]}}}，但 flow.inputs 里没有 "${m[1]}" / ${prompt} uses {{inputs.${m[1]}}} but flow.inputs has no "${m[1]}"` });
            }
          }
        }
      }
    };
    if (ex.type === "llm") {
      if (stage.outputs.length !== 1) {
        issues.push({ level: "error", path: `${base}/outputs`, message: `llm 阶段只能有一个产物 / llm executor needs exactly one output (stage "${stage.id}" has ${stage.outputs.length})` });
      }
      checkPrompt(ex.prompt);
    } else if (ex.type === "agent") {
      checkPrompt(ex.prompt);
      if (ex.command && ex.agent !== "custom") {
        issues.push({ level: "warning", path: `${base}/executor/command`, message: `command 只在 agent 为 "custom" 时使用，这里会被忽略 / command is only used when agent is "custom"; it is ignored here` });
      }
    } else if (ex.type === "workflow") {
      if (ex.engine === "flowgit") issues.push(...workflowIssues(flow, stage.outputs, ex, base, opts));
      else {
        issues.push({
          level: "warning",
          path: `${base}/executor`,
          message: `workflow 引擎 "${ex.engine}" 还不能运行，目前只有 flowgit / workflow engine "${ex.engine}" cannot run yet; only "flowgit" can`,
        });
      }
    } else if (ex.type === "mcp") {
      issues.push(...mcpStageIssues(flow, stage, base));
    } else if (ex.type === "plugin") {
      const problem = pluginPathProblem(ex.plugin, opts.dir);
      if (problem) issues.push({ level: "error", path: `${base}/executor/plugin`, message: problem });
    } else if (ex.type === "image") {
      issues.push(...imageExecutorIssues(flow, stage, base));
      checkPrompt(ex.prompt);
    }
  });
  issues.push(...mcpEnvIssues(flow));
  issues.push(...outputSchemaIssues(flow, opts.dir));
  const cycle = findCycle(flow);
  if (cycle.length) {
    issues.push({ level: "error", path: "/stages", message: `阶段之间形成了环 / stages form a cycle: ${cycle.join(" -> ")}` });
  }
  return issues;
}

function templateWarnings(value: unknown, flow: Flow, issuePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      for (const match of item.matchAll(/\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g)) {
        if (!flow.inputs || !(match[1] in flow.inputs)) {
          issues.push({
            level: "warning",
            path: issuePath,
            message: `params.inputs 用了 {{inputs.${match[1]}}}，但 flow.inputs 里没有 "${match[1]}" / params.inputs uses {{inputs.${match[1]}}} but flow.inputs has no "${match[1]}"`,
          });
        }
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return issues;
}

function subflowOutputPaths(data: unknown): string[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  const stages = (data as { stages?: { outputs?: Output[] }[] }).stages;
  if (!Array.isArray(stages)) return undefined;
  const paths: string[] = [];
  for (const stage of stages) {
    for (const out of stage.outputs ?? []) paths.push(normRel(outputRel(out)));
  }
  return paths;
}

function copyIssues(outputs: Output[], copy: Record<string, string> | undefined, sources: string[] | undefined, issuePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dests = new Map<string, string>();
  for (const [src, dst] of Object.entries(copy ?? {})) {
    if (typeof dst !== "string" || !isSafeRelative(dst)) {
      issues.push({ level: "error", path: issuePath, message: `copy 的目标必须是相对路径 / copy destination must be a relative path: "${String(dst)}"` });
      continue;
    }
    if (!isSafeRelative(src)) {
      issues.push({ level: "error", path: issuePath, message: `copy 的来源必须是相对路径 / copy source must be a relative path: "${src}"` });
      continue;
    }
    const dest = normRel(dst);
    if (dests.has(dest)) {
      issues.push({ level: "error", path: issuePath, message: `copy 的目标重复 / copy destination is repeated: "${dest}"` });
    }
    dests.set(dest, src);
    if (sources && !sources.includes(normRel(src))) {
      issues.push({ level: "error", path: issuePath, message: `copy 的来源不是子流程的产物 / copy source is not an output of the sub-flow: "${src}"` });
    }
  }
  const parent = new Set(outputs.map((out) => normRel(outputRel(out))));
  for (const dest of dests.keys()) {
    if (!parent.has(dest)) {
      issues.push({ level: "error", path: issuePath, message: `copy 的目标不是这个阶段的产物 / copy destination is not an output of this stage: "${dest}"` });
    }
  }
  for (const rel of parent) {
    if (!dests.has(rel)) {
      issues.push({ level: "error", path: issuePath, message: `copy 没有覆盖产物 "${rel}" / copy does not cover output "${rel}"` });
    }
  }
  return issues;
}

function workflowIssues(flow: Flow, outputs: Output[], ex: ExecutorWorkflow, base: string, opts: ValidateOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = `${base}/executor/file`;
  const params = flowgitParams(ex);
  issues.push(...templateWarnings(params.inputs, flow, `${base}/executor/params/inputs`));
  const resolved = resolveSubflowFile(opts.dir ?? ".", ex.file);
  if ("error" in resolved) {
    issues.push({ level: "error", path: at, message: resolved.error });
    issues.push(...copyIssues(outputs, params.copy, undefined, `${base}/executor/params/copy`));
    return issues;
  }
  if (!opts.dir) {
    issues.push(...copyIssues(outputs, params.copy, undefined, `${base}/executor/params/copy`));
    return issues;
  }
  if (!fs.existsSync(resolved.abs)) {
    issues.push({ level: "error", path: at, message: `找不到子流程 / sub-flow file not found: ${ex.file}` });
    issues.push(...copyIssues(outputs, params.copy, undefined, `${base}/executor/params/copy`));
    return issues;
  }
  const stack = subflowStack(path.join(opts.dir, FLOW_FILE), opts.flowStack);
  const problem = subflowEnterProblem(stack, resolved.abs);
  if (problem) {
    issues.push({ level: "error", path: at, message: problem });
    return issues;
  }
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(resolved.abs, "utf8"));
  } catch (err) {
    issues.push({ level: "error", path: at, message: `${ex.file} 不是合法的 JSON / is not valid JSON: ${(err as Error).message}` });
    return issues;
  }
  const subDir = path.dirname(resolved.abs);
  for (const issue of validateFlow(data, { dir: subDir, flowStack: [...stack, flowFileId(resolved.abs)] })) {
    issues.push({ ...issue, path: `${at}${issue.path}`, message: `${ex.file}: ${issue.message}` });
  }
  issues.push(...copyIssues(outputs, params.copy, subflowOutputPaths(data), `${base}/executor/params/copy`));
  return issues;
}

/** Resolve the flow directory from a path that may be a directory, a flow.json or a flow.md. */
export function resolveFlowDir(target: string = "."): string {
  const abs = path.resolve(target);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return path.dirname(abs);
  return abs;
}

/** There is no flow.json or flow.md where a flow was expected. */
export class FlowNotFoundError extends Error {
  constructor(public dir: string) {
    super(`${dir} 里没有 ${FLOW_FILE} 或 ${FLOW_MD_FILE} / No ${FLOW_FILE} or ${FLOW_MD_FILE} in ${dir}`);
    this.name = "FlowNotFoundError";
  }
}

/**
 * The flow file in dir: flow.json or flow.md, or undefined when there is neither.
 * Throws when both exist, since it would be unclear which one counts.
 */
export function findFlowFile(dir: string): string | undefined {
  let found = FLOW_FILES.map((name) => path.join(dir, name)).filter((f) => fs.existsSync(f));
  // A flow.md without frontmatter next to flow.json is not a flow, e.g. an older
  // `flowgit graph --out flow.md`: keep using flow.json.
  if (found.length > 1 && !looksLikeFlowMd(path.join(dir, FLOW_MD_FILE))) found = [path.join(dir, FLOW_FILE)];
  if (found.length > 1) {
    throw new Error(
      `${dir} 里同时有 ${FLOW_FILE} 和 ${FLOW_MD_FILE}，只能留一个（可以用 flowgit convert 转换）/ ${dir} has both ${FLOW_FILE} and ${FLOW_MD_FILE}; keep one (flowgit convert switches between them)`,
    );
  }
  return found[0];
}

/** Whether a flow.md starts with frontmatter, as every flow.md must. */
function looksLikeFlowMd(file: string): boolean {
  const head = fs.readFileSync(file, "utf8").slice(0, 8).replace(/^\uFEFF/, "");
  return /^---\r?\n/.test(head);
}

/** Whether the file is a flow.md (by name), as opposed to flow.json. */
export function isFlowMd(file: string): boolean {
  return path.basename(file) === FLOW_MD_FILE;
}

/** Parse a flow file (flow.json or flow.md) without validating it. */
export function parseFlowText(text: string, file: string): unknown {
  if (isFlowMd(file)) {
    try {
      return parseFlowMd(text);
    } catch (err) {
      throw new Error(`${file} 读不懂 / could not be read: ${(err as Error).message}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} 不是合法的 JSON / is not valid JSON: ${(err as Error).message}`);
  }
}

/** Read and parse a flow file (flow.json or flow.md) without validating it. */
export function readFlowFile(file: string): unknown {
  return parseFlowText(fs.readFileSync(file, "utf8"), file);
}

/** Text of a flow in the format its file name asks for. */
export function renderFlowText(flow: Flow, file: string): string {
  return isFlowMd(file) ? renderFlowMd(flow) : `${JSON.stringify(flow, null, 2)}\n`;
}

/** Write a flow back in the format of its file (flow.json or flow.md). */
export function writeFlowFile(file: string, flow: Flow): void {
  fs.writeFileSync(file, renderFlowText(flow, file));
}

/** Read, parse and validate <dir>/flow.json or <dir>/flow.md. Throws FlowValidationError on errors. */
export function loadFlow(target: string = "."): LoadedFlow {
  const dir = resolveFlowDir(target);
  const file = findFlowFile(dir);
  if (!file) throw new FlowNotFoundError(dir);
  const data = readFlowFile(file);
  const issues = validateFlow(data, { dir });
  if (issues.some((i) => i.level === "error")) {
    throw new FlowValidationError(issues, file);
  }
  return { dir, file, flow: data as Flow };
}
