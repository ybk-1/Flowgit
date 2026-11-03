# VS Code 和 Cursor 插件 / VS Code and Cursor extension

侧边栏名叫 **Flowgit**。它在工作区里找 `flow.json` 或 `flow.md`（跳过 `node_modules`、`.git`、`runs`、`.flowgit`），按依赖顺序列出阶段，状态和 `flowgit status --json` 一样。点一个阶段会打开它的第一个产物；还没有产物就打开提示词，再没有就打开流程文件。

`flow.json` 里每个阶段上方有 CodeLens：当前状态，以及「运行」（编辑器是英文时显示 Run）。一次只显示一种语言。命令面板和阶段右键也可以：运行这个阶段、运行全部、打开看板（`flowgit board`）、和上一版比较（`flowgit diff`）、确认复制来的流程（`flowgit trust`）。

这些命令都交给 VS Code 的任务去跑，参数是数组，由编辑器处理空格和引号。输出在终端面板里。插件不读取、不保存任何密钥。

The sidebar is named **Flowgit**. It finds `flow.json` or `flow.md` in the workspace (skipping `node_modules`, `.git`, `runs` and `.flowgit`), lists stages in dependency order, and shows the same states as `flowgit status --json`. Clicking a stage opens its first output; if that file is not there yet, the prompt; if there is no prompt, the flow file.

Above each stage in `flow.json`, a CodeLens shows the state and Run (运行 when the editor language is Simplified Chinese). One language shows at a time. The Command Palette and the stage's context menu can also run this stage, run all, open the board (`flowgit board`), compare with the previous version (`flowgit diff`), and confirm a copied flow (`flowgit trust`).

Those commands run as VS Code tasks. Arguments are an array, and the editor quotes spaces. Output is in the terminal panel. The extension never reads or stores a key.

插件不发布到 npm，也不进 VS Code Marketplace 或 Open VSX。下面是从源码打包、装进编辑器的步骤。

The extension is not published to npm, the VS Code Marketplace, or Open VSX. The steps below package it from source and install it.

## 打包 / Package a vsix

需要 Node.js 22+ 和 pnpm。在仓库根目录：

You need Node.js 22+ and pnpm. From the repository root:

```bash
corepack enable
pnpm install
pnpm --filter flowgit-vscode build
cd packages/vscode
npx @vscode/vsce package --no-dependencies
```

在这个仓库里要加 `--no-dependencies`：依赖已经打进 `dist/extension.js`，而 pnpm 的目录布局会让 `vsce` 默认的 `npm list` 失败。`npx` 这里只用来跑打包工具 `@vscode/vsce`，不会下载 Flowgit，也不会用 `npx` 跑最新的 `flowgit`。生成的文件是 `packages/vscode/flowgit-vscode-0.1.0.vsix`。

From this repository, pass `--no-dependencies`: the dependency is already bundled into `dist/extension.js`, and pnpm's layout makes `vsce`'s default `npm list` fail. `npx` here only runs the packager `@vscode/vsce`. It does not download Flowgit, and the extension never runs `npx flowgit`. The file is `packages/vscode/flowgit-vscode-0.1.0.vsix`.

构建会把 `packages/core/schema/flow.schema.json` 复制到插件里，让编辑器校验 `flow.json`。两份文件内容相同。

The build copies `packages/core/schema/flow.schema.json` into the extension so the editor can validate `flow.json`. The two files are identical.

## 装进 VS Code / Install in VS Code

1. 命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）→ **Extensions: Install from VSIX...**
2. 选中上面的 `.vsix`。

也可以：

```bash
code --install-extension packages/vscode/flowgit-vscode-0.1.0.vsix
```

说明见 [Install from a VSIX](https://code.visualstudio.com/docs/editor/extension-marketplace#_install-from-a-vsix)。

1. Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Extensions: Install from VSIX...**
2. Choose the `.vsix` above.

Or:

```bash
code --install-extension packages/vscode/flowgit-vscode-0.1.0.vsix
```

See [Install from a VSIX](https://code.visualstudio.com/docs/editor/extension-marketplace#_install-from-a-vsix).

## 装进 Cursor / Install in Cursor

Cursor 基于 VS Code，同一个 `.vsix` 可以装：

Cursor is a VS Code fork, so the same `.vsix` installs there: [VS Code migration](https://cursor.com/docs/configuration/migrations/vscode).

1. 命令面板 → **Extensions: Install from VSIX...**
2. 如果命令面板里没有这一项，打开扩展视图，点 `...` 菜单，选 **Install from VSIX...**。

或：

```bash
cursor --install-extension packages/vscode/flowgit-vscode-0.1.0.vsix
```

`engines.vscode` 是 `^1.128.0`。这是 Cursor 目前能装的版本：更高的要求会被拒绝。依据写在 `packages/vscode/src/engine.ts` 的注释里。

1. Command Palette → **Extensions: Install from VSIX...**
2. If that command is missing, open the Extensions view, open the `...` menu, and choose **Install from VSIX...**.

Or:

```bash
cursor --install-extension packages/vscode/flowgit-vscode-0.1.0.vsix
```

`engines.vscode` is `^1.128.0`, the engine Cursor can install today. A higher requirement is refused. The comment in `packages/vscode/src/engine.ts` has the sources.

## 找到 flowgit 命令 / Finding the flowgit command

按这个顺序找，都没有就提示 `npm i -g flowgit`。插件不会自动下载，也不会用 `npx` 跑最新版。

The extension looks in this order, and if none is found it says to run `npm i -g flowgit`. It never downloads a CLI and never runs the latest one with `npx`.

1. 设置 `flowgit.cliPath`（可以是带空格的绝对路径）。
2. 工作区的 `node_modules/.bin/flowgit`（Windows 上是 `flowgit.cmd`）。
3. `PATH` 上的 `flowgit`。

1. The `flowgit.cliPath` setting (an absolute path may contain spaces).
2. The workspace `node_modules/.bin/flowgit` (`flowgit.cmd` on Windows).
3. `flowgit` on `PATH`.

## 密钥放在编辑器能看到的环境里 / Keys live in the environment the editor can see

模型的密钥只从环境变量来，例如 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`。插件自己不读、不写、不存这些变量。运行阶段时，命令行继承的是**编辑器进程**的环境，不是你后来在某个终端里 `export` 的那一份。

Model keys come only from environment variables, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The extension does not read, write, or store them. When a stage runs, the CLI inherits the **editor process** environment, not a variable you `export` later in some other terminal.

**Windows**：在「系统属性 → 环境变量 → 用户变量」里添加，然后完全退出 VS Code 或 Cursor 再打开。只在 PowerShell 窗口里设的 `$env:ANTHROPIC_API_KEY`，从开始菜单打开的编辑器看不见。

**Windows**: add a user variable under System Properties → Environment Variables, then quit VS Code or Cursor completely and open it again. `$env:ANTHROPIC_API_KEY` set only in a PowerShell window is invisible to an editor opened from the Start menu.

**macOS**：从程序坞打开的编辑器读不到 shell 配置文件里的变量。在终端里导出密钥后，从同一个终端启动编辑器：

**macOS**: an editor opened from the Dock does not see variables from your shell profile. Export the key in a terminal, then start the editor from that same terminal:

```bash
export ANTHROPIC_API_KEY="..."
cursor .
# 或 / or
code .
```

**Linux** 也一样：从应用菜单打开时，往往看不到 `~/.bashrc` 里的变量。需要密钥时，从终端启动编辑器。

**Linux** is the same: an editor opened from the application menu often cannot see variables from `~/.bashrc`. Start it from a terminal when a stage needs a key.

## 受限模式 / Restricted Mode

`capabilities.untrustedWorkspaces.supported` 是 `"limited"`。未受信任的工作区里，侧边栏和 CodeLens 照常显示，运行类命令不会执行，并说明原因。工作区里的 `flowgit.cliPath` 会被忽略，也不会运行工作区 `node_modules` 里的 `flowgit`。信任工作区之后才能跑。

说明见 [Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust) 和[扩展里的 Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)。

`capabilities.untrustedWorkspaces.supported` is `"limited"`. In an untrusted workspace the sidebar and CodeLens still show, and the run commands do not run; they tell you why. A workspace `flowgit.cliPath` is ignored, and `flowgit` inside the workspace `node_modules` is not executed. Trust the workspace to run.

See [Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust) and [Workspace Trust for extensions](https://code.visualstudio.com/api/extension-guides/workspace-trust).
