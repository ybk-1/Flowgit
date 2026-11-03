import { describe, expect, it } from "vitest";
import { stageCodeLensAnchors } from "./codelens.js";
import { positionAt } from "./lines.js";

describe("stageCodeLensAnchors", () => {
  it("points at each stage object, including comments, trailing commas and CRLF", () => {
    const text = [
      "{",
      "  // keep this comment",
      '  "stages": [',
      "    {",
      '      "id": "my stage",',
      '      "name": "One",',
      '      "executor": { "type": "human" },',
      '      "outputs": [],',
      "    },",
      "    {",
      '      "id": "next",',
      '      "executor": { "type": "llm", "prompt": "prompts/a.md" },',
      '      "outputs": [{ "path": "out.md", "type": "text/markdown" }],',
      "    },",
      "  ],",
      "}",
    ].join("\r\n");

    const lines = text.split(/\r?\n/);
    const anchors = stageCodeLensAnchors(text);
    expect(anchors.map((anchor) => anchor.stageId)).toEqual(["my stage", "next"]);
    expect(lines[anchors[0]!.line]).toBe("    {");
    expect(lines[anchors[1]!.line]).toBe("    {");
    expect(anchors[0]!.character).toBe(4);
    expect(anchors[1]!.character).toBe(4);
    expect(anchors[0]!.line).toBeLessThan(lines.findIndex((line) => line.includes('"id": "next"')));
    const braceAt = text.indexOf('    {\r\n      "id": "my stage"') + "    ".length;
    expect(text[braceAt]).toBe("{");
    expect(positionAt(text, braceAt)).toEqual({ line: anchors[0]!.line, character: anchors[0]!.character });
  });
});
