// Check registry/community.json against the same rules as community.schema.json.
// Run after `pnpm build` (it imports the compiled checker). No network.
import { readFileSync } from "node:fs";
import { validateCommunityRegistry } from "../packages/cli/dist/registry.js";

const file = new URL("../registry/community.json", import.meta.url);
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`社区模板登记不是合法的 JSON / the community registry is not valid JSON: ${err.message}`);
  process.exit(1);
}
const result = validateCommunityRegistry(data);
if (!result.ok) {
  console.error("社区模板登记不合法 / the community registry is invalid");
  for (const error of result.errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`社区模板登记通过 / community registry ok (${result.entries.length})`);
