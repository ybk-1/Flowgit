import { describe, expect, it } from "vitest";
import { colorizeUnifiedDiff } from "./format.js";

const patch = ["--- v1/notes.md", "+++ v2/notes.md", "@@ -1,3 +1,3 @@", " keep", "-old line", "+new line", "---- looks like a header", "++++ also added", ""].join("\n");

describe("colorizeUnifiedDiff", () => {
  it("paints added lines green and removed lines red, leaving file headers plain", () => {
    const out = colorizeUnifiedDiff(patch, true);
    expect(out).toContain("\x1b[31m-old line\x1b[0m");
    expect(out).toContain("\x1b[32m+new line\x1b[0m");
    expect(out).toContain("\x1b[31m---- looks like a header\x1b[0m");
    expect(out).toContain("\x1b[32m++++ also added\x1b[0m");
    expect(out.startsWith("--- v1/notes.md\n+++ v2/notes.md\n")).toBe(true);
    expect(out).not.toMatch(/\x1b\[31m--- v1/);
    expect(out).not.toMatch(/\x1b\[32m\+\+\+ v2/);
  });

  it("honors an explicit off switch and NO_COLOR", () => {
    expect(colorizeUnifiedDiff(patch, false)).toBe(patch);
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const prev = process.env.NO_COLOR;
    try {
      delete process.env.NO_COLOR;
      expect(colorizeUnifiedDiff(patch)).toContain("\x1b[32m+new line\x1b[0m");
      process.env.NO_COLOR = "1";
      expect(colorizeUnifiedDiff(patch)).toBe(patch);
      expect(colorizeUnifiedDiff(patch)).not.toMatch(/\x1b\[/);
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
    }
  });
});