# AGENTS.md：给 AI 编码助手的说明 / Instructions for AI coding agents

本文件给 Cursor、Codex 等编码助手读。项目结构、命令和代码约定以 [`CLAUDE.md`](CLAUDE.md) 为准，先读它。

This file is for coding agents such as Cursor or Codex. [`CLAUDE.md`](CLAUDE.md) is the source of truth for layout, commands and code conventions: read it first.

## 分工 / Who does what

- **Cursor（在 Orca 里）负责实现**：按任务写代码、写测试、开 PR。
- **Claude 负责审核**：review、本地验证（build / typecheck / test / 渲染）、debug，CI 通过后合并。
- 你不要自己合并 PR，也不要直接推到 `main`。

- **Cursor (inside Orca) implements**: writes code and tests for a task, then opens a PR.
- **Claude reviews**: reviews, verifies (build / typecheck / test / render), debugs, and merges once CI is green.
- Do not merge PRs yourself and never push to `main`.

## 硬性规则 / Hard rules

1. **GitHub 上的内容一律中英双语，中文在前**：PR 标题和描述、commit message、README、docs、代码里面向用户的文字（CLI 输出、模板）。代码注释可以只用英文。
   **Everything on GitHub is bilingual, Chinese first**: PR titles and bodies, commit messages, README, docs, and user-facing strings (CLI output, templates). Code comments may be English only.
2. **开 PR 前必须全部通过 / Before opening a PR, all of these must pass:**
   ```bash
   pnpm install
   pnpm build
   pnpm typecheck
   pnpm test
   ```
   改了行为就加或改测试。不要跳过、删除或 `skip` 测试来让它变绿。
   Add or update tests when behavior changes. Never skip, delete or `.skip` a test to get green.
3. **永远不覆盖用户的手动修改**：某个阶段的产物被手动改过，重跑前必须先存成一个 `manual` run。
   **Never overwrite a hand edit**: a hand-edited stage output is saved as a `manual` run before any re-run.
4. **格式改动要成对**：改 `packages/core/schema/flow.schema.json` 时，同时改 `src/types.ts` 和 `docs/spec.md`。
   **Format changes come in pairs**: changing the schema means changing `src/types.ts` and `docs/spec.md` too.
5. **一个任务一个分支一个 PR**，分支名用 `cursor/<简短英文主题>`，例如 `cursor/web-board`。PR 尽量小，方便审核。
   **One task, one branch, one PR**, named `cursor/<short-topic>`, e.g. `cursor/web-board`. Keep PRs small enough to review.
6. **PR 描述按模板填**（`.github/pull_request_template.md`），写清楚改了什么、怎么验证的、还有什么没做。
   **Fill in the PR template**: what changed, how you verified it, and what is left.
7. 不要提交密钥、`.env`、`node_modules`、`dist/`、`runs/` 这类生成文件。
   Never commit secrets, `.env`, `node_modules`, `dist/`, `runs/` or other generated files.
8. **用户能感觉到的改动要记进 `CHANGELOG.md`**：在最上面那个“未发布 / Unreleased”版本的对应小节里加一行，中英双语。纯测试、CI、内部重构不用写。
   **Record user-visible changes in `CHANGELOG.md`**: add a bilingual line under the matching section of the top "Unreleased" version. Tests, CI and internal refactors don't need one.

## 收到审核意见后 / After review

Claude 会在 PR 上留言，或者直接推修复 commit 到你的分支。继续改之前先 `git pull`，不要 force push 覆盖别人的 commit。

Claude may comment on the PR or push fix commits to your branch. `git pull` before you continue, and never force-push over someone else's commits.
