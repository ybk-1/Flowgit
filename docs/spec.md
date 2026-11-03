# Flow 格式规范 v0.1 / Flow format spec v0.1

状态：草案。机器可读的版本是 [`packages/core/schema/flow.schema.json`](../packages/core/schema/flow.schema.json)，两者不一致时以 Schema 为准。

Status: draft. The machine-readable source of truth is [`packages/core/schema/flow.schema.json`](../packages/core/schema/flow.schema.json); where the two disagree, the schema wins.

## 一句话 / In one sentence

一个流程 = 一串阶段。每个阶段声明它读什么（上游阶段的产物）、产出什么（文件）、谁来做（执行器）。每次运行一个阶段，都会留下一个可回看、可对比、可回退的版本。

A flow is a list of stages. Each stage declares what it reads (upstream artifacts), what it writes (files) and who does the work (an executor). Every run of a stage is kept as a version you can inspect, diff and restore.

## 目录结构 / Layout

```text
my-flow/
├── flow.json              # 流程定义（必需，或者写成 flow.md）/ the flow definition (required; or flow.md)
├── prompts/               # llm 阶段的提示词 / prompts for llm stages
├── scripts/               # script 阶段的脚本 / scripts for script stages
├── script.md              # 各阶段的当前产物 / current artifacts of each stage
├── storyboard.json
├── assets/
├── flowgit.local.json     # 本地填写的流程输入，不分享 / local input values, not shared
├── .flowgit/              # 看板缓存的视频帧，不分享 / video frames cached for the board, not shared
└── runs/                  # 历史版本，flowgit 自动写入 / version history, written by flowgit
    └── <stage>/<n>/
        ├── run.json       # 这次运行的记录 / the run record
        └── outputs/...    # 产物快照 / snapshot of the outputs
```

**模板和项目是同一个格式。** 去掉 `runs/`、`flowgit.local.json`、`.flowgit/` 和各阶段产物，剩下的就是可以分享、可以 fork 的模板；带上它们就是一个做了一半或做完的项目。

**A template and a project are the same format.** Strip `runs/`, `flowgit.local.json`, `.flowgit/` and the artifacts and you have a shareable, forkable template; keep them and it is a project, half done or finished.

## flow.json

| 字段 / Field | 必需 / Required | 说明 | Description |
| --- | --- | --- | --- |
| `format` | 是 / yes | 固定为 `"flowgit"` | Always `"flowgit"` |
| `version` | 是 / yes | 规范版本，目前是 `"0.1"` | Spec version, currently `"0.1"` |
| `id` | 否 / no | 短标识：小写字母、数字、连字符。用作导出 Skill 的名字 | Short slug: lowercase letters, digits, hyphens. Used as the exported Skill's name |
| `name` | 是 / yes | 流程名 | Flow name |
| `description` | 否 / no | 一两句话说明这个流程做什么 | A sentence or two on what the flow does |
| `language` | 否 / no | 提示词和文档的主要语言，如 `"zh"`、`"en"` | Main language of the prompts and docs, e.g. `"zh"`, `"en"` |
| `author` | 否 / no | `{ "name": "...", "url": "..." }` | `{ "name": "...", "url": "..." }` |
| `license` | 否 / no | 流程本身（提示词、脚本）的 SPDX 许可证 | SPDX license of the flow itself (prompts, scripts) |
| `tags` | 否 / no | 标签数组 | Array of tags |
| `forkedFrom` | 否 / no | 从 Git 地址 `init` 时记下的来源：`{ "source", "ref"?, "commit"? }`，地址里的账号和密码（令牌）会去掉。从本地目录复制不写这个字段，避免把可能含用户名的本机路径带出去。有这个字段、又会运行命令、启动 agent、调用服务、启动 MCP 服务器、加载插件、调用生图接口或运行子流程的流程，第一次运行前要在每台电脑上确认一次（`flowgit trust`、`run` 时的询问或看板弹窗）；确认记在 `~/.flowgit/trusted.json`（或 `$FLOWGIT_HOME/trusted.json`），不在流程目录里，这些动作变了会再问 | Recorded when `init` copies a Git URL: `{ "source", "ref"?, "commit"? }`, with any user name and password (token) removed from the URL. A local directory does not set it, so a path that may contain a user name is never stored. A flow with this field that runs commands, starts agents, calls services, starts MCP servers, loads plugins, calls an image API or runs sub-flows must be confirmed once on each computer before its first run (`flowgit trust`, the prompt in `run`, or the board dialog); the confirmation is stored in `~/.flowgit/trusted.json` (or `$FLOWGIT_HOME/trusted.json`), never in the flow directory, and is asked again when that list changes |
| `inputs` | 否 / no | 流程级参数，见下 | Flow-level parameters, see below |
| `mcpServers` | 否 / no | 具名 MCP 服务器，写法和 Claude Desktop / Cursor 一样。stdio 是 `{ command, args?, env? }`，远程是 `{ url }`（Streamable HTTP）。`env` 的每个值必须是 `${变量名}`。见「MCP 执行器」 | Named MCP servers, shaped like Claude Desktop / Cursor. Stdio is `{ command, args?, env? }`; remote is `{ url }` (Streamable HTTP). Every `env` value must be `${VAR}`. See "The MCP executor" |
| `concurrency` | 否 / no | `run all` 同时跑几个阶段，至少 1。没有依赖关系的阶段会一起开始，最多这么多个。不写就是 2。命令行的 `--concurrency` 覆盖它 | How many stages `run all` runs at once, at least 1. Stages with no dependency start together, up to this many. Unset means 2. `--concurrency` overrides it |
| `stages` | 是 / yes | 阶段数组，至少一个 | Array of stages, at least one |

### inputs：流程输入 / Flow inputs

用户在开始时填一次的参数，比如视频主题。值存在 `flowgit.local.json` 里（`flowgit inputs set k=v`），或运行时用 `--input key=value` 临时覆盖。

Parameters the user fills in once at the start, such as the video topic. Values are stored in `flowgit.local.json` (`flowgit inputs set k=v`), or overridden for one run with `--input key=value`.

```json
"inputs": {
  "topic":    { "type": "string", "description": "视频主题 / Video topic", "required": true },
  "duration": { "type": "number", "description": "目标时长（秒）/ Target length (s)", "default": 30 },
  "language": { "type": "string", "enum": ["zh", "en"], "default": "zh" }
}
```

| 字段 / Field | 说明 | Description |
| --- | --- | --- |
| `type` | `string`、`text`、`number`、`boolean`、`file`。`number` 要能读成数字，`boolean` 只能是 `true` 或 `false`，否则运行前报错 | One of `string`, `text`, `number`, `boolean`, `file`. A `number` must parse as a number and a `boolean` must be `true` or `false`, or the run fails before it starts |
| `description` | 给填写的人看的说明 | Help text for whoever fills it in |
| `default` | 没填时用的值 | Value used when nothing is set |
| `required` | 为 `true` 时，没填就不能运行 | When `true`, runs are refused until it is set |
| `enum` | 允许的取值；填了别的值，运行前就报错 | Allowed values; any other value fails before the run starts |

`flowgit inputs set` 保存前就做同样的检查，写错名字或值时会直接报错，不会存进 `flowgit.local.json`。

`flowgit inputs set` runs the same checks before saving, so a wrong name or value is refused right away and never reaches `flowgit.local.json`.

在 llm 提示词里用 `{{inputs.topic}}` 引用；script 阶段从 `FLOWGIT_FLOW_INPUTS` 读取。比如短视频模板用 `language`（`zh` | `en`）让用户选择脚本、字幕和日志的语言。

Reference them in llm prompts as `{{inputs.topic}}`; script stages read them from `FLOWGIT_FLOW_INPUTS`. The short-video template, for example, uses `language` (`zh` | `en`) to let the user pick the language of the script, captions and logs.

### stage：阶段 / Stage

| 字段 / Field | 必需 / Required | 说明 | Description |
| --- | --- | --- | --- |
| `id` | 是 / yes | 小写字母开头，可含数字、`_`、`-`。在整个流程里唯一 | Starts with a lowercase letter; may contain digits, `_`, `-`. Unique within the flow |
| `name` | 是 / yes | 显示名，比如"分镜" | Display name, e.g. "Storyboard" |
| `description` | 否 / no | 这一步做什么 | What this step does |
| `inputs` | 否 / no | 上游阶段 id 的数组。这个阶段会读取它们的全部产物 | Array of upstream stage ids. The stage reads all of their outputs |
| `executor` | 是 / yes | 谁来做，见下 | Who does the work, see below |
| `outputs` | 是 / yes | 产物数组，至少一个 | Array of outputs, at least one |

阶段之间不能成环。阶段的运行顺序由 `inputs` 决定，依赖相同时按文件里的顺序。`flowgit run all` 会把没有依赖关系的阶段同时跑起来，同时最多 `concurrency` 个（默认 2，`--concurrency <n>` 覆盖流程里的值）。依赖顺序不变：一个阶段要等它的上游都成功、被跳过或被保留之后才开始。某一阶段失败，或者停在等人的阶段，就不再开始新的阶段；已经在跑的会跑完，它们的版本保留。日志每一行前面是阶段 id，这样并行时也能看清是谁打的。看板仍然同时只跑一次运行。

Stages must not form a cycle. Run order follows `inputs`; ties keep the order in the file. `flowgit run all` starts stages that do not depend on each other at the same time, up to `concurrency` (default 2; `--concurrency <n>` overrides the flow). Dependency order is unchanged: a stage waits until every upstream has succeeded, been skipped or been kept. When a stage fails, or the run stops at a person, no further stage is started; stages already running finish, and their versions are kept. Each log line is prefixed with the stage id so a parallel run stays readable. The board still runs only one run at a time.

### output：产物 / Output

```json
{ "type": "flowgit/storyboard+json", "path": "storyboard.json" }
```

- `path`：相对流程目录，不能是绝对路径，不能有 `..`，不能放进 `runs/`。以 `/` 结尾或 `type` 为 `"dir"` 表示文件夹。
- `type`：类 MIME 的类型。`text/*`、`application/json`、`*+json` 和 `flowgit/*` 会被当成文本，交给下游 llm 阶段时直接附上内容；文件夹附上文件列表；其他文件附上路径。
- `schema`（可选）：流程目录里一个 JSON Schema 文件的相对路径，只能用在 JSON 产物上（`application/json` 或以 `+json` 结尾）。按文件里的 `$schema` 选 draft-07、2019-09 或 2020-12，不写就当 2020-12。阶段跑完后立刻检查；不合格则这次运行记为失败，报错最多列出 5 条（JSON 路径和原因）。llm 阶段会自动再问模型一次：接着原来的对话（原来的提示词和模型完整的回复），再发去错误和 schema，请它只输出改好的完整 JSON；`run.json` 的 `usage` 是两次调用的合计，`llmCalls` 分别记下每一次；修复后仍不合格，或者回复根本不是 JSON 时，失败运行的 `run.json` 也记下这些。`FLOWGIT_LLM_MOCK_DIR` 下，这一次读 `<阶段>.repair.json`，没有这个文件就失败。schema 文件的内容算进执行器配置的哈希，所以改了 schema，这个阶段就会需要重跑。
- 同一个路径只能由一个阶段产出。

- `path`: relative to the flow directory; no absolute paths, no `..`, nothing inside `runs/`. A trailing `/` or `type: "dir"` means a folder.
- `type`: a MIME-like type. `text/*`, `application/json`, `*+json` and `flowgit/*` are treated as text and their content is attached for downstream llm stages; a folder attaches its file list; any other file attaches its path.
- `schema` (optional): relative path of a JSON Schema file in the flow directory, only for JSON outputs (`application/json` or a type ending in `+json`). The file's `$schema` picks draft-07, 2019-09 or 2020-12; without one it is 2020-12. It is checked as soon as the stage finishes; a failure is recorded as a failed run and the error lists at most 5 problems (JSON path and reason). An llm stage automatically asks the model once more: it continues the original conversation (the original prompt and the model's whole reply), then sends the errors and the schema and asks for only the complete corrected JSON; `usage` in `run.json` is the total of both calls, and `llmCalls` keeps each one; when the repair still fails, or a reply is not JSON at all, the failed run's `run.json` keeps them too. Under `FLOWGIT_LLM_MOCK_DIR` that retry reads `<stage>.repair.json` and fails if the file is missing. The schema file's content counts in the executor config hash, so editing it marks the stage stale.
- Each path can be produced by only one stage.

### executor：执行器 / Executor

| `type` | v0.1 能否运行 / Runs in v0.1 | 字段 / Fields | 说明 | Description |
| --- | --- | --- | --- | --- |
| `human` | 能 / yes | `instructions?` | 由人完成。运行时检查产物是否到位；可用 `--from <path>` 把文件复制进来。缺产物时阶段停下，显示 `instructions` | Done by a person. A run checks the outputs are in place; `--from <path>` copies files in. If outputs are missing the stage stops and shows `instructions` |
| `llm` | 能 / yes | `prompt`, `system?`, `model?`, `effort?`, `maxTokens?`, `retries?` | 读取 `prompt` 指向的 Markdown，替换 `{{inputs.*}}`，把上游产物附在后面，调用模型，把回复写进唯一的产物。产物是 JSON 时自动从回复里提取 JSON。`model` 可写 `<provider>/<model>`（见下面的"模型供应商"），不写前缀就是 Claude。默认模型 `claude-opus-5-5`，优先级：`--model` > `model` > `FLOWGIT_MODEL` > 默认。`retries` 见下面 | Reads the Markdown file named by `prompt`, fills in `{{inputs.*}}`, appends the upstream artifacts, calls the model and writes the reply to the stage's single output. JSON outputs have the JSON extracted from the reply. `model` may be `<provider>/<model>` (see "Model providers" below); no prefix means Claude. Default model `claude-opus-5-5`; precedence: `--model` > `model` > `FLOWGIT_MODEL` > default. See below for `retries` |
| `script` | 能 / yes | `run`, `requires?`, `cwd?`, `env?`, `timeoutSec?` | 在流程目录执行一条 shell 命令。命令自己负责写出产物。`requires` 列出命令还要用到的程序（例如 `["ffmpeg"]`），运行前和 `flowgit doctor` 都会检查它们在不在 PATH 上。`timeoutSec` 见下面 | Runs a shell command in the flow directory. The command writes the outputs itself. `requires` lists other programs the command needs (e.g. `["ffmpeg"]`); they are checked on PATH before the run and by `flowgit doctor`. See below for `timeoutSec` |
| `agent` | 能 / yes | `agent`, `prompt`, `command?`, `args?`, `timeoutSec?` | 在流程目录里以无界面模式启动一个 agent CLI（Claude Code、Codex、Cursor、Gemini，或自定义命令），把渲染好的提示词交给它，由它自己写出产物。见下面的"agent 执行器" | Starts an agent CLI headless in the flow directory (Claude Code, Codex, Cursor, Gemini, or a custom command), hands it the rendered prompt, and lets it write the outputs itself. See "The agent executor" below |
| `workflow` | `engine` 为 `flowgit` 时能 / yes when `engine` is `flowgit` | `engine`, `file`, `params?` | 运行另一个流程。`flowgit` 跑一条 Flowgit 子流程；ComfyUI、n8n 等其他引擎仍是预留。见下面的「子流程」 | Runs another flow. `flowgit` runs a Flowgit sub-flow; other engines such as ComfyUI and n8n stay reserved. See "Sub-flows" below |
| `service` | 能 / yes | `url`, `method?`, `headers?`, `timeoutSec?`, `retries?` | 调用 HTTP 服务。只允许 `http` 和 `https`。`POST` 发送 `{ inputs, upstream }`（只带 1 MB 以内的文本产物），`GET` 把流程输入放进查询参数。`headers` 的值可以写 `{{env.变量名}}`，运行时从环境变量读取，这是传密钥的唯一方式，密钥不写进文件。`timeoutSec` 默认 60。跳转只跟同一个源（最多 5 次）；要跳到别的源时直接失败，免得请求头里的密钥被带过去。非 2xx、返回的 JSON 不合法、或引用的环境变量没设置，都记为失败。`url`、`method` 和 `headers` 的写法（不是取到的值）算进配置哈希。`retries` 见下面 | Calls an HTTP service. Only `http` and `https`. `POST` sends `{ inputs, upstream }` (text outputs up to 1 MB), `GET` puts flow inputs in the query string. Header values may contain `{{env.NAME}}`, read from the environment at run time; this is the only way to pass a key, and keys are never written to a file. `timeoutSec` defaults to 60. Redirects are followed within the same origin only (up to 5); a redirect to another origin fails the run so a key in the headers is never sent there. A non-2xx response, invalid JSON, or an unset env var fails the run. `url`, `method` and the `headers` as written (not the resolved values) count in the config hash. See below for `retries` |
| `mcp` | 能 / yes | `server`, `tool`, `args?`, `timeoutSec?` | 调用 `mcpServers` 里的一个工具，把结果写进唯一的产物。见下面的「MCP 执行器」 | Calls one tool on a server named in `mcpServers` and writes the result to the stage's single output. See "The MCP executor" below |
| `plugin` | 能 / yes | `plugin`, `config?`, `timeoutSec?` | 加载流程目录里的一个插件，由它写出产物。包名只从该目录的 `node_modules` 解析；`./` 路径必须留在流程目录内。见下面的「插件执行器」 | Loads a plugin from the flow directory and lets it write the outputs. A package name resolves only from that directory's `node_modules`; a `./` path must stay inside the flow directory. See "The plugin executor" below |
| `image` | 能 / yes | `model`, `prompt`, `size?`, `n?`, `each?`, `timeoutSec?` | 按提示词生成图片，写进唯一的、以 `/` 结尾的目录。`model` 写成 `<provider>/<model>`。见下面的「生图执行器」 | Generates pictures from a prompt into the stage's one directory output (the path ends with `/`). `model` is `<provider>/<model>`. See "The image executor" below |

### MCP 执行器 / The MCP executor

`mcp` 阶段调用一个 MCP 工具。服务器写在流程顶层的 `mcpServers` 里，阶段用 `server` 点名。`flowgit validate` 会检查这个名字存在，并且每个阶段只有一个产物。

An `mcp` stage calls one MCP tool. Servers live in the top-level `mcpServers` object, and the stage names one with `server`. `flowgit validate` checks that the name exists and that the stage has exactly one output.

```json
{
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remote": { "url": "https://example.com/mcp" }
  }
}
```

```json
{
  "type": "mcp",
  "server": "files",
  "tool": "list_directory",
  "args": { "path": "{{inputs.dir}}" },
  "timeoutSec": 30
}
```

- stdio 服务器和 Claude Desktop / Cursor 一样：`command`、`args`、`env`。`env` 的每个值必须整段都是 `${变量名}`（例如 `"API_KEY": "${API_KEY}"`）。运行时从环境变量读取，不写进任何文件。写成别的字（包括把密钥直接放进 flow.json）校验失败。远程服务器只有 `url`，走 Streamable HTTP，只允许 `http` 和 `https`。
- `args` 里的字符串可以用 `{{inputs.名称}}`（和提示词同一个 `renderTemplate`）、`{{upstream.<阶段 id>}}`（那个阶段第一个产物的相对路径）和 `{{upstream.<阶段 id>.content}}`（它的文本）。
- 文本产物把每一段 `type: "text"` 用空行拼起来。JSON 产物写入 `structuredContent`；工具没给这个字段时，写入原来的 `content` 数组。以 `/` 结尾的目录产物按顺序把 `image` / `audio` 存成 `001.png`、`002.wav` 这样的文件，文字存成 `result.md`。
- `isError: true` 时阶段失败，错误里是工具返回的文字。
- 超时先看阶段的 `timeoutSec`，没有就用默认 60 秒。到点就停掉 stdio 子进程。子进程的 stderr 写进这次运行的日志。
- 是否需要重跑的哈希包含 `mcpServers` 里这个服务器的配置（`env` 只算变量名，不算值）、`tool` 和 `args`。改了参数或命令会变成 `stale`；换一个密钥的值不会。
- `flowgit doctor` 检查 stdio 的 `command` 在不在 PATH 上，以及每个 `${变量名}` 有没有设置。`flowgit mcp tools <服务器>` 列出工具和参数。`init` 和从别处复制来的流程会列出将要启动的命令或 URL。从 Git 地址复制来的流程，第一次运行前要确认这份清单；确认之前不会启动 MCP 服务器。
- 可运行的例子：[`examples/mcp-echo`](../examples/mcp-echo)（本地假服务器，不访问网络）。更完整的说明见 [docs/mcp.md](mcp.md)。

- A stdio server matches Claude Desktop / Cursor: `command`, `args`, `env`. Every `env` value must be the whole string `${VAR}` (for example `"API_KEY": "${API_KEY}"`). It is read from the environment at run time and never written to a file. Anything else, including a literal secret in flow.json, fails validation. A remote server is only `url`, over Streamable HTTP, and only `http` and `https` are allowed.
- Strings in `args` may use `{{inputs.name}}` (the same `renderTemplate` as prompts), `{{upstream.<stageId>}}` (the relative path of that stage's first output) and `{{upstream.<stageId>.content}}` (its text).
- A text output joins every `type: "text"` item with a blank line. A JSON output is `structuredContent`, or the raw `content` array when the tool did not send `structuredContent`. A directory output (path ending in `/`) saves `image` / `audio` items in order as `001.png`, `002.wav` and so on, and text as `result.md`.
- `isError: true` fails the stage, and the error is the tool's text.
- The timeout is the stage's `timeoutSec`, or 60 seconds when that is unset. At the deadline the stdio child is killed. The child's stderr is written to the run log.
- The staleness hash includes that server's `mcpServers` entry with env values removed (the variable names stay), plus `tool` and `args`. Changing args or the command marks the stage `stale`; changing a secret's value does not.
- `flowgit doctor` checks that a stdio `command` is on PATH and that every `${VAR}` is set. `flowgit mcp tools <server>` lists tools and parameters. `init`, and a flow copied from somewhere else, lists the command or URL that would be started. A flow copied from a Git URL must confirm that list before its first run; no MCP server starts until then.
- Runnable example: [`examples/mcp-echo`](../examples/mcp-echo) (a local fake server, no network). The longer write-up is [docs/mcp.md](mcp.md).

### 插件执行器 / The plugin executor

`plugin` 阶段在本进程里加载一个插件，调用它的 `executor.run`。插件自己写出产物。完整契约、`PluginContext` 和一份能跑的最小插件见 [docs/plugins.md](plugins.md)。

A `plugin` stage loads a plugin in this process and calls its `executor.run`. The plugin writes the outputs. The full contract, `PluginContext`, and a runnable minimal plugin are in [docs/plugins.md](plugins.md).

```json
{
  "type": "plugin",
  "plugin": "./plugins/echo",
  "config": { "prefix": "echo: " },
  "timeoutSec": 30
}
```

- `plugin` 是包名，或 `./` 开头的相对路径。包名只用 `createRequire(<流程目录>/package.json)` 从该目录的 `node_modules` 解析，不查上级目录、不查全局、也不自动安装。找不到就失败，并提示在流程目录运行 `npm install <包名>`。`./` 路径必须留在流程目录内；`../outside` 在校验时失败。
- 默认导出 `{ flowgitPlugin: 1, name, executor: { run(ctx) } }`。`ctx` 是 `@flowgit/core` 导出的 `PluginContext`：`flowDir`、`stage`、`config`、`inputs`、`upstream`（相对路径和一个 `read`）、`writeOutput(rel, data)`、`log(line)`、`signal`（`AbortSignal`）。`flowgitPlugin` 不是 `1` 就失败，请升级 Flowgit 或这个插件。插件不要 import Flowgit 的内部模块。
- `writeOutput` 只能写这个阶段声明的产物（目录产物可以写里面的文件）。`upstream.read` 只能读上游产物。
- `timeoutSec` 到点就中止 `signal`，这次运行记为失败。不写表示不限时。
- 是否需要重跑的哈希包含 `config`。包插件还包含其 `package.json` 的 `version`；文件夹插件改为该目录（或那一个文件）的哈希。
- `flowgit doctor` 和 `flowgit plugins` 列出用到的插件、解析到的路径和版本，以及没找到的。`init` 和从别处复制来的流程会列出插件名字和解析位置。从 Git 地址复制来的流程，第一次运行前要确认这份清单；确认之前不会加载插件。
- 可运行的例子：[`examples/plugin-echo`](../examples/plugin-echo)（纯 JavaScript，无依赖）。

- `plugin` is a package name or a relative path starting with `./`. A package name is resolved only from that directory's `node_modules` via `createRequire(<flowDir>/package.json)`: no parent directories, no global lookup, and no auto-install. A missing package fails and hints to run `npm install <name>` in the flow directory. A `./` path must stay inside the flow directory; `../outside` fails validation.
- The default export is `{ flowgitPlugin: 1, name, executor: { run(ctx) } }`. `ctx` is the `PluginContext` exported by `@flowgit/core`: `flowDir`, `stage`, `config`, `inputs`, `upstream` (relative paths and a `read`), `writeOutput(rel, data)`, `log(line)`, and `signal` (`AbortSignal`). Any `flowgitPlugin` other than `1` fails and asks you to upgrade Flowgit or the plugin. Plugins must not import Flowgit internals.
- `writeOutput` can only write this stage's declared outputs (a directory output accepts a file inside it). `upstream.read` can only read upstream outputs.
- `timeoutSec` aborts `signal` and fails the run. Unset means no limit.
- The staleness hash includes `config`. A package plugin also includes the `version` in its `package.json`; a folder plugin hashes that directory (or that one file) instead.
- `flowgit doctor` and `flowgit plugins` list the plugins in use, the resolved path and version, and any that are missing. `init`, and a flow copied from somewhere else, lists plugin names and where they resolve. A flow copied from a Git URL must confirm that list before its first run; no plugin is loaded until then.
- Runnable example: [`examples/plugin-echo`](../examples/plugin-echo) (plain JavaScript, no dependencies).

### 生图执行器 / The image executor

`image` 阶段调用图像模型，把图片写进这个阶段唯一的目录产物（`path` 以 `/` 结尾）。自带模板仍然默认用你上传的素材；生图是可选阶段。密钥怎么拿、费用和版权见 [docs/image.md](image.md)。

An `image` stage calls an image model and writes pictures into that stage's one directory output (`path` ends with `/`). Bundled templates still default to assets you upload; image generation is optional. Keys, cost and copyright are in [docs/image.md](image.md).

```json
{
  "type": "image",
  "model": "zhipu/cogview-4",
  "prompt": "prompts/shots.md",
  "size": "1024x1024",
  "n": 1,
  "each": { "from": "storyboard.json", "path": "shots", "field": "image_prompt" },
  "timeoutSec": 180
}
```

- `model` 写成 `<provider>/<model>`，只按第一个 `/` 拆开。预设有 `openai`（`OPENAI_API_KEY`）、`zhipu`（`GLM_API_KEY`，和对话用的智谱密钥是同一把）、`volcengine`（`ARK_API_KEY`，火山方舟 / 即梦 Seedream）、`dashscope`（`DASHSCOPE_API_KEY`，通义万相）。地址在 `packages/core/src/image-providers.ts`，都来自厂商官方文档。密钥只从 `apiKeyEnv` 指的环境变量读，不写进文件。`flowgit providers` 多一节「生图 / Image」，列出预设、要哪个变量、设没设。
- `prompt` 是 Markdown 文件。`{{inputs.名称}}` 会换成流程输入。没有 `each` 时，`n` 是这一句提示词出几张图，默认 1，文件名 `001.png`、`002.png`……有 `each` 时，`from` 必须是上游某个 JSON 产物的路径，`path` 是里面的数组（点号分开，例如 `shots`），每一项的 `field` 接在渲染后的提示词后面，一项一张图。这时 `n` 只能是 1 或不写。
- `size` 默认 `1024x1024`。万相要的是 `1024*1024`，Flowgit 会把 `宽x高` 换成星号再送出。别的写法原样送出。每一张图单独请求一次，所以万相不会用它默认的一次 4 张。万相是异步的：提交后马上查一次，之后每 2 秒再查，成功就下载，失败就停下。`timeoutSec` 是这一张图的上限，含轮询，默认 180 秒。
- 返回的地址会下载（请求图片时不带密钥）。返回的 base64 会解码。文件名从 `001.png` 起。`run.json` 记下供应商、模型、尺寸、张数，以及每张的文件名和字节数。`flowgit log` 会显示模型、尺寸和张数。
- 设置 `FLOWGIT_IMAGE_MOCK_DIR=<目录>` 时，从 `<目录>/<阶段 id>/` 按文件名顺序复制图片，张数不够就从头循环，不调用接口，也不需要密钥。
- 从 Git 地址复制来的流程会把模型和密钥变量名列进确认清单；确认之前不会调用接口。
- `FLOWGIT_IMAGE_BASE_URL` 会换掉预设地址，只给测试里的本机假服务器用。平时不要设置，否则密钥会发到那个地址。
- 提示词文件算进是否需要重跑。改了提示词，这个阶段和下游都会变成 `stale`。
- 接口返回 401 时，报错会用中文和英文点名该用的环境变量。
- 可运行的例子：[`examples/image-shots`](../examples/image-shots)（用固定图片，不访问网络）。

- `model` is `<provider>/<model>`, split on the first `/` only. Presets: `openai` (`OPENAI_API_KEY`), `zhipu` (`GLM_API_KEY`, the same Zhipu key as chat), `volcengine` (`ARK_API_KEY`, Volcengine Ark / Jimeng Seedream), `dashscope` (`DASHSCOPE_API_KEY`, Tongyi Wanxiang). Endpoints live in `packages/core/src/image-providers.ts` and come from the vendors' official docs. The key is read only from the environment variable `apiKeyEnv` names, never from a file. `flowgit providers` adds a "生图 / Image" section listing the presets, the variable each one needs, and whether it is set.
- `prompt` is a Markdown file. `{{inputs.name}}` is filled from the flow inputs. Without `each`, `n` is how many pictures that one prompt makes (default 1), named `001.png`, `002.png`, and so on. With `each`, `from` must be the path of an upstream JSON output, `path` is the array inside it (dotted, for example `shots`), and each item's `field` is appended to the rendered prompt, one picture per item. `n` must then be 1 or omitted.
- `size` defaults to `1024x1024`. Wanxiang wants `1024*1024`; Flowgit rewrites `WIDTHxHEIGHT` to a star before sending it. Anything else is sent as written. Each picture is its own request, so Wanxiang does not use its default of 4 pictures per call. Wanxiang is async: submit, poll once immediately and then every 2 seconds, download on success, stop on failure. `timeoutSec` is the limit for one picture, polling included, default 180 seconds.
- A returned URL is downloaded (the picture request does not send the key). Returned base64 is decoded. Names start at `001.png`. `run.json` records the provider, model, size, count, and each file's name and byte size. `flowgit log` shows the model, size and count.
- `FLOWGIT_IMAGE_MOCK_DIR=<dir>` copies pictures from `<dir>/<stage id>/` in name order, cycling if there are too few, and calls nothing. No key is needed.
- A flow copied from a Git URL lists the model and the key variable in the confirmation; the API is not called until then.
- `FLOWGIT_IMAGE_BASE_URL` replaces the preset endpoint. It is for a local fake server in tests. Leave it unset; otherwise the key is sent there.
- The prompt file counts toward staleness. Editing it marks this stage and everything downstream `stale`.
- A 401 names the environment variable to check, in Chinese and in English.
- Runnable example: [`examples/image-shots`](../examples/image-shots) (canned pictures, no network).

### 子流程 / Sub-flows

`engine` 为 `"flowgit"` 时，`workflow` 阶段运行另一份 `flow.json`。其他引擎只保留字段，还不能运行。

When `engine` is `"flowgit"`, a `workflow` stage runs another `flow.json`. Other engines keep the fields and cannot run yet.

```json
{
  "type": "workflow",
  "engine": "flowgit",
  "file": "subflows/short-video/flow.json",
  "params": {
    "inputs": { "topic": "{{inputs.topic}}", "language": "zh" },
    "copy": { "export/final.mp4": "video.mp4" }
  }
}
```

- `file`：子流程的 `flow.json`，相对父流程目录，而且必须留在目录里面。带 `..` 或绝对路径，校验失败。
- `params.inputs`：交给子流程的输入。字符串里的 `{{inputs.名称}}` 用父流程的输入替换（和提示词同一个 `renderTemplate`）。子流程用自己的 `runs/`，不会写进父流程的 `runs/`。
- `params.copy`：子流程产物路径 → 本阶段产物路径，文件和文件夹都可以。本阶段声明的每一个产物都必须被 `copy` 的某个值覆盖，否则校验失败。
- 子流程停在人工阶段时，父阶段也停。提示里写明子流程的阶段，以及文件在子流程目录下的路径。子流程失败时，父阶段失败，错误里带上子流程的阶段 id。
- 可以嵌套。形成环是错误。最多 5 层。
- 子流程的日志前缀是 `[子流程 / sub-flow <阶段 id>]`。
- 是否需要重跑的哈希包含子流程的 `flow.json`，以及它点名的提示词文件和脚本文件（沿用阶段配置哈希）。改了子流程，父阶段就会变成 `stale`。
- `run all --dry-run`、`doctor`、`graph` 和 `export-skill` 都认识它。`export-skill` 写成「运行子流程 `<file>` / run the sub-flow `<file>`」。`graph` 把这种阶段标成 `sub-flow`。
- 示例：[`examples/subflow`](../examples/subflow)，题目（人）→ 子流程（模型和脚本）→ 摘要（脚本）。

- `file`: the sub-flow's `flow.json`, relative to the parent directory and inside it. A `..` segment or an absolute path fails validation.
- `params.inputs`: values passed to the sub-flow. `{{inputs.name}}` in a string is filled from the parent inputs (the same `renderTemplate` as prompts). The sub-flow keeps its own `runs/` and does not write into the parent's `runs/`.
- `params.copy`: sub-flow output path → this stage's output path, for a file or a directory. Every output this stage declares must be the value of some `copy` entry, or validation fails.
- When the sub-flow stops on a human stage, the parent stage stops too. The message names that sub-flow stage and the path under the sub-flow directory. When the sub-flow fails, the parent stage fails, and the error includes the sub-flow stage id.
- Nesting is allowed. A cycle is an error. The maximum depth is 5.
- Sub-flow logs are prefixed with `[子流程 / sub-flow <stage id>]`.
- The staleness hash includes the sub-flow's `flow.json` and the prompt and script files it names (the same stage-config hash). Changing the sub-flow marks the parent `stale`.
- `run all --dry-run`, `doctor`, `graph` and `export-skill` understand it. `export-skill` writes "运行子流程 `<file>` / run the sub-flow `<file>`". `graph` labels the stage `sub-flow`.
- Example: [`examples/subflow`](../examples/subflow), topic (person) → sub-flow (model and script) → summary (script).

`params` 只有在 `engine` 为 `flowgit` 时才是上面这个形状（`inputs` 和 `copy`）。其他引擎的 `params` 仍是任意对象。

Only when `engine` is `flowgit` is `params` the shape above (`inputs` and `copy`). For every other engine, `params` stays an arbitrary object.

### 模型供应商 / Model providers

llm 阶段可以接任何模型。几乎所有模型都支持两种接口之一：**Anthropic Messages** 或 **OpenAI Chat Completions**，Flowgit 只实现这两种协议，不为每家各写一套。

An llm stage can use any model. Nearly every model speaks one of two wire protocols, **Anthropic Messages** or **OpenAI Chat Completions**, so Flowgit implements those two instead of one client per vendor.

`model` 写成 `<provider>/<model>`，例如 `glm/glm-5.3`、`deepseek/deepseek-v4-pro`、`ollama/qwen3:8b`。只按第一个 `/` 拆分，所以 `openrouter/openai/gpt-5` 的模型名是 `openai/gpt-5`。没有前缀就是 `anthropic`，旧的流程不用改。

Write `model` as `<provider>/<model>`, e.g. `glm/glm-5.3`, `deepseek/deepseek-v4-pro`, `ollama/qwen3:8b`. Only the first `/` splits, so in `openrouter/openai/gpt-5` the model is `openai/gpt-5`. No prefix means `anthropic`, so existing flows keep working.

`flow.json` 是要分享的，所以**只写模型名，不写地址和密钥**。地址在本机配置里，密钥只从环境变量读，**永远不写进文件**（配置里出现 `apiKey` 之类的字段会直接报错）。

`flow.json` gets shared, so it **names the model only, never an endpoint or a key**. Endpoints live in local config; keys are read only from environment variables and **never stored in a file** (a field such as `apiKey` in the config is an error).

内置预设 / Built-in presets（`flowgit providers` 查看 / list them with `flowgit providers`）：

| provider | 协议 / Protocol | 地址 / baseUrl | 密钥变量 / Key variable |
| --- | --- | --- | --- |
| `anthropic`（默认 / default） | anthropic | `https://api.anthropic.com`（或 / or `ANTHROPIC_BASE_URL`） | `ANTHROPIC_API_KEY`（或 / or `ANTHROPIC_AUTH_TOKEN`） |
| `openai` | openai | `https://api.openai.com/v1`（或 / or `OPENAI_BASE_URL`） | `OPENAI_API_KEY` |
| `openrouter` | openai | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `glm`（智谱 / Zhipu） | anthropic | `https://open.bigmodel.cn/api/anthropic` | `GLM_API_KEY` |
| `deepseek` | openai | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `moonshot`（Kimi） | openai | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `qwen`（通义千问 / Qwen） | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` |
| `ollama`（本机 / local） | openai | `http://localhost:11434/v1` | 不需要 / none |

每个预设的地址都来自厂商官方文档，链接写在 `packages/core/src/providers.ts` 里。

Every preset's endpoint comes from the vendor's official docs, linked in `packages/core/src/providers.ts`.

本机配置 / Local config：全局文件 `~/.flowgit/providers.json`（设置了 `FLOWGIT_HOME` 时是 `$FLOWGIT_HOME/providers.json`），再由流程目录下 `flowgit.local.json` 的 `providers` 覆盖，逐个字段合并在预设上。/ The global file `~/.flowgit/providers.json` (`$FLOWGIT_HOME/providers.json` when `FLOWGIT_HOME` is set), then the `providers` key of the flow's `flowgit.local.json`, merged field by field over the presets.

流程目录里的 `flowgit.local.json` 改了某个带密钥的 provider 的 `baseUrl` 时，`flowgit doctor` 会警告，运行日志也会写出来：用 `git clone` 下载的文件夹会带着这个文件，可能把你已经在用的密钥指向别的服务器（`flowgit init` 和 `flowgit share` 从不复制它）。/ When the flow directory's `flowgit.local.json` changes the `baseUrl` of a provider that sends a key, `flowgit doctor` warns and the run log says so: a folder downloaded with `git clone` keeps that file, and it could point a key you already use at another server (`flowgit init` and `flowgit share` never copy it).

```json
{
  "providers": {
    "glm":     { "apiKeyEnv": "ZHIPU_KEY" },
    "zai":     { "protocol": "anthropic", "baseUrl": "https://api.z.ai/api/anthropic", "apiKeyEnv": "ZAI_API_KEY" },
    "company": { "protocol": "openai", "baseUrl": "https://llm.example.com/v1", "apiKeyEnv": "COMPANY_LLM_KEY" }
  }
}
```

| 字段 / Field | 说明 | Description |
| --- | --- | --- |
| `protocol` | `anthropic` 或 `openai`。新的 provider 必填 | `anthropic` or `openai`. Required for a new provider |
| `baseUrl` | 接口地址（http/https）。新的 provider 必填 | Endpoint (http/https). Required for a new provider |
| `apiKeyEnv` | 存密钥的环境变量名。不写表示不需要密钥 | Name of the env var holding the key. Leave it out when no key is needed |

请求的差别 / How requests differ：

- `anthropic` 协议：只有直连 Anthropic 官方接口（`api.anthropic.com`）时才发送 Claude 专用参数（服务端 fallback、`effort`）。第三方兼容接口只收到标准的 messages 请求，密钥同时放在 `Authorization: Bearer` 和 `x-api-key` 里。
- `openai` 协议：流式调用 Chat Completions。OpenAI 官方接口用 `max_completion_tokens`，其他兼容接口用 `max_tokens`。`effort` 不发送。
- 非 Anthropic 的 provider 永远不会读 `ANTHROPIC_API_KEY`，非 OpenAI 的也不会带上 `OPENAI_ORG_ID` 等变量，密钥不会发给别家。
- `run.json` 的 `params` 记录 `provider`、`protocol`、`model` 和用量；`effort` 只在真的发送了时才记录。

- `anthropic` protocol: Claude-only parameters (server-side fallback, `effort`) are sent only to Anthropic's own API (`api.anthropic.com`). Compatible third-party endpoints get a plain messages request, with the key in both `Authorization: Bearer` and `x-api-key`.
- `openai` protocol: streamed Chat Completions. OpenAI's own API gets `max_completion_tokens`; compatible servers get `max_tokens`. `effort` is not sent.
- A non-Anthropic provider never reads `ANTHROPIC_API_KEY`, and a non-OpenAI provider never picks up `OPENAI_ORG_ID` and similar variables, so a key is never sent to another vendor.
- `params` in `run.json` records `provider`, `protocol`, `model` and usage; `effort` is recorded only when it was actually sent.

注意：智谱的 GLM Coding Plan 额度只能在它列出的工具里用（见[官方说明](https://docs.bigmodel.cn/cn/coding-plan/overview)），Flowgit 调用 `glm` 用的是普通 API 余额和普通 API key。

Note: Zhipu's GLM Coding Plan quota only applies inside the tools Zhipu lists ([official docs](https://docs.bigmodel.cn/cn/coding-plan/overview)); Flowgit's `glm` provider uses regular API balance and a regular API key.

代理：`flowgit run` 和 `flowgit board` 调用模型和服务时会走代理。先看 `HTTPS_PROXY`、`HTTP_PROXY`（以及 Node 本身不读的 `ALL_PROXY`），没有的话用 Windows 或 macOS 的系统代理。本机地址（`localhost`、`127.0.0.1`、`::1`）不走代理，除非你自己设了 `NO_PROXY`。Node 只能用 http 代理，`socks5://` 用不了。Node 24.14 以上在进程里直接切换；Node 22.21 以上会带着 `NODE_USE_ENV_PROXY=1` 把命令重新启动一次，脚本和 agent 阶段看到的仍是你原来的环境变量。设置 `FLOWGIT_PROXY=off` 可以关掉。连不上时，报错会说明这次走的是哪个代理。

Proxies: when `flowgit run` and `flowgit board` call models and services, they go through a proxy: `HTTPS_PROXY` or `HTTP_PROXY` first (and `ALL_PROXY`, which Node itself doesn't read), otherwise the Windows or macOS system proxy. Local addresses (`localhost`, `127.0.0.1`, `::1`) skip the proxy unless you set `NO_PROXY` yourself. Node can only use http proxies, not `socks5://`. Node 24.14+ switches in-process; Node 22.21+ starts the command once more with `NODE_USE_ENV_PROXY=1`, and script and agent stages still see your own environment. Set `FLOWGIT_PROXY=off` to turn this off. When a request can't connect, the error says which proxy it went through.

`timeoutSec`（可选，整数，至少为 1）在 `script` 和 `agent` 上的行为如下。不写表示不限时。`service`、`mcp`、`plugin` 和 `image` 各自的超时见上面的执行器说明。到了这个秒数，Flowgit 停掉整棵进程树，而不是只停掉外壳：macOS 和 Linux 上命令单独成一个进程组，先对进程组发 `SIGTERM`，5 秒后还在就发 `SIGKILL`；Windows 上用 `taskkill /pid <pid> /T /F`。这次运行记为失败，错误是 `超时（N 秒），已停止 / Timed out after Ns and was stopped`。父进程如果收到 `SIGINT`、`SIGTERM` 或 `SIGHUP`，也会把同一个信号转给这个进程组再退出。`timeoutSec` 属于执行器配置，改了它，这个阶段和下游都会变成 `stale`。

`timeoutSec` (optional integer, minimum 1) behaves as follows on `script` and `agent`. Unset means no limit. `service`, `mcp`, `plugin` and `image` document their own timeouts above. When it elapses, Flowgit stops the whole process tree, not just the shell: on macOS and Linux the command runs in its own process group and gets `SIGTERM`, then `SIGKILL` if it is still alive after 5 seconds; on Windows, `taskkill /pid <pid> /T /F`. The run is recorded as failed with `超时（N 秒），已停止 / Timed out after Ns and was stopped`. If the parent receives `SIGINT`, `SIGTERM`, or `SIGHUP`, it forwards that signal to the process group and then exits. `timeoutSec` is part of the executor config, so changing it marks this stage and everything downstream `stale`.

script 和 agent 阶段运行时可以读到这些环境变量 / Environment variables for script and agent stages:

| 变量 / Variable | 内容 | Content |
| --- | --- | --- |
| `FLOWGIT_PROJECT_DIR` | 流程目录的绝对路径 | Absolute path of the flow directory |
| `FLOWGIT_STAGE` / `FLOWGIT_STAGE_NAME` | 阶段 id / 名称 | Stage id / name |
| `FLOWGIT_INPUTS` | JSON：上游产物 `[{stage, path, type}]` | JSON: upstream artifacts `[{stage, path, type}]` |
| `FLOWGIT_OUTPUTS` | JSON：本阶段应写出的产物 `[{path, type}]` | JSON: the outputs this stage must write `[{path, type}]` |
| `FLOWGIT_FLOW_INPUTS` | JSON：流程输入的值 | JSON: the flow input values |
| `FLOWGIT_PROMPT_FILE` | 只有 agent 阶段：渲染好的提示词文件路径 | agent stages only: path of the rendered prompt file |

### agent 执行器 / The agent executor

```json
{ "type": "agent", "agent": "claude-code", "prompt": "prompts/research.md" }
{ "type": "agent", "agent": "custom", "prompt": "prompts/research.md", "command": "my-agent --prompt-file {{promptFile}}" }
```

运行时 Flowgit 会：

1. 读取 `prompt` 指向的文件，替换 `{{inputs.*}}`，再在后面附上上游产物的路径（只读）、本阶段要写出的文件，以及流程输入的值。
2. 在流程目录里启动 agent，把提示词从 stdin 交给它。`custom` 的 `command` 里 `{{promptFile}}` 会换成提示词文件的路径；`FLOWGIT_PROMPT_FILE` 也指向这个文件。
3. agent 退出码不是 0 就记为失败。之后照常检查产物是否写出、存成一个版本。
4. agent 如果改了产物以外的文件（不算 `runs/`、`node_modules/`、`.git/`），会在日志里提醒，并记录在 `run.json` 的 `params.changedOutside`。

When it runs, Flowgit:

1. Reads the file named by `prompt`, fills in `{{inputs.*}}`, and appends the upstream artifact paths (read only), the files this stage must write, and the flow input values.
2. Starts the agent in the flow directory with the prompt on stdin. In a `custom` `command`, `{{promptFile}}` becomes the path of the prompt file; `FLOWGIT_PROMPT_FILE` points to it too.
3. Treats a non-zero exit code as a failure, then checks the outputs and records a version as usual.
4. Notes in the log, and in `params.changedOutside` in `run.json`, any file the agent changed besides its outputs (ignoring `runs/`, `node_modules/` and `.git/`).

内置适配 / Built-in adapters（参数都照官方文档写，链接在 `packages/core/src/executors/agent.ts` / every flag is taken from the official docs, linked in `packages/core/src/executors/agent.ts`）：

| `agent` | 实际命令 / Command | 权限 / Permission | 提示词 / Prompt |
| --- | --- | --- | --- |
| `claude-code` | `claude -p --permission-mode acceptEdits "..."` | 可以在当前目录建立和修改文件；无界面模式下其他需要批准的操作会被拒绝 / creates and edits files in the working directory; other calls that need approval are denied in `-p` runs | stdin |
| `codex` | `codex exec --sandbox workspace-write --skip-git-repo-check -` | 只能在工作区内写入（`exec` 默认只读）/ writes inside the workspace only (`exec` is read-only by default) | stdin（`-`） |
| `cursor` | `agent -p --output-format text "Read runs/.agent/<stage>.prompt.md ..."` | 默认只提出修改、不写文件，见下面 / proposes changes only by default, see below | 提示词文件 / prompt file |
| `gemini` | `gemini --approval-mode auto_edit -p "..."` | 自动批准编辑；其他需要批准的工具在无界面模式下被拒绝 / auto-approves edits; other tools that need approval are denied headless | stdin |
| `custom` | `command` + `args` | 由你的命令决定 / up to your command | stdin 和 / and `{{promptFile}}` |

渲染好的提示词在运行期间放在 `runs/.agent/<stage>.prompt.md`，结束后删除，并完整记录在 `run.json` 的 `params.prompt` 里。

The rendered prompt lives at `runs/.agent/<stage>.prompt.md` while the agent runs, is deleted afterwards, and is kept in full in `params.prompt` in `run.json`.

**Cursor**：官方文档写明，无界面模式不加 `--force` 只会提出修改、不会写文件，而 `--force`（别名 `--yolo`）同时允许执行命令，所以 Flowgit 不会默认加。确认信任这个流程后，在 `args` 里写 `["--force"]`。如果 Cursor 什么都没写出来，Flowgit 会给出这个提示。

**Cursor**: per its docs, headless mode only proposes changes unless `--force` is passed, and `--force` (alias `--yolo`) also allows shell commands, so Flowgit never adds it by default. If you trust the flow, set `args` to `["--force"]`. When Cursor writes nothing, Flowgit tells you this.

**Claude Code**：`-p` 运行时会执行流程目录里 `.claude/settings.json` 的 hooks，并连接 `.mcp.json` 里的服务器，不会弹出信任确认。从别人那里 fork 来的流程，和 `script` 阶段一样，运行前先看过。

**Claude Code**: a `-p` run executes the hooks in the flow directory's `.claude/settings.json` and connects the servers in its `.mcp.json` without a trust prompt. As with `script` stages, review a flow forked from someone else before running it.

`args` 里的参数会加在命令后面，比如指定模型。**安全**：内置适配只给"能在流程目录里写文件"的最小权限，**不会默认加任何跳过所有权限的参数**。如果你在 `args` 里自己加了（例如 Claude Code 的 `--dangerously-skip-permissions`、Codex 的 `--dangerously-bypass-approvals-and-sandbox`、Gemini 的 `--approval-mode yolo`、Cursor 的 `--force`），agent 就能不经确认执行任何命令、改任何文件。只在你信任这个提示词、而且是在隔离环境里时才这样做。从别人那里 fork 来的流程，先看一下它的 `args`。

`args` are appended to the command, e.g. to pick a model. **Safety**: built-in adapters give the agent the least permission that still lets it write files in the flow directory, and **never pass a bypass-all-permissions flag by default**. If you add one yourself in `args` (such as Claude Code's `--dangerously-skip-permissions`, Codex's `--dangerously-bypass-approvals-and-sandbox`, Gemini's `--approval-mode yolo` or Cursor's `--force`), the agent can run any command and change any file without asking. Only do that for a prompt you trust, in an isolated environment. When you fork someone else's flow, check its `args` first.

执行器配置的哈希包含执行器定义本身（所以包含 `timeoutSec`）、`agent`、`command`、`args`、提示词文件，以及 `command` 里提到的、在流程目录中的脚本文件。

The executor config hash covers the executor definition itself (so it includes `timeoutSec`), `agent`, `command`, `args`, the prompt file, and any file in the flow directory named in `command`.

## flow.md

同一个流程也可以写成 Markdown：把 `flow.json` 换成 `flow.md`。一个流程目录里只能有其中一个，两个都有会报错（例外：没有 YAML 头的 `flow.md`，例如以前用 `flowgit graph --out flow.md` 存的图，会被忽略）。`flow.md` 读进来就是和 `flow.json` 完全一样的对象，用同一个 JSON Schema 检查，运行、版本和是否需要重跑都不受影响。

The same flow can be written as Markdown: replace `flow.json` with `flow.md`. A flow directory holds one or the other; both at once is an error (except that a `flow.md` with no YAML frontmatter, such as a diagram saved by an older `flowgit graph --out flow.md`, is ignored). A `flow.md` reads into exactly the object `flow.json` would hold and is checked by the same JSON Schema, so runs, versions and staleness work the same.

| 写在哪 / Where | 对应 / Becomes | 说明 | Notes |
| --- | --- | --- | --- |
| 开头 `---` 之间的 YAML 头 | 流程级字段 | `format`、`version`、`inputs` 等，`stages` 不能写在这里 | Flow fields such as `format`, `version`, `inputs`; not `stages` |
| `# 标题` | `name` | 只能有一个，在第一个阶段前面 | One, before the first stage |
| 标题和第一个阶段之间的正文 | `description` | | |
| `## 阶段名 {#id}` | 一个阶段的 `name` 和 `id` | 按出现顺序 | In order of appearance |
| 阶段里的 ```` ```flowgit ```` 代码块 | 阶段的其余字段 | YAML，字段和 `flow.json` 一样；每个阶段正好一个 | YAML with the same fields as `flow.json`; exactly one per stage |
| 阶段里代码块以外的正文 | 阶段的 `description` | 其他语言的代码块（例如 ```` ```js ````）也算正文 | Code blocks in other languages count as prose |

标题和正文只是简写：每个字段也都可以直接写进 YAML（例如 `## {#notes}` 再在代码块里写 `name:`），但同一个字段不能两边都写。YAML 按 1.2 读，`version` 要加引号写成 `"0.1"`。

Headings and prose are shorthand: any field can go in the YAML instead (e.g. `## {#notes}` with `name:` in the block), but not both ways at once. YAML is read as 1.2; quote `version` as `"0.1"`.

````markdown
---
format: flowgit
version: "0.1"
inputs:
  topic: {type: string, required: true}
---

# 写一篇文章

先列大纲，再写初稿，最后人来审稿。

## 大纲 {#outline}

模型根据题目列出三到五个小节。

```flowgit
executor: {type: llm, prompt: prompts/outline.md}
outputs:
  - {type: text/markdown, path: outline.md}
```

## 人工审稿 {#review}

```flowgit
inputs: [outline]
executor: {type: human, instructions: 改好后保存为 final.md}
outputs:
  - {type: text/markdown, path: final.md}
```
````

`flowgit convert --to md` 和 `flowgit convert --to json` 在两种写法之间转换，转换前会确认新文件读回来和原来完全一样；`flowgit init --format md` 新建流程时直接用 `flow.md`。`stage add`、`stage rm` 和 `init` 写回时保持原来的格式。程序写回 `flow.md` 会按固定格式重新排版，写在 YAML 里的注释不会保留。

`flowgit convert --to md` and `flowgit convert --to json` switch between the two, after checking the new file reads back exactly the same; `flowgit init --format md` starts a flow as `flow.md`. `stage add`, `stage rm` and `init` write back in the file's own format. A `flow.md` written back by a command is laid out in one fixed style, and YAML comments are not kept.

## 运行与版本 / Runs and versions

每次运行一个阶段：

1. 检查上游阶段都有成功的版本，且产物还在。
2. 如果这个阶段的产物被手动改过，先把改动存成一个版本（`executor: "manual"`），手改永远不会被覆盖丢失。
3. 执行。
4. 检查声明的产物都写出来了，把它们复制到 `runs/<stage>/<n>/outputs/`。
5. 写 `runs/<stage>/<n>/run.json`。失败的运行也会记录（`status: "error"`）。

Each run of a stage:

1. Checks that every upstream stage has a successful version and its outputs still exist.
2. If this stage's outputs were edited by hand, saves the edit as its own version first (`executor: "manual"`), so a hand edit is never lost.
3. Runs the executor.
4. Checks every declared output was written and copies them to `runs/<stage>/<n>/outputs/`.
5. Writes `runs/<stage>/<n>/run.json`. Failed runs are recorded too (`status: "error"`).

### 重试 / Retries

`llm` 和 `service` 可以写 `retries`（整数，默认 0），表示失败后再试几次。只重试网络错误（连不上、超时）、HTTP 429 和 5xx。其他 4xx 不重试。产物不符合 JSON Schema 也不走这里，llm 仍按原来的方式修一次。等待时间从 200 毫秒起，每次翻倍，再加 0 到 199 毫秒的随机抖动，最多 30 秒。每一次重试都记在 `run.json` 的 `params.retries` 里：`n`（从 1 起）、`status`（有的话）、`error`（第一行）和 `delayMs`。

`llm` and `service` accept `retries` (an integer, default 0): how many extra attempts to make after a failure. Only network errors (unreachable, timed out), HTTP 429 and 5xx are retried. Other 4xx are not. A JSON Schema failure does not use this; an llm stage still does its own one repair. The wait starts at 200ms, doubles each time, and adds jitter from 0 to 199ms, capped at 30 seconds. Each retry is stored in `params.retries` of `run.json`: `n` (from 1), `status` when there is one, `error` (the first line) and `delayMs`.

### token 预算 / Token budget

`flowgit run all --max-tokens <n>` 给这一次运行一个上限。每要开始一个会调用模型的 llm 阶段之前，把这次运行里已经记下来的输入和输出 token 加起来，大于 `<n>` 就停下，不再开始后面的阶段。已经跑完的版本保留，并打印一行双语说明。等于上限时还不算超过，下一个阶段仍会开始。`FLOWGIT_LLM_MOCK_DIR` 的固定回复不调用模型，也不计入。看板预演和 `run all --dry-run` 会在有阶段可以同时跑时多印一行 `同时运行 / run together: ...`。看板的 `GET /api/plan` 给每个步骤加上 `together`（同一数字的 `run` 会一起开始）。

`flowgit run all --max-tokens <n>` sets a budget for this run. Before each llm stage that would call a model, the input and output tokens already recorded in this run are added up; if they are greater than `<n>`, the run stops and no later stage is started. Finished versions are kept, and one bilingual line is printed. Matching the budget exactly is not over it, so the next stage still starts. Canned replies from `FLOWGIT_LLM_MOCK_DIR` call no model and add nothing. The board preview and `run all --dry-run` print an extra `同时运行 / run together: ...` line when some stages would start together. The board's `GET /api/plan` adds `together` on each step (`run` steps that share a number start together).

回退（`flowgit restore <stage> <n>`，或看板上的"回退"）把 `runs/<stage>/<n>/outputs/` 复制回原位。当前产物如果和任何一个已保存的版本都不一样，说明是手改的，会先存成一个 `manual` 版本再回退。回退后的产物等于一个已保存的版本，所以不算手改：这个阶段不会显示 `edited`，下次运行也不会再存一份；下游因为上游产物变了而变成 `stale`。

Restoring (`flowgit restore <stage> <n>`, or "Restore" on the board) copies `runs/<stage>/<n>/outputs/` back in place. If the current outputs match no saved version, they are a hand edit and are saved as a `manual` version before the restore. Restored outputs equal a saved version, so they are not a hand edit: the stage does not show as `edited` and the next run does not save another copy; downstream stages become `stale` because their upstream output changed.

`flowgit prune [--keep <n>] [--stage <id>] [--dry-run] [--yes]` 删掉不需要的整个 `runs/<阶段>/<n>/`。每个阶段保留最新的 `--keep` 个版本（默认 5，至少 1），另外保留所有 `executor` 为 `manual` 的版本、产物哈希和当前文件一致的最新一个版本，以及最新一次成功的版本。版本号不会重新使用，下一次运行仍是现有最大编号加一。`--dry-run` 只列出要删除的版本和能腾出的空间（KB / MB / GB）。在终端里会问一次 `[y/N]`；不在终端里，除非加上 `--yes`，否则什么都不删。`runs/` 超过 500 MB 时，`flowgit status` 的最后一行会提示可以用 `flowgit prune` 清理。

`flowgit prune [--keep <n>] [--stage <id>] [--dry-run] [--yes]` deletes whole `runs/<stage>/<n>/` folders that are no longer kept. Each stage keeps its newest `--keep` versions (default 5, minimum 1), plus every version whose `executor` is `manual`, the newest version whose output hashes match the current files, and the newest successful version. Version numbers are never reused: the next run is still one past the highest number. `--dry-run` only lists the versions and the space they would free (KB / MB / GB). A terminal asks once `[y/N]`; outside a terminal nothing is deleted unless `--yes` is passed. When `runs/` is over 500 MB, the last line of `flowgit status` points at `flowgit prune`.

`run.json` 的主要字段：`stage`、`n`、`status`、`executor`、`startedAt`、`finishedAt`、`inputHash`、`inputs`（上游产物和它们的 sha256）、`flowInputs`、`outputs`（路径、类型、sha256、大小）、`params`（provider、模型、用量、命令、`retries` 等）、`log`、`error`。经过 `flowgit serve --mcp` 的运行还有 `via: "mcp"` 和 `client`（MCP 客户端报的名字和版本）。

Main `run.json` fields: `stage`, `n`, `status`, `executor`, `startedAt`, `finishedAt`, `inputHash`, `inputs` (upstream artifacts and their sha256), `flowInputs`, `outputs` (path, type, sha256, size), `params` (provider, model, usage, command, `retries`, ...), `log`, `error`. A run made through `flowgit serve --mcp` also has `via: "mcp"` and `client` (the name and version the MCP client reported).

### 阶段状态 / Stage states

| 状态 / State | 含义 | Meaning |
| --- | --- | --- |
| `never-run` | 还没运行过，上游已就绪 | Not run yet; upstream is ready |
| `waiting-upstream` | 有上游阶段还没有成功的版本 | An upstream stage has no successful version yet |
| `ok` | 最新版本成功，之后上游、配置、产物都没变 | Latest run succeeded; upstream, config and outputs unchanged since |
| `stale` | 上游产物、流程输入、执行器配置（含提示词文件、脚本文件）变了，或者上游本身需要重跑 | Upstream artifacts, flow inputs or executor config (incl. prompt and script files) changed, or an upstream stage itself needs a re-run |
| `edited` | 产物被手动改过：和任何一个成功的版本都不一样（回退到旧版本不算） | Outputs were edited by hand: they match no successful run (restoring an older version does not count) |
| `error` | 最新一次运行失败 | The latest run failed |

`inputHash` 是"上游产物的 sha256 + 流程输入 + 执行器配置"的指纹。执行器配置包括执行器定义本身、llm 的提示词文件，以及 script 命令里出现的、存在于流程目录中的文件（比如 `node scripts/render.mjs` 里的 `scripts/render.mjs`）。`workflow` 且 `engine` 为 `flowgit` 时，还包含子流程的 `flow.json`，以及那份子流程里同样算法算出来的提示词和脚本文件。`mcp` 阶段还包含 `mcpServers` 里对应服务器的配置（不含 `env` 的值）、`tool` 和 `args`。`plugin` 阶段还包含 `config`，以及包的 `package.json` 版本（文件夹插件则是其中文件的哈希）。所以改一句提示词、改了子流程、改了 MCP 工具的参数，或者改了插件的 `config` 或文件，这个阶段和它下游的阶段都会变成 `stale`。

`inputHash` fingerprints the upstream artifacts' sha256, the flow inputs, and the executor config. The executor config covers the executor definition itself, an llm stage's prompt file, and any file in the flow directory named in a script command (e.g. `scripts/render.mjs` in `node scripts/render.mjs`). A `workflow` with `engine: "flowgit"` also includes the sub-flow's `flow.json` and, by the same hash, the prompt and script files that sub-flow names. An `mcp` stage also includes that server's `mcpServers` entry with the env values removed, plus `tool` and `args`. A `plugin` stage also includes `config` and the package's `package.json` version (a hash of its files, for a folder plugin). So changing one line of a prompt, changing the sub-flow, changing an MCP tool's arguments, or changing a plugin's `config` or files marks that stage and everything downstream as `stale`.

### 对比版本 / Diffing versions

`flowgit diff <stage> <a> [b] [--json]` 对比 `runs/<stage>/<a>/outputs/` 和 `runs/<stage>/<b>/outputs/`。省略 `b` 时，拿版本 `a` 和流程目录里的当前文件比。版本不存在时报错，中文在前。

对这个阶段声明的每一个产物：

- 文本（`isTextType` 为真，包括 JSON）：按行的 unified diff。终端里 `+` 行是绿色、`-` 行是红色；设置了 `NO_COLOR`，或者输出不是终端时，不加颜色。
- 二进制：只报告相同或不同，用 sha256 比较，不输出逐行差异。
- 文件夹：列出新增、删除和内容变了的文件（相对该文件夹的路径）。

`@flowgit/core` 导出 `diffRuns(dir, flow, stageId, a, b?)`，和 `listRuns`、`restoreStage` 一样从包的入口导出。看板的历史直接调用这三个函数：`GET /api/runs?stage=` 是 `listRuns`，`GET /api/diff?stage=&a=&b=` 是 `diffRuns`，`POST /api/restore` 的 JSON 正文 `{ "stage", "n" }` 是 `restoreStage`（先保存手改，再调用 `restoreRun`；运行中返回 409）。省略 `b` 时和当前文件比。这三个接口和别的 `/api/*` 一样要带请求头 `X-Flowgit-Token`。`b` 省略时，返回值里的 `b` 是 `null`，表示当前文件。

`flowgit diff <stage> <a> [b] [--json]` compares `runs/<stage>/<a>/outputs/` with `runs/<stage>/<b>/outputs/`. Omit `b` to compare version `a` with the files currently in the flow directory. A missing version is an error, Chinese first.

For each output the stage declares:

- Text (`isTextType`, which includes JSON): a line-based unified diff. In a terminal, `+` lines are green and `-` lines are red; color is off when `NO_COLOR` is set or stdout is not a terminal.
- Binary: same or different only, compared by sha256, with no line diff.
- Directory: lists of added, removed and changed files (paths relative to that directory).

`@flowgit/core` exports `diffRuns(dir, flow, stageId, a, b?)` from the package entry, the same way it exports `listRuns` and `restoreStage`. The board's history calls these three functions directly: `GET /api/runs?stage=` is `listRuns`, `GET /api/diff?stage=&a=&b=` is `diffRuns`, and `POST /api/restore` with JSON `{ "stage", "n" }` is `restoreStage` (keeps a hand edit, then calls `restoreRun`; 409 during a run). Omit `b` to compare with the current files. Those routes require the `X-Flowgit-Token` header, like every other `/api/*` route. When `b` is omitted, the result's `b` is `null`, meaning the current files.

## 导出为 Skill / Export as a Skill

`flowgit export-skill` 根据 `flow.json`（或 `flow.md`）生成一个 `SKILL.md`，让 Claude Code 等会读 Skill 的 AI 工具不需要界面也能按阶段跑完这个流程。Flow 和 Skill 不是二选一：Flow 是人和 AI 共用的、可视化的、有版本的流程；Skill 是它给 AI 看的那一面。

`flowgit export-skill` generates a `SKILL.md` from `flow.json` (or `flow.md`), so AI tools that read Skills, such as Claude Code, can run the flow stage by stage without a UI. Flows and Skills are not either/or: a Flow is the visual, versioned process shared by people and AI; the Skill is the side of it that an AI reads.

## 以后的版本 / Planned

- v0.2：剪辑阶段输出 OpenTimelineIO（`.otio`）；`flowgit pack` 打包分享。`workflow` 的其他引擎（ComfyUI、n8n）仍是预留。
- 之后：把整条流程暴露成 MCP 服务供别人调用。

- v0.2: the edit stage emits OpenTimelineIO (`.otio`); `flowgit pack` for sharing. Other `workflow` engines (ComfyUI, n8n) stay reserved.
- Later: exposing a whole flow as an MCP service others can call.
