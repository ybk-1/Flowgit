import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("keeps commas inside quotes", () => {
    expect(parseCsv('name,note\n"猫,狗",plain\n')).toEqual([
      ["name", "note"],
      ["猫,狗", "plain"],
    ]);
  });

  it("keeps newlines inside quotes", () => {
    expect(parseCsv('a,b\n"line1\nline2",ok\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "ok"],
    ]);
  });

  it("turns a doubled quote into one quote", () => {
    expect(parseCsv('"say ""hi""",c\n')).toEqual([['say "hi"', "c"]]);
    expect(parseCsv('"a""b",c\n')).toEqual([['a"b', "c"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFtopic,tone\n猫,warm\n")).toEqual([
      ["topic", "tone"],
      ["猫", "warm"],
    ]);
  });

  it("accepts CRLF record separators without an extra empty row", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv('"a\r\nb",c\r\nd,e')).toEqual([
      ["a\r\nb", "c"],
      ["d", "e"],
    ]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('"open,field\n')).toThrow(/unclosed quote/);
  });
});
