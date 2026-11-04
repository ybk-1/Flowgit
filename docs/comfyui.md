# ComfyUI

`workflow` 阶段的 `engine` 写成 `comfyui`，就把一份 ComfyUI 工作流跑在你自己的电脑上。绘本、短视频这类画面可以不用付费的生图接口：ComfyUI 免费，也能用你自己的模型和 LoRA。

A `workflow` stage with `engine` `comfyui` runs a ComfyUI workflow on your own computer. Pictures for a story or a short video do not have to come from a paid image API: ComfyUI is free, and it can use your own models and LoRAs.

Flowgit 不安装 ComfyUI，也不下载模型。先自己把 ComfyUI 跑起来（默认地址 `http://127.0.0.1:8188`）。网页版不直接连它，这种阶段和 script 一样交给本机看板。

Flowgit does not install ComfyUI or download models. Start ComfyUI yourself (the default address is `http://127.0.0.1:8188`). The web app never talks to it; like a script stage, this one is handed to the local board.

规范里的字段见 [docs/spec.md](spec.md) 的「ComfyUI」。能看的例子是 [`examples/comfyui-picture`](../examples/comfyui-picture)。

The fields are in ["ComfyUI"](spec.md) in the spec. The example is [`examples/comfyui-picture`](../examples/comfyui-picture).

## 导出 API 格式 / Export the API format

`file` 必须是 ComfyUI 的 **API 格式**，不是界面上 Save 存下来的那份（那份带节点位置，提交会失败）。

`file` has to be ComfyUI's **API format**, not the file Save writes in the UI (that one stores node positions, and submitting it fails).

按官方说明导出：[Workflow API Format](https://docs.comfy.org/development/api-development/workflow-api-format)。在 ComfyUI 里打开工作流，菜单选 **File → Export Workflow (API)**，把得到的 JSON 放进流程目录。

Export it the way the official docs describe: [Workflow API Format](https://docs.comfy.org/development/api-development/workflow-api-format). Open the workflow in ComfyUI and choose **File → Export Workflow (API)**, then put that JSON in the flow directory.

每个节点是 `"节点 id": { "class_type", "inputs" }`。改提示词时，键写成 `<节点 id>.inputs.<字段>`，例如 CLIPTextEncode 的 `6.inputs.text`。

Each node is `"node id": { "class_type", "inputs" }`. To change a prompt, the key is `<node id>.inputs.<field>`, for example `6.inputs.text` on a CLIPTextEncode.

## 怎么写 / How to write it

```json
{
  "type": "workflow",
  "engine": "comfyui",
  "file": "comfy/picture.json",
  "params": {
    "set": { "6.inputs.text": "{{inputs.scene}}", "3.inputs.seed": 1 },
    "each": {
      "from": "scenes.json",
      "path": "scenes",
      "field": "prompt",
      "target": "6.inputs.text"
    }
  }
}
```

- `server` 不写就是 `http://127.0.0.1:8188`。`FLOWGIT_COMFYUI_URL` 可以换成别的地址，`params.server` 优先。只允许 http 和 https。
- `set` 在提交前改节点的输入。字符串可以用 `{{inputs.名称}}` 和 `{{upstream.<阶段 id>.content}}`。seed 这种数字直接写数字。
- `each` 和 image 阶段一样读上游 JSON 数组，多一个 `target`。数组的每一项跑一次，把那一项的 `field` 填进 `target`。
- 产物是一个以 `/` 结尾的目录时，按顺序存成 `001.png`、`002.gif`……（视频同样编号）。产物是单个文件时，就写那一个文件。
- `timeoutSec` 默认 600 秒，含这一次提交、轮询和下载。`retries` 和 service 一样，只重试网络错误、429 和 5xx。节点报错不重试。

- Unset `server` means `http://127.0.0.1:8188`. `FLOWGIT_COMFYUI_URL` can point somewhere else, and `params.server` wins. Only http and https.
- `set` changes node inputs before the submit. Strings may use `{{inputs.name}}` and `{{upstream.<stage id>.content}}`. A number, such as a seed, is written as a number.
- `each` reads an upstream JSON array the same way an image stage does, plus `target`. The workflow runs once per item, and that item's `field` is written into `target`.
- A directory output (the path ends with `/`) is saved in order as `001.png`, `002.gif`, and so on (a video is numbered the same way). A single file output is that one file.
- `timeoutSec` defaults to 600 seconds and covers that one submission, the poll and the downloads. `retries` follows a service stage: only a network error, 429 or 5xx is retried. A node error is not.

## 运行时做了什么 / What a run does

Flowgit 只调用 ComfyUI 官方文档里的这几个路由（[服务器路由](https://docs.comfy.org/development/comfyui-server/comms_routes)，[示例](https://docs.comfy.org/development/comfyui-server/api-examples)，实现在[官方仓库的 server.py](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)）：

Flowgit calls only these routes from ComfyUI's official docs ([server routes](https://docs.comfy.org/development/comfyui-server/comms_routes), [examples](https://docs.comfy.org/development/comfyui-server/api-examples), implemented in [server.py in the official repo](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)):

1. `POST /prompt`，正文是 `{ "prompt": <工作流>, "client_id": "<uuid>" }`。
2. 轮询 `GET /history/<prompt_id>`，直到这次跑完。
3. 按 `outputs` 里的图片、gif 或视频，`GET /view?filename=...&type=...&subfolder=...` 下载。

1. `POST /prompt` with `{ "prompt": <workflow>, "client_id": "<uuid>" }`.
2. Poll `GET /history/<prompt_id>` until that run finishes.
3. Download each picture, gif or video in `outputs` with `GET /view?filename=...&type=...&subfolder=...`.

ComfyUI 返回 `node_errors`，或者 history 里是执行失败时，阶段失败。错误是中文和英文，并带上节点 id 和原来的信息。

The stage fails when ComfyUI returns `node_errors`, or when the history entry is an execution failure. The error is in Chinese and English, and it includes the node id and the original message.

改了 `file` 的内容，或者改了 `params` 里写的字（不是运行时替换出来的值），这个阶段和下游都需要重跑。

Editing the contents of `file`, or the text written in `params` (not the values filled in at run time), marks this stage and everything downstream stale.

## 检查和确认 / Checks and confirmation

`flowgit doctor` 看到 comfyui 阶段时会请求 `GET /system_stats`。连不上只打印一行提醒，不算错误，流程仍可以做别的检查。地址写错（不是 http/https）才是错误。

When `flowgit doctor` sees a comfyui stage it requests `GET /system_stats`. If nothing answers, it prints one hint and does not count that as an error, so the other checks still run. An address that is not http or https is an error.

从 Git 地址复制来的流程，`flowActions` 会列出 `ComfyUI <地址>`。第一次运行前要确认；确认之前不会提交。

For a flow copied from a Git URL, `flowActions` lists `ComfyUI <server>`. Confirm that list before the first run; nothing is submitted until you do.

图生图要先 `POST /upload/image`，这一版不做。

Image-to-image would upload with `POST /upload/image`. This version does not.
