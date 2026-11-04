import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { host, withHost, type Host, type HostEnv } from "./host/current.js";
import { loadFlow } from "./load.js";
import { TrustNeededError, trustFlow } from "./trust.js";
import { runFlowTests, type FlowTestReport } from "./flowtest.js";

const schema = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../schema/flow-test.schema.json", import.meta.url)), "utf8")) as object;
const validateCase = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): { root: string; home: string; tmp: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-flowtest-"));
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  fs.mkdirSync(home);
  fs.mkdirSync(tmp);
  roots.push(root);
  return { root, home, tmp };
}

function withEnv<T>(home: string, tmp: string, fn: () => Promise<T>, fetch?: Host["fetch"]): Promise<T> {
  const base = host();
  const env: Record<string, string | undefined> = {};
  for (const key of Object.keys(base.env)) env[key] = base.env[key];
  env.FLOWGIT_HOME = home;
  env.TMPDIR = tmp;
  const wrapped = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "env") return env as HostEnv;
      if (prop === "fetch" && fetch) return fetch;
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return withHost(wrapped as Host, fn);
}

function hashDir(dir: string): string {
  const hash = host().hash();
  const walk = (abs: string, rel: string) => {
    for (const name of host().readdir(abs).slice().sort((a, b) => a.localeCompare(b))) {
      const child = path.join(abs, name);
      const next = rel ? `${rel}/${name}` : name;
      const stat = host().lstat(child);
      if (stat.isSymbolicLink()) {
        hash.update(`link ${next}\n`);
      } else if (stat.isDirectory()) {
        hash.update(`dir ${next}\n`);
        walk(child, next);
      } else if (stat.isFile()) {
        hash.update(`file ${next}\n`);
        hash.update(host().readFile(child));
        hash.update("\n");
      }
    }
  };
  walk(dir, "");
  return hash.digest();
}

function write(dir: string, rel: string, text: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const FLOW = {
  format: "flowgit",
  version: "0.1",
  name: "测试流程",
  inputs: {
    topic: { type: "string", enum: ["a", "b"], required: true },
  },
  stages: [
    {
      id: "note",
      name: "笔记",
      executor: { type: "human" },
      outputs: [{ type: "text/plain", path: "note.txt" }],
    },
    {
      id: "echo",
      name: "回声",
      inputs: ["note"],
      executor: { type: "service", method: "POST", url: "http://127.0.0.1:9/echo" },
      outputs: [{ type: "application/json", path: "echo.json", schema: "schemas/echo.schema.json" }],
    },
    {
      id: "report",
      name: "报告",
      inputs: ["echo"],
      executor: { type: "script", run: "node scripts/report.mjs" },
      outputs: [
        { type: "text/markdown", path: "report.md" },
        { type: "application/json", path: "out.json" },
      ],
    },
  ],
};

const REPORT_SCRIPT = `import fs from "node:fs";
const outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? "[]");
const report = outputs.find((item) => String(item.path).endsWith(".md"))?.path ?? "report.md";
const json = outputs.find((item) => String(item.path).endsWith(".json"))?.path ?? "out.json";
if (!fs.existsSync("echo.json")) {
  console.error("missing echo.json");
  process.exit(1);
}
JSON.parse(fs.readFileSync("echo.json", "utf8"));
const long = "A".repeat(300);
fs.writeFileSync(report, "# Report\\n\\nhello flowgit test\\n\\n" + long + "\\n");
fs.writeFileSync(json, JSON.stringify({ ok: true, n: 5, items: ["one", "two"], title: "hello" }, null, 2) + "\\n");
`;

function scaffold(dir: string): void {
  write(dir, "flow.json", `${JSON.stringify(FLOW, null, 2)}\n`);
  write(dir, "scripts/report.mjs", REPORT_SCRIPT);
  write(dir, "fixtures/note.txt", "hello\n");
  write(dir, "fixtures/echo.json", `${JSON.stringify({ items: ["x"], ok: true }, null, 2)}\n`);
  write(dir, "fixtures/echo-bad.json", `${JSON.stringify({ items: "nope", ok: true }, null, 2)}\n`);
  write(
    dir,
    "schemas/echo.schema.json",
    `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["items", "ok"],
      properties: { items: { type: "array", items: { type: "string" } }, ok: { type: "boolean" } },
    })}\n`,
  );
}

const passCase = {
  name: "全部通过",
  inputs: { topic: "a" },
  files: { "note.txt": "fixtures/note.txt", "echo.json": "fixtures/echo.json" },
  skip: ["echo"],
  expect: {
    note: [{ file: "note.txt", exists: true, contains: "hello" }],
    echo: [
      { file: "echo.json", json: true },
      { file: "echo.json", jsonPath: "ok", equals: true },
      { file: "echo.json", jsonPath: "items", length: 1 },
      { file: "echo.json", jsonPath: "items.length", equals: 1 },
    ],
    report: [
      { file: "report.md", exists: true },
      { file: "report.md", contains: ["Report", "hello"] },
      { file: "report.md", notContains: ["TODO", "TBD"] },
      { file: "report.md", matches: "^# Report" },
      { file: "report.md", minChars: 10, maxChars: 500 },
      { file: "missing.txt", exists: false },
      { file: "out.json", json: true },
      { file: "out.json", jsonPath: "n", min: 1, max: 10 },
      { file: "out.json", jsonPath: "items", length: 2 },
      { file: "out.json", jsonPath: "items.length", equals: 2 },
      { file: "out.json", jsonPath: "ok", equals: true },
      { file: "out.json", jsonPath: "title", equals: "hello" },
    ],
  },
};

const failCase = {
  name: "全部失败",
  inputs: { topic: "b" },
  files: { "note.txt": "fixtures/note.txt", "echo.json": "fixtures/echo-bad.json" },
  skip: ["echo"],
  expect: {
    note: [{ file: "note.txt", exists: false }],
    echo: [{ file: "echo.json", json: true }],
    report: [
      { file: "report.md", exists: false },
      { file: "missing.txt", exists: true },
      { file: "report.md", contains: "NOT-IN-FILE" },
      { file: "report.md", contains: ["Report", "NOT-IN-FILE"] },
      { file: "report.md", notContains: "hello" },
      { file: "report.md", notContains: ["zzz", "hello"] },
      { file: "report.md", matches: "^nope" },
      { file: "report.md", minChars: 100000 },
      { file: "report.md", maxChars: 1 },
      { file: "report.md", json: true },
      { file: "out.json", jsonPath: "n", min: 100 },
      { file: "out.json", jsonPath: "n", max: 1 },
      { file: "out.json", jsonPath: "items", length: 9 },
      { file: "out.json", jsonPath: "items.length", equals: 9 },
      { file: "out.json", jsonPath: "ok", equals: false },
      { file: "out.json", jsonPath: "missing.path", equals: 1 },
    ],
  },
};

function putCase(dir: string, name: string, data: unknown, schemaOk = true): void {
  if (schemaOk) expect(validateCase(data), JSON.stringify(validateCase.errors)).toBe(true);
  write(dir, `tests/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

describe("runFlowTests", () => {
  it("passes every check, fails every check, and does not call a skipped service", async () => {
    const { root, home, tmp } = workspace();
    const dir = path.join(root, "flow");
    scaffold(dir);
    putCase(dir, "pass", passCase);
    putCase(dir, "fail", failCase);
    putCase(dir, "bad-enum", {
      inputs: { topic: "nope" },
      files: { "note.txt": "fixtures/note.txt", "echo.json": "fixtures/echo.json" },
      skip: ["echo"],
      expect: { note: [{ file: "note.txt", exists: true }] },
    });
    putCase(dir, "escape", {
      files: { "note.txt": "../secret.txt" },
      skip: ["echo"],
      expect: { note: [{ file: "note.txt", exists: true }] },
    }, false);
    putCase(dir, "replies-out", {
      replies: "../replies",
      expect: { note: [{ file: "note.txt", exists: true }] },
    }, false);
    putCase(dir, "images-out", {
      images: path.resolve(root, "secret.txt"),
      expect: { note: [{ file: "note.txt", exists: true }] },
    }, false);
    putCase(dir, "extra", { expect: { note: [{ file: "note.txt", exists: true }] }, extra: true }, false);
    putCase(dir, "skip-missing", {
      inputs: { topic: "a" },
      files: { "note.txt": "fixtures/note.txt" },
      skip: ["echo"],
      expect: { note: [{ file: "note.txt", exists: true }] },
    });
    write(dir, "tests/broken.json", "{");
    fs.writeFileSync(path.join(root, "secret.txt"), "TOP-SECRET\n");
    try {
      fs.symlinkSync(path.join(root, "secret.txt"), path.join(dir, "leak.txt"));
      putCase(dir, "symlink", {
        files: { "note.txt": "leak.txt" },
        skip: ["echo"],
        expect: { note: [{ file: "note.txt", exists: true }] },
      });
    } catch {
      // A machine that cannot make symlinks still refuses ".." and absolute paths.
    }

    let fetches = 0;
    const before = hashDir(dir);
    const result = await withEnv(home, tmp, () => runFlowTests(dir), async () => {
      fetches += 1;
      throw new Error("service ran");
    });
    expect(hashDir(dir)).toBe(before);
    expect(fetches).toBe(0);
    expect(fs.readdirSync(tmp).filter((name) => name.startsWith("flowgit-test-"))).toEqual([]);

    const byId = new Map(result.cases.map((item) => [item.id, item]));
    const pass = byId.get("pass");
    const fail = byId.get("fail");
    expect(pass?.ok, JSON.stringify(pass, null, 2)).toBe(true);
    expect(pass?.error).toBeUndefined();
    expect(pass?.checks.every((check) => check.ok)).toBe(true);
    expect(pass?.name).toBe("全部通过");

    expect(fail?.ok).toBe(false);
    expect(fail?.error).toBeUndefined();
    expect(fail?.checks.length).toBeGreaterThan(0);
    expect(fail?.checks.every((check) => !check.ok)).toBe(true);
    const expected = fail?.checks.map((check) => check.expected).join("\n") ?? "";
    for (const phrase of ["文件存在", "文件不存在", "包含", "不包含", "匹配", "至少", "至多", "JSON", "schema", "等于", "不小于", "不大于", "长度"]) {
      expect(expected, phrase).toContain(phrase);
    }
    for (const check of fail?.checks ?? []) {
      expect(check.stage).toBeTruthy();
      expect(check.file).toBeTruthy();
      expect(check.expected).toBeTruthy();
      expect(Array.from(check.actual ?? "").length).toBeLessThanOrEqual(200);
    }
    expect(expected).toContain("schema");

    expect(byId.get("bad-enum")?.ok).toBe(false);
    expect(byId.get("bad-enum")?.error).toMatch(/只能是|must be one of/);
    for (const id of ["escape", "replies-out", "images-out", "symlink"].filter((name) => byId.has(name))) {
      expect(byId.get(id)?.ok, id).toBe(false);
      expect(byId.get(id)?.error, id).toMatch(/留在流程目录|stay inside the flow directory/);
      expect(byId.get(id)?.error, id).not.toContain("TOP-SECRET");
    }
    expect(byId.get("extra")?.error).toMatch(/不认识的字段|unknown field/);
    expect(byId.get("skip-missing")?.error).toMatch(/echo\.json/);
    expect(byId.get("broken")?.ok).toBe(false);
    expect(byId.get("broken")?.error).toMatch(/JSON/);

    const kept = await withEnv(home, tmp, () => runFlowTests(dir, { names: ["pass"], keep: true }), async () => {
      fetches += 1;
      throw new Error("service ran");
    });
    expect(kept.ok).toBe(true);
    expect(fetches).toBe(0);
    const copy = kept.cases[0]?.dir;
    expect(copy).toBeTruthy();
    const manual = JSON.parse(fs.readFileSync(path.join(copy!, "runs", "echo", "1", "run.json"), "utf8")) as { executor: string; n: number };
    expect(manual).toMatchObject({ executor: "manual", n: 1 });
    expect(fs.existsSync(path.join(copy!, "runs", "echo", "2"))).toBe(false);
    const report = JSON.parse(fs.readFileSync(path.join(copy!, "runs", "report", "1", "run.json"), "utf8")) as { executor: string };
    expect(report.executor).toBe("script");
    expect(hashDir(dir)).toBe(before);
  });

  it("fails a case when the canned reply is missing and does not call the network", async () => {
    const { root, home, tmp } = workspace();
    const dir = path.join(root, "llm");
    write(dir, "flow.json", `${JSON.stringify({
      format: "flowgit",
      version: "0.1",
      name: "缺回复",
      stages: [{
        id: "draft",
        name: "草稿",
        executor: { type: "llm", prompt: "prompts/draft.md" },
        outputs: [{ type: "text/markdown", path: "report.md" }],
      }],
    })}\n`);
    write(dir, "prompts/draft.md", "写一段。\n");
    putCase(dir, "one", { expect: { draft: [{ file: "report.md", exists: true }] } });
    let fetches = 0;
    const before = hashDir(dir);
    const result = await withEnv(home, tmp, () => runFlowTests(dir), async () => {
      fetches += 1;
      throw new Error("network");
    });
    expect(fetches).toBe(0);
    expect(hashDir(dir)).toBe(before);
    expect(result.ok).toBe(false);
    expect(result.cases[0]?.error).toMatch(/draft\.md/);
    expect(result.cases[0]?.error).toContain("draft");
  });

  it("refuses an unconfirmed copy and runs it after the original directory is confirmed", async () => {
    const { root, home, tmp } = workspace();
    const dir = path.join(root, "forked");
    write(dir, "flow.json", `${JSON.stringify({
      format: "flowgit",
      version: "0.1",
      name: "复制来的",
      forkedFrom: { source: "https://example.com/someone/flow.git", commit: "abc123" },
      stages: [{
        id: "write",
        name: "写",
        executor: { type: "script", run: "node scripts/write.mjs" },
        outputs: [{ type: "text/plain", path: "out.txt" }],
      }],
    })}\n`);
    write(dir, "scripts/write.mjs", "import fs from \"node:fs\";\nconst outputs = JSON.parse(process.env.FLOWGIT_OUTPUTS ?? \"[]\");\nfs.writeFileSync(outputs[0]?.path ?? \"out.txt\", \"ok\\n\");\n");
    putCase(dir, "ok", { expect: { write: [{ file: "out.txt", contains: "ok" }] } });

    await withEnv(home, tmp, async () => {
      const before = hashDir(dir);
      await expect(runFlowTests(dir)).rejects.toBeInstanceOf(TrustNeededError);
      expect(hashDir(dir)).toBe(before);
      expect(fs.readdirSync(tmp).filter((name) => name.startsWith("flowgit-test-"))).toEqual([]);

      trustFlow(loadFlow(dir));
      const result = await runFlowTests(dir, { keep: true });
      expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
      const copy = result.cases[0]?.dir;
      expect(copy).toBeTruthy();
      const copied = JSON.parse(fs.readFileSync(path.join(copy!, "flow.json"), "utf8")) as { forkedFrom?: unknown };
      expect(copied.forkedFrom).toBeUndefined();
      const original = JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")) as { forkedFrom?: { source?: string } };
      expect(original.forkedFrom?.source).toBe("https://example.com/someone/flow.git");
      expect(hashDir(dir)).toBe(before);
    });
  });

  it("reports zero model calls for --live when the flow does not call a model", async () => {
    const { root, home, tmp } = workspace();
    const dir = path.join(root, "live");
    write(dir, "flow.json", `${JSON.stringify({
      format: "flowgit",
      version: "0.1",
      name: "live",
      stages: [{
        id: "write",
        name: "写",
        executor: { type: "script", run: "node scripts/write.mjs" },
        outputs: [{ type: "text/plain", path: "out.txt" }],
      }],
    })}\n`);
    write(dir, "scripts/write.mjs", "import fs from \"node:fs\";\nfs.writeFileSync(\"out.txt\", \"ok\\n\");\n");
    putCase(dir, "ok", { expect: { write: [{ file: "out.txt", contains: "ok" }] } });
    let seen: number | undefined;
    const result = await withEnv(home, tmp, () => runFlowTests(dir, { live: true, onPlan: ({ modelCalls }) => { seen = modelCalls; } }));
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(seen).toBe(0);
    expect(result.modelCalls).toBe(0);
    expect(shape(result).cases[0]?.checks[0]).toMatchObject({ stage: "write", file: "out.txt", ok: true, expected: expect.any(String) });
  });

  it("rejects an unknown case name", async () => {
    const { root, home, tmp } = workspace();
    const dir = path.join(root, "names");
    write(dir, "flow.json", `${JSON.stringify({
      format: "flowgit",
      version: "0.1",
      name: "names",
      stages: [{ id: "note", name: "笔记", executor: { type: "human" }, outputs: [{ type: "text/plain", path: "note.txt" }] }],
    })}\n`);
    write(dir, "fixtures/note.txt", "hi\n");
    putCase(dir, "sample", { name: "示例", files: { "note.txt": "fixtures/note.txt" }, expect: { note: [{ file: "note.txt", exists: true }] } });
    await withEnv(home, tmp, async () => {
      const one = await runFlowTests(dir, { names: ["示例"] });
      expect(one.ok).toBe(true);
      expect(one.cases).toHaveLength(1);
      await expect(runFlowTests(dir, { names: ["missing"] })).rejects.toThrow(/没有这个测试|No such test/);
    });
  });
});

function shape(report: FlowTestReport): FlowTestReport {
  expect(report).toEqual(expect.objectContaining({ ok: expect.any(Boolean), cases: expect.any(Array) }));
  return report;
}
