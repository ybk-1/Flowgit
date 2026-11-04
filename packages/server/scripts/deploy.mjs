// Deploy the Worker to Cloudflare: node scripts/deploy.mjs <staging|production>
// Run by .github/workflows/server.yml after `pnpm build`. Needs CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID (https://developers.cloudflare.com/workers/wrangler/system-environment-variables/);
// without them it says so and exits 0, like the site deploy.
// 1. Find the D1 database and R2 bucket by name, creating them the first time
//    (https://developers.cloudflare.com/d1/wrangler-commands/, https://developers.cloudflare.com/r2/reference/wrangler-commands/).
// 2. Write wrangler.deploy.json with the database id filled in (nothing account-specific is committed).
// 3. Staging only: copy the built web app into public/app/, so staging.flowgit.dev/app/ works.
// 4. Apply D1 migrations, then deploy.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2];
if (target !== "staging" && target !== "production") {
  console.error("用法 / usage: node scripts/deploy.mjs <staging|production>");
  process.exit(1);
}
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.log(`没有 Cloudflare 密钥，跳过部署 ${target} / No Cloudflare secrets, skipping the ${target} deploy`);
  process.exit(0);
}

const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
function wrangler(args, options = {}) {
  console.log(`$ wrangler ${args.join(" ")}`);
  return execFileSync(process.execPath, [wranglerBin, ...args], { cwd: root, encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
}

// wrangler.jsonc has only whole-line // comments.
const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
const env = config.env[target];
const db = env.d1_databases[0];
const bucket = env.r2_buckets[0].bucket_name;

const findDb = () => JSON.parse(wrangler(["d1", "list", "--json"], { capture: true })).find((item) => item.name === db.database_name);
let found = findDb();
if (!found) {
  wrangler(["d1", "create", db.database_name]);
  found = findDb();
}
if (!found?.uuid) throw new Error(`找不到 D1 数据库 / D1 database not found: ${db.database_name}`);
db.database_id = found.uuid;

try {
  wrangler(["r2", "bucket", "info", bucket], { capture: true });
} catch {
  wrangler(["r2", "bucket", "create", bucket]);
}

fs.writeFileSync(path.join(root, "wrangler.deploy.json"), JSON.stringify(config, null, 2));

const appDist = path.join(root, "..", "app", "dist");
const appOut = path.join(root, "public", "app");
fs.rmSync(appOut, { recursive: true, force: true });
if (target === "staging" && fs.existsSync(appDist)) fs.cpSync(appDist, appOut, { recursive: true });

wrangler(["d1", "migrations", "apply", "DB", "--remote", "--env", target, "--config", "wrangler.deploy.json"]);
wrangler(["deploy", "--env", target, "--config", "wrangler.deploy.json"]);
