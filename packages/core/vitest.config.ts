import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests import modules directly, not through index.ts; give them the same Node host and MCP executor.
    setupFiles: ["./src/node-setup.ts"],
  },
});
