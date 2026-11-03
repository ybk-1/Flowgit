# 生图 / Image generation

`image` 是可选的阶段类型：按提示词调用图像模型，把图片写进一个以 `/` 结尾的目录。自带模板（短视频、图文等）仍然默认用你自己放进去的照片或素材，不会改成自动生图。

`image` is an optional stage type. It calls an image model with a prompt and writes the pictures into a directory whose path ends with `/`. Bundled templates (short video, article, and the rest) still default to photos or assets you put there yourself. They do not generate images on their own.

规范里的字段见 [docs/spec.md](spec.md) 的「生图执行器」。能跑的例子是 [`examples/image-shots`](../examples/image-shots)。

The fields are in ["The image executor"](spec.md) in the spec. A runnable example is [`examples/image-shots`](../examples/image-shots).

## 怎么写 / How to write it

```json
{
  "type": "image",
  "model": "zhipu/cogview-4",
  "prompt": "prompts/shots.md",
  "size": "1024x1024",
  "each": { "from": "storyboard.json", "path": "shots", "field": "image_prompt" }
}
```

`prompt` 指向的 Markdown 里可以写 `{{inputs.名称}}`。有 `each` 时，渲染后的提示词后面会接上数组里每一项的 `field`，一项一张图，文件名 `001.png`、`002.png`……没有 `each` 时，`n`（默认 1）是同一句提示词出几张。

`{{inputs.name}}` in the Markdown file named by `prompt` is filled in. With `each`, that rendered prompt is followed by the `field` of each array item, one picture per item, named `001.png`, `002.png`, and so on. Without `each`, `n` (default 1) is how many pictures that one prompt makes.

不调用接口的试跑：

Offline, with no API call:

```bash
FLOWGIT_IMAGE_MOCK_DIR=demo-pictures flowgit run shots
```

它从 `<目录>/<阶段 id>/` 按文件名复制图片。张数不够就从头循环。

That copies pictures from `<dir>/<stage id>/` in name order, and cycles from the start when there are too few.

## 密钥 / Keys

密钥只放在环境变量里，不写进 `flow.json`。`flowgit providers` 的「生图 / Image」一节会列出要哪个变量、现在设没设。下面的链接都是厂商自己的文档或控制台。

Keys live only in environment variables, never in `flow.json`. The "生图 / Image" section of `flowgit providers` lists the variable and whether it is set. Every link below is the vendor's own docs or console.

| provider | 示例模型 / Example model | 环境变量 / Variable | 怎么拿到 / Where to get it |
| --- | --- | --- | --- |
| `openai` | `gpt-image-1` | `OPENAI_API_KEY` | [创建密钥 / Create a key](https://platform.openai.com/api-keys)。接口说明：[Create image](https://developers.openai.com/api/reference/resources/images/methods/generate/)。官方说明 [`gpt-image-1` 已于 2026-10-23 下线](https://developers.openai.com/api/docs/models/gpt-image-1)，同一个地址可以改用更新的模型 id，例如 `openai/gpt-image-2.5-sunburst`。 |
| `zhipu` | `cogview-4` | `GLM_API_KEY` | 和对话预设用同一个变量名。[快速开始](https://docs.bigmodel.cn/cn/guide/start/quick-start) 说明在个人中心创建 API Key；个人套餐、团队套餐和模型标准 API 的密钥不通用，请用能调用图像模型的那一把。[图像生成 API](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90)，模型说明见 [CogView-4](https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4)。 |
| `volcengine` | `doubao-seedream-5-0-pro-260628` | `ARK_API_KEY` | 火山方舟（即梦 / Seedream）。[获取 API Key 并配置](https://www.volcengine.com/docs/82379/1541594)，再 `export ARK_API_KEY=...`。接口是 [图片生成 API](https://www.volcengine.com/docs/82379/1541523)。 |
| `dashscope` | `wan2.6-t2i` | `DASHSCOPE_API_KEY` | 通义万相，和通义千问对话用的是同一把百炼密钥。[获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)。接口是 [万相文生图](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)。北京地域的共享域名 `dashscope.aliyuncs.com` 文档写明仍可使用。 |

`openai` 的示例模型仍写成 `gpt-image-1`，因为这是这个预设对应的名字；真要调用时请换成文档里还在售的模型 id。`volcengine/` 和 `dashscope/` 后面的模型名按你开通的来写，不限于表里的例子。

The `openai` example model is still written `gpt-image-1`, because that is the name this preset is known by; for a real call, use a model id the docs still list as available. The model after `volcengine/` or `dashscope/` is whichever one you have enabled, not only the example in the table.

万相是异步的：提交后马上查一次，之后每 2 秒再查，成功再下载。`wan2.6` 走新的 messages 接口，更早的 `wanx` / `wan2.5` 及以下走原来的 `image-synthesis`。`timeoutSec` 默认 180，管这一张图从提交到下载的全部时间。

Wanxiang is async: submit, poll once immediately and then every 2 seconds, then download. `wan2.6` uses the newer messages API; older `wanx` / `wan2.5` and below keep `image-synthesis`. `timeoutSec` defaults to 180 and covers that one picture from submit through download.

接口返回 401 时，报错会用中文和英文写明要检查哪个环境变量。

A 401 names the environment variable to check, in Chinese and in English.

## 费用 / Cost

生图按张计费，而且不便宜。`n` 和 `each` 都会把调用次数乘上去：10 个镜头就是 10 次请求。Flowgit 每次只向厂商要 1 张，避免万相文档里的默认 `n=4` 让一张镜头变成四张账单。

Image APIs bill per picture, and they are not cheap. `n` and `each` both multiply the calls: 10 shots means 10 requests. Flowgit asks the vendor for 1 picture per request, so Wanxiang's documented default of `n=4` does not turn one shot into four charges.

跑一批之前先看厂商当前的价格，不要凭记忆：

Check the vendor's current prices before a batch. Do not trust a remembered number:

- OpenAI：[Image generation](https://developers.openai.com/api/docs/guides/image-generation)（价格写在这篇指南里 / prices are in this guide）
- 智谱 / Zhipu：[CogView-4](https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4) 和开放平台的价格页
- 火山方舟 / Volcengine：图片生成文档里的模型价格，以 [图片生成 API](https://www.volcengine.com/docs/82379/1541523) 为准
- 百炼 / DashScope：[万相文生图](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference) 写明费用 = 单价 × 张数

`flowgit run all --dry-run` 会把这一步标成「生图 / image」，但不会把它算进「模型调用次数」。那一栏只数对话模型。固定图片（`FLOWGIT_IMAGE_MOCK_DIR`）不会访问网络。

`flowgit run all --dry-run` marks the step as "生图 / image". It does not count toward "model calls"; that number is only chat models. Canned pictures (`FLOWGIT_IMAGE_MOCK_DIR`) do not use the network.

## 版权和平台规则 / Copyright and platform rules

生成结果能不能商用、能不能再训练、归谁，以你同意的那份厂商协议为准。Flowgit 不授予任何图片权利。

Whether you may sell the result, train on it, or who owns it is the vendor agreement you accepted. Flowgit grants no rights in the pictures.

- 提示词里不要写受版权保护的角色、商标，或厂商明确禁止的在世艺术家名字。万相文档写明：智能改写可能引入受版权保护的内容并导致审核失败。Flowgit 发送 `prompt_extend: false`，不替你打开这项改写。
- 智谱和火山方舟的水印默认开着。Flowgit 不发送关闭水印的参数。平台要求和生成式人工智能的标识规定仍然适用；不要为了冒充人工拍摄而抹掉水印。
- 下载链接通常几小时到一天就失效。Flowgit 会在阶段成功时把字节写进流程目录。`run.json` 只记张数、尺寸、模型和文件名，不记带签名的下载地址。

- Do not put copyrighted characters, trademarks, or the name of a living artist a vendor forbids into the prompt. Wanxiang's docs say the prompt rewrite can introduce copyrighted content and fail the safety check. Flowgit sends `prompt_extend: false` and does not turn that rewrite on for you.
- Zhipu and Volcengine leave the watermark on by default. Flowgit does not send a parameter that turns it off. Platform rules and generative-AI labeling rules still apply; do not strip a watermark to pass the picture off as a photograph.
- Download links usually die within hours or a day. Flowgit writes the bytes into the flow directory when the stage succeeds. `run.json` records the count, size, model and file names, not the signed download URL.
