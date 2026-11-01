# 安全 / Security

## 报告漏洞 / Reporting a vulnerability

请不要在公开的 issue 里报告安全问题。仓库公开后，请用 GitHub 的私密漏洞报告（仓库的 Security → Report a vulnerability）。在那之前，请私下联系维护者 [@cgold9820-dotcom](https://github.com/cgold9820-dotcom)。请写清楚影响的版本、复现步骤和可能的影响。

Please don't report security problems in public issues. Once the repository is public, use GitHub's private vulnerability reporting (Security → Report a vulnerability). Until then, contact the maintainer [@cgold9820-dotcom](https://github.com/cgold9820-dotcom) privately. Include the affected version, steps to reproduce and the likely impact.

## 支持的版本 / Supported versions

还在 0.x 阶段，只有最新发布的版本会收到修复。

While Flowgit is at 0.x, only the latest release gets fixes.

## 安全模型 / Security model

- **运行流程就是运行它的代码。** `script` 阶段的命令和 `agent` 阶段启动的 agent，会以你的用户权限在流程目录里运行。只运行你信任的流程；运行别人分享的流程之前，先看一下 `flow.json` 里的命令和它引用的脚本。
- **密钥**只从环境变量读（模型供应商的 `apiKeyEnv`），不会写进 `flow.json`、`runs/` 或任何文件。`providers.json` 里出现 key、token、secret、password 这类字段会直接报错。
- **llm 阶段**会把提示词和上游产物发给你选的模型供应商。不想发给第三方的内容，不要放进流程，或者用本机模型（例如 `ollama`）。
- **agent 执行器**的内置适配只给"能在流程目录里写文件"的最小权限，永远不默认加跳过所有权限的参数。你自己在 `args` 里加的参数由你负责。
- **本地看板**（开发中）只监听 `127.0.0.1`，每次启动生成随机 token，并检查 `Host` 请求头。

- **Running a flow runs its code.** Commands in `script` stages and the agents started by `agent` stages run in the flow directory with your user's permissions. Only run flows you trust; before running a flow someone shared, read the commands in its `flow.json` and the scripts they call.
- **Keys** are read only from environment variables (a provider's `apiKeyEnv`) and are never written to `flow.json`, `runs/` or any other file. A key, token, secret or password field in `providers.json` is an error.
- **llm stages** send the prompt and upstream artifacts to the model provider you chose. Keep content you don't want sent to a third party out of the flow, or use a local model (for example `ollama`).
- **The agent executor's** built-in adapters use the least permission that still lets the agent write files in the flow directory, and never pass a bypass-all-permissions flag by default. Flags you add in `args` are your responsibility.
- **The local board** (in development) listens only on `127.0.0.1`, generates a random token on every start, and checks the `Host` header.
