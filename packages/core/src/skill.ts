import type { Executor, Flow, Stage } from "./types.js";
import { topoOrder } from "./graph.js";
import { outputRel } from "./util.js";

/** Skill names allow lowercase letters, digits and hyphens only. */
export function flowSlug(flow: Flow): string {
  if (flow.id) return flow.id;
  const s = flow.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "flowgit-flow";
}

function executorLine(ex: Executor): string {
  switch (ex.type) {
    case "llm":
      return `由模型执行 (llm)。提示词在 \`${ex.prompt}\`${ex.model ? `，模型 \`${ex.model}\`` : ""}。`;
    case "human":
      return `由人完成 (human)。${ex.instructions ?? "把产物放到下面列出的路径。"}`;
    case "script":
      return `运行命令 (script)：\`${ex.run}\`${ex.requires?.length ? `。需要先装好 / requires: ${ex.requires.map((r) => `\`${r}\``).join(", ")}` : ""}`;
    case "agent":
      return `由 agent 执行 (${ex.agent})。提示词在 \`${ex.prompt}\`${ex.agent === "custom" && ex.command ? `，命令 \`${ex.command}\`` : ""}。`;
    case "workflow":
      return ex.engine === "flowgit"
        ? `运行子流程 \`${ex.file}\` / run the sub-flow \`${ex.file}\``
        : `运行外部工作流 (${ex.engine})：\`${ex.file}\`（尚未实现 / not implemented yet）`;
    case "service":
      return `调用 HTTP 服务 (service)：\`${ex.method ?? "POST"} ${ex.url}\`${ex.headers ? "。请求头里的 {{env.名称}} 从环境变量读取，密钥不写进文件。" : ""}。`;
    case "mcp":
      return `调用 MCP 工具 ${ex.server}/${ex.tool}（v0.1 尚未实现）`;
  }
}

function stageSection(flow: Flow, stage: Stage, index: number): string {
  const reads = (stage.inputs ?? []).length
    ? (stage.inputs ?? [])
        .map((id) => {
          const up = flow.stages.find((s) => s.id === id)!;
          return up.outputs.map((o) => `\`${outputRel(o)}\``).join(", ");
        })
        .join(", ")
    : "无 / none";
  const writes = stage.outputs.map((o) => `\`${outputRel(o)}\` (${o.type})`).join(", ");
  return [
    `### ${index}. ${stage.name} (\`${stage.id}\`)`,
    "",
    stage.description ? `${stage.description}\n` : "",
    `- 读取 / reads: ${reads}`,
    `- 产出 / writes: ${writes}`,
    `- 怎么做 / how: ${executorLine(stage.executor)}`,
    `- 命令 / command: \`flowgit run ${stage.id}\``,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/**
 * Render a SKILL.md so any agent that reads skills (Claude Code, Cursor ...)
 * can run the flow stage by stage, with or without the flowgit CLI.
 */
export function renderSkillMd(flow: Flow): string {
  const order = topoOrder(flow);
  const stages = order.map((id) => flow.stages.find((s) => s.id === id)!);
  const inputs = Object.entries(flow.inputs ?? {});
  const description = (flow.description ?? `Run the "${flow.name}" flow stage by stage.`).replace(/\s+/g, " ").trim();
  const lines: string[] = [
    "---",
    `name: ${flowSlug(flow)}`,
    `description: ${description}`,
    "---",
    "",
    `# ${flow.name}`,
    "",
    flow.description ?? "",
    "",
    `这是一个 Flowgit 流程（spec v${flow.version}），由 \`flow.json\` 自动生成。流程分为 ${stages.length} 个阶段，每个阶段读取上游阶段的产物，写出自己的产物，每次运行都记录为 \`runs/<stage>/<n>/\` 下的一个版本。`,
    "",
    `This is a Flowgit flow generated from \`flow.json\`. It has ${stages.length} stages; each stage reads upstream artifacts, writes its own, and every run is recorded as a version under \`runs/<stage>/<n>/\`.`,
    "",
    "## 输入 / Inputs",
    "",
  ];
  if (inputs.length) {
    lines.push("| 名称 / name | 类型 / type | 必填 / required | 默认 / default | 说明 / description |", "| --- | --- | --- | --- | --- |");
    for (const [k, def] of inputs) {
      lines.push(
        `| \`${k}\` | ${def.type} | ${def.required ? "是 / yes" : "否 / no"} | ${def.default === undefined ? "" : `\`${JSON.stringify(def.default)}\``} | ${def.description ?? ""} |`,
      );
    }
    lines.push("", "值放在 `flowgit.local.json` 的 `inputs` 里，或用 `--input key=value` 传入。", "");
  } else {
    lines.push("无 / none", "");
  }
  lines.push("## 阶段 / Stages", "");
  stages.forEach((s, i) => lines.push(stageSection(flow, s, i + 1), ""));
  lines.push(
    "## 怎么运行 / How to run",
    "",
    "有 Flowgit CLI 时 / with the CLI:",
    "",
    "```bash",
    "flowgit doctor          # 跑之前检查密钥和要用的命令",
    "flowgit status          # 看每个阶段的状态",
    "flowgit run all --dry-run   # 先预演：哪些阶段会跑、最多调用几次模型，什么都不运行",
    "flowgit run all         # 按顺序跑完，遇到需要人的阶段会停下并说明",
    "flowgit run <stage>     # 只跑一个阶段",
    "flowgit log <stage>     # 看这个阶段的历史版本",
    "```",
    "",
    "没有 CLI 时 / without the CLI: 按上面的顺序逐个阶段执行。对 llm 阶段，读取提示词文件，把上游产物附在后面，把回复写到产物路径；对 script 阶段，在流程目录执行命令；对 human 阶段，等人把文件放到位。每个阶段完成后，把产物复制到 `runs/<stage>/<n>/outputs/` 并写一个 `run.json`，这样历史可以回看。",
    "",
    "Without the CLI, execute the stages in the order above: for an llm stage, read the prompt file, append the upstream artifacts and write the reply to the output path; for a script stage, run the command in the flow directory; for a human stage, wait for the person to put the files in place. After each stage, copy its outputs to `runs/<stage>/<n>/outputs/` and write a `run.json` so the history stays inspectable.",
    "",
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
