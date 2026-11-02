# 图文帖子 / Article post

大纲 → 正文 → 配图方案 → 照片 → 导出。

Outline → draft → image plan → photos → export.

| 阶段 / Stage | 谁来做 / Who | 产物 / Output |
| --- | --- | --- |
| 大纲 outline | Claude（`prompts/outline.md`） | `outline.md` |
| 正文 draft | Claude（`prompts/draft.md`） | `draft.md` |
| 配图 images | Claude（`prompts/images.md`） | `images.json` |
| 照片 photos | 你 / you | `photos/` |
| 导出 export | `scripts/export-post.mjs` | `post.md`、`post.html` |

## 输入 / Inputs

| 输入 / Input | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `topic` | （必填 / required） | 文章主题 | What the post is about |
| `platform` | `xiaohongshu` | 发布平台：`xiaohongshu`、`wechat`、`blog`。决定篇幅和语气 | Where it is published. Sets length and tone |
| `audience` | 对这个话题好奇的普通读者 | 目标读者 | Who it is for |
| `style` | 清楚、有画面感 | 风格和语气 | Tone and style |
| `language` | `zh` | 大纲、正文、配图说明和导出日志的语言：`zh` 或 `en` | Language of the outline, draft, image notes and the export log: `zh` or `en` |

篇幅和语气 / Length and tone:

| 平台 / Platform | 篇幅 / Length | 语气 / Tone |
| --- | --- | --- |
| `xiaohongshu` | 中文约 400–800 字，英文约 150–300 词 | 短段落，口语，结尾留一个问题 |
| `wechat` | 中文约 1200–2000 字，英文约 600–1000 词 | 场景开头，几节正文，收成一句判断 |
| `blog` | 中文约 1500–2500 字，英文约 800–1400 词 | 先说读完能得到什么，分节论证，结尾写明边界 |

`xiaohongshu`: about 400–800 Chinese characters or 150–300 English words, short and conversational, ending with a question. `wechat`: about 1200–2000 characters or 600–1000 words, a scene then sections, closed with one line worth remembering. `blog`: about 1500–2500 characters or 800–1400 words, a promise up front, sections with examples, and an ending that says what the post will not cover.

## 运行 / Run

```bash
flowgit inputs set topic="为什么猫喜欢纸箱"
flowgit inputs set platform=wechat   # 可选：xiaohongshu（默认）、wechat、blog / optional
flowgit inputs set language=en       # 可选，想要英文正文时 / optional, for an English post
export ANTHROPIC_API_KEY=...         # 大纲、正文和配图方案调用 Claude / outline, draft and image plan call Claude
flowgit run all                      # 跑到照片阶段会停下等你 / stops at the photos stage and waits for you
mkdir -p photos                      # 放照片，或者先空着，导出时用画面描述占位 / add photos, or leave it empty for placeholders
flowgit run all                      # 导出 → post.md、post.html / export → post.md and post.html
```

想用别的模型写大纲、正文和配图方案，加上 `--model`，比如 `flowgit run all --model glm/glm-5.3`（需要 `GLM_API_KEY`）。`flowgit providers` 列出所有能接的模型供应商。

To use another model for the outline, draft and image plan, add `--model`, e.g. `flowgit run all --model glm/glm-5.3` (needs `GLM_API_KEY`). `flowgit providers` lists every provider you can use.

没有 API key 想先看效果，用自带的示例回复（示例内容是中文，按小红书的篇幅写的）：

No API key yet? Use the bundled demo replies (the demo content is in Chinese, written at Xiaohongshu length):

```bash
export FLOWGIT_LLM_MOCK_DIR=demo-replies   # PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"
flowgit inputs set topic=为什么猫喜欢纸箱
flowgit run all                            # 停在照片阶段 / stops at the photos stage
mkdir -p photos                            # PowerShell: mkdir photos
flowgit run all                            # 导出 → post.md、post.html / export → post.md and post.html
unset FLOWGIT_LLM_MOCK_DIR                 # 换成真的模型之前 / before a real model (PowerShell: Remove-Item Env:FLOWGIT_LLM_MOCK_DIR)
```

## 照片 / Photos

把照片放进 `photos/`，文件名用 `images.json` 里的 `file`，例如 `cover.jpg`。每张图还有 `purpose`（它在文中的作用）、`prompt`（可以直接交给图像模型的画面描述）和 `alt`（替代文本）。没有对应文件时，`post.md` 和 `post.html` 会按这个顺序放一个带画面描述的占位。

Put photos in `photos/`, named after the `file` field in `images.json`, e.g. `cover.jpg`. Each image also has a `purpose` (what it does in the post), a `prompt` (a scene description you can hand to an image model) and `alt` (alt text). A missing file becomes a placeholder with that scene description, in `images.json` order, in both `post.md` and `post.html`.

## 改一步，重跑后面 / Change one step, re-run what follows

- 不满意正文：直接改 `draft.md`，或改 `prompts/draft.md` 后 `flowgit run draft`。
- `flowgit status` 会把受影响的下游阶段标成「需重跑」，`flowgit run all` 只重跑这些；你手改过的产物会先存成一个版本，不会被覆盖。
- 想回到之前的版本：`flowgit log draft` 看历史，`flowgit restore draft 1` 回退。

- Not happy with the draft? Edit `draft.md` directly, or change `prompts/draft.md` and run `flowgit run draft`.
- `flowgit status` marks the affected downstream stages as needing a re-run, and `flowgit run all` re-runs only those. Your hand edits are saved as a version first and never overwritten.
- To go back: `flowgit log draft` shows the history, and `flowgit restore draft 1` rolls back.

导出不需要 FFmpeg。`post.html` 是一篇带标题、正文和图片的单页；缺图的位置显示画面描述。

Export does not need FFmpeg. `post.html` is a single page with the title, the body and the images; a missing image shows its scene description.
