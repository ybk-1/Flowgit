import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFlow } from "@flowgit/core";
import { executeNew } from "./commands/new.js";

const weeklyPlan = {
  name: "周报",
  description: "把一周的笔记整理成周报",
  language: "zh",
  inputs: [{ name: "name", type: "string", description: "你的名字", required: true }],
  stages: [
    {
      id: "notes",
      name: "随手记",
      executor: "human",
      dependsOn: [],
      outputs: [{ type: "text/markdown", path: "notes.md" }],
      instructions: "写下这周的事",
    },
    {
      id: "draft",
      name: "草稿",
      executor: "llm",
      dependsOn: ["notes"],
      outputs: [{ type: "text/markdown", path: "report.md" }],
    },
  ],
};

const weeklyDoc = {
  flow: {
    format: "flowgit",
    version: "0.1",
    name: "周报",
    description: "把一周的笔记整理成周报",
    language: "zh",
    inputs: { name: { type: "string", description: "你的名字", required: true } },
    stages: [
      {
        id: "notes",
        name: "随手记",
        executor: { type: "human", instructions: "写下这周的事" },
        outputs: [{ type: "text/markdown", path: "notes.md" }],
      },
      {
        id: "draft",
        name: "草稿",
        inputs: ["notes"],
        executor: { type: "llm", prompt: "prompts/draft.md" },
        outputs: [{ type: "text/markdown", path: "report.md" }],
      },
    ],
  },
  prompts: { "prompts/draft.md": "把 {{inputs.name}} 的笔记整理成周报。\n" },
};

const previousMock = process.env.FLOWGIT_LLM_MOCK_DIR;
afterEach(() => {
  if (previousMock === undefined) delete process.env.FLOWGIT_LLM_MOCK_DIR;
  else process.env.FLOWGIT_LLM_MOCK_DIR = previousMock;
});

function mocks(dir: string, files: Record<string, unknown>): string {
  const mockDir = path.join(dir, "replies");
  fs.mkdirSync(mockDir, { recursive: true });
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(mockDir, name), `${JSON.stringify(value, null, 2)}\n`);
  process.env.FLOWGIT_LLM_MOCK_DIR = mockDir;
  return mockDir;
}

async function run(dir: string, extra: { yes?: boolean; tty?: boolean; ask?: (question: string) => Promise<string>; md?: boolean; language?: string } = {}) {
  const lines: string[] = [];
  const code = await executeNew({
    description: "把一周的笔记整理成周报",
    dir,
    ...(extra.md ? { md: true } : {}),
    ...(extra.language ? { language: extra.language } : {}),
    ...(extra.yes ? { yes: true } : {}),
    tty: extra.tty ?? false,
    ask: extra.ask ?? (async () => ""),
    log: (line) => lines.push(line),
  });
  return { code, out: lines.join("\n") };
}

describe("flowgit new confirmation", () => {
  it("prints the dry run and writes nothing until the answer is yes", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-new-"));
    const target = path.join(work, "report");
    mocks(work, { "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
    try {
      const refused = await run(target, { tty: false });
      expect(refused.code).toBe(1);
      expect(refused.out).toContain("预演：不会运行任何阶段 / dry run: nothing runs");
      expect(refused.out).toContain("要写入的文件 / files to write:");
      expect(refused.out).toContain("flow.json");
      expect(refused.out).toContain("prompts/draft.md");
      expect(refused.out).toContain("不在终端里，什么都没写。确认写入请加上 --yes / Not a terminal, so nothing was written. Add --yes to write.");
      expect(fs.existsSync(path.join(target, "flow.json"))).toBe(false);

      const no = await run(target, { tty: true, ask: async (question) => (expect(question).toContain("写入这些文件"), "n") });
      expect(no.code).toBe(1);
      expect(no.out).toContain("已取消，什么都没写 / Cancelled, nothing was written.");
      expect(fs.existsSync(path.join(target, "flow.json"))).toBe(false);

      const yes = await run(target, { tty: true, ask: async () => "y" });
      expect(yes.code, yes.out).toBe(0);
      expect(yes.out).toContain("已写入 / wrote");
      expect(loadFlow(target).flow.name).toBe("周报");
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("accepts 是 and --yes, and rejects a bad language before calling the model", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-new-yes-"));
    mocks(work, { "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
    try {
      const chinese = path.join(work, "shi");
      const shi = await run(chinese, { tty: true, ask: async () => "是" });
      expect(shi.code, shi.out).toBe(0);
      expect(fs.existsSync(path.join(chinese, "flow.json"))).toBe(true);

      const skipped = path.join(work, "skip");
      const yes = await run(skipped, { yes: true, md: true });
      expect(yes.code, yes.out).toBe(0);
      expect(fs.existsSync(path.join(skipped, "flow.md"))).toBe(true);
      expect(fs.existsSync(path.join(skipped, "flow.json"))).toBe(false);

      const bad = await run(path.join(work, "nope"), { language: "fr", yes: true });
      expect(bad.code).toBe(1);
      expect(bad.out).toContain("--language 只能是 zh 或 en");
      expect(fs.existsSync(path.join(work, "nope"))).toBe(false);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
