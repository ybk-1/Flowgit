# Flow 格式规范 v0.1 / Flow format spec v0.1

状态：草案。机器可读的版本是 [`packages/core/schema/flow.schema.json`](../packages/core/schema/flow.schema.json)，两者不一致时以 Schema 为准。

Status: draft. The machine-readable source of truth is [`packages/core/schema/flow.schema.json`](../packages/core/schema/flow.schema.json); where the two disagree, the schema wins.

## 一句话 / In one sentence

一个流程 = 一串阶段。每个阶段声明它读什么（上游阶段的产物）、产出什么（文件）、谁来做（执行器）。每次运行一个阶段，都会留下一个可回看、可回退的版本。

A flow is a list of stages. Each stage declares what it reads (upstream artifacts), what it writes (files) and who does the work (an executor). Every run of a stage is kept as a version you can inspect and restore.

## 目录结构 / Layout

```text
my-flow/
├── flow.json              # 流程定义（必需）/ the flow definition (required)
├── prompts/               # llm 阶段的提示词 / prompts for llm stages
├── scripts/               # script 阶段的脚本 / scripts for script stages
├── script.md              # 各阶段的当前产物 / current artifacts of each stage
├── storyboard.json
├── assets/
├── flowgit.local.json     # 本地填写的流程输入，不分享 / local input values, not shared
└── runs/                  # 历史版本，flowgit 自动写入 / version history, written by flowgit
    └── <stage>/<n>/
        ├── run.json       # 这次运行的记录 / the run record
        └── outputs/...    # 产物快照 / snapshot of the outputs
```

**模板和项目是同一个格式。** 去掉 `runs/`、`flowgit.local.json` 和各阶段产物，剩下的就是可以分享、可以 fork 的模板；带上它们就是一个做了一半或做完的项目。

**A template and a project are the same format.** Strip `runs/`, `flowgit.local.json` and the artifacts and you have a shareable, forkable template; keep them and it is a project, half done or finished.

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
| `inputs` | 否 / no | 流程级参数，见下 | Flow-level parameters, see below |
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
| `type` | `string`、`text`、`number`、`boolean`、`file` | One of `string`, `text`, `number`, `boolean`, `file` |
| `description` | 给填写的人看的说明 | Help text for whoever fills it in |
| `default` | 没填时用的值 | Value used when nothing is set |
| `required` | 为 `true` 时，没填就不能运行 | When `true`, runs are refused until it is set |
| `enum` | 允许的取值；填了别的值，运行前就报错 | Allowed values; any other value fails before the run starts |

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

阶段之间不能成环。阶段的运行顺序由 `inputs` 决定，依赖相同时按文件里的顺序。

Stages must not form a cycle. Run order follows `inputs`; ties keep the order in the file.

### output：产物 / Output

```json
{ "type": "flowgit/storyboard+json", "path": "storyboard.json" }
```

- `path`：相对流程目录，不能是绝对路径，不能有 `..`，不能放进 `runs/`。以 `/` 结尾或 `type` 为 `"dir"` 表示文件夹。
- `type`：类 MIME 的类型。`text/*`、`application/json`、`*+json` 和 `flowgit/*` 会被当成文本，交给下游 llm 阶段时直接附上内容；文件夹附上文件列表；其他文件附上路径。
- 同一个路径只能由一个阶段产出。

- `path`: relative to the flow directory; no absolute paths, no `..`, nothing inside `runs/`. A trailing `/` or `type: "dir"` means a folder.
- `type`: a MIME-like type. `text/*`, `application/json`, `*+json` and `flowgit/*` are treated as text and their content is attached for downstream llm stages; a folder attaches its file list; any other file attaches its path.
- Each path can be produced by only one stage.

### executor：执行器 / Executor

| `type` | v0.1 能否运行 / Runs in v0.1 | 字段 / Fields | 说明 | Description |
| --- | --- | --- | --- | --- |
| `human` | 能 / yes | `instructions?` | 由人完成。运行时检查产物是否到位；可用 `--from <path>` 把文件复制进来。缺产物时阶段停下，显示 `instructions` | Done by a person. A run checks the outputs are in place; `--from <path>` copies files in. If outputs are missing the stage stops and shows `instructions` |
| `llm` | 能 / yes | `prompt`, `system?`, `model?`, `effort?`, `maxTokens?` | 读取 `prompt` 指向的 Markdown，替换 `{{inputs.*}}`，把上游产物附在后面，调用模型，把回复写进唯一的产物。产物是 JSON 时自动从回复里提取 JSON。`model` 可写 `<provider>/<model>`（见下面的"模型供应商"），不写前缀就是 Claude。默认模型 `claude-opus-5-5`，优先级：`--model` > `model` > `FLOWGIT_MODEL` > 默认 | Reads the Markdown file named by `prompt`, fills in `{{inputs.*}}`, appends the upstream artifacts, calls the model and writes the reply to the stage's single output. JSON outputs have the JSON extracted from the reply. `model` may be `<provider>/<model>` (see "Model providers" below); no prefix means Claude. Default model `claude-opus-5-5`; precedence: `--model` > `model` > `FLOWGIT_MODEL` > default |
| `script` | 能 / yes | `run`, `cwd?`, `env?` | 在流程目录执行一条 shell 命令。命令自己负责写出产物 | Runs a shell command in the flow directory. The command writes the outputs itself |
| `workflow` | 预留 / reserved | `engine`, `file`, `params?` | 运行外部工作流文件（ComfyUI、n8n 等） | Runs an external workflow file (ComfyUI, n8n, ...) |
| `service` | 预留 / reserved | `url`, `method?` | 调用 HTTP 服务 | Calls an HTTP service |
| `mcp` | 预留 / reserved | `server`, `tool`, `args?` | 调用 MCP 服务器上的工具。以后整个流程也会通过这一层暴露给别人调用 | Calls a tool on an MCP server. Later, whole flows will be exposed to others through this layer |

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
- `run.json` 的 `params` 记录 `provider`、`protocol`、`model` 和用量。

- `anthropic` protocol: Claude-only parameters (server-side fallback, `effort`) are sent only to Anthropic's own API (`api.anthropic.com`). Compatible third-party endpoints get a plain messages request, with the key in both `Authorization: Bearer` and `x-api-key`.
- `openai` protocol: streamed Chat Completions. OpenAI's own API gets `max_completion_tokens`; compatible servers get `max_tokens`. `effort` is not sent.
- A non-Anthropic provider never reads `ANTHROPIC_API_KEY`, and a non-OpenAI provider never picks up `OPENAI_ORG_ID` and similar variables, so a key is never sent to another vendor.
- `params` in `run.json` records `provider`, `protocol`, `model` and usage.

注意：智谱的 GLM Coding Plan 额度只能在它列出的工具里用（见[官方说明](https://docs.bigmodel.cn/cn/coding-plan/overview)），Flowgit 调用 `glm` 用的是普通 API 余额和普通 API key。

Note: Zhipu's GLM Coding Plan quota only applies inside the tools Zhipu lists ([official docs](https://docs.bigmodel.cn/cn/coding-plan/overview)); Flowgit's `glm` provider uses regular API balance and a regular API key.

script 阶段运行时可以读到这些环境变量 / Environment variables for script stages:

| 变量 / Variable | 内容 | Content |
| --- | --- | --- |
| `FLOWGIT_PROJECT_DIR` | 流程目录的绝对路径 | Absolute path of the flow directory |
| `FLOWGIT_STAGE` / `FLOWGIT_STAGE_NAME` | 阶段 id / 名称 | Stage id / name |
| `FLOWGIT_INPUTS` | JSON：上游产物 `[{stage, path, type}]` | JSON: upstream artifacts `[{stage, path, type}]` |
| `FLOWGIT_OUTPUTS` | JSON：本阶段应写出的产物 `[{path, type}]` | JSON: the outputs this stage must write `[{path, type}]` |
| `FLOWGIT_FLOW_INPUTS` | JSON：流程输入的值 | JSON: the flow input values |

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

`run.json` 的主要字段：`stage`、`n`、`status`、`executor`、`startedAt`、`finishedAt`、`inputHash`、`inputs`（上游产物和它们的 sha256）、`flowInputs`、`outputs`（路径、类型、sha256、大小）、`params`（provider、模型、用量、命令等）、`log`、`error`。

Main `run.json` fields: `stage`, `n`, `status`, `executor`, `startedAt`, `finishedAt`, `inputHash`, `inputs` (upstream artifacts and their sha256), `flowInputs`, `outputs` (path, type, sha256, size), `params` (provider, model, usage, command, ...), `log`, `error`.

### 阶段状态 / Stage states

| 状态 / State | 含义 | Meaning |
| --- | --- | --- |
| `never-run` | 还没运行过，上游已就绪 | Not run yet; upstream is ready |
| `waiting-upstream` | 有上游阶段还没有成功的版本 | An upstream stage has no successful version yet |
| `ok` | 最新版本成功，之后上游、配置、产物都没变 | Latest run succeeded; upstream, config and outputs unchanged since |
| `stale` | 上游产物、流程输入、执行器配置（含提示词文件、脚本文件）变了，或者上游本身需要重跑 | Upstream artifacts, flow inputs or executor config (incl. prompt and script files) changed, or an upstream stage itself needs a re-run |
| `edited` | 产物在最新版本之后被手动改过 | Outputs were edited by hand after the latest run |
| `error` | 最新一次运行失败 | The latest run failed |

`inputHash` 是"上游产物的 sha256 + 流程输入 + 执行器配置"的指纹。执行器配置包括执行器定义本身、llm 的提示词文件，以及 script 命令里出现的、存在于流程目录中的文件（比如 `node scripts/render.mjs` 里的 `scripts/render.mjs`）。所以改一句提示词，这个阶段和它下游的阶段都会变成 `stale`。

`inputHash` fingerprints the upstream artifacts' sha256, the flow inputs, and the executor config. The executor config covers the executor definition itself, an llm stage's prompt file, and any file in the flow directory named in a script command (e.g. `scripts/render.mjs` in `node scripts/render.mjs`). So changing one line of a prompt marks that stage and everything downstream as `stale`.

## 导出为 Skill / Export as a Skill

`flowgit export-skill` 根据 `flow.json` 生成一个 `SKILL.md`，让 Claude Code 等会读 Skill 的 AI 工具不需要界面也能按阶段跑完这个流程。Flow 和 Skill 不是二选一：Flow 是人和 AI 共用的、可视化的、有版本的流程；Skill 是它给 AI 看的那一面。

`flowgit export-skill` generates a `SKILL.md` from `flow.json`, so AI tools that read Skills, such as Claude Code, can run the flow stage by stage without a UI. Flows and Skills are not either/or: a Flow is the visual, versioned process shared by people and AI; the Skill is the side of it that an AI reads.

## 以后的版本 / Planned

- v0.2：`workflow`（ComfyUI / n8n）和 `service` 执行器；剪辑阶段输出 OpenTimelineIO（`.otio`）；`flowgit pack` 打包分享。
- 之后：`mcp` 执行器，以及把整条流程暴露成 MCP 服务供别人调用。

- v0.2: `workflow` (ComfyUI / n8n) and `service` executors; the edit stage emits OpenTimelineIO (`.otio`); `flowgit pack` for sharing.
- Later: the `mcp` executor, and exposing a whole flow as an MCP service others can call.
