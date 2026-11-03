import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copySchemaFile, coreSchemaPath, filesEqual } from "./schema.js";
import { repoRoot } from "./locate.js";

describe("flow schema copy", () => {
  it("copies packages/core/schema/flow.schema.json unchanged", () => {
    const root = repoRoot(import.meta.url);
    const from = coreSchemaPath(root);
    const to = path.join(os.tmpdir(), `flowgit-schema-${process.pid}.json`);
    copySchemaFile(from, to);
    try {
      expect(filesEqual(from, to)).toBe(true);
      expect(fs.readFileSync(from).equals(fs.readFileSync(to))).toBe(true);
    } finally {
      fs.rmSync(to, { force: true });
    }
    const build = fs.readFileSync(path.join(root, "packages", "vscode", "scripts", "build.mjs"), "utf8");
    expect(build).toContain("flow.schema.json");
    expect(build).toContain('"core"');
    expect(build).toContain('"schema"');
  });
});
