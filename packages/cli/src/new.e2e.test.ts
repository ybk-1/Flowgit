import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");

function flowgit(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FLOWGIT_TTS_API_KEY: "", ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

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

function writeMocks(dir: string, files: Record<string, unknown>): string {
  const mockDir = path.join(dir, "replies");
  fs.mkdirSync(mockDir, { recursive: true });
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(mockDir, name), `${JSON.stringify(value, null, 2)}\n`);
  return mockDir;
}

describe("flowgit new", () => {
  it("asks before writing, and --yes writes a flow that validates", () => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-new-e2e-"));
    const mockDir = writeMocks(work, { "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
    const target = path.join(work, "report");
    const env = { FLOWGIT_LLM_MOCK_DIR: mockDir };
    try {
      const help = flowgit(["new", "--help"]);
      expect(help.code).toBe(0);
      expect(help.out).toContain("用一句话生成流程 / generate a flow from one sentence");

      const asked = flowgit(["new", "把一周的笔记整理成周报", target], env);
      expect(asked.code).toBe(1);
      expect(asked.out).toContain("预演：不会运行任何阶段 / dry run: nothing runs");
      expect(asked.out).toContain("prompts/draft.md");
      expect(asked.out).toContain("不在终端里，什么都没写。确认写入请加上 --yes");
      expect(asked.out).toContain("Not a terminal, so nothing was written. Add --yes to write.");
      expect(fs.existsSync(path.join(target, "flow.json"))).toBe(false);

      const wrote = flowgit(["new", "把一周的笔记整理成周报", target, "--yes"], env);
      expect(wrote.code, wrote.out).toBe(0);
      expect(wrote.out).toContain("已写入 / wrote");
      const validated = flowgit(["-C", target, "validate"]);
      expect(validated.code, validated.out).toBe(0);

      const again = flowgit(["new", "把一周的笔记整理成周报", target, "--yes"], env);
      expect(again.code).toBe(1);
      expect(again.out).toContain("没有覆盖 / already exists");
      expect(fs.readFileSync(path.join(target, "prompts/draft.md"), "utf8")).toContain("{{inputs.name}}");
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("marks a script stage, repairs, and writes nothing after three failures", () => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-new-repair-"));
    const withScript = {
      flow: {
        ...weeklyDoc.flow,
        stages: [
          ...weeklyDoc.flow.stages,
          {
            id: "check",
            name: "检查",
            inputs: ["draft"],
            executor: { type: "script", run: "node scripts/check.mjs" },
            outputs: [{ type: "application/json", path: "check.json" }],
          },
        ],
      },
      prompts: weeklyDoc.prompts,
    };
    const scriptPlan = {
      ...weeklyPlan,
      stages: [
        ...weeklyPlan.stages,
        {
          id: "check",
          name: "检查",
          executor: "script",
          dependsOn: ["draft"],
          outputs: [{ type: "application/json", path: "check.json" }],
          run: "node scripts/check.mjs",
        },
      ],
    };
    const nameless = {
      flow: {
        format: "flowgit",
        version: "0.1",
        stages: [{ id: "notes", name: "随手记", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "notes.md" }] }],
      },
      prompts: {},
    };
    try {
      const scriptDir = path.join(work, "script");
      const scriptMocks = writeMocks(path.join(work, "script-mocks"), { "generate-plan.json": scriptPlan, "generate-flow.json": withScript });
      const scripted = flowgit(["new", "把笔记整理成周报，并用脚本检查格式", scriptDir, "--yes"], { FLOWGIT_LLM_MOCK_DIR: scriptMocks });
      expect(scripted.code, scripted.out).toBe(0);
      expect(scripted.out).toContain("会在你的电脑上运行命令 / runs commands on your computer");
      expect(scripted.out).toContain("node scripts/check.mjs");
      const flow = JSON.parse(fs.readFileSync(path.join(scriptDir, "flow.json"), "utf8")) as { stages: { executor: { type: string } }[] };
      expect(flow.stages.map((stage) => stage.executor.type)).toEqual(["human", "llm", "script"]);

      const badDir = path.join(work, "bad");
      const badMocks = writeMocks(path.join(work, "bad-mocks"), {
        "generate-plan.json": weeklyPlan,
        "generate-flow.json": nameless,
        "generate-repair-1.json": nameless,
        "generate-repair-2.json": nameless,
        "generate-repair-3.json": nameless,
      });
      const failed = flowgit(["new", "把一周的笔记整理成周报", badDir, "--yes"], { FLOWGIT_LLM_MOCK_DIR: badMocks });
      expect(failed.code).toBe(1);
      expect(failed.out).toContain("缺少必填字段 / missing required property");
      expect(failed.out).toContain("什么都没写 / nothing was written");
      expect(fs.existsSync(path.join(badDir, "flow.json"))).toBe(false);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
