import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VSCODE_ENGINE } from "../engine.js";
import { MESSAGES } from "./messages.js";
import { repoRoot } from "./locate.js";

describe("package metadata", () => {
  const root = repoRoot(import.meta.url);
  const pkgDir = path.join(root, "packages", "vscode");

  it("stays private and is left out of the npm release", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      private: boolean;
      engines: { vscode: string };
      devDependencies: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(pkg.private).toBe(true);
    expect(pkg.engines.vscode).toBe(VSCODE_ENGINE);
    expect(pkg.devDependencies["@types/vscode"]).toBe("1.125.0");
    expect(pkg.devDependencies.esbuild).toBe("^0.25.12");
    expect(pkg.dependencies["jsonc-parser"]).toBeTruthy();

    const release = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
    const smoke = fs.readFileSync(path.join(root, "scripts", "pack-smoke.mjs"), "utf8");
    for (const text of [release, smoke]) {
      expect(text.includes("packages/vscode")).toBe(false);
      expect(text.includes("flowgit-vscode")).toBe(false);
    }
  });

  it("has matching English and Simplified Chinese strings", () => {
    const en = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.nls.json"), "utf8")) as Record<string, string>;
    const zh = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.nls.zh-cn.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    const manifest = fs.readFileSync(path.join(pkgDir, "package.json"), "utf8");
    for (const key of manifest.match(/%([A-Za-z0-9.]+)%/g) ?? []) {
      expect(en[key.slice(1, -1)]).toBeTypeOf("string");
    }
    const bundle = JSON.parse(fs.readFileSync(path.join(pkgDir, "l10n", "bundle.l10n.zh-cn.json"), "utf8")) as Record<string, string>;
    for (const message of Object.values(MESSAGES)) {
      expect(bundle[message], message).toBeTypeOf("string");
      expect(bundle[message]!.length).toBeGreaterThan(0);
    }
  });

  it("keeps the vscode module out of the pure logic, and does not download a CLI", () => {
    const logic = path.join(pkgDir, "src", "logic");
    for (const name of fs.readdirSync(logic)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const text = fs.readFileSync(path.join(logic, name), "utf8");
      expect(text.includes('from "vscode"') || text.includes("from 'vscode'")).toBe(false);
      expect(text.includes("npx")).toBe(false);
      expect(text.includes("secretStorage")).toBe(false);
      expect(text.includes("ANTHROPIC_API_KEY")).toBe(false);
    }
    const hostFiles = ["extension.ts", "commands.ts", "items.ts", "sidebar.ts", "lenses.ts", "store.ts"];
    for (const name of hostFiles) {
      const text = fs.readFileSync(path.join(pkgDir, "src", name), "utf8");
      expect(text.includes("npx")).toBe(false);
      expect(text.includes("secretStorage")).toBe(false);
      expect(text.includes("ANTHROPIC_API_KEY")).toBe(false);
    }
  });
});
