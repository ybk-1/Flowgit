import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentName, ExecutorAgent, Flow, Stage } from "../types.js";
import { outputRel, truncate } from "../util.js";
import { renderTemplate } from "./llm.js";
import type { ExecContext, ExecResult, InputArtifact, StageExecutor } from "./types.js";

const LOG_CAP = 20_000;

/** Positional instruction for agents that take the full prompt on stdin. ASCII only, so every shell passes it through unchanged. */
export const STDIN_INSTRUCTION = "Do the task described in the piped input.";

/** How Flowgit starts one agent CLI headless. The rendered prompt is always piped to stdin as well. */
export interface AgentAdapter {
  /** Executable on PATH. */
  bin: string;
  /** Arguments before the user's `args`. */
  before: string[];
  /** Arguments after the user's `args`; gets the prompt file's path relative to the flow directory. */
  after: (promptRel: string) => string[];
  /** Official docs for the headless flags. */
  docs: string;
  /** How to install it. */
  install: string;
}

/**
 * Built-in adapters. Each uses the least permission that still lets the agent
 * write files in the flow directory; none passes a bypass-all-permissions flag.
 * Every flag comes from the CLI's official docs, linked here.
 */
export const AGENT_ADAPTERS: Readonly<Record<Exclude<AgentName, "custom">, AgentAdapter>> = {
  // https://code.claude.com/docs/en/headless : `-p` print mode; piped stdin is processed with the prompt argument.
  // https://code.claude.com/docs/en/permission-modes : acceptEdits creates and edits files in the working
  // directory without prompting; in -p runs other calls that need approval are denied.
  "claude-code": {
    bin: "claude",
    before: ["-p", "--permission-mode", "acceptEdits"],
    after: () => [STDIN_INSTRUCTION],
    docs: "https://code.claude.com/docs/en/headless",
    install: "npm install -g @anthropic-ai/claude-code",
  },
  // https://developers.openai.com/codex/noninteractive : `codex exec` is read-only by default;
  // `--sandbox workspace-write` lets it edit inside the workspace; `--skip-git-repo-check` because a flow
  // directory need not be a git repo; `-` reads the prompt from stdin.
  codex: {
    bin: "codex",
    before: ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check"],
    after: () => ["-"],
    docs: "https://developers.openai.com/codex/noninteractive",
    install: "npm install -g @openai/codex",
  },
  // https://cursor.com/docs/cli/headless and https://cursor.com/docs/cli/reference/parameters :
  // the binary is `agent`; the prompt is a positional argument (stdin is not documented), so it points to
  // the prompt file inside the flow directory. Without `--force` print mode only proposes changes, and
  // `--force` (alias `--yolo`) also allows shell commands, so it is never added by default.
  cursor: {
    bin: "agent",
    before: ["-p", "--output-format", "text"],
    after: (promptRel) => [`Read ${promptRel} and do the task it describes.`],
    docs: "https://cursor.com/docs/cli/headless",
    install: "https://cursor.com/docs/cli/installation",
  },
  // https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md : `-p` forces
  // non-interactive mode and is appended to stdin input; `--approval-mode auto_edit` auto-approves edits.
  // https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md : tools that
  // still need approval are treated as denied in non-interactive mode.
  gemini: {
    bin: "gemini",
    before: ["--approval-mode", "auto_edit"],
    after: () => ["-p", STDIN_INSTRUCTION],
    docs: "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md",
    install: "npm install -g @google/gemini-cli",
  },
};

/** Quote one argument for the platform shell that spawn({ shell: true }) uses. */
export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(arg)) return arg;
  if (platform === "win32") return `"${arg.replace(/"/g, '\\"')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Where the rendered prompt is written, relative to the flow directory (inside runs/, so agents may read it). */
export function agentPromptRel(stageId: string): string {
  return `runs/.agent/${stageId}.prompt.md`;
}

/** The shell command line for an agent stage. `promptFile` is the absolute path of the rendered prompt. */
export function agentCommandLine(
  ex: ExecutorAgent,
  promptFile: string,
  promptRel: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const extra = (ex.args ?? []).map((a) => shellQuote(a, platform));
  if (ex.agent === "custom") {
    const cmd = (ex.command ?? "").replace(/\{\{\s*promptFile\s*\}\}/g, shellQuote(promptFile, platform));
    return [cmd, ...extra].join(" ");
  }
  const a = AGENT_ADAPTERS[ex.agent];
  return [a.bin, ...a.before, ...(ex.args ?? []), ...a.after(promptRel)].map((x, i) => (i === 0 ? x : shellQuote(x, platform))).join(" ");
}

function artifactLine(a: InputArtifact): string {
  const p = outputRel(a.output);
  return `- \`${a.isDir && !p.endsWith("/") ? `${p}/` : p}\` (${a.output.type}, ${a.stageName})${a.exists ? "" : " (missing)"}`;
}

/**
 * The agent's prompt: the rendered prompt file, then what Flowgit needs from
 * the agent (which files to read, which to write, what not to touch).
 */
export function buildAgentPrompt(
  template: string,
  flow: Flow,
  stage: Stage,
  inputs: InputArtifact[],
  flowInputs: Record<string, unknown>,
): string {
  const values = Object.entries(flowInputs).filter(([, v]) => v !== undefined && v !== "");
  const lines = [
    renderTemplate(template, flowInputs).trim(),
    "",
    "---",
    "",
    "## Flowgit",
    "",
    `你在执行流程「${flow.name}」的阶段「${stage.name}」（${stage.id}）。当前目录就是流程目录。`,
    `You are running stage "${stage.name}" (${stage.id}) of the flow "${flow.name}". The current directory is the flow directory.`,
    "",
    "上游产物，只读 / Upstream artifacts, read only:",
    ...(inputs.length ? inputs.map(artifactLine) : ["- 无 / none"]),
    "",
    "你要写出的文件 / Files you must write:",
    ...stage.outputs.map((o) => `- \`${outputRel(o)}\` (${o.type})${o.description ? `: ${o.description}` : ""}`),
  ];
  if (values.length) {
    lines.push("", "流程输入 / Flow inputs:", ...values.map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`));
  }
  lines.push(
    "",
    "只创建或修改上面列出的文件，不要改动其他文件，也不要碰 runs/ 目录。文件写好就结束。",
    "Create or change only the files listed above. Leave every other file alone and never touch runs/. Stop once they are written.",
  );
  return `${lines.join("\n")}\n`;
}

const SKIP_DIRS = new Set(["runs", "node_modules", ".git"]);

/** size + mtime of every file in the flow directory except runs/, node_modules/ and .git/. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!rel && SKIP_DIRS.has(e.name)) continue;
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) {
        const st = fs.statSync(a);
        out.set(r, `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** Files that appeared, changed or disappeared between two snapshots, split into the stage's own outputs and everything else. */
function diffSnapshots(before: Map<string, string>, after: Map<string, string>, outputs: string[]): { own: string[]; others: string[] } {
  const isOwn = (f: string) => outputs.some((o) => (o.endsWith("/") ? f.startsWith(o) : f === o));
  const changed = new Set<string>();
  for (const [f, sig] of after) if (before.get(f) !== sig) changed.add(f);
  for (const f of before.keys()) if (!after.has(f)) changed.add(f);
  const all = [...changed].sort();
  return { own: all.filter(isOwn), others: all.filter((f) => !isOwn(f)) };
}

function notFound(code: number, output: string): boolean {
  // 127: POSIX sh "command not found"; 9009: cmd.exe "is not recognized"
  return code === 127 || code === 9009 || /is not recognized as an internal or external command/i.test(output);
}

/**
 * Starts an agent CLI headless in the flow directory with the rendered prompt
 * on stdin. The agent writes the outputs itself; Flowgit checks them and
 * records a version as for any other stage.
 */
export const agentExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const { stage, loaded } = ctx;
    const ex = stage.executor as ExecutorAgent;
    if (ex.agent === "custom" && !ex.command) {
      throw new Error(`agent 为 "custom" 时要写 command / agent "custom" needs a command`);
    }
    const template = fs.readFileSync(path.join(loaded.dir, ex.prompt), "utf8");
    const prompt = buildAgentPrompt(template, loaded.flow, stage, ctx.inputs, ctx.flowInputs);
    const promptRel = agentPromptRel(stage.id);
    const promptFile = path.join(loaded.dir, ...promptRel.split("/"));
    fs.mkdirSync(path.dirname(promptFile), { recursive: true });
    fs.writeFileSync(promptFile, prompt);
    const commandLine = agentCommandLine(ex, promptFile, promptRel);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(ctx.options.env ?? {}),
      FLOWGIT_PROJECT_DIR: loaded.dir,
      FLOWGIT_STAGE: stage.id,
      FLOWGIT_STAGE_NAME: stage.name,
      FLOWGIT_INPUTS: JSON.stringify(ctx.inputs.map((i) => ({ stage: i.stage, path: outputRel(i.output), type: i.output.type }))),
      FLOWGIT_OUTPUTS: JSON.stringify(stage.outputs.map((o) => ({ path: outputRel(o), type: o.type }))),
      FLOWGIT_FLOW_INPUTS: JSON.stringify(ctx.flowInputs),
      FLOWGIT_PROMPT_FILE: promptFile,
    };
    const shown = ex.agent === "custom" ? commandLine.replace(promptFile, "<prompt>") : commandLine;
    ctx.log(`启动 / starting ${ex.agent}: ${shown} (prompt ${prompt.length} chars)`);
    const before = snapshot(loaded.dir);
    const started = Date.now();
    let result: { code: number; output: string };
    try {
      result = await new Promise((resolve, reject) => {
        const child = spawn(commandLine, { cwd: loaded.dir, env, shell: true, stdio: ["pipe", "pipe", "pipe"] });
        let buf = "";
        const onData = (chunk: Buffer) => {
          const s = chunk.toString("utf8");
          if (buf.length < LOG_CAP * 5) buf += s;
          for (const line of s.split(/\r?\n/)) if (line.trim()) ctx.log(line);
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        // An agent that does not read stdin may close it early; that is fine.
        child.stdin.on("error", () => {});
        child.stdin.end(prompt);
        child.on("error", reject);
        child.on("close", (c) => resolve({ code: c ?? 1, output: buf }));
      });
    } finally {
      fs.rmSync(promptFile, { force: true });
      try {
        fs.rmdirSync(path.dirname(promptFile));
      } catch {
        // other agent stages may still have prompts there
      }
    }
    const ms = Date.now() - started;
    const { code, output } = result;
    if (code !== 0) {
      if (ex.agent !== "custom" && notFound(code, output)) {
        const a = AGENT_ADAPTERS[ex.agent];
        throw new Error(`找不到 ${a.bin}，请先安装：${a.install} / ${a.bin} not found; install it first: ${a.install}`);
      }
      throw new Error(`agent 失败，退出码 ${code} / Agent exited with code ${code}: ${shown}\n${truncate(output, 2000)}`);
    }
    const outputs = stage.outputs.map(outputRel);
    const missing = outputs.filter((o) => !fs.existsSync(path.join(loaded.dir, o)));
    const { own, others } = diffSnapshots(before, snapshot(loaded.dir), outputs);
    const wroteNothing = missing.length > 0 || own.length === 0;
    if (wroteNothing && ex.agent === "cursor" && !(ex.args ?? []).some((a) => ["--force", "-f", "--yolo"].includes(a))) {
      throw new Error(
        `Cursor 的无界面模式不加 --force 只会提出修改，不会写文件。--force 同时允许它执行命令；确认信任这个流程后，在 executor.args 里加上 "--force"。\n` +
          `Cursor's headless mode only proposes changes without --force, so it wrote nothing. --force also lets it run commands; if you trust this flow, add "--force" to executor.args.`,
      );
    }
    if (!missing.length && own.length === 0) {
      ctx.log("注意：agent 没有改动产物，内容和上一版相同 / note: the agent did not change the outputs; they match the previous version");
    }
    if (others.length) {
      ctx.log(`注意：agent 还改动了这些文件 / note: the agent also changed: ${others.slice(0, 20).join(", ")}${others.length > 20 ? " ..." : ""}`);
    }
    return {
      params: {
        agent: ex.agent,
        command: shown,
        exitCode: code,
        durationMs: ms,
        promptChars: prompt.length,
        prompt: truncate(prompt, LOG_CAP),
        changedOutside: others.length ? others : undefined,
        output: truncate(output, LOG_CAP),
      },
    };
  },
};
