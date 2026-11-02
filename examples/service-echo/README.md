# 服务回声 / Service echo

一个最小的 `service` 示例：人写 `note.md`，下一步把它 POST 给一个 HTTP 服务，把返回的 JSON 存成 `echo.json`。

A minimal `service` example: a person writes `note.md`, the next stage POSTs it to an HTTP service, and the JSON reply is saved as `echo.json`.

请求头 `Authorization` 写成 `Bearer {{env.ECHO_TOKEN}}`。运行前要设置 `ECHO_TOKEN`，密钥不会写进任何文件。`timeoutSec` 是 30，默认是 60。

The `Authorization` header is `Bearer {{env.ECHO_TOKEN}}`. Set `ECHO_TOKEN` before the run; the key is never written to a file. `timeoutSec` is 30; the default is 60.

把 `url` 换成你自己的接口（自己的服务、n8n 或 Dify 的 webhook 都行）。`flowgit doctor` 会检查 `ECHO_TOKEN` 有没有设置，`flowgit run all --dry-run` 会把这一步标成会运行。

Point `url` at your own API, including an n8n or Dify webhook. `flowgit doctor` checks that `ECHO_TOKEN` is set, and `flowgit run all --dry-run` lists this stage as one that would run.

```bash
export ECHO_TOKEN=...          # PowerShell: $env:ECHO_TOKEN="..."
flowgit doctor
flowgit run all --dry-run --input topic=hello
```
