# Flowgit

开源工具：把任何过程变成可视化、分阶段、有版本的流程（"万物皆可流程化"）。

Open-source tool for turning any process into a visual, staged, versioned flow ("万物皆可流程化").

## 语言 / Language

- GitHub 上的一切都写中英双语，中文在前：提交信息、PR 标题和说明、README、文档、这个文件。代码标识符和代码注释可以只写英文。
- 命令行的提示和报错也是中英双语（"中文 / English"）。
- 模板生成的内容（提示词、脚本输出、字幕）不强制双语，由流程输入 `language`（`zh` | `en`）决定。

- Everything on GitHub is bilingual, Chinese first: commit messages, PR titles and descriptions, README, docs, and this file. Code identifiers and code comments may stay English-only.
- CLI messages and errors are bilingual too ("中文 / English").
- What a template produces (prompts, script output, captions) is not forced bilingual; the `language` flow input (`zh` | `en`) picks the language.

## 结构 / Layout

- `packages/core`（`@flowgit/core`）：flow.json 的 schema（流程也可以写成 `flow.md`，由 `src/flowmd.ts` 和 flow.json 互转；`schema/flow.schema.json` 是唯一标准，`src/types.ts` 跟它保持一致）、校验、`runs/<stage>/<n>/` 下的运行历史、阶段执行器（`human`、`llm`、`script`、`agent`、`service` 可运行；`workflow`/`mcp` 是预留）。
- `packages/cli`（`flowgit`）：commander 命令行在 `src/index.ts`，自带模板在 `templates/`。
- `packages/web`（`@flowgit/web`）：本机看板，可查看、修改和运行阶段，也可填写流程输入、看历史、对比和回退。`node:http` 只绑定 `127.0.0.1`，静态页面在 `public/`，`flowgit board` 打开它；页面只在带 `?token=` 的链接里拿到令牌（`startBoard` 返回的 `url` 就是它）。文本产物用 `PUT /api/file` 保存；人工阶段的文件夹产物用 `POST /api/upload` 上传。`POST /api/run` 在进程里调用 `runStage` / `runAll`（同时只跑一个，忙时 409；运行中保存产物或回退也是 409）。`GET /api/events` 用查询参数 `token` 推送 SSE（运行日志，以及文件变化时的 `flow:changed`）。`GET` / `PUT /api/inputs` 读写流程输入，保存前按 `loadFlowInputs` 的规则校验。`GET /api/runs?stage=` 调用 `listRuns`；`GET /api/diff?stage=&a=&b=` 调用 `diffRuns`（省略 `b` 则和当前文件比）；`POST /api/restore` 的 JSON `{ "stage", "n" }` 调用 `restoreStage`。`POST /api/stage` 的 JSON 就是 `addStage` 的参数（`id`、`type`，以及可选的 `name`、`after`、`inputs`、`outputs`、`prompt`、`run`、`agent`），通过后按 `flowgit validate` 校验；有错误就返回 400 的双语列表并且什么都不写，llm 的提示词文件不存在时会建和 `flowgit stage add` 一样的骨架。`DELETE /api/stage?id=<id>` 调用 `removeStage`（`force=1` 才断开下游依赖）；还有依赖且没带 `force` 时返回 409 并点名这些阶段，不删 `runs/` 和产物。运行中这两个接口也返回 409。除 SSE 外，`/api/*` 都要带请求头 `X-Flowgit-Token`。
- `docs/spec.md`：给人看的规范，改 schema 时一起改。
- `docs/guide.md`：入门教程，照着做出自带的 `weekly-report` 模板（`packages/cli/templates/weekly-report`）。里面贴了真实的命令行输出，改了命令行输出或格式时要跟着改。
- `examples/`：只在仓库里的示例流程。它们和 `packages/cli/templates/` 里的模板都由 `packages/core/src/examples.test.ts` 校验。发布流程见 `docs/releasing.md`。
- `CHANGELOG.md`：每个版本的更新记录。用户能感觉到的改动，在最上面的“未发布 / Unreleased”版本下加一行，中英双语。

- `packages/core` (`@flowgit/core`): the flow.json schema (a flow may also be a `flow.md`, converted to and from flow.json by `src/flowmd.ts`; `schema/flow.schema.json` is the source of truth; `src/types.ts` mirrors it), validation, run history under `runs/<stage>/<n>/`, and stage executors (`human`, `llm`, `script`, `agent`, `service`; `workflow`/`mcp` are reserved).
- `packages/cli` (`flowgit`): the commander CLI in `src/index.ts`, bundled templates in `templates/`.
- `packages/web` (`@flowgit/web`): the local board, where stages can be viewed, edited, and run, flow inputs can be filled in, and history can be browsed, compared, and restored. `node:http` binds `127.0.0.1` only, static files live in `public/`, and `flowgit board` opens it; the page only gets the token through the link with `?token=` (the `url` that `startBoard` returns). Text outputs are saved with `PUT /api/file`; files are uploaded into a human stage's directory output with `POST /api/upload`. `POST /api/run` calls `runStage` / `runAll` in-process (one run at a time; 409 when busy, and for output writes or a restore during a run). `GET /api/events` is the SSE stream (the run log, and `flow:changed` when files change) and takes the token in the `token` query parameter. `GET` / `PUT /api/inputs` read and save flow inputs, validated with the same rules as `loadFlowInputs`. `GET /api/runs?stage=` calls `listRuns`; `GET /api/diff?stage=&a=&b=` calls `diffRuns` (omit `b` to compare with the current files); `POST /api/restore` with JSON `{ "stage", "n" }` calls `restoreStage`. `POST /api/stage` takes the `addStage` spec (`id`, `type`, and optional `name`, `after`, `inputs`, `outputs`, `prompt`, `run`, `agent`) and then validates like `flowgit validate`; errors return 400 with a bilingual list and write nothing, and a missing llm prompt file is created the same way `flowgit stage add` creates it. `DELETE /api/stage?id=<id>` calls `removeStage` (`force=1` detaches downstream); without `force`, dependents yield 409 and are named, and `runs/` and output files are left in place. Both routes return 409 during a run. Every `/api/*` route except the SSE stream requires the `X-Flowgit-Token` header.
- `docs/spec.md`: the human-readable spec. Change it together with the schema.
- `docs/guide.md`: the starter tutorial; it builds the bundled `weekly-report` template (`packages/cli/templates/weekly-report`). It quotes real CLI output, so update it when CLI output or the format changes.
- `examples/`: repo-only example flows. They and the templates in `packages/cli/templates/` are validated by `packages/core/src/examples.test.ts`. Releasing is in `docs/releasing.md`.
- `CHANGELOG.md`: what changed in each version. For a user-visible change, add a bilingual line under the top "Unreleased" version.

## 命令 / Commands

```bash
pnpm install
pnpm build       # 编译所有包；命令行端到端测试跑的是 dist/ / tsc for every package; the CLI e2e test runs dist/
pnpm typecheck
pnpm test        # vitest；没有 ffmpeg 时跳过渲染测试 / vitest; the render test is skipped when ffmpeg is missing
node scripts/pack-smoke.mjs   # 像发布一样打包并安装后试跑（需要先 build）/ pack, install and run like a release (after build)
```

## 约定 / Conventions

- llm 阶段默认模型是 `claude-opus-5-5`，通过 `@anthropic-ai/sdk` 流式调用，带 `fallbacks: "default"`。设置 `FLOWGIT_LLM_MOCK_DIR=<dir>` 时改用目录里的固定回复 `<stageId>.md|json`（测试和模板的 `demo-replies/` 用它）。
- 模型写成 `<provider>/<model>`（`src/providers.ts`），只支持 Anthropic 和 OpenAI 两种协议。Claude 专用参数只发给 `api.anthropic.com`。密钥只从 `apiKeyEnv` 指定的环境变量读，不写进任何文件；新增预设时 `baseUrl` 必须来自官方文档，并在注释里附链接。
- `agent` 执行器在流程目录里以无界面模式启动 agent CLI（`src/executors/agent.ts`），提示词走 stdin。内置适配只用"能在流程目录写文件"的最小权限，**永远不默认加跳过所有权限的参数**；每个参数都要照官方文档写并附链接。测试用假的 `custom` agent，不调用真的 CLI。
- 手动改过的阶段产物永远不会被覆盖：重跑或回退前先存成一个 `manual` 版本。
- 是否需要重跑 = 上游产物 + 流程输入 + 执行器配置（包括提示词文件和命令里提到的脚本文件）的哈希，并向下游传递。
- 流程输入可以带 `enum` 限定取值，运行前会检查。

- The default model for llm stages is `claude-opus-5-5`, called through `@anthropic-ai/sdk` with streaming and `fallbacks: "default"`. `FLOWGIT_LLM_MOCK_DIR=<dir>` replaces the model with canned replies `<stageId>.md|json` (used by tests and the template's `demo-replies/`).
- Models are `<provider>/<model>` (`src/providers.ts`), over two protocols only: Anthropic and OpenAI. Claude-only parameters go to `api.anthropic.com` only. Keys are read only from the env var named by `apiKeyEnv` and never written to a file; a new preset's `baseUrl` must come from the vendor's official docs, linked in a comment.
- The `agent` executor starts an agent CLI headless in the flow directory (`src/executors/agent.ts`), with the prompt on stdin. Built-in adapters use the least permission that still lets the agent write files in the flow directory and **never pass a bypass-all-permissions flag by default**; every flag comes from the official docs, linked in a comment. Tests use a fake `custom` agent, never a real CLI.
- A hand edit of a stage's outputs is never overwritten: it is saved as a `manual` run before any re-run or restore.
- Staleness = hash of upstream artifacts + flow inputs + executor config (incl. the prompt file and script files named in the command), and it propagates downstream.
- Flow inputs can carry an `enum` of allowed values, checked before a run.
