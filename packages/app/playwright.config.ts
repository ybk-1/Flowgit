import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const port = 4178;

/**
 * Web app end-to-end tests: the built site (pnpm --filter @flowgit/app build) served as static files.
 * FLOWGIT_CHROMIUM points at a Chromium binary when Playwright's own download isn't installed.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: path.join(root, "test-results", "app"),
  reporter: [["list"]],
  webServer: {
    command: `node scripts/serve.mjs ${port}`,
    cwd: here,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.FLOWGIT_CHROMIUM ? { executablePath: process.env.FLOWGIT_CHROMIUM } : {},
  },
});
