// Writes src/flow-schema.generated.ts from schema/flow.schema.json, so the schema is bundled
// into code and core can load it without reading a file (a browser has no package files).
// schema/flow.schema.json stays the source of truth; `pnpm build` runs this first, and
// src/flow-schema.test.ts fails when the two differ.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema", "flow.schema.json"), "utf8"));
const out = `// Generated from schema/flow.schema.json by scripts/gen-schema.mjs. Do not edit.
export const flowSchemaJson: Record<string, unknown> = ${JSON.stringify(schema, null, 2)};
`;
const file = path.join(root, "src", "flow-schema.generated.ts");
if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== out) fs.writeFileSync(file, out);
