# MCP 执行器 / The MCP executor

`mcp` 阶段调用一个 [MCP](https://modelcontextprotocol.io) 工具，把结果写进这个阶段唯一的产物。服务器写在 `flow.json`（或 `flow.md` 的 YAML 头）顶层的 `mcpServers` 里，写法和 Claude Desktop、Cursor 一样。

An `mcp` stage calls a tool on an [MCP](https://modelcontextprotocol.io) server and writes the result to that stage's single output. Servers are declared in the top-level `mcpServers` of `flow.json` (or the YAML frontmatter of `flow.md`), in the same shape Claude Desktop and Cursor use.

## 服务器 / Servers

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

## 阶段 / The stage

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

## 产物 / Outputs

一个阶段只能有一个产物。

A stage has exactly one output.

| 产物 / Output | 写什么 / What is written |
| --- | --- |
| 文本（`text/*` 等）/ text | 每一段 `type: "text"` 用空行拼起来 / every `type: "text"` item, joined with a blank line |
| JSON（`application/json` 或以 `.json` 结尾） | `structuredContent`；工具没有这个字段时，写入原来的 `content` 数组 / `structuredContent`, or the raw `content` array when the tool did not send it |
| 目录（路径以 `/` 结尾，或 `type` 为 `dir`）/ directory | `image` / `audio` 按出现顺序存成 `001.png`、`002.wav` 这样的文件，文字存成 `result.md` / `image` and `audio` items in order as `001.png`, `002.wav`, …, and text as `result.md` |

工具返回 `isError: true` 时，这次运行失败，错误信息是工具返回的文字。

When the tool returns `isError: true`, the run fails and the error is the tool's text.

## 超时和日志 / Timeout and logs

超时先用阶段上的 `timeoutSec`，没写就是 60 秒。到点就停掉 stdio 子进程。子进程的 stderr 记进 `runs/<阶段>/<n>/run.json` 的 `log`。

The timeout is the stage's `timeoutSec`, or 60 seconds when it is omitted. At the deadline the stdio child is killed. The child's stderr is stored in the `log` of `runs/<stage>/<n>/run.json`.

## 什么时候要重跑 / When a stage goes stale

哈希包含这个服务器在 `mcpServers` 里的配置（`env` 只保留变量名，不保留值）、`tool` 和 `args`。改了参数、命令或 URL，阶段变成 `stale`。只换密钥的值不会。

The hash includes that server's `mcpServers` entry with env values removed (the variable names stay), plus `tool` and `args`. Changing the arguments, the command or the URL marks the stage `stale`. Changing only a secret's value does not.

## 运行前看一眼 / Look before you run

`flowgit doctor` 检查 stdio 的 `command` 在不在 PATH 上，以及每个 `${变量名}` 有没有设置。从别处 `init` 来的流程会列出将要启动的命令或 URL。从 Git 地址复制来的流程，第一次运行前要确认这份清单（`flowgit trust`，或 `run` 时的询问）；确认之前不会启动服务器。

`flowgit doctor` checks that a stdio `command` is on PATH and that every `${VAR}` is set. A flow you `init` from somewhere else lists the command or URL it would start. A flow copied from a Git URL must confirm that list before its first run (`flowgit trust`, or the question `run` asks); no server starts until then.

```bash
flowgit doctor
flowgit mcp tools files
flowgit run list --input dir=.
```

不联网就能试的例子：[`examples/mcp-echo`](../examples/mcp-echo)。它自带一个假的 stdio 服务器，把 `{{inputs.text}}` 写进 `echo.md`。

An example that needs no network: [`examples/mcp-echo`](../examples/mcp-echo). It ships a fake stdio server and writes `{{inputs.text}}` to `echo.md`.
