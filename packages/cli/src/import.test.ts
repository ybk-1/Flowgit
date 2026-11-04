import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeImport } from "./commands/import.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-import-cli-"));
  dirs.push(dir);
  return dir;
}

function run(file: string, outDir: string, extra: { format?: string; dryRun?: boolean } = {}) {
  const lines: string[] = [];
  const code = executeImport({
    file,
    outDir,
    ...(extra.format ? { format: extra.format } : {}),
    ...(extra.dryRun ? { dryRun: true } : {}),
    log: (line) => lines.push(line),
  });
  return { code, text: lines.join("\n") };
}

const dsl = [
  "version: \"0.1.5\"",
  "kind: app",
  "app:",
  "  name: Sample",
  "  mode: workflow",
  "  description: Hand-written sample",
  "workflow:",
  "  graph:",
  "    nodes:",
  "      - id: start",
  "        type: custom",
  "        data:",
  "          type: start",
  "          title: Start",
  "          variables:",
  "            - variable: topic",
  "              label: Topic",
  "              type: text-input",
  "              required: true",
  "      - id: llm",
  "        type: custom",
  "        data:",
  "          type: llm",
  "          title: Draft",
  "          model:",
  "            name: gpt-4o",
  "            mode: chat",
  "          prompt_template:",
  "            - role: user",
  "              text: \"Write about {{#start.topic#}}\"",
  "    edges:",
  "      - id: e",
  "        source: start",
  "        target: llm",
  "",
].join("\n");

describe("flowgit import", () => {
  it("writes a flow and refuses to overwrite it", () => {
    const dir = tmp();
    const file = path.join(dir, "topic.yml");
    fs.writeFileSync(file, dsl);
    const out = path.join(dir, "out");
    const wrote = run(file, out);
    expect(wrote.code).toBe(0);
    expect(wrote.text).toContain("导入报告 / Import report");
    expect(fs.existsSync(path.join(out, "flow.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "prompts", "draft.md"))).toBe(true);
    expect(fs.readFileSync(path.join(out, "README.md"), "utf8")).toContain("## 导入报告 / Import report");
    const flow = JSON.parse(fs.readFileSync(path.join(out, "flow.json"), "utf8")) as { forkedFrom: { source: string } };
    expect(flow.forkedFrom).toEqual({ source: "dify:topic.yml" });
    const again = run(file, out);
    expect(again.code).toBe(1);
    expect(again.text).toContain("没有覆盖");
    expect(again.text).toContain("nothing was overwritten");
  });

  it("prints a dry run and writes nothing", () => {
    const dir = tmp();
    const file = path.join(dir, "topic.yml");
    fs.writeFileSync(file, dsl);
    const out = path.join(dir, "out");
    const dry = run(file, out, { dryRun: true });
    expect(dry.code).toBe(0);
    expect(dry.text).toContain("要写入的文件");
    expect(dry.text).toContain("prompts/draft.md");
    expect(dry.text).toContain("什么都没写");
    expect(fs.existsSync(path.join(out, "flow.json"))).toBe(false);
  });

  it("stops when a generated file contains a key", () => {
    const dir = tmp();
    const secret = "sk-abcdefghijklmnopqrstuvwxyz";
    const keyed = [
      "version: \"0.1.5\"",
      "kind: app",
      "app:",
      "  name: Keyed",
      "  mode: workflow",
      "workflow:",
      "  graph:",
      "    nodes:",
      "      - id: llm",
      "        type: custom",
      "        data:",
      "          type: llm",
      "          title: Draft",
      "          model:",
      "            name: gpt-4o",
      "          prompt_template:",
      "            - role: user",
      `              text: "use ${secret}"`,
      "    edges: []",
      "",
    ].join("\n");
    const file = path.join(dir, "keyed.yml");
    fs.writeFileSync(file, keyed);
    const out = path.join(dir, "out");
    fs.mkdirSync(out);
    const result = run(file, out);
    expect(result.code).toBe(1);
    expect(result.text).toContain("发现密钥");
    expect(result.text).toContain("nothing was written");
    expect(result.text).not.toContain(secret);
    expect(fs.existsSync(path.join(out, "flow.json"))).toBe(false);
    expect(fs.existsSync(path.join(out, "prompts", "draft.md"))).toBe(false);
  });

  it("reports an unknown file in both languages", () => {
    const dir = tmp();
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, "hello");
    const result = run(file, path.join(dir, "out"));
    expect(result.code).toBe(1);
    expect(result.text).toContain("认不出这是 Dify");
    expect(result.text).toContain("neither a Dify DSL");
    expect(fs.existsSync(path.join(dir, "out", "flow.json"))).toBe(false);
  });
});
