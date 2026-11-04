import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const i18n = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "public", "i18n.js"), "utf8");

describe("desktop strings in the board dictionaries", () => {
  it("has the home page strings in both languages", () => {
    expect(i18n).toContain('title: "不用命令行的 Flowgit"');
    expect(i18n).toContain('title: "Flowgit without the command line"');
    expect(i18n).toContain('open: "打开文件夹"');
    expect(i18n).toContain('open: "Open a folder"');
    expect(i18n).toContain('doctor: "这台电脑"');
    expect(i18n).toContain('doctor: "This computer"');
  });
});
