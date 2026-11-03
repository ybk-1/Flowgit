// Check registry/community/*.json (one entry per file) against community.schema.json.
// The old single-file array still loads if you pass it as the argument.
// Run after `pnpm build` (it imports the compiled checker). No network.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCommunityRegistry } from "../packages/cli/dist/registry.js";

const source = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "registry", "community");
const result = await loadCommunityRegistry(source);
if (!result.ok) {
  console.error("社区模板登记不合法 / the community registry is invalid");
  for (const error of result.errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`社区模板登记通过 / community registry ok (${result.entries.length})`);
