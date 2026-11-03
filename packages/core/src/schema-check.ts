import { host, path } from "./host/current.js";
import { Ajv, type ErrorObject } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Flow, Output, Stage, ValidationIssue } from "./types.js";
import { isSafeRelative, outputRel } from "./util.js";

/** One failed check, in the shape problems are reported. */
export interface SchemaError {
  path: string;
  message: string;
}

/** Compiles a JSON Schema into a check; throws when the schema itself is unusable. */
export type SchemaCompiler = (schema: unknown) => (data: unknown) => SchemaError[];

/** Pick the ajv validator for the schema's $schema: draft-07, 2019-09, or 2020-12 (also the default). */
function ajvCompile(schema: unknown) {
  const opts = { allErrors: true, strict: false };
  const declared = schema && typeof schema === "object" ? (schema as { $schema?: unknown }).$schema : undefined;
  const draft = typeof declared === "string" ? declared : "";
  if (draft.includes("draft-07")) return new Ajv(opts).compile(schema as object);
  if (draft.includes("2019-09")) return new Ajv2019(opts).compile(schema as object);
  if (draft && !draft.includes("2020-12")) {
    throw new Error(`不支持 $schema "${draft}"，请用 draft-07、2019-09 或 2020-12 / unsupported $schema "${draft}"; use draft-07, 2019-09 or 2020-12`);
  }
  return new Ajv2020(opts).compile(schema as object);
}

const ajvCompiler: SchemaCompiler = (schema) => {
  const validate = ajvCompile(schema);
  return (data) => {
    if (validate(data) || !validate.errors) return [];
    return validate.errors.map((error) => ({ path: problemPath(error), message: problemMessage(error) }));
  };
};

let compiler: SchemaCompiler = ajvCompiler;

/**
 * Swap how output schemas are compiled. ajv (the default) generates code with new Function,
 * which a page with a strict Content-Security-Policy may not run; such a page plugs in an
 * interpreting validator instead. Pass nothing to go back to ajv.
 */
export function setSchemaCompiler(next?: SchemaCompiler): void {
  compiler = next ?? ajvCompiler;
}

function compileSchema(schema: unknown): (data: unknown) => SchemaError[] {
  return compiler(schema);
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

/** ajv's message plus the detail it keeps in params (the extra property, the allowed values). */
function problemMessage(error: ErrorObject): string {
  const message = error.message ?? "invalid";
  const params = error.params as { additionalProperty?: string; allowedValues?: unknown[] };
  if (params.additionalProperty) return `${message}: "${params.additionalProperty}"`;
  if (Array.isArray(params.allowedValues)) return `${message}: ${params.allowedValues.map((v) => JSON.stringify(v)).join(", ")}`;
  return message;
}

function problemPath(error: ErrorObject): string {
  if (error.instancePath) return error.instancePath;
  const missing = (error.params as { missingProperty?: string }).missingProperty;
  return missing ? `/${missing}` : "/";
}

function readSchema(dir: string, schemaPath: string): { schema?: unknown; problem?: string } {
  const abs = path.join(dir, schemaPath);
  if (!host().exists(abs)) return { problem: `找不到 schema 文件 / schema file not found: ${schemaPath}` };
  let schema: unknown;
  try {
    schema = JSON.parse(host().readFile(abs, "utf8")) as unknown;
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

/** The schema files a stage's outputs declare, as text, for the llm repair prompt. */
export function schemaTexts(dir: string, stage: Stage): string[] {
  const texts: string[] = [];
  for (const out of stage.outputs) {
    if (!out.schema) continue;
    const abs = path.join(dir, out.schema);
    if (host().exists(abs)) texts.push(host().readFile(abs, "utf8").trim());
  }
  return texts;
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
    if (!host().exists(abs) || !host().stat(abs).isFile()) {
      problems.push({ file: rel, path: "/", message: "文件不存在 / file is missing" });
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(host().readFile(abs, "utf8")) as unknown;
    } catch {
      problems.push({ file: rel, path: "/", message: "不是合法的 JSON / is not valid JSON" });
      continue;
    }
    for (const error of compileSchema(loaded.schema)(data)) problems.push({ file: rel, ...error });
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
