# Flowgit for VS Code and Cursor

侧边栏查看流程、运行阶段。这个包是 `"private": true`，不发布到 npm，也不进 VS Code Marketplace 或 Open VSX。

See a flow in the sidebar and run stages. This package is `"private": true`. It is not published to npm, the VS Code Marketplace, or Open VSX.

完整的打包和安装说明在仓库的 [docs/vscode.md](../../docs/vscode.md)。

Packaging and install steps are in [docs/vscode.md](../../docs/vscode.md).

## 许可证 / Licenses

扩展代码与 Flowgit 一样是 Apache-2.0。另外用到：

The extension code is Apache-2.0, the same as Flowgit. It also uses:

- `jsonc-parser`（Microsoft），MIT，打进 `dist/extension.js`。 / MIT, bundled into `dist/extension.js`.
- `@types/vscode`（Microsoft），MIT，钉在 1.125.0，只在类型检查时用，不打进包。npm 没有 1.128.0，而 1.134.0 比 Cursor 现在的引擎新。 / MIT, pinned to 1.125.0, typechecking only, not shipped. npm has no 1.128.0, and 1.134.0 is newer than the engine Cursor has today.
- `esbuild`（Evan Wallace），MIT，只用来打包，版本与 `packages/core`、`packages/app` 相同（`^0.25.12`），不打进包。 / MIT, used only to bundle, same range as `packages/core` and `packages/app` (`^0.25.12`), not shipped.

详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。 / See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
