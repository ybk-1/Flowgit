import { defineConfig } from "vitest/config";

// These tests start the built CLI (and FFmpeg) as child processes. On a shared
// CI runner one cold start can stall for seconds (a Windows run once took 5.4s
// for a test that usually takes 0.9s), so vitest's 5s default is too tight.
// The render test keeps its own longer limit.
export default defineConfig({ test: { testTimeout: 30_000 } });
