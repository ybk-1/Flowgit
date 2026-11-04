import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRecent, rememberRecent } from "./recent.js";
import { readLanguage, writeLanguage } from "./language.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("recent flows and language", () => {
  it("stores paths only, newest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-desktop-recent-"));
    dirs.push(dir);
    const file = path.join(dir, "recent.json");
    expect(readRecent(file)).toEqual([]);
    rememberRecent(file, path.join(dir, "a"));
    rememberRecent(file, path.join(dir, "b"));
    rememberRecent(file, path.join(dir, "a"));
    const listed = readRecent(file);
    expect(listed).toEqual([path.resolve(dir, "a"), path.resolve(dir, "b")]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(listed);
  });

  it("remembers zh or en and ignores anything else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-desktop-lang-"));
    dirs.push(dir);
    const file = path.join(dir, "language.json");
    expect(readLanguage(file)).toBeNull();
    writeLanguage(file, "en");
    expect(readLanguage(file)).toBe("en");
    fs.writeFileSync(file, JSON.stringify({ lang: "fr", extra: true }));
    expect(readLanguage(file)).toBeNull();
  });
});
