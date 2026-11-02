# 更新记录 / Changelog

每个版本做了什么。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。`@flowgit/core`、`@flowgit/web` 和 `flowgit` 用同一个版本号。

What changed in each version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). `@flowgit/core`, `@flowgit/web` and `flowgit` share one version number.

## [0.1.0] - 未发布 / Unreleased

第一个版本。/ The first release.

### 格式 / Format

- `flow.json` 规范 v0.1：流程输入（可带 `enum`）、阶段、产物和执行器，见 [docs/spec.md](docs/spec.md)。
- 每次运行都存成一个版本：`runs/<阶段>/<n>/` 里有产物快照和 `run.json`，可以随时回退。
- 是否需要重跑由上游产物、流程输入和执行器配置（包括提示词文件和脚本文件）的哈希决定，并向下游传递；手动改过的产物在重跑前会先存成 `manual` 版本，不会被覆盖。
- `flow.json` spec v0.1: flow inputs (optionally with an `enum`), stages, outputs and executors; see [docs/spec.md](docs/spec.md).
- Every run is kept as a version: `runs/<stage>/<n>/` holds an output snapshot and `run.json`, and you can roll back at any time.
- Whether a stage needs a re-run comes from a hash of upstream artifacts, flow inputs and executor config (including prompt and script files), and it propagates downstream. A hand edit is saved as a `manual` run before any re-run, so it is never overwritten.

### 执行器 / Executors

- `human`：人来完成，缺产物时流程停下并说明要放什么。
- `llm`：接任何模型。模型写成 `<provider>/<model>`，内置 Anthropic、OpenAI、OpenRouter、智谱 GLM、DeepSeek、Moonshot、通义千问和本机 Ollama，其他兼容 Anthropic 或 OpenAI 接口的服务加一条配置就行。密钥只从环境变量读。每次调用后显示 token 用量，`run all` 调用了好几次时最后再显示合计。
- `script`：在流程目录执行一条命令；`requires` 列出命令还要用到的程序（例如 `ffmpeg`）。
- `agent`：以无界面模式启动 Claude Code、Codex、Cursor、Gemini 或自定义的 agent CLI，只用能写流程目录的最小权限。
- `human`: done by a person; when outputs are missing the flow stops and says what to put where.
- `llm`: any model. Models are written `<provider>/<model>`, with Anthropic, OpenAI, OpenRouter, Zhipu GLM, DeepSeek, Moonshot, Qwen and local Ollama built in; any other Anthropic- or OpenAI-compatible service is one config entry. Keys are read only from environment variables. Each call shows its token usage, and `run all` ends with a total when it made several calls.
- `script`: runs a command in the flow directory; `requires` lists other programs the command needs (e.g. `ffmpeg`).
- `agent`: starts Claude Code, Codex, Cursor, Gemini or a custom agent CLI headless, with the least permission that still lets it write in the flow directory.

### 命令行 / CLI

- `init`、`templates`、`validate`、`status`（终端看板）、`board`（网页看板）、`inputs`、`run`、`log`、`restore`、`providers`、`doctor`、`graph`、`export-skill`。
- `doctor` 在运行前检查 Node、流程输入、密钥、代理设置，以及脚本和 agent 要用的命令。
- `export-skill` 把流程导出成 `SKILL.md`，AI 工具不用界面也能按步骤运行。
- `graph` 把流程画成 Mermaid 流程图，贴进 GitHub 或 Obsidian 就能看到；加 `--status` 按状态上色，`-o/--out` 直接写成 UTF-8 文件（`.md` 自动包上代码块）。
- `log` 不写阶段时按时间列出整个流程的所有版本，并合计用掉的 token。
- `board` 在浏览器打开本机只读看板（新包 `@flowgit/web`）：每个阶段一张卡，显示状态、最新版本和产物，点产物在侧栏预览文本、JSON、图片、视频和目录，每 3 秒刷新。只监听 `127.0.0.1`，接口要令牌并检查 `Host`。
- `run all --dry-run` 预演：每个阶段会跳过、运行还是停下等你，最多调用几次模型，什么都不运行。`doctor` 通过后和导出的 `SKILL.md` 里都会提到它。
- `inputs set` 保存前就检查名字和值（数字、`true`/`false`、可选值），写错了不会存进去。
- 提示、报错和 `--help` 都是中英双语（包括输错命令、少写参数这类报错，会提示“是不是想输入 …”），并针对余额不足、限流、连不上（包括代理）给出具体建议。
- `init`, `templates`, `validate`, `status` (terminal board), `board` (web board), `inputs`, `run`, `log`, `restore`, `providers`, `doctor`, `graph`, `export-skill`.
- `doctor` checks Node, flow inputs, keys, proxy settings, and the programs script and agent stages use, before a run.
- `export-skill` exports a flow as a `SKILL.md`, so AI tools can run it step by step without the UI.
- `graph` draws the flow as a Mermaid diagram that GitHub and Obsidian render; `--status` colors it by state, and `-o/--out` writes a UTF-8 file (a `.md` file gets the code block).
- `log` without a stage lists every version of the whole flow by time and adds up the tokens used.
- `board` opens a local read-only board in the browser (new package `@flowgit/web`): one card per stage with its state, latest version and outputs; click an output to preview text, JSON, images, video or a folder in a side panel; refreshes every 3 seconds. It listens on `127.0.0.1` only, and its API needs a token and checks `Host`.
- `run all --dry-run` shows whether each stage would be skipped, run or stop for you, and at most how many model calls it would make, without running anything. `doctor` points to it when nothing blocks, and so does the exported `SKILL.md`.
- `inputs set` checks names and values (numbers, `true`/`false`, allowed values) before saving, so a typo is never stored.
- Messages, errors and `--help` are bilingual (including typos in commands and missing arguments, with a “did you mean …”), with specific advice for an empty balance, rate limits and connection problems (including proxies).

### 模板和示例 / Templates and examples

- `short-video`（默认）：脚本 → 分镜 → 素材 → 剪辑 → 导出。FFmpeg 渲染竖屏视频，支持推近、模糊背景、渐变文字卡、标题、转场、背景音乐和配音（镜头时长跟着配音走）；输出语言可选中文或英文。
- `weekly-report`：周报入门示例，随手记（人）→ 草稿（模型）→ 检查（脚本），配合 [教程](docs/guide.md) 一步步做出来。
- `research-report`：把题目拆成子问题、收集资料、写成带引用的报告。脚本检查没被引用的来源、不存在的引用、没被回答的子问题和没有出处的段落。
- `examples/agent-page`：用 agent 做一页介绍网页（只在仓库里）。
- `short-video` (default): script → storyboard → assets → edit → export. FFmpeg renders a vertical video with zoom, blurred fill, gradient text cards, a title, transitions, background music and voiceover (clips follow the voice); the output language is Chinese or English.
- `weekly-report`: a starter that turns rough notes (person) into a draft (model) and checks it (script); the [guide](docs/guide.md) builds it step by step.
- `research-report`: split a topic into sub-questions, gather sources and write a cited report. A script checks uncited sources, citations of missing files, unanswered sub-questions and paragraphs with no citation.
- `examples/agent-page`: a one-page explainer made by an agent (repo only).

### 项目 / Project

- Linux 和 Windows 上的 CI，包括渲染测试、打包安装冒烟测试，以及照着 README 跑一遍 PowerShell 快速开始。
- 用 npm Trusted Publishing 的发布流程，见 [docs/releasing.md](docs/releasing.md)。
- CI on Linux and Windows, including the render test, a pack-and-install smoke test, and the README's PowerShell quick start run as written.
- A release workflow using npm Trusted Publishing; see [docs/releasing.md](docs/releasing.md).

[0.1.0]: https://github.com/cgold9820-dotcom/Flowgit/commits/main
