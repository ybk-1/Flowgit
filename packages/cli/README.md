# flowgit

**万物皆可流程化。** Flowgit 的命令行工具：把任何事情拆成一步一张卡片的流程，每一步有产物、有版本，由模型、脚本、agent 或人来完成。

**Turn anything into a flow.** The Flowgit CLI: break any piece of work into stages, each with its own artifacts and versions, done by a model, a script, an agent or a person.

```bash
npm install -g flowgit            # 需要 Node.js 22+ / needs Node.js 22+

flowgit init my-video             # 用自带的短视频模板建流程 / new flow from the short-video template
cd my-video
flowgit status                    # 看板 / the board
flowgit inputs set topic="为什么猫喜欢纸箱"
flowgit run all --model deepseek/deepseek-v4-pro   # 任何模型 / any model
flowgit providers                 # 内置的模型供应商和密钥状态 / built-in providers and key status
```

密钥只从环境变量读（例如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`），不会写进任何文件。导出视频需要 [FFmpeg](https://ffmpeg.org/download.html)。

Keys are read only from environment variables (such as `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`) and never written to a file. Exporting video needs [FFmpeg](https://ffmpeg.org/download.html).

完整说明、流程格式和模板见 / Full guide, flow format and templates: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
