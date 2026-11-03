import fs from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmComplete } from "./executors/types.js";
import {
  RUNS_ON_COMPUTER,
  descriptionAllows,
  descriptionLanguage,
  generateFlow,
  generateMockComplete,
  generatePromptFile,
  type GenerateResult,
} from "./generate.js";
import { host, withHost } from "./host/current.js";
import { createMemoryHost } from "./host/memory.js";
import { loadFlow, validateFlow } from "./load.js";

const PROMPTS = ["generate-plan.md", "generate-flow.md", "generate-repair.md"];

function seedPrompts(): void {
  for (const name of PROMPTS) {
    const target = generatePromptFile(name);
    host().mkdir(host().path.dirname(target), { recursive: true });
    host().writeFile(target, fs.readFileSync(nodePath.resolve(import.meta.dirname, "../prompts", name), "utf8"));
  }
}

function seedMocks(files: Record<string, unknown>): void {
  host().mkdir("/mocks", { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    host().writeFile(nodePath.posix.join("/mocks", name), `${JSON.stringify(value, null, 2)}\n`);
  }
}

async function usingHost<T>(fn: () => Promise<T>, env: Record<string, string | undefined> = { FLOWGIT_LLM_MOCK_DIR: "/mocks" }): Promise<T> {
  return withHost(createMemoryHost({ cwd: "/work", home: "/home", env, platform: "linux" }), async () => {
    seedPrompts();
    return fn();
  });
}

function ok(result: GenerateResult): Extract<GenerateResult, { ok: true }> {
  expect(result.ok, !result.ok ? result.errors.join("\n") : "").toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result;
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
      description: "人写下这周的事",
      executor: "human",
      dependsOn: [],
      outputs: [{ type: "text/markdown", path: "notes.md" }],
      instructions: "写下这周的事",
    },
    {
      id: "draft",
      name: "草稿",
      description: "整理成周报",
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
        description: "人写下这周的事",
        executor: { type: "human", instructions: "写下这周的事" },
        outputs: [{ type: "text/markdown", path: "notes.md" }],
      },
      {
        id: "draft",
        name: "草稿",
        description: "整理成周报",
        inputs: ["notes"],
        executor: { type: "llm", prompt: "prompts/draft.md" },
        outputs: [{ type: "text/markdown", path: "report.md" }],
      },
    ],
  },
  prompts: { "prompts/draft.md": "把 {{inputs.name}} 的笔记整理成周报。\n" },
};

const nameless = {
  flow: {
    format: "flowgit",
    version: "0.1",
    stages: [
      {
        id: "notes",
        name: "随手记",
        executor: { type: "human" },
        outputs: [{ type: "text/markdown", path: "notes.md" }],
      },
    ],
  },
  prompts: {},
};

const checkScript = [
  'import fs from "node:fs";',
  "const [output] = JSON.parse(process.env.FLOWGIT_OUTPUTS);",
  'fs.writeFileSync(output.path, JSON.stringify({ ok: true }) + "\\n");',
  "",
].join("\n");

/** A model call that answers from the mocks and keeps every prompt it was sent. */
function recording(): { llm: LlmComplete; prompts: { stageId: string; repair: boolean; prompt: string }[] } {
  const mock = generateMockComplete("/mocks");
  const prompts: { stageId: string; repair: boolean; prompt: string }[] = [];
  return {
    prompts,
    llm: async (req) => {
      prompts.push({ stageId: req.stageId, repair: Boolean(req.repair), prompt: req.prompt });
      return mock(req);
    },
  };
}

describe("descriptionLanguage", () => {
  it("goes by what most of the description is written in", () => {
    expect(descriptionLanguage("把一周的笔记整理成周报")).toBe("zh");
    expect(descriptionLanguage("每周一把上周的销售数据 CSV 做成周报")).toBe("zh");
    expect(descriptionLanguage("用 agent 把笔记改成终稿")).toBe("zh");
    expect(descriptionLanguage("把週報寫好")).toBe("zh");
    expect(descriptionLanguage("Plan a family trip with two young kids")).toBe("en");
    expect(descriptionLanguage("write a 小红书 post about my cafe")).toBe("en");
    expect(descriptionLanguage("")).toBe("en");
  });
});

describe("descriptionAllows", () => {
  it("treats a screenplay as a document, and a command or an agent as a computer stage", () => {
    expect(descriptionAllows("把一周的笔记整理成周报")).toEqual({ script: false, agent: false });
    expect(descriptionAllows("写一个短视频脚本")).toEqual({ script: false, agent: false });
    expect(descriptionAllows("write a video script about cats")).toEqual({ script: false, agent: false });
    expect(descriptionAllows("把笔记整理成周报，并用脚本检查格式")).toEqual({ script: true, agent: false });
    expect(descriptionAllows("run a script that checks the report")).toEqual({ script: true, agent: false });
    expect(descriptionAllows("用 agent 把笔记改成终稿")).toEqual({ script: false, agent: true });
  });
});

describe("generateFlow", () => {
  it("reads the prompt files", () => {
    const plan = fs.readFileSync(nodePath.resolve(import.meta.dirname, "../prompts/generate-plan.md"), "utf8");
    expect(plan).toContain("{{description}}");
    expect(plan).toContain("dependsOn");
    expect(fs.readFileSync(nodePath.resolve(import.meta.dirname, "../prompts/generate-flow.md"), "utf8")).toContain("{{plan}}");
    expect(fs.readFileSync(nodePath.resolve(import.meta.dirname, "../prompts/generate-repair.md"), "utf8")).toContain("{{errors}}");
  });

  it("writes a flow that validates when the canned replies are good, and writes nothing until asked", async () => {
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      const preview = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/report" }));
      expect(preview.written).toBe(false);
      expect(preview.files.map((file) => file.path)).toEqual(["flow.json", "prompts/draft.md"]);
      expect(preview.plan.map((step) => step.action)).toEqual(["wait", "not-reached"]);
      expect(preview.runsCommands).toBe(false);
      expect(preview.plan.some((step) => step.detail?.includes(RUNS_ON_COMPUTER))).toBe(false);
      expect(host().exists("/work/report/flow.json")).toBe(false);

      const written = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/report", write: true }));
      expect(written.written).toBe(true);
      const loaded = loadFlow("/work/report");
      expect(validateFlow(loaded.flow, { dir: loaded.dir }).filter((issue) => issue.level === "error")).toEqual([]);
      expect(loaded.flow.stages.map((stage) => stage.executor.type)).toEqual(["human", "llm"]);
      expect(host().readFile("/work/report/prompts/draft.md", "utf8")).toContain("{{inputs.name}}");
    });
  });

  it("writes flow.md when asked, and keeps an explicit language", async () => {
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      const written = ok(await generateFlow("Turn notes into a weekly report", { dir: "/work/report", write: true, md: true, language: "en" }));
      expect(written.flowFile).toBe("flow.md");
      expect(written.flow.language).toBe("en");
      expect(host().exists("/work/report/flow.md")).toBe(true);
      expect(host().exists("/work/report/flow.json")).toBe(false);
      expect(loadFlow("/work/report").flow.name).toBe("周报");
    });
  });

  it("drops a script the description did not ask for, and keeps one it did", async () => {
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
      scripts: { "scripts/check.mjs": checkScript },
    };
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": withScript });
      const dropped = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/plain", write: true }));
      expect(dropped.flow.stages.map((stage) => stage.executor.type)).toEqual(["human", "llm", "llm"]);
      expect(dropped.runsCommands).toBe(false);
      // The script nobody runs any more is not written.
      expect(dropped.scripts).toEqual({});
      expect(host().exists("/work/plain/scripts/check.mjs")).toBe(false);
      expect(loadFlow("/work/plain").flow.stages[2]?.executor.type).toBe("llm");
    });
    await usingHost(async () => {
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
      seedMocks({ "generate-plan.json": scriptPlan, "generate-flow.json": withScript });
      const kept = ok(await generateFlow("把笔记整理成周报，并用脚本检查格式", { dir: "/work/checked", write: true }));
      expect(kept.flow.stages.map((stage) => stage.executor.type)).toEqual(["human", "llm", "script"]);
      expect(kept.runsCommands).toBe(true);
      expect(kept.files.map((file) => file.path)).toEqual(["flow.json", "prompts/draft.md", "scripts/check.mjs"]);
      expect(host().readFile("/work/checked/scripts/check.mjs", "utf8")).toBe(checkScript);
      const check = kept.plan.find((step) => step.id === "check");
      expect(check?.detail).toContain("node scripts/check.mjs");
      expect(check?.detail).toContain(RUNS_ON_COMPUTER);
      expect(validateFlow(loadFlow("/work/checked").flow, { dir: "/work/checked" }).filter((issue) => issue.level === "error")).toEqual([]);
    });
  });

  it("keeps an agent stage only when the description asks, and marks that it runs a command", async () => {
    const plan = {
      name: "改稿",
      language: "zh",
      inputs: [],
      stages: [
        {
          id: "notes",
          name: "笔记",
          executor: "human",
          dependsOn: [],
          outputs: [{ type: "text/markdown", path: "notes.md" }],
          instructions: "放上笔记",
        },
        {
          id: "revise",
          name: "修改",
          executor: "agent",
          dependsOn: ["notes"],
          outputs: [{ type: "text/markdown", path: "final.md" }],
          agent: "claude-code",
        },
      ],
    };
    const doc = {
      flow: {
        format: "flowgit",
        version: "0.1",
        name: "改稿",
        language: "zh",
        stages: [
          {
            id: "notes",
            name: "笔记",
            executor: { type: "human", instructions: "放上笔记" },
            outputs: [{ type: "text/markdown", path: "notes.md" }],
          },
          {
            id: "revise",
            name: "修改",
            inputs: ["notes"],
            executor: { type: "agent", agent: "claude-code", prompt: "prompts/revise.md" },
            outputs: [{ type: "text/markdown", path: "final.md" }],
          },
        ],
      },
      prompts: { "prompts/revise.md": "把笔记改成终稿。\n" },
    };
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": plan, "generate-flow.json": doc });
      const written = ok(await generateFlow("用 agent 把笔记改成终稿", { dir: "/work/agent", write: true }));
      expect(written.flow.stages[1]?.executor.type).toBe("agent");
      expect(written.runsCommands).toBe(true);
      expect(written.plan.find((step) => step.id === "revise")?.detail).toContain(RUNS_ON_COMPUTER);
    });
  });

  it("repairs a bad flow, and after three failures writes nothing", async () => {
    await usingHost(async () => {
      const duplicate = {
        flow: {
          format: "flowgit",
          version: "0.1",
          name: "周报",
          stages: [
            weeklyDoc.flow.stages[0],
            { ...weeklyDoc.flow.stages[0], name: "又一个", outputs: [{ type: "text/markdown", path: "other.md" }] },
          ],
        },
        prompts: {},
      };
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": duplicate, "generate-repair-1.json": weeklyDoc });
      const mock = generateMockComplete("/mocks");
      let repairs = 0;
      const llm: LlmComplete = async (req) => {
        if (req.repair) repairs += 1;
        return mock(req);
      };
      const fixed = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/fixed", write: true, llm }));
      expect(repairs).toBe(1);
      expect(fixed.flow.stages.map((stage) => stage.id)).toEqual(["notes", "draft"]);
      expect(validateFlow(loadFlow("/work/fixed").flow, { dir: "/work/fixed" }).filter((issue) => issue.level === "error")).toEqual([]);
    });

    await usingHost(async () => {
      seedMocks({
        "generate-plan.json": weeklyPlan,
        "generate-flow.json": nameless,
        "generate-repair-1.json": nameless,
        "generate-repair-2.json": nameless,
        "generate-repair-3.json": weeklyDoc,
      });
      const mock = generateMockComplete("/mocks");
      let repairs = 0;
      const llm: LlmComplete = async (req) => {
        if (req.repair) repairs += 1;
        return mock(req);
      };
      const third = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/third", write: true, llm }));
      expect(repairs).toBe(3);
      expect(third.flow.name).toBe("周报");
    });

    await usingHost(async () => {
      seedMocks({
        "generate-plan.json": weeklyPlan,
        "generate-flow.json": nameless,
        "generate-repair-1.json": nameless,
        "generate-repair-2.json": nameless,
        "generate-repair-3.json": nameless,
      });
      const mock = generateMockComplete("/mocks");
      let repairs = 0;
      const llm: LlmComplete = async (req) => {
        if (req.repair) repairs += 1;
        return mock(req);
      };
      const failed = await generateFlow("把一周的笔记整理成周报", { dir: "/work/failed", write: true, llm });
      expect(repairs).toBe(3);
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.errors.join("\n")).toContain("缺少必填字段 / missing required property");
      expect(host().exists("/work/failed/flow.json")).toBe(false);
      expect(host().files().some((file) => file.startsWith("/work/failed"))).toBe(false);
    });
  });

  it("returns bilingual errors for a plan that stays bad after two repairs, and does not ask for a flow", async () => {
    await usingHost(async () => {
      const bad = { name: "只有名字" };
      seedMocks({ "generate-plan.json": bad, "generate-plan-repair-1.json": bad, "generate-plan-repair-2.json": bad });
      const mock = generateMockComplete("/mocks");
      const stages: string[] = [];
      const llm: LlmComplete = async (req) => {
        stages.push(`${req.stageId}${req.repair ? " repair" : ""}`);
        return mock(req);
      };
      const failed = await generateFlow("把一周的笔记整理成周报", { dir: "/work/bad-plan", write: true, llm });
      expect(stages).toEqual(["generate-plan", "generate-plan repair", "generate-plan repair"]);
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.errors.join("\n")).toMatch(/计划至少要有一个阶段 \/ the plan needs at least one stage/);
      expect(host().exists("/work/bad-plan/flow.json")).toBe(false);
    });
  });

  it("does not call the model when the directory already has a flow", async () => {
    await usingHost(async () => {
      host().mkdir("/work/exists", { recursive: true });
      host().writeFile("/work/exists/flow.json", "{}\n");
      let calls = 0;
      const llm: LlmComplete = async () => {
        calls += 1;
        throw new Error("should not be called");
      };
      const failed = await generateFlow("把一周的笔记整理成周报", { dir: "/work/exists", write: true, llm });
      expect(calls).toBe(0);
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.errors.join("\n")).toContain("没有覆盖 / already exists");
      expect(host().readFile("/work/exists/flow.json", "utf8")).toBe("{}\n");
    });
  });

  it("never overwrites a file that is already in the folder", async () => {
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      host().mkdir("/work/mine/prompts", { recursive: true });
      host().writeFile("/work/mine/prompts/draft.md", "my own notes\n");
      const failed = await generateFlow("把一周的笔记整理成周报", { dir: "/work/mine", write: true });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.errors.join("\n")).toContain("prompts/draft.md 已存在");
      expect(host().readFile("/work/mine/prompts/draft.md", "utf8")).toBe("my own notes\n");
      expect(host().exists("/work/mine/flow.json")).toBe(false);
    });
  });

  it("keeps the plan's human, script and agent stages when the reply puts the executor's fields on the stage", async () => {
    const plan = {
      name: "销售周报",
      inputs: [],
      stages: [
        {
          id: "data",
          name: "销售数据",
          executor: "human",
          dependsOn: [],
          outputs: [{ type: "text/csv", path: "sales.csv" }],
          instructions: "把上周的销售 CSV 放进来",
        },
        { id: "sum", name: "汇总", executor: "script", dependsOn: ["data"], outputs: [{ type: "text/markdown", path: "summary.md" }], run: "node scripts/sum.mjs" },
        { id: "report", name: "周报", executor: "agent", dependsOn: ["data", "sum"], outputs: [{ type: "text/markdown", path: "report.md" }], agent: "codex" },
      ],
    };
    // DeepSeek's usual shape: the executor's fields flat on the stage, and one `output`.
    const flat = {
      flow: {
        format: "flowgit",
        version: "0.1",
        name: "销售周报",
        stages: [
          { id: "data", name: "销售数据", type: "human", output: "sales.csv" },
          { id: "sum", name: "汇总", type: "script", inputs: ["data"], output: { path: "summary.md" } },
          { id: "report", name: "周报", type: "llm", inputs: ["sum"], prompt: "根据汇总写周报。\n分三段：结论、原因、下周建议。", outputs: [{ path: "report.md" }] },
        ],
      },
      prompts: {},
      scripts: { "scripts/sum.mjs": checkScript },
    };
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": plan, "generate-flow.json": flat });
      const written = ok(await generateFlow("每周用脚本把销售 CSV 算成汇总，再用 agent 写周报", { dir: "/work/flat", write: true }));
      const [data, sum, report] = written.flow.stages;
      expect(written.flow.stages.map((stage) => stage.executor.type)).toEqual(["human", "script", "agent"]);
      expect(data?.executor).toEqual({ type: "human", instructions: "把上周的销售 CSV 放进来" });
      expect(data?.outputs).toEqual([{ type: "text/csv", path: "sales.csv" }]);
      expect(sum?.executor).toEqual({ type: "script", run: "node scripts/sum.mjs" });
      expect(sum?.outputs).toEqual([{ type: "text/markdown", path: "summary.md" }]);
      // The plan's agent, and a prompt given as text is filed under prompts/<id>.md.
      expect(report?.executor).toEqual({ type: "agent", agent: "codex", prompt: "prompts/report.md" });
      expect(written.prompts["prompts/report.md"]).toContain("下周建议");
      // The reply dropped the plan's dependency on the data; the stage still reads it.
      expect(report?.inputs).toEqual(["sum", "data"]);
      expect(written.files.map((file) => file.path)).toEqual(["flow.json", "prompts/report.md", "scripts/sum.mjs"]);
      expect(validateFlow(loadFlow("/work/flat").flow, { dir: "/work/flat" }).filter((issue) => issue.level === "error")).toEqual([]);
    });
  });

  it("writes the flow in the description's language, whatever the plan says", async () => {
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      const english = recording();
      const result = ok(await generateFlow("Turn my weekly notes into a report", { dir: "/work/en", llm: english.llm }));
      expect(result.flow.language).toBe("en");
      const [planAsk, flowAsk] = english.prompts;
      expect(planAsk?.prompt).toContain("Language: en (English).");
      expect(flowAsk?.prompt).toContain("Language: en (English).");
      // The plan said zh; round two is told en.
      expect(flowAsk?.prompt).toContain('"language": "en"');
      expect(flowAsk?.prompt).not.toContain('"language": "zh"');

      const chinese = recording();
      ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/zh", llm: chinese.llm }));
      expect(chinese.prompts[0]?.prompt).toContain("Language: zh (Chinese).");
    });
  });

  it("sends a bad plan back with its errors and goes on with the repaired one", async () => {
    await usingHost(async () => {
      const chineseKey = { ...weeklyPlan, inputs: [{ name: "产品品类", type: "string", description: "品类", required: true }] };
      seedMocks({ "generate-plan.json": chineseKey, "generate-plan-repair-1.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      const calls = recording();
      ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/plan-repair", llm: calls.llm }));
      expect(calls.prompts.map((call) => `${call.stageId}${call.repair ? " repair" : ""}`)).toEqual(["generate-plan", "generate-plan repair", "generate-flow"]);
      expect(calls.prompts[1]?.prompt).toContain('a flow input name uses English letters, digits and _, and starts with a letter: "产品品类"');
    });
  });

  it("asks again for a script file that is missing or unsafe", async () => {
    const scriptPlan = {
      ...weeklyPlan,
      stages: [
        ...weeklyPlan.stages,
        { id: "check", name: "检查", executor: "script", dependsOn: ["draft"], outputs: [{ type: "application/json", path: "check.json" }], run: "node scripts/check.mjs" },
      ],
    };
    const stages = [
      ...weeklyDoc.flow.stages,
      { id: "check", name: "检查", inputs: ["draft"], executor: { type: "script", run: "node scripts/check.mjs" }, outputs: [{ type: "application/json", path: "check.json" }] },
    ];
    const reply = (scripts: Record<string, string>) => ({ flow: { ...weeklyDoc.flow, stages }, prompts: weeklyDoc.prompts, scripts });
    const unsafe = 'import { execSync } from "node:child_process";\nexecSync("rm -rf ~");\n';
    await usingHost(async () => {
      seedMocks({
        "generate-plan.json": scriptPlan,
        "generate-flow.json": reply({}),
        "generate-repair-1.json": reply({ "scripts/check.mjs": unsafe }),
        "generate-repair-2.json": reply({ "scripts/check.mjs": checkScript }),
      });
      const calls = recording();
      const written = ok(await generateFlow("把笔记整理成周报，并用脚本检查格式", { dir: "/work/scripted", write: true, llm: calls.llm }));
      const repairs = calls.prompts.filter((call) => call.repair).map((call) => call.prompt);
      expect(repairs).toHaveLength(2);
      expect(repairs[0]).toContain("the reply has no scripts/check.mjs under scripts");
      expect(repairs[1]).toContain("scripts/check.mjs starts other programs, which a generated script may not do");
      expect(written.scripts).toEqual({ "scripts/check.mjs": checkScript });
      expect(host().readFile("/work/scripted/scripts/check.mjs", "utf8")).toBe(checkScript);
    });
    await usingHost(async () => {
      const shell = { flow: { ...weeklyDoc.flow, stages: stages.map((stage) => (stage.id === "check" ? { ...stage, executor: { type: "script", run: "wc -l report.md" } } : stage)) }, prompts: weeklyDoc.prompts };
      seedMocks({ "generate-plan.json": scriptPlan, "generate-flow.json": shell, "generate-repair-1.json": shell, "generate-repair-2.json": shell, "generate-repair-3.json": shell });
      const failed = await generateFlow("把笔记整理成周报，并用脚本检查格式", { dir: "/work/shell", write: true });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.errors.join("\n")).toContain("a script stage runs a Node.js file written under scripts");
      expect(host().exists("/work/shell/flow.json")).toBe(false);
    });
  });

  it("adds a dependency on an earlier stage whose file a prompt names", async () => {
    const plan = {
      ...weeklyPlan,
      stages: [
        ...weeklyPlan.stages,
        { id: "check", name: "检查", executor: "llm", dependsOn: ["draft"], outputs: [{ type: "text/markdown", path: "check.md" }] },
        { id: "recap", name: "回顾", executor: "llm", dependsOn: ["draft"], outputs: [{ type: "text/markdown", path: "recap.md" }] },
      ],
    };
    const doc = {
      flow: {
        ...weeklyDoc.flow,
        stages: [
          ...weeklyDoc.flow.stages,
          { id: "check", name: "检查", inputs: ["draft"], executor: { type: "llm", prompt: "prompts/check.md" }, outputs: [{ type: "text/markdown", path: "check.md" }] },
          { id: "recap", name: "回顾", inputs: ["draft"], executor: { type: "llm", prompt: "prompts/recap.md" }, outputs: [{ type: "text/markdown", path: "recap.md" }] },
        ],
      },
      prompts: {
        ...weeklyDoc.prompts,
        "prompts/check.md": "对照 notes.md 逐条检查 report.md。\n",
        // meeting-notes.md is another file, not notes.md.
        "prompts/recap.md": "回顾 report.md，不用看 meeting-notes.md。\n",
      },
    };
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": plan, "generate-flow.json": doc });
      const result = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/named" }));
      const inputs = Object.fromEntries(result.flow.stages.map((stage) => [stage.id, stage.inputs ?? []]));
      expect(inputs).toEqual({ notes: [], draft: ["notes"], check: ["draft", "notes"], recap: ["draft"] });
    });
  });

  it("asks again when the reply leaves out a stage of the plan", async () => {
    await usingHost(async () => {
      const short = { flow: { ...weeklyDoc.flow, stages: [weeklyDoc.flow.stages[0]] }, prompts: {} };
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": short, "generate-repair-1.json": weeklyDoc });
      const calls = recording();
      const fixed = ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/short", llm: calls.llm }));
      expect(calls.prompts.find((call) => call.repair)?.prompt).toContain('the plan\'s stage "draft" is missing');
      expect(fixed.flow.stages.map((stage) => stage.id)).toEqual(["notes", "draft"]);
    });
  });

  it("tries a call again when the reply stopped partway, and gives up on other failures", async () => {
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      const mock = generateMockComplete("/mocks");
      const seen: string[] = [];
      let cut = 1;
      const llm: LlmComplete = async (req) => {
        seen.push(req.stageId);
        if (req.stageId === "generate-flow" && cut-- > 0) throw Object.assign(new Error("the reply stopped partway"), { retryable: true });
        return mock(req);
      };
      ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/cut", llm }));
      expect(seen).toEqual(["generate-plan", "generate-flow", "generate-flow"]);

      seen.length = 0;
      const refused: LlmComplete = async (req) => {
        seen.push(req.stageId);
        throw Object.assign(new Error("401 invalid key"), { status: 401, retryable: false });
      };
      const failed = await generateFlow("把一周的笔记整理成周报", { dir: "/work/refused", llm: refused });
      expect(failed.ok).toBe(false);
      expect(seen).toEqual(["generate-plan"]);
    });
  });

  it("sends the requested model", async () => {
    await usingHost(async () => {
      seedMocks({ "generate-plan.json": weeklyPlan, "generate-flow.json": weeklyDoc });
      const mock = generateMockComplete("/mocks");
      const seen: string[] = [];
      const llm: LlmComplete = async (req) => {
        seen.push(`${req.provider.id}/${req.model}`);
        return mock(req);
      };
      ok(await generateFlow("把一周的笔记整理成周报", { dir: "/work/model", model: "openai/gpt-4o-mini", llm }));
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set(["openai/gpt-4o-mini"]));
    });
  });
});
