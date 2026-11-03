import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { flowSchemaJson } from "./flow-schema.generated.js";

describe("flow-schema.generated.ts", () => {
  it("matches schema/flow.schema.json (run pnpm build to regenerate)", () => {
    const file = JSON.parse(fs.readFileSync(new URL("../schema/flow.schema.json", import.meta.url), "utf8")) as unknown;
    expect(flowSchemaJson).toEqual(file);
  });
});
