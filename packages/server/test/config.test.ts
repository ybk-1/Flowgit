// @ts-expect-error Vite's ?raw import
import raw from "../wrangler.jsonc?raw";
import { describe, expect, it } from "vitest";

describe("wrangler.jsonc", () => {
  it("never turns the test login on in a deployed environment", () => {
    const text = raw as string;
    expect(text).not.toContain("FLOWGIT_TEST_LOGIN");
    const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
    expect(config.env.staging.vars.ENVIRONMENT).toBe("staging");
    expect(config.env.production.vars.ENVIRONMENT).toBe("production");
    expect(config.env.production.routes).toEqual([{ pattern: "flowgit.dev/api/*", zone_name: "flowgit.dev" }]);
    // Bindings are not inherited by environments: each one has every binding.
    for (const name of ["staging", "production"]) {
      const env = config.env[name];
      for (const key of ["d1_databases", "r2_buckets", "durable_objects", "ratelimits", "vars"]) expect(env[key], `${name}.${key}`).toBeTruthy();
    }
  });
});

describe("the test console", () => {
  it("is served with a strict policy", async () => {
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("https://flowgit.test/api/console/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.js");
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect((await SELF.fetch("https://flowgit.test/api/console/../index.ts")).status).not.toBe(200);
  });
});
