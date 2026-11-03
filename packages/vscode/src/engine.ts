/**
 * Minimum VS Code this extension declares (`engines.vscode` in package.json).
 *
 * `engines.vscode` is the minimum editor the extension can be installed on:
 * https://code.visualstudio.com/api/references/extension-manifest#engines
 * https://code.visualstudio.com/api/working-with-extensions/publishing-extension#visual-studio-code-compatibility
 *
 * Cursor is a VS Code fork and often stays on a slightly older engine, so an
 * extension that asks for a newer engine will not install:
 * https://cursor.com/docs/configuration/migrations/vscode
 *
 * Cursor's changelog recorded the Extension API at 1.105.1 on 2025-11-21:
 * https://cursor.com/changelog/2-1
 * Cursor staff later said the API target moved to 1.128 in mid-July 2026 and
 * was still 1.128 on 2026-10-20 (upstream was already on 1.129+):
 * https://forum.cursor.com/t/request-please-bump-the-underlying-vs-code-extension-api-electron-version-to-the-latest-upstream-release/166421
 *
 * `^1.128.0` is the newest engine Cursor can install today. A higher floor
 * would be refused. npm has no `@types/vscode@1.128.0` (1.125.0, then 1.134.0).
 * Types are pinned to 1.125.0, the newest publish that is not newer than this
 * floor — `vsce` rejects types newer than `engines.vscode`, and 1.134 would
 * also be newer than Cursor's 1.128.
 */
export const VSCODE_ENGINE = "^1.128.0";
