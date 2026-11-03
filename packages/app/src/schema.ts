// Output JSON Schemas in the page. ajv (core's default) compiles schemas with new Function,
// which this app's Content-Security-Policy forbids, so the page checks outputs with
// @cfworker/json-schema, which interprets the schema instead of generating code.
// The flow schema itself is precompiled at build time (core's flow-validate.generated.ts).
import { setSchemaCompiler, type SchemaCompiler, type SchemaError } from "@flowgit/core";
import { Validator, type SchemaDraft } from "@cfworker/json-schema";

/** Wrapper errors that only say "a child failed"; the child's own error says what is wrong. */
const WRAPPERS = new Set(["properties", "items", "prefixItems", "patternProperties", "$ref", "$dynamicRef", "allOf", "false"]);

function draftOf(schema: unknown): SchemaDraft {
  const declared = schema && typeof schema === "object" ? (schema as { $schema?: unknown }).$schema : undefined;
  const draft = typeof declared === "string" ? declared : "";
  if (draft.includes("draft-07")) return "7";
  if (draft.includes("2019-09")) return "2019-09";
  if (draft && !draft.includes("2020-12")) {
    throw new Error(`不支持 $schema "${draft}"，请用 draft-07、2019-09 或 2020-12 / unsupported $schema "${draft}"; use draft-07, 2019-09 or 2020-12`);
  }
  return "2020-12";
}

export const interpretingCompiler: SchemaCompiler = (schema) => {
  if (typeof schema !== "boolean" && (!schema || typeof schema !== "object" || Array.isArray(schema))) {
    throw new Error("schema 必须是对象或布尔值 / a schema must be an object or a boolean");
  }
  const validator = new Validator(schema as object, draftOf(schema), false);
  return (data) => {
    const result = validator.validate(data);
    if (result.valid) return [];
    const errors: SchemaError[] = [];
    for (const unit of result.errors) {
      if (WRAPPERS.has(unit.keyword)) continue;
      errors.push({ path: unit.instanceLocation.replace(/^#/, "") || "/", message: unit.error });
    }
    return errors.length ? errors : [{ path: "/", message: result.errors[0]?.error ?? "invalid" }];
  };
};

export function useInterpretingSchemas(): void {
  setSchemaCompiler(interpretingCompiler);
}
