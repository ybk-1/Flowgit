# 更新记录 / Changelog

每个版本做了什么。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。`@flowgit/core`、`@flowgit/web` 和 `flowgit` 用同一个版本号。

What changed in each version. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). `@flowgit/core`, `@flowgit/web` and `flowgit` share one version number.

## [0.1.0] - 未发布 / Unreleased

第一个版本。/ The first release.

### 格式 / Format

- `flow.json` 规范 v0.1：流程输入（可带 `enum`）、阶段、产物和执行器，见 [docs/spec.md](docs/spec.md)。
- JSON 产物可以带 `schema`（一个 JSON Schema 文件）。跑完就检查；llm 不合格时自动让模型修一次。改 schema 文件会让这个阶段需要重跑。短视频模板的分镜带了 `schemas/storyboard.schema.json`。
- 每次运行都存成一个版本：`runs/<阶段>/<n>/` 里有产物快照和 `run.json`，可以随时回退。
- 是否需要重跑由上游产物、流程输入和执行器配置（包括提示词文件和脚本文件）的哈希决定，并向下游传递；手动改过的产物在重跑或回退前会先存成 `manual` 版本，不会被覆盖；回退到的旧版本不算手改。
- 流程也可以写成 `flow.md`：YAML 头写流程信息，每个 `## 阶段名 {#id}` 是一个阶段，配置写在 ```` ```flowgit ```` 代码块里，其余文字就是说明。和 `flow.json` 用同一个规范检查，可以互相转换。
- `flow.json` spec v0.1: flow inputs (optionally with an `enum`), stages, outputs and executors; see [docs/spec.md](docs/spec.md).
- A flow can also be written as `flow.md`: YAML frontmatter for the flow, one `## Stage name {#id}` per stage with its settings in a ```` ```flowgit ```` block, and the rest as descriptions. It is checked against the same spec as `flow.json`, and the two convert into each other.
- A JSON output can carry a `schema` (a JSON Schema file). It is checked when the stage finishes, and an llm stage that fails gets one automatic repair call. Editing the schema file marks the stage stale. The short-video template's storyboard uses `schemas/storyboard.schema.json`.
- Every run is kept as a version: `runs/<stage>/<n>/` holds an output snapshot and `run.json`, and you can roll back at any time.
- Whether a stage needs a re-run comes from a hash of upstream artifacts, flow inputs and executor config (including prompt and script files), and it propagates downstream. A hand edit is saved as a `manual` run before any re-run or restore, so it is never overwritten; a restored older version does not count as a hand edit.

### 执行器 / Executors

- `human`：人来完成，缺产物时流程停下并说明要放什么。
- `llm`：接任何模型。模型写成 `<provider>/<model>`，内置 Anthropic、OpenAI、OpenRouter、智谱 GLM、DeepSeek、Moonshot、通义千问和本机 Ollama，其他兼容 Anthropic 或 OpenAI 接口的服务加一条配置就行。密钥只从环境变量读。每次调用后显示 token 用量，`run all` 调用了好几次时最后再显示合计。自动修复 schema 算两次调用；修复后仍不合格的失败运行也会记下用量。
- `script`：在流程目录执行一条命令；`requires` 列出命令还要用到的程序（例如 `ffmpeg`）。
- `service`：调用 HTTP 服务。`POST` 发送流程输入和 1 MB 以内的文本上游产物，`GET` 把流程输入放进查询参数。请求头用 `{{env.变量名}}` 传密钥，不写进文件；跳转只跟同一个源，不会把请求头带到别的网站。`timeoutSec` 默认 60。示例见 `examples/service-echo`。
- `agent`：以无界面模式启动 Claude Code、Codex、Cursor、Gemini 或自定义的 agent CLI，只用能写流程目录的最小权限。
- `script` 和 `agent` 可以设 `timeoutSec`：到时间就停掉整棵进程树（macOS、Linux 先 `SIGTERM`、5 秒后 `SIGKILL`；Windows 用 `taskkill /T /F`），这次运行记为失败。按 Ctrl+C 时也会一起停掉子进程。
- `human`: done by a person; when outputs are missing the flow stops and says what to put where.
- `llm`: any model. Models are written `<provider>/<model>`, with Anthropic, OpenAI, OpenRouter, Zhipu GLM, DeepSeek, Moonshot, Qwen and local Ollama built in; any other Anthropic- or OpenAI-compatible service is one config entry. Keys are read only from environment variables. Each call shows its token usage, and `run all` ends with a total when it made several calls. A schema repair counts as two calls, and a run that still fails after the repair keeps its usage too.
- `script`: runs a command in the flow directory; `requires` lists other programs the command needs (e.g. `ffmpeg`).
- `service`: calls an HTTP service. `POST` sends the flow inputs and text upstream outputs up to 1 MB; `GET` puts the flow inputs in the query string. Headers pass keys with `{{env.NAME}}`, never written to a file, and redirects are followed only within the same origin so headers never reach another site. `timeoutSec` defaults to 60. See `examples/service-echo`.
- `agent`: starts Claude Code, Codex, Cursor, Gemini or a custom agent CLI headless, with the least permission that still lets it write in the flow directory.
- `script` and `agent` take `timeoutSec`: when it runs out, the whole process tree is stopped (`SIGTERM`, then `SIGKILL` after 5 seconds on macOS and Linux; `taskkill /T /F` on Windows) and the run is recorded as failed. Ctrl+C stops the child processes too.

### 命令行 / CLI

- `init`、`templates`、`validate`、`status`（终端看板）、`board`（网页看板）、`inputs`、`run`、`log`、`diff`、`restore`、`providers`、`doctor`、`graph`、`export-skill`。
- `init -t` 可以是 Git 地址（`git clone --depth 1`，可加 `--ref` 和 `--path`）。从本地目录或 Git 复制时默认不带产物，`--with-outputs` 才带上；Git 来源会把 `forkedFrom` 写进新的 `flow.json`。没有安装 git 时会说明怎么装。
- `convert --to md|json` 在 `flow.json` 和 `flow.md` 之间转换，内容不变；`init --format md` 新建时直接用 `flow.md`。`stage add`、`stage rm` 写回时保持原来的格式。
- `stage add` / `stage rm`：用命令加、删阶段。llm 和 agent 没给提示词时会建一个中英双语骨架，已有文件不覆盖。删阶段不删文件，也不动 `runs/`；还有别的阶段依赖它时要 `--force`。
- `share`：把流程复制成可以分享的副本。先检查密钥（发现就拒绝、什么都不写）、邮箱和本机路径（写完后提醒）。`runs/`、`flowgit.local.json` 和 `.env*` 永远不复制。
- `doctor` 在运行前检查 Node、流程输入、密钥、代理设置，以及脚本和 agent 要用的命令。
- 用代理或 VPN 时自动连得上模型：`run` 和 `board` 会走 `HTTPS_PROXY`，不用再设 `NODE_USE_ENV_PROXY=1`；Windows 和 macOS 上打开了系统代理也会自动用上。`doctor` 显示用的是哪个代理，`FLOWGIT_PROXY=off` 可以关掉。
- `export-skill` 把流程导出成 `SKILL.md`，AI 工具不用界面也能按步骤运行。
- `graph` 把流程画成 Mermaid 流程图，贴进 GitHub 或 Obsidian 就能看到；加 `--status` 按状态上色，`-o/--out` 直接写成 UTF-8 文件（`.md` 自动包上代码块）。
- `log` 不写阶段时按时间列出整个流程的所有版本，并合计用掉的 token。
- `diff` 对比同一个阶段的两个版本，或者某个版本和现在的文件：文本和 JSON 显示按行的改动，二进制只比较是否相同，文件夹列出新增、删除和改动的文件。
- `board` 在浏览器打开本机看板（新包 `@flowgit/web`）：每个阶段一张卡，显示状态、最新版本和产物，点产物在侧栏预览文本、JSON、图片、视频和目录。文件一变就通过 SSE 的 `flow:changed` 刷新（约 300 毫秒合并一次）；保存产物、上传、运行结束、回退和保存输入也会推送。连接着的时候不再每 3 秒轮询，断开时提示并改回每 3 秒刷新，每 5 秒重连。文本产物可以直接修改保存（JSON 先检查格式），人工阶段的文件夹可以上传文件；改过的产物下次运行前会先存成一个版本。可以填写流程输入，运行单个阶段或全部阶段，日志实时显示；同时只跑一个，运行中不能保存产物。每张卡可以看历史版本、对比两个版本（或和当前文件比）并回退。只监听 `127.0.0.1`，接口要令牌并检查 `Host`。
- 看板换了新造型：亮色是粗网格加大号阶段编号，可以运行的那一步整块变蓝；暗色是深色卡片，状态用发光圆点标出。跟着系统的深浅色自动切换，不用联网加载字体。
- 看板上可以新增和删除阶段。校验不通过就什么都不写，并返回双语错误列表；llm / agent 没有提示词文件时会建骨架，已有文件不覆盖。删除不碰产物和 `runs/`，还有依赖时会说明并可以一起断开。运行中不能改阶段。
- 看板上可以在「卡片 / Cards」和「流程图 / Graph」之间切换，选择记在浏览器里。流程图按依赖从左到右分列，阶段是圆角框，颜色和卡片一样表示状态；点一个阶段，侧栏里可以看产物、运行和历史。布局来自 `GET /api/graph`（`layoutFlow`）。
- 看板上有「预演 / Preview」：在日志里列出每个阶段会跳过、运行、等你还是不能运行，最后写最多调用几次模型，什么都不运行。全部运行前，如果这次会调用真实模型（`FLOWGIT_LLM_MOCK_DIR` 的固定回复不算），会先确认。每张卡片和流程图方框的提示显示这个阶段用过的 token，页面顶部显示合计。`GET /api/plan` 和 `GET /api/usage`。
- `run all --dry-run` 预演：每个阶段会跳过、运行还是停下等你，最多调用几次模型，什么都不运行。`doctor` 通过后和导出的 `SKILL.md` 里都会提到它。
- `inputs set` 保存前就检查名字和值（数字、`true`/`false`、可选值），写错了不会存进去。
- `board` 打印和打开的链接带着令牌（`?token=…`）。直接打开 `http://127.0.0.1:4747/` 只会看到提示、拿不到令牌，所以同一台电脑上的其他账号或程序没法操作你的看板。
- 从 Git 地址或别的文件夹 `init` 时，会列出这个流程要运行的命令、要启动的 agent 和要调用的服务（以及请求头里带的环境变量），运行前先看一眼。
- 提示词文件，以及要发给模型或服务的上游产物，如果是指向流程目录外面的链接，就不读取（`validate` 也会报出来），免得下载来的流程把 `~/.ssh` 这类文件发出去。脚本和 agent 阶段不受影响。
- 流程自己的 `flowgit.local.json` 改了某个带密钥的模型服务的地址时，`doctor` 会警告，运行日志也会写出来，因为密钥会发到那个地址。
- 提示、报错和 `--help` 都是中英双语（包括输错命令、少写参数这类报错，会提示“是不是想输入 …”），并针对余额不足、限流、连不上（包括代理）给出具体建议。
- `init`, `templates`, `validate`, `status` (terminal board), `board` (web board), `inputs`, `run`, `log`, `diff`, `restore`, `providers`, `doctor`, `graph`, `export-skill`.
- `init -t` accepts a Git URL (`git clone --depth 1`, with `--ref` and `--path`). Copying a local directory or a Git URL leaves outputs behind unless `--with-outputs` is set, and a Git source writes `forkedFrom` into the new `flow.json`. If git is not installed, the error says how to install it.
- `stage add` / `stage rm`: add or remove a stage from the command line. An llm or agent stage without a prompt gets a bilingual skeleton, and an existing file is never overwritten. Removing a stage deletes no files and leaves `runs/` alone; `--force` is required when other stages depend on it.
- `share` copies a flow into a directory that is safe to hand to someone else. A secret blocks the write entirely; emails and local paths are listed afterwards. `runs/`, `flowgit.local.json` and `.env*` are never copied.
- `doctor` checks Node, flow inputs, keys, proxy settings, and the programs script and agent stages use, before a run.
- Models are reachable behind a proxy or VPN: `run` and `board` use `HTTPS_PROXY` without `NODE_USE_ENV_PROXY=1`, and pick up the Windows or macOS system proxy too. `doctor` shows which proxy is used; `FLOWGIT_PROXY=off` turns this off.
- `export-skill` exports a flow as a `SKILL.md`, so AI tools can run it step by step without the UI.
- `graph` draws the flow as a Mermaid diagram that GitHub and Obsidian render; `--status` colors it by state, and `-o/--out` writes a UTF-8 file (a `.md` file gets the code block).
- `convert --to md|json` switches between `flow.json` and `flow.md` without changing the flow; `init --format md` starts a flow as `flow.md`. `stage add` and `stage rm` write back in the file's own format.
- `log` without a stage lists every version of the whole flow by time and adds up the tokens used.
- `diff` compares two versions of a stage, or a version with the current files: line changes for text and JSON, same-or-different for binaries, and added, removed and changed files for folders.
- `board` opens a local board in the browser (new package `@flowgit/web`): one card per stage with its state, latest version and outputs; click an output to preview text, JSON, images, video or a folder in a side panel. A file change refreshes it through the SSE event `flow:changed` (debounced by about 300 ms); saving an output, an upload, the end of a run, a restore and saving inputs push it too. While that stream is connected it no longer polls every 3 seconds; if the stream drops it says so, polls every 3 seconds again, and retries every 5 seconds. Text outputs can be edited and saved (JSON is checked first), and files can be uploaded into a human stage's folder; an edited output is saved as a version before the next run. Flow inputs can be filled in, and one stage or the whole flow can be run with a live log; one run at a time, and outputs cannot be saved while it runs. Each card can list its versions, compare two of them (or one with the current files) and restore one. It listens on `127.0.0.1` only, and its API needs a token and checks `Host`.
- The board has a new look: in light mode a bold grid with large stage numbers, and the stage you can run now in a solid blue block; in dark mode graphite cards with glowing status dots. It follows the system light/dark setting and loads no web fonts.
- Stages can be added and removed on the board. A stage that fails validation is not written, and the error list is bilingual; an llm or agent stage without a prompt file gets a skeleton, and an existing file is left as it is. Removing a stage leaves outputs and `runs/` in place, names any stages that still depend on it, and can detach those links. Stages cannot be changed while a run is in progress.
- The board switches between "卡片 / Cards" and "流程图 / Graph", and the choice is remembered in the browser. The graph lays stages out left to right by dependency, as rounded boxes colored the same way as the cards; click a stage for its outputs, run, and history in the side panel. Layout comes from `GET /api/graph` (`layoutFlow`).
- The board has "预演 / Preview": the log lists whether each stage would be skipped, run, wait for you or cannot run, and ends with at most how many model calls, without running anything. Run all asks first when the run would call a real model (canned replies from `FLOWGIT_LLM_MOCK_DIR` do not count). Each card and the graph box tooltip show the tokens that stage has used, and the top of the page shows the total. `GET /api/plan` and `GET /api/usage`.
- `run all --dry-run` shows whether each stage would be skipped, run or stop for you, and at most how many model calls it would make, without running anything. `doctor` points to it when nothing blocks, and so does the exported `SKILL.md`.
- `inputs set` checks names and values (numbers, `true`/`false`, allowed values) before saving, so a typo is never stored.
- The link `board` prints and opens carries the token (`?token=…`). Opening `http://127.0.0.1:4747/` by itself shows a note and no token, so other accounts or programs on the same computer can't drive your board.
- `init` from a Git URL or another folder lists the commands the flow runs, the agents it starts and the services it calls (with the environment variables their headers send), so you can look before you run it.
- A prompt file, or an upstream output on its way to a model or a service, that is a link to a file outside the flow directory is not read (`validate` reports it too), so a downloaded flow can't send files like `~/.ssh` anywhere. Script and agent stages are not affected.
- When a flow's own `flowgit.local.json` changes the address of a model provider that sends a key, `doctor` warns and the run log says so, because the key goes to that address.
- Messages, errors and `--help` are bilingual (including typos in commands and missing arguments, with a “did you mean …”), with specific advice for an empty balance, rate limits and connection problems (including proxies).

### 模板和示例 / Templates and examples

- `short-video`（默认）：脚本 → 配音 → 分镜 → 素材 → 剪辑 → 导出。FFmpeg 渲染竖屏视频，支持推近、模糊背景、渐变文字卡、标题、转场、背景音乐和配音（镜头时长跟着配音走）；输出语言可选中文或英文。
- 配音阶段调用 OpenAI 兼容的语音接口，把口播合成 `voice/voice.mp3`。密钥用 `FLOWGIT_TTS_API_KEY`（不写进文件），`FLOWGIT_TTS_BASE_URL` 可以换成别的兼容服务。没配密钥就跳过，不报错；`assets/` 里自己录的配音优先。`doctor` 没配密钥时只提醒，不算错误。
- `weekly-report`：周报入门示例，随手记（人）→ 草稿（模型）→ 检查（脚本），配合 [教程](docs/guide.md) 一步步做出来。
- `article`：图文帖子，大纲 → 正文 → 配图方案 → 照片（人）→ 导出 `post.md` 和 `post.html`。篇幅和语气按平台（小红书、公众号、博客）变化，缺的照片用画面描述占位。
- `support-sop`：客服 SOP，资料（人）→ 汇总（脚本）→ 规程 → 用例 → 检查（模型）→ 打包成 `skill/SKILL.md` 和评测用例。
- `job-application`：对照职位描述改简历并写求职信。简历和求职信并行，最后脚本检查关键词、篇幅和占位符。
- `research-report`：把题目拆成子问题、收集资料、写成带引用的报告。脚本检查没被引用的来源、不存在的引用、没被回答的子问题和没有出处的段落。
- `ecommerce-listing`：电商商品上架（淘宝、拼多多、抖店、亚马逊）。商品资料（人）→ FABE 卖点 → 标题 → 主图和“好处先行”的详情页、客服问答（并行）→ 检查：按平台口径算标题长度（亚马逊 75 个字符）、《广告法》的绝对化和医疗用语、价格比较，以及资料里找不到的数字。README 列出参考资料。
- `slides`：PPT 演示稿。按金字塔原理定核心结论和 SCQA 开场 → 每页“结论标题 + 证据”（图表、画面、引用、步骤，带 schema）→ 排成网页幻灯片 `slides.html` 和讲稿，打印就是一页一张的 PDF → 检查标题、字数、要点页占比和结尾的下一步。
- `live-selling`：直播带货脚本。商品资料（人）→ 七段流程表（留人、痛点、塑品、信任、价格、逼单、返场）→ 逐段话术和弹幕问答（并行）→ 按《网络直播营销管理办法》检查虚构的销量、库存和数字，以及绝对化、医疗用语和价格比较。
- `short-drama`：竖屏微短剧。设定和人物 → 分集节拍（钩子、压抑、爆发、悬念，付费卡点）→ 逐集剧本 → 按广电总局管理提示和创作标准审读 → 检查集数、估算时长、旁白开头、悬念和付费卡点。
- `lesson-plan`：老师备课，按逆向设计。教学目标（布鲁姆层级）→ 评价任务 → 教案和分层练习（并行）→ 学生练习单和答案，并检查教学评一致性、时间和“双减”作业时长。
- `examples/agent-page`：用 agent 做一页介绍网页（只在仓库里）。
- `short-video` (default): script → voiceover → storyboard → assets → edit → export. FFmpeg renders a vertical video with zoom, blurred fill, gradient text cards, a title, transitions, background music and voiceover (clips follow the voice); the output language is Chinese or English.
- The voice stage calls an OpenAI-compatible speech API and writes `voice/voice.mp3`. The key is `FLOWGIT_TTS_API_KEY` (never written to a file); `FLOWGIT_TTS_BASE_URL` points it at another compatible service. With no key the stage skips instead of failing, and a voiceover you recorded in `assets/` wins. `doctor` warns when the key is missing, and that warning is not an error.
- `weekly-report`: a starter that turns rough notes (person) into a draft (model) and checks it (script); the [guide](docs/guide.md) builds it step by step.
- `article`: an illustrated post, outline → draft → image plan → photos (person) → export to `post.md` and `post.html`. Length and tone follow the platform (Xiaohongshu, WeChat, blog), and a missing photo becomes a placeholder with its scene description.
- `support-sop`: a customer-support SOP, knowledge (person) → collect (script) → SOP → test cases → review (model) → packaged as `skill/SKILL.md` with an eval set.
- `job-application`: tailor a resume and write a cover letter for a job description. The resume and letter run in parallel, then a script checks keywords, length and placeholders.
- `research-report`: split a topic into sub-questions, gather sources and write a cited report. A script checks uncited sources, citations of missing files, unanswered sub-questions and paragraphs with no citation.
- `ecommerce-listing`: a product listing for Taobao, Pinduoduo, Douyin shops or Amazon. Product facts (person) → FABE selling points → titles → main images and a benefit-first detail page, plus customer Q&A (in parallel) → checks on title length counted the platform's way (75 characters on Amazon), absolute and medical claims under China's Advertising Law, price comparisons, and numbers the facts do not contain. The README lists its sources.
- `slides`: a slide deck. A governing thought and SCQA opening (Pyramid Principle) → claim-plus-evidence slides (charts, visuals, quotes, steps; with a schema) → an HTML deck `slides.html` plus speaker notes that prints to a one-slide-per-page PDF → checks on titles, text, bullet share and the closing next step.
- `live-selling`: a live-selling stream script. Product facts (person) → a seven-part rundown (hook, pain, demo, trust, price, close, recap) → segment script and chat Q&A (in parallel) → checks for invented sales, stock and numbers under China's live-stream marketing rules, plus absolute and medical claims and price comparisons.
- `short-drama`: a vertical micro-drama. Story bible and characters → episode beats (hook, suppression, payoff, cliffhanger, paywall) → scripts → a read against NRTA guidance and craft standards → checks on count, length, voice-over openings, cliffhangers and the paywall.
- `lesson-plan`: lesson prep with backward design. Objectives (Bloom levels) → assessment tasks → lesson plan and tiered exercises (in parallel) → a student worksheet and answer key, with checks on alignment, timing and homework load under the double-reduction rules.
- `examples/agent-page`: a one-page explainer made by an agent (repo only).

### 项目 / Project

- Linux 和 Windows 上的 CI，包括渲染测试、打包安装冒烟测试，以及照着 README 跑一遍 PowerShell 快速开始。
- 用 npm Trusted Publishing 的发布流程，见 [docs/releasing.md](docs/releasing.md)。
- CI on Linux and Windows, including the render test, a pack-and-install smoke test, and the README's PowerShell quick start run as written.
- A release workflow using npm Trusted Publishing; see [docs/releasing.md](docs/releasing.md).

[0.1.0]: https://github.com/cgold9820-dotcom/Flowgit/commits/main
