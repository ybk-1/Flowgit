# MCP

Flowgit 和 MCP 有两种关系：流程里的 `mcp` 阶段调用别人的 MCP 工具（下面先讲），`flowgit serve --mcp` 把你的流程变成 MCP 服务器给别的 AI 工具调用（见[把流程变成 MCP 服务器](#把流程变成-mcp-服务器--serve-a-flow-as-an-mcp-server)）。

Flowgit works with MCP both ways: an `mcp` stage in a flow calls someone else's MCP tool (first below), and `flowgit serve --mcp` turns your flow into an MCP server that other AI tools call (see [Serve a flow as an MCP server](#把流程变成-mcp-服务器--serve-a-flow-as-an-mcp-server)).

## MCP 执行器 / The MCP executor

`mcp` 阶段调用一个 [MCP](https://modelcontextprotocol.io) 工具，把结果写进这个阶段唯一的产物。服务器写在 `flow.json`（或 `flow.md` 的 YAML 头）顶层的 `mcpServers` 里，写法和 Claude Desktop、Cursor 一样。

An `mcp` stage calls a tool on an [MCP](https://modelcontextprotocol.io) server and writes the result to that stage's single output. Servers are declared in the top-level `mcpServers` of `flow.json` (or the YAML frontmatter of `flow.md`), in the same shape Claude Desktop and Cursor use.

### 服务器 / Servers

本机 stdio：Flowgit 在流程目录里启动 `command`，参数是 `args`。远程：`url` 走 Streamable HTTP，只允许 `http` 和 `https`。

Local stdio: Flowgit starts `command` in the flow directory, with `args`. Remote: `url` is Streamable HTTP, and only `http` and `https` are allowed.

```json
{
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    },
    "remote": { "url": "https://example.com/mcp" }
  }
}
```

`env` 的每个值必须整段都是 `${变量名}`。运行时从环境变量读取，不写进 `flow.json`、`run.json` 或日志。写成别的内容（包括把密钥直接放进去）时，`flowgit validate` 报错。

Every `env` value must be the whole string `${VAR}`. It is read from the environment when the stage runs, and it is not written to `flow.json`, `run.json` or the log. Anything else, including a literal secret, is a validation error.

```json
"env": { "API_KEY": "${API_KEY}" }
```

`server` 必须是 `mcpServers` 里的一个名字，`flowgit validate` 会检查。

`server` must name an entry in `mcpServers`. `flowgit validate` checks that.

### 阶段 / The stage

```json
{
  "id": "list",
  "name": "列出文件",
  "executor": {
    "type": "mcp",
    "server": "files",
    "tool": "list_directory",
    "args": { "path": "{{inputs.dir}}" },
    "timeoutSec": 30
  },
  "outputs": [{ "type": "text/markdown", "path": "files.md" }]
}
```

`@modelcontextprotocol/server-filesystem` 的工具名以服务器实际公布的为准。先跑 `flowgit mcp tools files`，再把 `tool` 写成它列出来的名字（常见的有 `list_directory`、`read_file`）。`server-everything` 用来试调用。

Tool names on `@modelcontextprotocol/server-filesystem` are whatever that server advertises. Run `flowgit mcp tools files` first, then set `tool` to a name it lists (`list_directory` and `read_file` are the usual ones). `server-everything` is handy for trying a call.

`args` 里的字符串可以写：

- `{{inputs.名称}}`：流程输入，和提示词用的是同一个替换。
- `{{upstream.<阶段 id>}}`：那个阶段第一个产物的相对路径。
- `{{upstream.<阶段 id>.content}}`：那个产物的文本。

Strings in `args` may contain:

- `{{inputs.name}}`: a flow input, using the same replacement as prompts.
- `{{upstream.<stageId>}}`: the relative path of that stage's first output.
- `{{upstream.<stageId>.content}}`: the text of that output.

### 产物 / Outputs

一个阶段只能有一个产物。

A stage has exactly one output.

| 产物 / Output | 写什么 / What is written |
| --- | --- |
| 文本（`text/*` 等）/ text | 每一段 `type: "text"` 用空行拼起来 / every `type: "text"` item, joined with a blank line |
| JSON（`application/json` 或以 `.json` 结尾） | `structuredContent`；工具没有这个字段时，写入原来的 `content` 数组 / `structuredContent`, or the raw `content` array when the tool did not send it |
| 目录（路径以 `/` 结尾，或 `type` 为 `dir`）/ directory | `image` / `audio` 按出现顺序存成 `001.png`、`002.wav` 这样的文件，文字存成 `result.md` / `image` and `audio` items in order as `001.png`, `002.wav`, …, and text as `result.md` |

工具返回 `isError: true` 时，这次运行失败，错误信息是工具返回的文字。

When the tool returns `isError: true`, the run fails and the error is the tool's text.

### 超时和日志 / Timeout and logs

超时先用阶段上的 `timeoutSec`，没写就是 60 秒。到点就停掉 stdio 子进程。子进程的 stderr 记进 `runs/<阶段>/<n>/run.json` 的 `log`。

The timeout is the stage's `timeoutSec`, or 60 seconds when it is omitted. At the deadline the stdio child is killed. The child's stderr is stored in the `log` of `runs/<stage>/<n>/run.json`.

### 什么时候要重跑 / When a stage goes stale

哈希包含这个服务器在 `mcpServers` 里的配置（`env` 只保留变量名，不保留值）、`tool` 和 `args`。改了参数、命令或 URL，阶段变成 `stale`。只换密钥的值不会。

The hash includes that server's `mcpServers` entry with env values removed (the variable names stay), plus `tool` and `args`. Changing the arguments, the command or the URL marks the stage `stale`. Changing only a secret's value does not.

### 运行前看一眼 / Look before you run

`flowgit doctor` 检查 stdio 的 `command` 在不在 PATH 上，以及每个 `${变量名}` 有没有设置。从别处 `init` 来的流程会列出将要启动的命令或 URL。从 Git 地址复制来的流程，第一次运行前要确认这份清单（`flowgit trust`，或 `run` 时的询问）；确认之前不会启动服务器。

`flowgit doctor` checks that a stdio `command` is on PATH and that every `${VAR}` is set. A flow you `init` from somewhere else lists the command or URL it would start. A flow copied from a Git URL must confirm that list before its first run (`flowgit trust`, or the question `run` asks); no server starts until then.

```bash
flowgit doctor
flowgit mcp tools files
flowgit run list --input dir=.
```

不联网就能试的例子：[`examples/mcp-echo`](../examples/mcp-echo)。它自带一个假的 stdio 服务器，把 `{{inputs.text}}` 写进 `echo.md`。

An example that needs no network: [`examples/mcp-echo`](../examples/mcp-echo). It ships a fake stdio server and writes `{{inputs.text}}` to `echo.md`.

## 把流程变成 MCP 服务器 / Serve a flow as an MCP server

`flowgit serve --mcp [目录]` 在 stdio 上启动一个 MCP 服务器。Claude Code、Claude Desktop、Cursor 这类客户端连上以后，就能直接运行这个流程。服务器只在本机运行，由客户端启动，不开网络端口。

`flowgit serve --mcp [dir]` starts an MCP server over stdio. Once a client such as Claude Code, Claude Desktop or Cursor connects, it can run the flow directly. The server is local only: the client starts it, and it opens no network port.

### 工具 / Tools

| 工具 / Tool | 做什么 / What it does |
| --- | --- |
| `run_flow` | 参数就是流程输入（从 `inputs` 生成 JSON Schema，带上 `enum`、`default` 和说明；已经有值的必填输入可以不传）。和 `flowgit run all` 一样从头跑，已是最新的阶段跳过，停在等人的阶段。返回每个阶段的状态，以及最后一层阶段（没有别的阶段读它）的产物。/ Its parameters are the flow inputs (a JSON Schema from `inputs`, with `enum`, `default` and descriptions; a required input that already has a value may be left out). Runs like `flowgit run all`: skips stages that are up to date and stops at a stage waiting for a person. Returns every stage's state and the outputs of the last stages (the ones no other stage reads). |
| `run_stage` | 重跑一个阶段（`stage`），可带 `inputs`。人工阶段可以用 `files`（产物路径 → 文字）直接给内容。/ Re-runs one stage (`stage`), optionally with `inputs`. A human stage can take `files` (output path → text) for its content. |
| `get_output` | 读一个阶段现在的产物；可只读一个 `path`。/ Reads a stage's current outputs, or one `path`. |
| `status` | 和 `flowgit status --json` 一样。/ The same as `flowgit status --json`. |

文本产物不超过 100 KB 时直接返回文字；更大的文件、二进制文件和文件夹只返回路径（`absPath`）和大小。工具结果第一行是一句双语说明，下面是 JSON。

A text output up to 100 KB comes back as text; bigger files, binary files and folders come back as a path (`absPath`) and size. Each tool result starts with one bilingual line, followed by JSON.

一次调用里给的流程输入只在这个服务器运行期间记住，供后面的调用使用，不写进 `flowgit.local.json`。同一时间只跑一次，忙的时候调用会返回错误。

Flow inputs given in a call are remembered for later calls while this server runs, and are not written to `flowgit.local.json`. One run at a time; a call made meanwhile returns an error.

### 人工阶段 / Human stages

跑到人工阶段时，`run_flow` 返回 `status: "waiting"`，写明是哪个阶段、`instructions`，以及要准备的文件和它们的绝对路径。客户端支持 elicitation（表单提问）且缺的都是文本文件时，服务器直接在客户端里问人，填好后写入文件并接着跑；拒绝或取消就返回“等待”。也可以把文件放到列出的位置后再调用 `run_flow`，或者用 `run_stage` 的 `files` 直接给内容。

At a human stage, `run_flow` returns `status: "waiting"` with the stage, its `instructions`, and the files to prepare with their absolute paths. When the client supports elicitation (form questions) and every missing file is text, the server asks the person in the client, writes the answers and keeps going; a decline or cancel returns "waiting". You can also put the files at the listed paths and call `run_flow` again, or pass their text in `run_stage`'s `files`.

### 安全 / Safety

human 和 llm 阶段默认可以运行。流程里有 script、agent、service、mcp、plugin 或 image 阶段（包括子流程里的）时，要用 `--allow-exec` 启动服务器，否则 `run_flow` 返回双语说明并列出这些阶段，什么都不运行。`run_stage` 只看那一个阶段，所以这类流程里的人工阶段和 llm 阶段不加 `--allow-exec` 也能单独运行。

Human and llm stages run by default. When a flow has a script, agent, service, mcp, plugin or image stage (including inside a sub-flow), the server must be started with `--allow-exec`; otherwise `run_flow` returns a bilingual explanation that lists those stages and runs nothing. `run_stage` looks only at its own stage, so the human and llm stages of such a flow can still run one by one without `--allow-exec`.

从 Git 地址复制来、还没确认的流程，`run_flow` 和 `run_stage` 都会拒绝，请先在终端里运行 `flowgit trust`。确认不能通过 MCP 完成。

A flow copied from a Git URL that hasn't been confirmed is refused by both `run_flow` and `run_stage`; run `flowgit trust` in a terminal first. Confirming can't be done over MCP.

### 云端 / In the cloud

云端的流程也可以打开一个远端 MCP 地址，工具相同，用 OAuth 登录授权，见 [docs/cloud.md](cloud.md#远端-mcp--remote-mcp)。

A cloud flow can also turn on a remote MCP URL with the same tools and OAuth sign-in; see [docs/cloud.md](cloud.md#远端-mcp--remote-mcp).

### 记录 / Records

经过 MCP 的每次运行，`run.json` 里多两个字段：`via: "mcp"` 和 `client`（客户端报的名字和版本，例如 `claude-code 2.1.0`）。token 和平时一样记在 `params.usage`，`flowgit log` 照常合计。

Every run made over MCP gets two more fields in `run.json`: `via: "mcp"` and `client` (the name and version the client reported, e.g. `claude-code 2.1.0`). Tokens are in `params.usage` as usual, and `flowgit log` totals them as usual.

### 接入客户端 / Connect a client

`flowgit serve --mcp --print-config` 打印 Claude Code、Claude Desktop 和 Cursor 的配置，已经填好这个流程的目录，以及 llm 阶段要用的密钥变量名。`--allow-exec` 和 `--model` 会一起写进去。

`flowgit serve --mcp --print-config` prints the setup for Claude Code, Claude Desktop and Cursor, filled in with this flow's directory and the key variables its llm stages need. `--allow-exec` and `--model` are carried into it.

```bash
flowgit -C weekly serve --mcp --print-config --model deepseek/deepseek-chat
```

- Claude Code（[文档 / docs](https://code.claude.com/docs/en/mcp)）：打印 `claude mcp add --env 'KEY=${KEY}' --transport stdio <名字> -- <命令>`。单引号让 `${KEY}` 原样存下，Claude Code 启动服务器时才从环境变量展开，密钥不会存进配置。也可以写进项目的 `.mcp.json`。/ Prints `claude mcp add --env 'KEY=${KEY}' --transport stdio <name> -- <command>`. The single quotes keep `${KEY}` as written, so Claude Code expands it from the environment when it starts the server and the key is not stored in its config. The project `.mcp.json` works too.
- Claude Desktop（[文档 / docs](https://modelcontextprotocol.io/docs/develop/connect-local-servers)）：写进 `claude_desktop_config.json`（macOS `~/Library/Application Support/Claude/`，Windows `%APPDATA%\Claude\`）。它不展开环境变量，`<你的密钥>` 要换成真的密钥。/ Goes in `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`). It doesn't expand environment variables, so replace `<your key>` with the key.
- Cursor（[文档 / docs](https://cursor.com/docs/context/mcp)）：写进项目的 `.cursor/mcp.json` 或 `~/.cursor/mcp.json`，密钥写成 `${env:KEY}`。/ Goes in the project's `.cursor/mcp.json` or `~/.cursor/mcp.json`, with the key as `${env:KEY}`.

命令是 `flowgit`（在 PATH 上时），否则是 node 加上这个命令行的绝对路径；Windows 上总用后者，因为 `flowgit.cmd` 不经过命令行解释器就启动不了。

The command is `flowgit` when it is on PATH, otherwise node with this CLI's absolute path; Windows always uses the latter, since `flowgit.cmd` can't start without a shell.

服务器运行时，模型和服务请求和 `flowgit run` 一样走系统代理。stdout 是 MCP 通道，给人看的提示写到 stderr。

While the server runs, model and service requests go through the system proxy like `flowgit run`. stdout is the MCP channel; messages for people go to stderr.
