# 插件回声 / Plugin echo

一个最小的 `plugin` 示例：`plugins/echo` 是纯 JavaScript，没有依赖。它读取上游的 `source.txt`，加上 `config.prefix`，写进 `echo.txt`。

A minimal `plugin` example: `plugins/echo` is plain JavaScript with no dependencies. It reads the upstream `source.txt`, adds `config.prefix`, and writes `echo.txt`.

插件不要 import Flowgit 的内部模块，只用传进来的 `ctx`。契约见 [docs/plugins.md](../../docs/plugins.md)。

The plugin does not import Flowgit internals. It only uses the `ctx` it is given. The contract is in [docs/plugins.md](../../docs/plugins.md).

```bash
printf 'hello\n' > source.txt
flowgit plugins
flowgit run source
flowgit run echo
```

`echo.txt` 的内容是 `echo: hello`。`flowgit doctor` 和 `flowgit plugins` 会列出 `./plugins/echo`、解析到的 `plugins/echo` 和版本 `1.0.0`。

`echo.txt` contains `echo: hello`. `flowgit doctor` and `flowgit plugins` list `./plugins/echo`, the resolved `plugins/echo`, and version `1.0.0`.
