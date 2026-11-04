/**
 * Download the Electron binary. pnpm 10 does not run dependency install scripts,
 * so `pnpm install` does not download it.
 *
 * This is the install script shipped with the `electron` package:
 * https://www.electronjs.org/docs/latest/tutorial/installation
 * Run it from desktop.yml, or before `pnpm --filter @flowgit/desktop start`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const install = path.join(path.dirname(require.resolve("electron/package.json")), "install.js");
const result = spawnSync(process.execPath, [install], { stdio: "inherit" });
process.exit(result.status ?? 1);
