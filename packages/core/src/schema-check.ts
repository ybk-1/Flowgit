import fs from "node:fs";
import path from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { Flow, Output, Stage, ValidationIssue } from "./types.js";
import { isSafeRelative, outputRel } from "./util.js";

function compileSchema(schema: unknown) {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema as object);
}

export interface SchemaProblem {
  file: string;
  path: string;
  message: string;
}

/** application/json, or any type ending in +json (for example flowgit/storyboard+json). */
export function isJsonOutputType(type: string): boolean {
  const t = type.toLowerCase();
  return t === "application/json" || t.endsWith("+json");
}

function problemPath(error: ErrorObject): string {
  if (error.instancePath) return error.instancePath;
  const missing = (error.params as { missingProperty?: string }).missingProperty;
  return missing ? `/${missing}` : "/";
}

function readSchema(dir: string, schemaPath: string): { schema?: unknown; problem?: string } {
  const abs = path.join(dir, schemaPath);
  if (!fs.existsSync(abs)) return { problem: `找不到 schema 文件 / schema file not found: ${schemaPath}` };
  let schema: unknown;
  try {
    schema = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
  } catch (err) {
    return { problem: `schema 不是合法的 JSON / schema is not valid JSON: ${(err as Error).message}` };
  }
  try {
    compileSchema(schema);
  } catch (err) {
    return { problem: `不是合法的 JSON Schema / is not a valid JSON Schema: ${(err as Error).message}` };
  }
  return { schema };
}

/** Problems with the JSON outputs that declare a schema, after the files have been written. */
export function schemaProblems(dir: string, stage: Stage): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  for (const out of stage.outputs) {
    if (!out.schema) continue;
    const rel = outputRel(out);
    const loaded = readSchema(dir, out.schema);
    if (!loaded.schema) {
      problems.push({ file: rel, path: out.schema, message: loaded.problem ?? "schema 不可用 / schema is unusable" });
      continue;
    }
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      problems.push({ file: rel, path: "/", message: "文件不存在 / file is missing" });
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
    } catch {
      problems.push({ file: rel, path: "/", message: "不是合法的 JSON / is not valid JSON" });
      continue;
    }
    const validate = compileSchema(loaded.schema);
    if (!validate(data) && validate.errors) {
      for (const error of validate.errors) {
        problems.push({ file: rel, path: problemPath(error), message: error.message ?? "invalid" });
      }
    }
  }
  return problems;
}

/** Bilingual error listing at most 5 problems. */
export function schemaFailure(problems: SchemaProblem[]): Error {
  const shown = problems.slice(0, 5);
  const more = problems.length - shown.length;
  const lines = [
    "产物不符合 JSON Schema / output does not match its JSON Schema",
    ...shown.map((p) => `  ${p.file} ${p.path}: ${p.message}`),
  ];
  if (more > 0) lines.push(`  还有 ${more} 条 / ${more} more`);
  return new Error(lines.join("\n"));
}

function schemaPathProblem(output: Output, indexPath: string): ValidationIssue | undefined {
  if (!output.schema) return undefined;
  if (!isJsonOutputType(output.type)) {
    return {
      level: "error",
      path: `${indexPath}/schema`,
      message: `schema 只能用在 JSON 产物上（application/json 或以 +json 结尾）/ schema is only for JSON outputs (application/json or a type ending in +json): "${output.path}"`,
    };
  }
  if (!isSafeRelative(output.schema)) {
    return {
      level: "error",
      path: `${indexPath}/schema`,
      message: `schema 路径必须是相对路径，且在流程目录内 / schema path must be relative and stay inside the flow directory: "${output.schema}"`,
    };
  }
  return undefined;
}

/** Static checks for `output.schema`: JSON type, safe path, file exists, file is a JSON Schema. */
export function outputSchemaIssues(flow: Flow, dir?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  flow.stages.forEach((stage, i) => {
    stage.outputs.forEach((output, j) => {
      const at = `/stages/${i}/outputs/${j}`;
      const pathProblem = schemaPathProblem(output, at);
      if (pathProblem) {
        issues.push(pathProblem);
        return;
      }
      if (!output.schema || !dir) return;
      const loaded = readSchema(dir, output.schema);
      if (loaded.problem) issues.push({ level: "error", path: `${at}/schema`, message: loaded.problem });
    });
  });
  return issues;
}
