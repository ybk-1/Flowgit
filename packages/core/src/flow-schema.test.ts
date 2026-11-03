import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flowSchemaJson } from "./flow-schema.generated.js";

describe("flow-schema.generated.ts", () => {
  it("matches schema/flow.schema.json (run pnpm build to regenerate)", () => {
    const file = JSON.parse(fs.readFileSync(new URL("../schema/flow.schema.json", import.meta.url), "utf8")) as unknown;
    expect(flowSchemaJson).toEqual(file);
  });

  it("the precompiled validator is up to date (run pnpm build to regenerate)", () => {
    const script = fileURLToPath(new URL("../scripts/gen-schema.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
