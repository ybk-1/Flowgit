# 插件 / Plugins

`plugin` 执行器在本进程里加载一个插件，调用它的 `executor.run`。插件自己写出这个阶段声明的产物。

A `plugin` executor loads a plugin in this process and calls its `executor.run`. The plugin writes the outputs the stage declared.

插件和 `script` 一样，是会在你电脑上执行的代码。从别处复制来的流程，运行前先看 `init` 列出来的插件名字和解析位置。从 Git 地址复制来的流程，第一次运行前要确认（`flowgit trust`，或 `run` 时的询问）；确认之前不会加载插件。

A plugin is code that runs on your machine, the same as a `script`. Before running a flow copied from somewhere else, read the plugin names and resolved paths that `init` lists. A flow copied from a Git URL must be confirmed before its first run (`flowgit trust`, or the question `run` asks); no plugin is loaded until then.

## 执行器 / The executor

```json
{
  "type": "plugin",
  "plugin": "./plugins/echo",
  "config": { "prefix": "echo: " },
  "timeoutSec": 30
}
```

`plugin` 二选一：

- 包名，例如 `echo-plugin` 或 `@scope/echo`。只用 `createRequire(<流程目录>/package.json)` 从**这个流程目录的** `node_modules` 解析。不查上级目录，不查全局，也不自动安装。没装就失败，错误里会提示在流程目录运行 `npm install <包名>`。
- `./` 开头的相对路径，必须留在流程目录内。`../outside` 这种路径在 `flowgit validate` 就会失败。

`config` 是一个 JSON 对象，原样放进 `ctx.config`。不写就是 `{}`。

`timeoutSec`（可选，整数，至少为 1）到点就让 `ctx.signal` 中止，这次运行记为失败，错误是 `超时（N 秒），已停止 / Timed out after Ns and was stopped`。不写表示不限时，`signal` 不会中止。

`plugin` is one of:

- A package name, such as `echo-plugin` or `@scope/echo`. It is resolved only from **this flow directory's** `node_modules`, via `createRequire(<flowDir>/package.json)`. There is no parent-directory lookup, no global lookup, and no auto-install. A missing package fails with a hint to run `npm install <name>` in the flow directory.
- A relative path starting with `./` that stays inside the flow directory. A path such as `../outside` fails `flowgit validate`.

`config` is a JSON object, passed through as `ctx.config`. Omit it for `{}`.

`timeoutSec` (optional integer, minimum 1) aborts `ctx.signal` when it elapses and fails the run with `超时（N 秒），已停止 / Timed out after Ns and was stopped`. Unset means no limit, and `signal` does not abort.

## 契约 / Contract

插件是一个 ESM（或 CommonJS）模块，**默认导出**：

A plugin is an ESM (or CommonJS) module. Its **default export** is:

```js
{
  flowgitPlugin: 1,
  name: "echo",
  executor: {
    async run(ctx) {
      // ...
    },
  },
}
```

`flowgitPlugin` 必须是数字 `1`。别的值（包括没写）会失败，并请你升级 Flowgit 或这个插件。`name` 是非空字符串。`executor.run` 可以是同步函数，也可以返回 Promise。

`ctx` 是 `@flowgit/core` 导出的稳定类型 `PluginContext`：

`flowgitPlugin` must be the number `1`. Any other value, including a missing one, fails and asks you to upgrade Flowgit or the plugin. `name` is a non-empty string. `executor.run` may be sync or return a Promise.

`ctx` is the stable `PluginContext` type exported by `@flowgit/core`:

| 字段 / Field | 说明 | Description |
| --- | --- | --- |
| `flowDir` | 流程目录的绝对路径 | Absolute path of the flow directory |
| `stage` | `{ id, name, description?, inputs?, outputs }`。`outputs[].path` 是相对路径 | `{ id, name, description?, inputs?, outputs }`. `outputs[].path` is relative |
| `config` | `executor.config`，没有就是 `{}` | `executor.config`, or `{}` |
| `inputs` | 这次运行的流程输入 | Flow input values for this run |
| `upstream` | `{ paths, read(rel) }`。`paths` 是上游产物的相对路径；`read` 按 UTF-8 返回文本。只能读这些路径 | `{ paths, read(rel) }`. `paths` are relative paths of upstream outputs; `read` returns UTF-8 text. Only those paths can be read |
| `writeOutput(rel, data)` | 写这个阶段声明的产物。`data` 是字符串或 `Uint8Array`。目录产物可以写里面的文件 | Write one of this stage's declared outputs. `data` is a string or `Uint8Array`. A directory output accepts a file inside it |
| `log(line)` | 往这次运行的日志加一行 | Append a line to this run's log |
| `signal` | `AbortSignal`。设置了 `timeoutSec` 时到点中止 | `AbortSignal`. Aborted when `timeoutSec` elapses |

插件抛错时，阶段记为失败，错误里带插件的 `name`。

If the plugin throws, the stage is recorded as failed and the error includes the plugin's `name`.

插件**不要** import `@flowgit/core` 的内部模块（`packages/core/src` 下面的文件）。运行时只使用传进来的 `ctx`。写 TypeScript 时可以从 `@flowgit/core` 引进类型 `PluginContext`，那是公开的稳定接口，不是内部实现。

A plugin **must not** import Flowgit's internal modules (files under `packages/core/src`). At run time it only uses the `ctx` it is given. TypeScript may import the `PluginContext` type from `@flowgit/core`; that public type is the stable contract, not an internal module.

## 最小插件 / A minimal plugin

下面就是 [`examples/plugin-echo`](../examples/plugin-echo) 里的插件。目录 `plugins/echo/` 放 `package.json`（`"type": "module"`，`"main": "index.js"`）和 `index.js`，没有依赖。

This is the plugin in [`examples/plugin-echo`](../examples/plugin-echo). The folder `plugins/echo/` holds a `package.json` (`"type": "module"`, `"main": "index.js"`) and `index.js`, with no dependencies.

```json
{
  "name": "echo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "index.js"
}
```

```js
// Prefix upstream text and write this stage's output.
// A plugin must not import Flowgit internals. It only uses the ctx argument.
export default {
  flowgitPlugin: 1,
  name: "echo",
  executor: {
    async run(ctx) {
      const prefix = typeof ctx.config.prefix === "string" ? ctx.config.prefix : "";
      const text = ctx.upstream.paths.map((rel) => ctx.upstream.read(rel)).join("\n");
      const output = ctx.stage.outputs[0];
      if (!output) throw new Error("echo 需要一个产物 / echo needs one output");
      ctx.log(`加上前缀 / prefixing ${ctx.upstream.paths.length} file(s)`);
      ctx.writeOutput(output.path, `${prefix}${text}`);
    },
  },
};
```

阶段写成：

The stage is:

```json
{
  "type": "plugin",
  "plugin": "./plugins/echo",
  "config": { "prefix": "echo: " }
}
```

CommonJS 也可以：`module.exports = { flowgitPlugin: 1, name, executor }`。

CommonJS works too: `module.exports = { flowgitPlugin: 1, name, executor }`.

## 是否需要重跑 / Staleness

执行器配置的哈希包含 `config`。包插件再算上它 `package.json` 的 `version`。文件夹插件（`./` 路径）不算版本号，而是算目录里文件的哈希（单个文件就哈希那个文件）。改 `config`、改版本，或改文件夹里的文件，这个阶段和下游都会变成 `stale`。

The executor config hash includes `config`. A package plugin also includes the `version` in its `package.json`. A folder plugin (a `./` path) does not use the version; it hashes the files in the folder (or that one file, when `plugin` points at a file). Changing `config`, the version, or a file in the folder marks this stage and everything downstream `stale`.

## 查看 / Inspecting

`flowgit doctor` 和 `flowgit plugins` 列出用到的插件、解析到的路径和版本。没找到的会标出来；包没装时提示 `npm install <包名>`。`flowgit plugins --json` 打印同样的内容。

`init` 从别的目录或 Git 地址复制流程时，也会列出插件名字和解析位置，和命令、agent、服务、MCP 服务器放在一起。

`flowgit doctor` and `flowgit plugins` list the plugins in use, the resolved path and the version. Missing ones are marked; a missing package hints `npm install <name>`. `flowgit plugins --json` prints the same information.

When `init` copies a flow from another directory or a Git URL, it lists plugin names and where they resolve, next to the commands, agents, services and MCP servers.

子流程里的插件，`flowgit doctor` 会跟着子流程一起检查。`flowgit plugins` 列出当前这份流程文件里的插件阶段。

Plugins inside a sub-flow are checked by `flowgit doctor` along with that sub-flow. `flowgit plugins` lists the plugin stages in the current flow file.
