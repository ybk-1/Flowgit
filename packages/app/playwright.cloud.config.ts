import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const port = 8791;
const persist = path.join(os.tmpdir(), `flowgit-cloud-e2e-${process.pid}`);

/**
 * Web app against the local cloud emulator.
 * wrangler 4.157.0 (checked against https://developers.cloudflare.com/workers/wrangler/commands/dev/
 * and https://developers.cloudflare.com/workers/wrangler/commands/#d1-migrations-apply):
 * `--persist-to` is shared by the migration and `wrangler dev`, `--var KEY:VALUE` injects
 * FLOWGIT_TEST_LOGIN, `--latest false` stays on the installed runtime.
 * Playwright webServer: https://playwright.dev/docs/test-webserver
 */
const command = [
  "set -e",
  `cd ${JSON.stringify(root)}`,
  `rm -rf ${JSON.stringify(persist)}`,
  `mkdir -p ${JSON.stringify(persist)}`,
  "pnpm --filter @flowgit/app build",
  "rm -rf packages/server/public/app",
  "mkdir -p packages/server/public/app",
  "cp -a packages/app/dist/. packages/server/public/app/",
  `pnpm --filter @flowgit/server exec wrangler d1 migrations apply DB --local --persist-to ${JSON.stringify(persist)}`,
  `pnpm --filter @flowgit/server exec wrangler dev --port ${port} --ip 127.0.0.1 --persist-to ${JSON.stringify(persist)} --var FLOWGIT_TEST_LOGIN:1 --latest false --inspector-port 9239 --show-interactive-dev-session false`,
].join(" && ");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "cloud*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: path.join(root, "test-results", "cloud"),
  reporter: [["list"]],
  webServer: {
    command,
    cwd: root,
    url: `http://127.0.0.1:${port}/app/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}/app/`,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.FLOWGIT_CHROMIUM ? { executablePath: process.env.FLOWGIT_CHROMIUM } : {},
  },
});