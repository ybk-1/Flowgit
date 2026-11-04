// Tests run inside workerd with Cloudflare's official Vitest integration (local D1, R2 and
// Durable Objects; nothing talks to the real Cloudflare):
// https://developers.cloudflare.com/workers/testing/vitest-integration/
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(here, "migrations")),
          FLOWGIT_TEST_LOGIN: "1",
          GITHUB_CLIENT_ID: "test-github-id",
          GITHUB_CLIENT_SECRET: "test-github-secret",
          GOOGLE_CLIENT_ID: "test-google-id",
          GOOGLE_CLIENT_SECRET: "test-google-secret",
          FLOWGIT_TEST_LLM_MOCK_DIR: "demo-replies",
          // Test-only keys, made for these tests and used nowhere else.
          VAULT_MASTER_KEY: "bznE5Tb5wkrGu82so15hdMTCoMpsvDnNA8l3mpSHb2k=",
          VAPID_PUBLIC_KEY: "BF_kYEvR8_TQn6FEomOt0pwNhLTKIPOhqgJ_7V7BWu_kdERmMaNEr54cDr89s-8ojUcJFKDdGfIUJWLwKJWV38I",
          VAPID_PRIVATE_KEY: "k7BVArWLpqRoAlPfBsTso9QlLmuvXVslcjAB0fvIi-I",
          VAPID_SUBJECT: "mailto:test@flowgit.dev",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    // Cloud-run tests drive real Workflows instances through several steps; slower CI runners
    // (Windows) need more than vitest's default 5 s for one of them.
    testTimeout: 30_000,
  },
});
