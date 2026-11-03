// Check added or changed registry/community/*.json entries.
// Shallow-clones each entry, read only. The workflow only calls this script.
// Run after `pnpm build` (it imports the compiled checker).
import fs from "node:fs";
import path from "node:path";
import { changedCommunityFiles, checkEntryFile, renderRegistryComment } from "../packages/cli/dist/registry-check.js";

const args = process.argv.slice(2);
let comment = "";
const files = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--comment") comment = args[++i] ?? "";
  else if (arg === "--file") files.push(args[++i] ?? "");
  else if (arg === "--help") {
    console.log("用法 / usage: node scripts/registry-check.mjs --comment out.md [--file registry/community/<id>.json]");
    process.exit(0);
  }
}
const targets = files.filter(Boolean);
if (!targets.length) {
  const base = process.env.REGISTRY_BASE || "origin/main";
  const cwd = process.cwd();
  const changed = changedCommunityFiles(cwd, base);
  if (!changed.ok) {
    const body = `## 社区登记检查 / Community registry check\n\n列不出改动的条目，不能当成没有改动。 / Could not list the changed entries, so this is not treated as "no changes".\n\n${changed.error}\n`;
    if (comment) fs.writeFileSync(comment, body);
    else process.stdout.write(body);
    process.exit(1);
  }
  targets.push(...changed.files.map((rel) => path.resolve(cwd, rel)));
}
const results = targets.flatMap((file) => checkEntryFile(file));
const body = renderRegistryComment(results);
if (comment) fs.writeFileSync(comment, body);
else process.stdout.write(body);
const failed = results.some((result) => !result.ok);
process.exit(failed ? 1 : 0);
