import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function jsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFiles(abs));
    else if (entry.isFile() && entry.name.endsWith(".js")) found.push(abs);
  }
  return found;
}

describe("board modules", () => {
  it("only api.js calls fetch or EventSource", () => {
    const bad: string[] = [];
    let api = "";
    for (const file of jsFiles(publicDir)) {
      const rel = path.relative(publicDir, file);
      const text = fs.readFileSync(file, "utf8");
      if (rel === "api.js") {
        api = text;
        continue;
      }
      if (text.includes("fetch(") || text.includes("new EventSource(")) bad.push(rel);
    }
    expect(bad).toEqual([]);
    expect(api).toContain("fetch(");
    expect(api).toContain("new EventSource(");
  });
});
