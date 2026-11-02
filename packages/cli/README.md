# flowgit

**万物皆可流程化。** Flowgit 的命令行工具：把任何事情拆成一步一张卡片的流程，每一步有产物、有版本，由模型、脚本、agent 或人来完成。

**Turn anything into a flow.** The Flowgit CLI: break any piece of work into stages, each with its own artifacts and versions, done by a model, a script, an agent or a person.

```bash
npm install -g flowgit            # 需要 Node.js 22+ / needs Node.js 22+

flowgit init my-video             # 用自带的短视频模板建流程 / new flow from the short-video template
cd my-video
flowgit status                    # 终端看板 / the board in the terminal
flowgit board                     # 在浏览器打开看板 / the board in your browser
flowgit inputs set topic="为什么猫喜欢纸箱"
flowgit providers                 # 内置的模型供应商和密钥状态 / built-in providers and key status
flowgit doctor                    # 跑之前检查密钥、FFmpeg、agent / check keys, FFmpeg and agents before a run
flowgit run all --dry-run         # 预演：会跑哪些阶段、调用几次模型 / preview: which stages run, how many model calls
flowgit run all --model deepseek/deepseek-v4-pro   # 任何模型 / any model
flowgit log                       # 整个流程的历史和 token 合计 / the whole history and token total
```

自带的模板 / Bundled templates：

| `-t` | 做什么 | What it makes |
| --- | --- | --- |
| `short-video`（默认 / default） | 竖屏短视频：脚本 → 分镜 → 素材 → 剪辑 → 导出 | A vertical short video: script → storyboard → assets → edit → export |
| `weekly-report` | 周报入门示例：随手记（人）→ 草稿（模型）→ 检查（脚本） | Starter: a weekly report from rough notes (person → model → script) |

```bash
flowgit templates                 # 列出模板和它们的阶段 / list templates and their stages
flowgit init my-report -t weekly-report
flowgit -C my-report graph --md   # 画成 Mermaid 流程图贴进 README / a Mermaid diagram for your README
```

密钥只从环境变量读（例如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`），不会写进任何文件。导出视频需要 [FFmpeg](https://ffmpeg.org/download.html)。

Keys are read only from environment variables (such as `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`) and never written to a file. Exporting video needs [FFmpeg](https://ffmpeg.org/download.html).

完整说明、流程格式和模板见 / Full guide, flow format and templates: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
