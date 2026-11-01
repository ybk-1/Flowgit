# Flowgit

**万物皆可流程化。** 把任何事情拆成一步一张卡片的可视化流程：每一步有产物、有版本，人和 AI 都能接手，做好的流程可以分享给别人 fork 复用。

**Turn anything into a flow.** Break any piece of work into visual stages: each stage has artifacts and versions, people and AI can both pick it up, and finished flows can be shared and forked.

> 状态：早期开发（spec v0.1）。目前有格式规范、核心库和命令行工具；可视化看板网站是下一步。
>
> Status: early (spec v0.1). The format, core library and CLI are here; the visual board web app comes next.

## 为什么 / Why

现在的 AI 工具要么是一键黑盒，要么是给工程师用的节点图。中间过程看不见、改不了、存不下来。Flowgit 把"做出来的过程"当成产品本身：

- **阶段看板**：脚本 → 分镜 → 素材 → 剪辑 → 导出，每一步一张卡，不是 200 个节点。
- **每一步都有版本**：改了分镜，后面需要重跑的阶段自动标出来；不满意随时回退。
- **人和 AI 混合**：一个阶段可以由模型做、由脚本做，也可以由人来做。
- **开放格式**：流程就是一个文件夹加一个 `flow.json`，可以放进 Git、分享、fork。
- **能导出成 Skill**：同一个流程可以生成 `SKILL.md`，让 Claude Code 这类工具直接按阶段跑。

Today's AI tools are either one-click black boxes or node graphs built for engineers. You can't see the steps in between, change them, or keep them. Flowgit treats the process of making something as the product itself:

- **Stage board**: script → storyboard → assets → edit → export. One card per step, not 200 nodes.
- **Every step is versioned**: change the storyboard and the stages that need a re-run are marked for you; roll back any time.
- **People and AI together**: a stage can be done by a model, by a script, or by a person.
- **Open format**: a flow is a folder with a `flow.json`. Put it in Git, share it, fork it.
- **Exports to a Skill**: the same flow can generate a `SKILL.md` so tools like Claude Code can run it stage by stage.

## 快速开始 / Quick start

需要 Node.js 22+、[pnpm](https://pnpm.io)，导出视频需要 [FFmpeg](https://ffmpeg.org/download.html)。

You need Node.js 22+ and [pnpm](https://pnpm.io); exporting video needs [FFmpeg](https://ffmpeg.org/download.html).

```bash
git clone https://github.com/cgold9820-dotcom/Flowgit.git
cd Flowgit
pnpm install
pnpm build

# 用自带的短视频模板建一个流程 / create a flow from the short-video template
node packages/cli/dist/index.js init ~/my-video
cd ~/my-video
alias flowgit="node $OLDPWD/packages/cli/dist/index.js"

flowgit status                                   # 看板 / the board
flowgit inputs set topic="为什么猫喜欢纸箱"         # 主题 / topic
flowgit inputs set language=en                   # 可选：zh（默认）或 en / optional: zh (default) or en
export ANTHROPIC_API_KEY=...                     # 脚本和分镜由 Claude 写 / Claude writes the script and storyboard
flowgit run all                                  # 跑到"素材"会停下等你 / stops at "assets" and waits for you
mkdir -p assets                                  # 放素材；空着也行，导出时用文字卡 / add assets, or leave empty for text cards
flowgit run all                                  # 剪辑 + 导出 → final.mp4 / edit + export → final.mp4
```

没有 API key，可以先用模板自带的示例回复试跑：

No API key yet? Try it with the template's bundled demo replies:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
```

`flowgit status` 的样子 / what the board looks like:

```text
短视频制作 · flow.json v0.1 · /home/me/my-video

#  阶段 stage       执行 executor  状态 state                  版本 runs  产物 outputs
1  脚本 script      llm            ✓ 已完成 (ok)               v1         script.md
2  分镜 storyboard  llm            ✎ 产物被手动修改 (edited)   v1         storyboard.json
3  素材 assets      human          ↻ 需重跑（上游或配置变了）  v1         assets
4  剪辑 edit        script         ↻ 需重跑（上游或配置变了）  v1         timeline.json
5  导出 export      script         ↻ 需重跑（上游或配置变了）  v1         final.mp4
```

命令行的提示和报错都是中英双语。模板生成的内容（脚本、字幕、提示）用你选的 `language`。

CLI messages and errors are bilingual. What a template produces (script, captions, its own messages) follows the `language` input you choose.

## 命令 / Commands

| 命令 / Command | 作用 | What it does |
| --- | --- | --- |
| `flowgit init [dir] [-t template]` | 从模板新建流程（默认 `short-video`） | Create a flow from a template (default `short-video`) |
| `flowgit validate` | 按规范检查 `flow.json` | Check `flow.json` against the spec |
| `flowgit status [--json]` | 看板：每个阶段的状态、版本、产物和下一步 | The board: each stage's state, version, outputs, and the next step |
| `flowgit inputs` / `flowgit inputs set k=v` | 查看 / 填写流程输入 | Show / set flow inputs |
| `flowgit run <stage\|all>` | 跑一个阶段，或按顺序跑完所有需要跑的阶段 | Run one stage, or every stage that needs it, in order |
| `flowgit run <stage> --from <path>` | 人工阶段：把文件或文件夹放进产物位置 | Human stage: put a file or folder in place as the output |
| `flowgit log <stage>` | 这个阶段的历史版本 | The stage's version history |
| `flowgit restore <stage> <n>` | 回退到某个版本 | Roll back to a version |
| `flowgit export-skill [-o SKILL.md]` | 生成 `SKILL.md`，给 AI 工具用 | Generate a `SKILL.md` for AI tools |

所有命令都接受 `-C <dir>` 指定流程目录。`run` 还接受 `--input k=v`（只对这次运行生效）、`--model` 和 `--force`。

Every command accepts `-C <dir>` for the flow directory. `run` also takes `--input k=v` (this run only), `--model`, and `--force`.

## 格式 / Format

最小的 `flow.json`：

A minimal `flow.json`:

```json
{
  "format": "flowgit",
  "version": "0.1",
  "name": "写一篇文章",
  "inputs": {
    "topic": { "type": "string", "required": true },
    "language": { "type": "string", "enum": ["zh", "en"], "default": "zh" }
  },
  "stages": [
    {
      "id": "outline",
      "name": "大纲",
      "executor": { "type": "llm", "prompt": "prompts/outline.md" },
      "outputs": [{ "type": "text/markdown", "path": "outline.md" }]
    },
    {
      "id": "draft",
      "name": "初稿",
      "inputs": ["outline"],
      "executor": { "type": "llm", "prompt": "prompts/draft.md" },
      "outputs": [{ "type": "text/markdown", "path": "draft.md" }]
    },
    {
      "id": "review",
      "name": "人工审稿",
      "inputs": ["draft"],
      "executor": { "type": "human", "instructions": "改好后保存为 final.md" },
      "outputs": [{ "type": "text/markdown", "path": "final.md" }]
    }
  ]
}
```

完整规范见 [docs/spec.md](docs/spec.md)，JSON Schema 在 [packages/core/schema/flow.schema.json](packages/core/schema/flow.schema.json)。

The full spec is in [docs/spec.md](docs/spec.md); the JSON Schema is [packages/core/schema/flow.schema.json](packages/core/schema/flow.schema.json).

## 仓库结构 / Repository layout

```text
packages/
  core/   @flowgit/core  格式、校验、版本记录、执行器 / format, validation, runs, executors
  cli/    flowgit        命令行工具和模板 / CLI and templates
    templates/short-video/  短视频示例流程 / the short-video example flow
docs/
  spec.md                  格式规范 / format spec
```

## 开发 / Development

```bash
pnpm install
pnpm build        # 编译所有包 / compile every package
pnpm typecheck
pnpm test         # 单元测试 + 命令行端到端测试 / unit tests + CLI end-to-end tests
```

端到端测试运行编译后的 `dist/`，所以要先 `pnpm build`；渲染视频的测试需要 FFmpeg，没装会自动跳过。

The end-to-end tests run the compiled `dist/`, so run `pnpm build` first. The video render test needs FFmpeg and is skipped without it.

GitHub 上的内容（提交信息、PR、文档）都写中英双语，中文在前。

Everything on GitHub (commit messages, PRs, docs) is bilingual, Chinese first.

## 路线图 / Roadmap

1. **格式 + 命令行**（本仓库现状）：Flow 规范 v0.1，跑通短视频流程。
2. **阶段看板网站**：打开一个流程就是一块看板，每张卡能看产物、改、重跑、看历史。
3. **发布与复用**：画廊、发布（自动去隐私）、fork、版本对比。
4. **更多领域**：做网站等流程；之后让作者把流程变成 MCP 服务供别人调用。

English:

1. **Format + CLI** (this repo today): Flow spec v0.1, with the short-video flow working end to end.
2. **Stage board web app**: opening a flow shows a board; each card lets you see its outputs, edit them, re-run, and browse history.
3. **Publish and reuse**: a gallery, publishing (with private data stripped), forks, and version diffs.
4. **More domains**: flows such as building a website; later, authors can expose a flow as an MCP service for others to call.

## 许可证 / License

[Apache-2.0](LICENSE)
