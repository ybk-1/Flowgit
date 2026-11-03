# MCP 回声 / MCP echo

一个最小的 `mcp` 示例：调用本地的假 MCP 服务器（`scripts/fake-mcp.mjs`），把 `{{inputs.text}}` 写进 `echo.md`。不访问网络。

A minimal `mcp` example: it calls a local fake MCP server (`scripts/fake-mcp.mjs`) and writes `{{inputs.text}}` to `echo.md`. It does not use the network.

`mcpServers.echo.env.ECHO_TOKEN` 写成 `${ECHO_TOKEN}`。运行前要设置这个环境变量，密钥不会写进任何文件。`timeoutSec` 是 30，默认是 60。

`mcpServers.echo.env.ECHO_TOKEN` is `${ECHO_TOKEN}`. Set that variable before the run; the key is never written to a file. `timeoutSec` is 30; the default is 60.

`flowgit doctor` 会检查 `node` 在不在 PATH 上、`ECHO_TOKEN` 有没有设置。`flowgit mcp tools echo` 列出这个服务器的工具和参数。

`flowgit doctor` checks that `node` is on PATH and that `ECHO_TOKEN` is set. `flowgit mcp tools echo` lists the server's tools and parameters.

```bash
export ECHO_TOKEN=demo          # PowerShell: $env:ECHO_TOKEN="demo"
flowgit doctor
flowgit mcp tools echo
flowgit run echo --input text=hello
```

把 `command` / `args` 换成真正的服务器（例如 `@modelcontextprotocol/server-filesystem`）就能调用别人的工具。说明见 [docs/mcp.md](../../docs/mcp.md)。

Point `command` / `args` at a real server (for example `@modelcontextprotocol/server-filesystem`) to call someone else's tools. See [docs/mcp.md](../../docs/mcp.md).
