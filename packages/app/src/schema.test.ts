import { describe, expect, it } from "vitest";
import { interpretingCompiler } from "./schema.js";

const schema = {
  type: "object",
  required: ["n"],
  properties: { n: { type: "number" }, tags: { type: "array", items: { enum: ["a", "b"] } } },
  additionalProperties: false,
};

describe("interpreting schema compiler (no new Function, for the app's CSP)", () => {
  it("accepts valid data and reports the failing JSON paths, without wrapper errors", () => {
    const check = interpretingCompiler(schema);
    expect(check({ n: 1, tags: ["a"] })).toEqual([]);
    const errors = check({ n: "no", tags: ["z"], extra: true });
    expect(errors.map((e) => e.path)).toEqual(["/n", "/tags/0", "/"]);
    expect(errors.every((e) => e.message.length > 0)).toBe(true);
  });

  it("reads draft-07, rejects drafts it can't check, and rejects a schema that is not an object", () => {
    expect(interpretingCompiler({ $schema: "http://json-schema.org/draft-07/schema#", type: "string" })(1)).toHaveLength(1);
    expect(() => interpretingCompiler({ $schema: "http://json-schema.org/draft-04/schema#" })).toThrow(/draft-07/);
    expect(() => interpretingCompiler([])).toThrow(/object/);
  });
});
