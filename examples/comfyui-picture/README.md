# ComfyUI 出四张图 / Four pictures from ComfyUI

模型先写 4 句画面（`scenes.json`），下一步是 `workflow` 阶段，`engine` 为 `comfyui`。它读 `comfy/picture.json`，每句画面跑一次，图片落到 `pictures/001.png` 起。

An llm stage writes 4 scene lines (`scenes.json`). The next stage is `workflow` with `engine` `comfyui`. It reads `comfy/picture.json`, runs once per scene, and saves pictures from `pictures/001.png`.

`comfy/picture.json` 是手写的最小 API 工作流：CheckpointLoaderSimple、两个 CLIPTextEncode、EmptyLatentImage、KSampler、VAEDecode、SaveImage。节点编号和 ComfyUI 自带的文生图例子一致，正面提示词是节点 `6` 的 `inputs.text`。

`comfy/picture.json` is a minimal API workflow written by hand: CheckpointLoaderSimple, two CLIPTextEncode nodes, EmptyLatentImage, KSampler, VAEDecode and SaveImage. The node ids match ComfyUI's own text-to-image example. The positive prompt is `inputs.text` on node `6`.

checkpoint 写成了 `your-checkpoint.safetensors`。这只是占位。打开 `comfy/picture.json`，把节点 `4` 的 `ckpt_name` 换成你 ComfyUI 的 `models/checkpoints/` 里真实的文件名，否则 ComfyUI 会报找不到模型。

The checkpoint is `your-checkpoint.safetensors`. That name is a placeholder. Open `comfy/picture.json` and change `ckpt_name` on node `4` to a real file in your ComfyUI `models/checkpoints/` folder, or ComfyUI reports that the model is missing.

## 导出 API 格式 / Export the API format

自己的工作流不要用界面上的 Save（那份带坐标，不能提交）。按官方文档导出：[Workflow API Format](https://docs.comfy.org/development/api-development/workflow-api-format)。

Don't use Save in the UI for your own workflow (that file stores positions and cannot be submitted). Export it the way the official docs say: [Workflow API Format](https://docs.comfy.org/development/api-development/workflow-api-format).

在 ComfyUI 里打开工作流，选 **File → Export Workflow (API)**，用导出的 JSON 换掉 `comfy/picture.json`。要改的输入仍写成 `<节点 id>.inputs.<字段>`，和现在的 `6.inputs.text` 一样。

Open the workflow in ComfyUI, choose **File → Export Workflow (API)**, and replace `comfy/picture.json` with that JSON. Inputs you want to change stay `<node id>.inputs.<field>`, the same way `6.inputs.text` is written now.

服务器路由见 [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)。更完整的说明在 [docs/comfyui.md](../../docs/comfyui.md)。

Server routes: [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes). The longer write-up is [docs/comfyui.md](../../docs/comfyui.md).

## 试跑 / Try it

先让 ComfyUI 在 `http://127.0.0.1:8188` 跑着（或设置 `FLOWGIT_COMFYUI_URL`）。没有模型密钥时，画面描述用自带的示例回复：

Start ComfyUI at `http://127.0.0.1:8188` (or set `FLOWGIT_COMFYUI_URL`). Without a model key, the scene lines use the canned reply:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run scenes
flowgit run pictures
```

`flowgit doctor` 会问一下 ComfyUI 在不在。连不上只是提醒，不是错误。

`flowgit doctor` asks whether ComfyUI is there. If it isn't, that is a hint, not an error.
