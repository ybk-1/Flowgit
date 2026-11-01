# @flowgit/core

Flowgit 的核心库：`flow.json` 的 schema 和校验、`runs/<stage>/<n>/` 下的运行历史、过期判断，以及阶段执行器（`human`、`llm`、`script`、`agent`）。命令行工具 [`flowgit`](https://www.npmjs.com/package/flowgit) 就建在它上面。

The Flowgit core library: the `flow.json` schema and validation, run history under `runs/<stage>/<n>/`, staleness, and the stage executors (`human`, `llm`, `script`, `agent`). The [`flowgit`](https://www.npmjs.com/package/flowgit) CLI is built on it.

```js
import { loadFlow, runStage } from "@flowgit/core";
```

JSON Schema: `@flowgit/core/schema/flow.schema.json`

规范和文档见 / Spec and docs: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
