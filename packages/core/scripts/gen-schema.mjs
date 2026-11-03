// Writes two files from schema/flow.schema.json, so core can check a flow without reading a
// file (a browser has no package files) and without compiling code at run time (the web app's
// Content-Security-Policy forbids eval and new Function, which ajv's compile uses):
//   src/flow-schema.generated.ts    the schema itself
//   src/flow-validate.generated.ts  the schema compiled by ajv's standalone mode
// schema/flow.schema.json stays the source of truth; `pnpm build` runs this first.
// `node scripts/gen-schema.mjs --check` writes nothing and exits 1 when a file is out of date
// (src/flow-schema.test.ts runs it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import standalone from "ajv/dist/standalone/index.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema", "flow.schema.json"), "utf8"));

const schemaTs = `// Generated from schema/flow.schema.json by scripts/gen-schema.mjs. Do not edit.
export const flowSchemaJson: Record<string, unknown> = ${JSON.stringify(schema, null, 2)};
`;

// Same options as before the validator was precompiled (load.ts used to compile at load time).
const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true, code: { source: true, esm: true } });
let code = standalone.default(ajv, ajv.compile(schema));
// The one runtime helper ajv still requires: string length in code points (for minLength/maxLength).
const ucs2 = 'require("ajv/dist/runtime/ucs2length").default';
code = code.split(ucs2).join("((s) => [...s].length)");
if (/\brequire\(/.test(code)) throw new Error("ajv standalone code still has a require(); inline that helper here");
const validateTs = `// Generated from schema/flow.schema.json by scripts/gen-schema.mjs. Do not edit.
// @ts-nocheck
${code}
`;

const outputs = [
  [path.join(root, "src", "flow-schema.generated.ts"), schemaTs],
  [path.join(root, "src", "flow-validate.generated.ts"), validateTs],
];
const check = process.argv.includes("--check");
let stale = false;
for (const [file, text] of outputs) {
  // Windows checkouts may turn \n into \r\n; that is not a difference.
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") === text) continue;
  stale = true;
  if (check) console.error(`过期 / out of date: ${path.relative(root, file)}`);
  else fs.writeFileSync(file, text);
}
if (check && stale) process.exit(1);
