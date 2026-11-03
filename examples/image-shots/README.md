# 分镜出图 / Storyboard pictures

人写 `storyboard.json`，`image` 阶段按 `shots` 里每一条 `image_prompt` 出一张图，文件是 `shots/001.png`、`002.png`……

A person writes `storyboard.json`. The `image` stage makes one picture per `image_prompt` in `shots`, as `shots/001.png`, `002.png`, and so on.

自带模板仍然默认用你上传的照片。生图是可选阶段，说明见 [docs/image.md](../../docs/image.md)。

Bundled templates still default to pictures you upload. Image generation is an optional stage. See [docs/image.md](../../docs/image.md).

不调用接口的试跑：`demo-pictures/shots/` 里只有两张图，三个镜头会循环使用。在这个目录里：

Offline run, no API call: `demo-pictures/shots/` has two pictures and the three shots cycle through them. From this directory:

```bash
flowgit run board
FLOWGIT_IMAGE_MOCK_DIR=demo-pictures flowgit run shots
```

真的出图需要智谱的 `GLM_API_KEY`（和对话预设用同一个变量；个人套餐、团队套餐和模型标准 API 的密钥不通用）。换模型就改 `shots` 阶段的 `model`，例如 `volcengine/doubao-seedream-5-0-pro-260628`、`dashscope/wan2.6-t2i`。OpenAI 的 `gpt-image-1` 已于 2026-10-23 下线，请改用文档里还在售的模型 id。每张图都会计费。

A real run needs Zhipu's `GLM_API_KEY` (the same variable as the chat preset; personal, team and standard model keys are not interchangeable). To use another model, change `model` on the `shots` stage, for example `volcengine/doubao-seedream-5-0-pro-260628` or `dashscope/wan2.6-t2i`. OpenAI's `gpt-image-1` was shut down on 2026-10-23; use a model id the docs still list. Every picture is billed.
