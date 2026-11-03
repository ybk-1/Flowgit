# 一页介绍网页（agent 示例）/ One-page explainer (agent example)

这个示例让 agent 做两步、脚本做一步：

1. **大纲**（agent）：根据主题写 `outline.md`。
2. **网页**（agent）：照大纲做一个单文件网页 `index.html`，不引用任何外部资源。
3. **检查**（script）：检查网页有标题、语言对、没有外部资源、大小合理，结果写进 `check.json`。不通过就失败，你可以直接改 `index.html`，或者重跑网页这一步。

This example has an agent do two stages and a script do one:

1. **Outline** (agent): writes `outline.md` from the topic.
2. **Page** (agent): builds a single-file page `index.html` from the outline, with no external resources.
3. **Check** (script): checks the page has a title, the right language, no external resources and a sane size, and writes `check.json`. If a check fails the stage fails; edit `index.html` yourself or re-run the page stage.

## 需要 / Requirements

- 编译好的 Flowgit（见根目录 README 的"快速开始"）。/ Flowgit built (see "Quick start" in the root README).
- 装好并登录 [Claude Code](https://docs.claude.com/en/docs/claude-code)：`npm install -g @anthropic-ai/claude-code`，然后运行一次 `claude` 登录。用 Claude 订阅登录就行，不需要 API key。/ [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in: `npm install -g @anthropic-ai/claude-code`, then run `claude` once to log in. A Claude subscription login works; no API key needed.

## 运行 / Run

macOS / Linux（在 Flowgit 仓库根目录 / from the Flowgit repo root）：

```bash
alias flowgit="node $PWD/packages/cli/dist/index.js"
flowgit init ~/my-page -t examples/agent-page
cd ~/my-page
flowgit inputs set topic="为什么猫喜欢纸箱"
flowgit run all
open index.html        # Linux: xdg-open index.html
```

Windows PowerShell（把路径换成你自己的 / use your own paths）：

```powershell
$fg = "E:\claude_code\Flowgit\Flowgit\packages\cli\dist\index.js"
node $fg init E:\claude_code\my-page -t E:\claude_code\Flowgit\Flowgit\examples\agent-page
cd E:\claude_code\my-page
node $fg inputs set topic="为什么猫喜欢纸箱"
node $fg run all
start index.html
```

想要英文网页就加 `flowgit inputs set language=en`。改了大纲以后再 `run all`，只有网页和检查会重跑。

For an English page, add `flowgit inputs set language=en`. Edit the outline and `run all` again: only the page and the check re-run.

## 换成别的 agent / Use another agent

把 `flow.json` 里两个 agent 阶段的 `"agent"` 改成 `codex`、`gemini` 或 `cursor`。Cursor 默认只提出修改、不写文件，要在 `executor.args` 里自己加 `"--force"`，详见 [docs/spec.md](../../docs/spec.md) 的"agent 执行器"。

Change `"agent"` in the two agent stages of `flow.json` to `codex`, `gemini` or `cursor`. Cursor only proposes changes by default; add `"--force"` to `executor.args` yourself. See "The agent executor" in [docs/spec.md](../../docs/spec.md).

## 安全 / Safety

Claude Code 用 `--permission-mode acceptEdits` 启动：可以直接改流程目录里的文件，但不会自动放行其他需要确认的操作。示例不会加任何跳过所有权限的参数。

Claude Code starts with `--permission-mode acceptEdits`: it can edit files in the flow directory without asking, but nothing else that needs approval is allowed automatically. The example adds no bypass-all-permissions flag.

## 依据 / Sources

- Agent 在流程目录里写文件，只用能写这个目录的最小权限。Flowgit 的 [agent 执行器](../../docs/spec.md) 写了 Claude Code 用 `--permission-mode acceptEdits`，不默认加上跳过所有权限的参数。 / The agent writes in the flow directory with the least permission that can do that. Flowgit's [agent executor](../../docs/spec.md) starts Claude Code with `--permission-mode acceptEdits` and does not add a bypass-all-permissions flag.
- 网页是单个文件，不引用外部资源。检查脚本按有没有标题、语言对不对、有没有外链、体积大不大来判断。 / The page is one file and cites no external resource. The check script looks for a title, the right language, no external links, and a sane size.
