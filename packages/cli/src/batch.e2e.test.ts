import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Built CLI, canned model replies, no network and no API key.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");

let work: string;
let flowDir: string;
let mockDir: string;

function flowgit(dir: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      OPENAI_API_KEY: "",
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function writeFlow(dir: string): void {
  fs.mkdirSync(path.join(dir, "demo-replies"), { recursive: true });
  fs.mkdirSync(path.join(dir, "runs", "draft", "9"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
  fs.mkdirSync(path.join(dir, "batch"), { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), "Write about {{inputs.topic}}.\n");
  fs.writeFileSync(path.join(dir, "demo-replies", "draft.md"), "DRAFT-FROM-MOCK\n");
  fs.writeFileSync(path.join(dir, "draft.md"), "SHOULD-NOT-COPY\n");
  fs.writeFileSync(path.join(dir, "note.txt"), "COPIED-NOTE\n");
  fs.writeFileSync(path.join(dir, "runs", "draft", "9", "run.json"), '{"sourceRun":true}\n');
  fs.writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports = {}\n");
  fs.writeFileSync(path.join(dir, "batch", "keep-me.txt"), "stay\n");
  fs.writeFileSync(path.join(dir, ".env"), "SECRET_MARKER=1\n");
  fs.writeFileSync(path.join(dir, ".env.local"), "LOCAL_SECRET=1\n");
  fs.writeFileSync(path.join(dir, "flowgit.local.json"), JSON.stringify({ marker: "SOURCE", inputs: { topic: "from-source" } }) + "\n");
  fs.writeFileSync(
    path.join(dir, "check.mjs"),
    [
      "import fs from 'node:fs';",
      "const inputs = JSON.parse(process.env.FLOWGIT_FLOW_INPUTS ?? '{}');",
      "const draft = fs.readFileSync('draft.md', 'utf8');",
      "if (!draft.includes('DRAFT-FROM-MOCK')) { console.error('draft was not the mock reply'); process.exit(1); }",
      "fs.writeFileSync('check.json', JSON.stringify({ ok: true, topic: inputs.topic, tone: inputs.tone, count: inputs.count }) + '\\n');",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "flow.json"),
    JSON.stringify(
      {
        format: "flowgit",
        version: "0.1",
        name: "batch-demo",
        inputs: {
          topic: { type: "string", description: "题目 / topic", required: true },
          tone: { type: "string", description: "语气 / tone", default: "calm" },
          count: { type: "number", description: "条数 / count", default: 1 },
        },
        stages: [
          {
            id: "draft",
            name: "草稿",
            executor: { type: "llm", prompt: "prompt.md" },
            outputs: [{ type: "text/markdown", path: "draft.md" }],
          },
          {
            id: "check",
            name: "检查",
            inputs: ["draft"],
            executor: { type: "script", run: "node check.mjs" },
            outputs: [{ type: "application/json", path: "check.json" }],
          },
        ],
      },
      null,
      2,
    ),
  );
}

beforeAll(() => {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-batch-"));
  flowDir = path.join(work, "flow");
  mockDir = path.join(flowDir, "demo-replies");
  writeFlow(flowDir);
});

afterAll(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

const rowsCsv = () =>
  "\uFEFFtopic,tone,count\r\n" + '猫,"say ""hi""",2\r\n' + ",loud,\r\n" + "狗\r\n" + '"鸟\n雀",bright,3\r\n';

describe("flowgit batch", () => {
  it("runs three rows, fails an empty required input, and skips finished stages the second time", () => {
    const file = path.join(work, "rows.csv");
    // BOM, CRLF, "" inside quotes, and a newline inside quotes.
    fs.writeFileSync(file, rowsCsv());
    const first = flowgit(flowDir, ["batch", file, "--out", "batch", "--concurrency", "2"], { FLOWGIT_LLM_MOCK_DIR: mockDir });
    expect(first.code, first.out).toBe(1);
    expect(first.out).toMatch(/001-猫\s+done\s+0/);
    expect(first.out).toMatch(/002-row\s+failed:/);
    expect(first.out).toContain("缺少流程输入");
    expect(first.out).toMatch(/003-狗\s+done\s+0/);
    expect(first.out).toMatch(/004-鸟雀\s+done\s+0/);
    expect(first.out).toContain("用量合计 / total usage: 0 输入 input + 0 输出 output tokens（0 次模型调用 / model calls）");

    const row = (name: string) => path.join(flowDir, "batch", name);
    expect(JSON.parse(fs.readFileSync(path.join(row("001-猫"), "check.json"), "utf8"))).toEqual({ ok: true, topic: "猫", tone: 'say "hi"', count: 2 });
    expect(JSON.parse(fs.readFileSync(path.join(row("003-狗"), "check.json"), "utf8"))).toEqual({ ok: true, topic: "狗", tone: "calm", count: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(row("004-鸟雀"), "check.json"), "utf8"))).toEqual({ ok: true, topic: "鸟\n雀", tone: "bright", count: 3 });
    expect(fs.existsSync(path.join(row("002-row"), "check.json"))).toBe(false);

    const local = JSON.parse(fs.readFileSync(path.join(row("001-猫"), "flowgit.local.json"), "utf8")) as { marker?: string; inputs: { topic: string } };
    expect(local.marker).toBeUndefined();
    expect(local.inputs.topic).toBe("猫");
    expect(fs.readFileSync(path.join(row("001-猫"), "note.txt"), "utf8")).toBe("COPIED-NOTE\n");
    expect(fs.readFileSync(path.join(row("001-猫"), "draft.md"), "utf8")).toContain("DRAFT-FROM-MOCK");
    expect(fs.readFileSync(path.join(row("001-猫"), "draft.md"), "utf8")).not.toContain("SHOULD-NOT-COPY");
    for (const name of ["001-猫", "003-狗", "004-鸟雀"]) {
      expect(fs.existsSync(path.join(row(name), ".env"))).toBe(false);
      expect(fs.existsSync(path.join(row(name), ".env.local"))).toBe(false);
      expect(fs.existsSync(path.join(row(name), "node_modules"))).toBe(false);
      expect(fs.existsSync(path.join(row(name), "runs", "draft", "9"))).toBe(false);
      expect(fs.existsSync(path.join(row(name), "batch", "keep-me.txt"))).toBe(false);
      expect(fs.readdirSync(path.join(row(name), "runs", "draft"))).toEqual(["1"]);
    }
    expect(fs.readFileSync(path.join(flowDir, "batch", "keep-me.txt"), "utf8")).toBe("stay\n");

    fs.writeFileSync(path.join(flowDir, "only-source.txt"), "nope\n");
    const again = flowgit(flowDir, ["batch", file, "--out", "batch"], { FLOWGIT_LLM_MOCK_DIR: mockDir });
    expect(again.code, again.out).toBe(1);
    expect(again.out).toContain("已有这个文件夹，不重新复制");
    expect(again.out.match(/已是最新/g)?.length).toBeGreaterThanOrEqual(6);
    for (const name of ["001-猫", "002-row", "003-狗", "004-鸟雀"]) {
      expect(fs.existsSync(path.join(row(name), "only-source.txt"))).toBe(false);
    }
    expect(fs.readdirSync(path.join(row("001-猫"), "runs", "draft"))).toEqual(["1"]);
    expect(fs.readdirSync(path.join(row("003-狗"), "runs", "check"))).toEqual(["1"]);
  });

  it("errors on an unknown column, a concurrency above 4, and a row range outside the file", () => {
    const bad = path.join(work, "bad.csv");
    fs.writeFileSync(bad, "topic,nope\n猫,x\n");
    const unknown = flowgit(flowDir, ["batch", bad, "--out", "should-not"], { FLOWGIT_LLM_MOCK_DIR: mockDir });
    expect(unknown.code, unknown.out).toBe(1);
    expect(unknown.out).toContain("Unknown column(s): nope");
    expect(unknown.out).toContain("known inputs: topic, tone, count");
    expect(fs.existsSync(path.join(flowDir, "should-not"))).toBe(false);

    const tooMany = flowgit(flowDir, ["batch", bad, "--concurrency", "5", "--out", "also-no"], { FLOWGIT_LLM_MOCK_DIR: mockDir });
    expect(tooMany.code, tooMany.out).toBe(1);
    expect(tooMany.out).toContain("concurrency is at most 4, got 5");
    expect(fs.existsSync(path.join(flowDir, "also-no"))).toBe(false);

    const file = path.join(work, "rows.csv");
    fs.writeFileSync(file, rowsCsv());
    const range = flowgit(flowDir, ["batch", file, "--rows", "9-9", "--out", "range-no"], { FLOWGIT_LLM_MOCK_DIR: mockDir });
    expect(range.code, range.out).toBe(1);
    expect(range.out).toContain("CSV has 4 data row(s)");
    expect(fs.existsSync(path.join(flowDir, "range-no"))).toBe(false);
  });

  it("runs a row range to completion and keeps the original row numbers", () => {
    const file = path.join(work, "rows.csv");
    fs.writeFileSync(file, rowsCsv());
    const slice = flowgit(flowDir, ["batch", file, "--rows", "3-4", "--out", "slice"], { FLOWGIT_LLM_MOCK_DIR: mockDir });
    expect(slice.code, slice.out).toBe(0);
    expect(slice.out).toMatch(/003-狗\s+done/);
    expect(slice.out).toMatch(/004-鸟雀\s+done/);
    expect(fs.existsSync(path.join(flowDir, "slice", "001-猫"))).toBe(false);
    expect(fs.existsSync(path.join(flowDir, "slice", "002-row"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(flowDir, "slice", "003-狗", "check.json"), "utf8")).topic).toBe("狗");
  });

  it("waits at a human stage without failing the other rows", () => {
    const dir = path.join(work, "wait");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "flow.json"),
      JSON.stringify({
        format: "flowgit",
        version: "0.1",
        name: "wait",
        inputs: { title: { type: "string", required: true } },
        stages: [{ id: "notes", name: "随手记", executor: { type: "human", instructions: "写 notes.md" }, outputs: [{ type: "text/markdown", path: "notes.md" }] }],
      }),
    );
    const one = path.join(work, "one.csv");
    fs.writeFileSync(one, "title\nhello\n");
    const waiting = flowgit(dir, ["batch", one, "--out", "batch"], { FLOWGIT_LLM_MOCK_DIR: "" });
    expect(waiting.code, waiting.out).toBe(2);
    expect(waiting.out).toMatch(/001-hello\s+waiting: notes/);
    expect(waiting.out).not.toContain("failed:");

    const mix = path.join(work, "mix.csv");
    fs.writeFileSync(mix, "title\nhello\n\n");
    const both = flowgit(dir, ["batch", mix, "--out", "mix"], { FLOWGIT_LLM_MOCK_DIR: "" });
    expect(both.code, both.out).toBe(1);
    expect(both.out).toMatch(/001-hello\s+waiting: notes/);
    expect(both.out).toMatch(/002-row\s+failed:/);
    expect(fs.existsSync(path.join(dir, "mix", "001-hello", "flow.json"))).toBe(true);
  });

  it("asks once for a flow copied from a Git URL, then runs every row copy under that confirmation", () => {
    const dir = path.join(work, "forked");
    writeFlow(dir);
    const flowFile = path.join(dir, "flow.json");
    const flow = JSON.parse(fs.readFileSync(flowFile, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(flowFile, JSON.stringify({ ...flow, forkedFrom: { source: "https://example.com/someone/flow.git", commit: "abc123" } }, null, 2));
    const home = path.join(work, "forked-home");
    const env = { FLOWGIT_LLM_MOCK_DIR: path.join(dir, "demo-replies"), FLOWGIT_HOME: home };
    const file = path.join(work, "forked.csv");
    fs.writeFileSync(file, "topic\n猫\n狗\n");

    // No terminal to ask in: nothing is copied or run, and it says how to confirm.
    const refused = flowgit(dir, ["batch", file, "--out", "rows"], env);
    expect(refused.code, refused.out).toBe(1);
    expect(refused.out).toContain("node check.mjs");
    expect(refused.out).toContain("flowgit trust");
    expect(fs.existsSync(path.join(dir, "rows"))).toBe(false);

    // --yes confirms the source once; each row copy does the same things, so it runs too.
    const ran = flowgit(dir, ["batch", file, "--out", "rows", "--yes"], env);
    expect(ran.code, ran.out).toBe(0);
    expect(ran.out).toMatch(/001-猫\s+done/);
    expect(ran.out).toMatch(/002-狗\s+done/);
    const store = JSON.parse(fs.readFileSync(path.join(home, "trusted.json"), "utf8")) as { flows: Record<string, unknown> };
    expect(Object.keys(store.flows)).toHaveLength(3);

    // A row folder whose commands were changed by hand is not covered by the source's confirmation.
    const edited = path.join(dir, "rows", "001-猫", "flow.json");
    fs.writeFileSync(edited, fs.readFileSync(edited, "utf8").replace("node check.mjs", "node check.mjs --again"));
    const again = flowgit(dir, ["batch", file, "--out", "rows"], env);
    expect(again.code, again.out).toBe(1);
    expect(again.out).toMatch(/001-猫\s+failed:.*flowgit trust/);
    expect(again.out).toMatch(/002-狗\s+done/);
  });

  it("prints bilingual help", () => {
    const help = spawnSync(process.execPath, [cli, "batch", "--help"], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("file.csv");
    expect(help.stdout).toContain("--concurrency");
    expect(help.stdout).toContain("--rows");
    expect(help.stdout).toContain('默认 / default: "batch"');
  });
});
