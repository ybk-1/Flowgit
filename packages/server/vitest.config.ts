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
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
