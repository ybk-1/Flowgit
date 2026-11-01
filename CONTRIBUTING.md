# 参与贡献 / Contributing

欢迎贡献！GitHub 上的所有内容（PR、commit、文档）请用中英双语，中文在前。代码约定见 [`CLAUDE.md`](CLAUDE.md)，AI 编码助手的规则见 [`AGENTS.md`](AGENTS.md)。

Contributions are welcome! Please write everything on GitHub (PRs, commits, docs) in Chinese first, then English. Code conventions are in [`CLAUDE.md`](CLAUDE.md); rules for AI coding agents are in [`AGENTS.md`](AGENTS.md).

## 本地开发 / Local development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## 维护者的工作流：Cursor 实现，Claude 审核 / Maintainer workflow: Cursor implements, Claude reviews

1. **派任务**：在 Orca 里为任务开一个新的 worktree，让 Cursor 按 `AGENTS.md` 实现，分支名 `cursor/<topic>`。
   **Assign**: open a new worktree for the task in Orca and let Cursor implement it per `AGENTS.md`, on a `cursor/<topic>` branch.
2. **开 PR**：Cursor 跑通测试后推分支并开 PR，按 PR 模板填写。
   **Open a PR**: once tests pass, Cursor pushes the branch and opens a PR using the template.
3. **审核**：Claude 拉下 PR 分支，跑 build / typecheck / test（需要时跑渲染），review 代码。小问题直接推修复 commit；大问题在 PR 上留言，交回 Cursor 改。
   **Review**: Claude checks out the PR, runs build / typecheck / test (and the render when relevant), and reviews the code. Small issues get a fix commit; larger ones get a PR comment for Cursor to address.
4. **合并**：CI 通过、审核没问题后由 Claude 合并。
   **Merge**: Claude merges once CI is green and the review is clean.

## 发布 / Releasing

发布到 npm 的步骤（第一次手动发布、Trusted Publishing 设置、日常打 tag 发布）见 [`docs/releasing.md`](docs/releasing.md)。安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告。

How to publish to npm (the first manual release, Trusted Publishing setup, and routine tag releases) is in [`docs/releasing.md`](docs/releasing.md). Report security problems privately as described in [`SECURITY.md`](SECURITY.md).
