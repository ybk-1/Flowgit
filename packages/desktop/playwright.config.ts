import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Desktop end-to-end tests launch the packaged app with Playwright's Electron
 * driver: https://playwright.dev/docs/api/class-electron
 * They are not part of `pnpm test` (that suite must not need the Electron binary).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: path.join(here, "..", "..", "test-results", "desktop"),
  reporter: [["list"]],
});
