// Keep the packages on one version, and check a release tag against it.
//
//   node scripts/release-version.mjs check v0.1.1   # CI: the tag must match every package
//   node scripts/release-version.mjs set 0.1.1      # bump every package before a release
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["packages/core/package.json", "packages/web/package.json", "packages/cli/package.json"].map((f) => path.join(root, f));
const [command, arg] = process.argv.slice(2);
const want = (arg ?? "").replace(/^v/, "");

if (!["check", "set"].includes(command) || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(want)) {
  console.error("用法 / usage: node scripts/release-version.mjs check v0.1.1 | set 0.1.1");
  process.exit(2);
}

let ok = true;
for (const file of files) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (command === "set") {
    pkg.version = want;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`${pkg.name} → ${want}`);
  } else if (pkg.version !== want) {
    console.error(`✗ ${pkg.name} 的版本是 ${pkg.version}，tag 是 ${arg} / ${pkg.name} is at ${pkg.version} but the tag is ${arg}`);
    ok = false;
  } else {
    console.log(`✓ ${pkg.name} ${pkg.version}`);
  }
}
process.exit(ok ? 0 : 1);
