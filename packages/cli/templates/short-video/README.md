# 短视频制作 / Short video

脚本 → 配音 → 分镜 → 素材 → 剪辑 → 导出。

Script → voiceover → storyboard → assets → edit → export.

| 阶段 / Stage | 谁来做 / Who | 产物 / Output |
| --- | --- | --- |
| 脚本 script | Claude（`prompts/script.md`） | `script.md` |
| 配音 voice | `scripts/tts.mjs` | `voice/` |
| 分镜 storyboard | Claude（`prompts/storyboard.md`） | `storyboard.json` |
| 素材 assets | 你 / you | `assets/` |
| 剪辑 edit | `scripts/build-timeline.mjs` | `timeline.json` |
| 导出 export | `scripts/render.mjs`（FFmpeg） | `final.mp4` |

## 输入 / Inputs

| 输入 / Input | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `topic` | （必填 / required） | 视频主题 | What the video is about |
| `duration` | `30` | 目标时长（秒） | Target length in seconds |
| `style` | 轻松科普 | 风格和语气 | Tone and style |
| `audience` | 短视频平台的普通观众 | 目标观众 | Who it is for |
| `language` | `zh` | 脚本、字幕和模板提示用的语言：`zh` 或 `en` | Language of the script, captions and template messages: `zh` or `en` |
| `platform` | `douyin` | 导出预设。见下面的平台表 | Export preset. See the platform table below |

## 运行 / Run

```bash
flowgit inputs set topic="为什么猫喜欢纸箱"
flowgit inputs set language=en     # 可选，想要英文视频时 / optional, for an English video
export ANTHROPIC_API_KEY=...       # 脚本和分镜阶段调用 Claude / the script and storyboard stages call Claude
export FLOWGIT_TTS_API_KEY=...     # 可选：自动配音 / optional: automatic voiceover
flowgit run all                    # 跑到素材阶段会停下等你 / stops at the assets stage and waits for you
mkdir -p assets                    # 放素材，或者先空着，导出时用文字卡 / add assets, or leave it empty for text cards
flowgit run all                    # 剪辑 + 导出 → final.mp4 / edit + export → final.mp4
```

想用别的模型写脚本和分镜，加上 `--model`，比如 `flowgit run all --model glm/glm-5.3`（需要 `GLM_API_KEY`）。`flowgit providers` 列出所有能接的模型供应商。

To use another model for the script and storyboard, add `--model`, e.g. `flowgit run all --model glm/glm-5.3` (needs `GLM_API_KEY`). `flowgit providers` lists every provider you can use.

没有 API key 想先看效果，用自带的示例回复（示例内容是中文）：

No API key yet? Use the bundled demo replies (the demo content is in Chinese):

```bash
export FLOWGIT_LLM_MOCK_DIR=demo-replies   # PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"
flowgit inputs set topic=为什么猫喜欢纸箱
flowgit run all                            # 停在素材阶段 / stops at the assets stage
mkdir -p assets                            # PowerShell: mkdir assets
flowgit run all                            # 剪辑 + 导出 → final.mp4 / edit + export → final.mp4
unset FLOWGIT_LLM_MOCK_DIR                 # 换成真的模型之前 / before a real model (PowerShell: Remove-Item Env:FLOWGIT_LLM_MOCK_DIR)
```

## 素材 / Assets

把图片或视频放进 `assets/`，文件名用分镜里的镜头 id，例如 `s1.jpg`、`s2.mp4`。没有素材的镜头会用口播文字做成文字卡。

Put images or videos in `assets/`, named after the shot ids in the storyboard, e.g. `s1.jpg`, `s2.mp4`. A shot with no asset becomes a text card showing its narration.

## 画面 / Look

- **图片**会慢慢推近或拉远（单数镜头推近、双数镜头拉远）。横图放进竖屏时，背景用同一张图模糊、压暗后铺满，不会有黑边。
- **视频**同样用模糊背景铺满画面。
- **没有素材的镜头**是缓慢流动的双色渐变文字卡（FFmpeg 6.0 以上；更旧的版本用纯色）。
- **标题**在第一个镜头上显示约 2.5 秒后淡出；**字幕**放在半透明底框上。
- **转场**：镜头之间默认交叉淡化，也可以改成硬切、滑动或缩放。开头淡入、结尾淡出，总时长不变。

- **Images** slowly zoom in or out (in on odd shots, out on even ones). A landscape picture in a vertical video sits on a blurred, darkened copy of itself instead of black bars.
- **Videos** get the same blurred fill.
- **Shots without an asset** become text cards on a slowly moving two-colour gradient (FFmpeg 6.0+; a flat colour on older builds).
- **The title** shows over the first shot for about 2.5 seconds, then fades; **captions** sit on a translucent box.
- **Transitions**: clips cross-fade by default, or use a cut, slide or zoom. The picture fades in at the start and out at the end; the total length stays the same.

在 `timeline.json` 里可以调整 / You can tweak these in `timeline.json`:

```json
{
  "transition": { "type": "fade", "duration": 0.4 },
  "clips": [{ "id": "s1", "motion": "zoom-out" }]
}
```

`transition.type` 可以是 `"fade"`、`"slide"`、`"zoom"`、`"cut"`（`"none"` 和硬切一样）。写在时间线上是所有缝隙的默认值；写在某一个镜头上，只影响它和下一个镜头之间的那一条缝。镜头的 `motion` 可以是 `"zoom-in"`、`"zoom-out"` 或 `"none"`（只对图片有效）。

`transition.type` can be `"fade"`, `"slide"`, `"zoom"` or `"cut"` (`"none"` is a cut). On the timeline it is the default for every gap; on one clip it only affects the gap after that clip. A clip's `motion` can be `"zoom-in"`, `"zoom-out"` or `"none"` (images only).

在看板上点两个镜头之间的缝隙，转场会在硬切、淡化、滑动、缩放之间换，预览里也能看到。字幕样式在同一条工具栏上选，预览和导出读的是同一份 `scripts/caption-style.json`（`classic`、`bold`、`outline`、`soft`、`lower`）。

On the board, click the gap between two shots to cycle cut, fade, slide and zoom; the preview shows it too. The caption style is on the same toolbar. Preview and export read the same `scripts/caption-style.json` (`classic`, `bold`, `outline`, `soft`, `lower`).

## 配音 / Voiceover

配音阶段（`scripts/tts.mjs`）读 `script.md`，去掉标题、画面说明和其他不念出来的部分，调用语音接口把口播合成 `voice/voice.mp3`。一段太长时按句子拆开请求，再用 FFmpeg 拼成一条（导出视频本来就要装 FFmpeg）。没有 FFmpeg 时，这一步会说明要先安装。

The voice stage (`scripts/tts.mjs`) reads `script.md`, drops headings, visual notes and anything else that is not spoken, and calls a speech API to write `voice/voice.mp3`. A long script is split on sentence boundaries and joined with FFmpeg (you already need FFmpeg to export). With no FFmpeg, the stage says to install it first.

密钥只从环境变量读，不会写进文件。下面两种用法：

The key is read only from the environment and never written to a file. Two ways to call it:

1. **预设 / Preset.** `FLOWGIT_TTS=<供应商>/<模型或声音>`。`node scripts/tts.mjs --list` 列出预设、要设置的环境变量，以及现在有没有设置（不打印密钥本身）。选了预设却没配密钥，这一步会失败，并在中文和英文里写上变量名。
2. **OpenAI 兼容接口 / OpenAI-compatible API.** 不设置 `FLOWGIT_TTS`，只设置 `FLOWGIT_TTS_API_KEY`。没设置时这一步不失败：它写下 `voice/README.md` 然后继续，你可以之后自己录音。

1. **Preset.** `FLOWGIT_TTS=<provider>/<model or voice>`. `node scripts/tts.mjs --list` lists the presets, the env vars they need, and whether each one is set (it never prints the secret). A preset with no key fails the stage and names that variable in Chinese and English.
2. **OpenAI-compatible API.** Leave `FLOWGIT_TTS` unset and set only `FLOWGIT_TTS_API_KEY`. With no key the stage does not fail: it writes `voice/README.md` and continues, so you can record the voice later.

`FLOWGIT_TTS_BASE_URL`、`FLOWGIT_TTS_API_KEY`、`FLOWGIT_TTS_MODEL`、`FLOWGIT_TTS_VOICE` 会覆盖预设。流程语言是 `en` 且没指定声音时，用该预设的英文音色。

`FLOWGIT_TTS_BASE_URL`, `FLOWGIT_TTS_API_KEY`, `FLOWGIT_TTS_MODEL` and `FLOWGIT_TTS_VOICE` override a preset. When the flow language is `en` and you didn't pick a voice, the preset's English voice is used.

| 预设 / Preset | 示例 / Example | 密钥 / Key | 还要 / Also |
| --- | --- | --- | --- |
| OpenAI 语音 / OpenAI Audio Speech | `FLOWGIT_TTS=openai/gpt-4o-mini-tts` | `OPENAI_API_KEY` | |
| 阿里云百炼 CosyVoice / Alibaba DashScope CosyVoice | `FLOWGIT_TTS=dashscope/cosyvoice-v3-flash` | `DASHSCOPE_API_KEY` | `DASHSCOPE_WORKSPACE_ID`（官方地址里的工作空间 ID / workspace id in the official host） |
| 火山引擎豆包 / Volcengine Doubao | `FLOWGIT_TTS=volcengine/seed-tts-2.0` | `VOLCENGINE_API_KEY` | |
| MiniMax | `FLOWGIT_TTS=minimax/speech-2.8-hd` | `MINIMAX_API_KEY` | 国际站把 `FLOWGIT_TTS_BASE_URL` 设为 `https://api.minimax.io` / for the international host set `FLOWGIT_TTS_BASE_URL` to `https://api.minimax.io` |
| Azure 语音 / Azure Speech | `FLOWGIT_TTS=azure/zh-CN-Xiaoxiao:DragonHDFlashLatestNeural` | `SPEECH_KEY` | `SPEECH_REGION`（例如 `eastus` / e.g. `eastus`） |

斜线后面：OpenAI、百炼、豆包、MiniMax 是模型；Azure 是声音。每个预设都带一组文档里的中文和英文音色，请求里带语速，输出 mp3（这些接口也能出 wav，这里用 mp3，好写成 `voice/voice.mp3`）。地址和参数来自各家当前的官方文档，`--list` 里有链接。

After the slash: OpenAI, DashScope, Doubao and MiniMax take a model; Azure takes a voice. Each preset has a few documented Chinese and English voices, sends a speaking rate, and asks for mp3 (those APIs can also return wav; mp3 is what `voice/voice.mp3` needs). The URL and parameters come from each vendor's current docs; `--list` links them.

| 变量 / Variable | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `FLOWGIT_TTS` | （没有 / unset） | `<供应商>/<模型或声音>` | `<provider>/<model or voice>` |
| `FLOWGIT_TTS_API_KEY` | （没有 / unset） | 覆盖预设的密钥；没选预设时，这是 OpenAI 兼容接口的密钥 | Overrides the preset key; with no preset, this is the OpenAI-compatible key |
| `FLOWGIT_TTS_BASE_URL` | 预设自己的官方地址；没选预设时是 `https://api.openai.com/v1` | 覆盖服务地址。OpenAI 兼容接口不要自己加上 `/audio/speech`；预设只写协议和主机，不要自己加路径 | Overrides the service URL. For the OpenAI-compatible API, do not append `/audio/speech`; for a preset, set only the scheme and host, not the path |
| `FLOWGIT_TTS_MODEL` | 预设或 `gpt-4o-mini-tts` | 覆盖模型（Azure 没有模型，这个变量不用） | Overrides the model (Azure has no model; this variable does not apply) |
| `FLOWGIT_TTS_VOICE` | 预设按语言挑一个；没选预设时是 `alloy` | 覆盖声音 | Overrides the voice |

```bash
export FLOWGIT_TTS=openai/gpt-4o-mini-tts
export OPENAI_API_KEY=...
# PowerShell: $env:FLOWGIT_TTS = "openai/gpt-4o-mini-tts"; $env:OPENAI_API_KEY = "..."
node scripts/tts.mjs --list

# 百炼：工作空间 ID 来自控制台，密钥是 DASHSCOPE_API_KEY
# DashScope: the workspace id is from the console, the key is DASHSCOPE_API_KEY
export FLOWGIT_TTS=dashscope/cosyvoice-v3-flash
export DASHSCOPE_API_KEY=...
export DASHSCOPE_WORKSPACE_ID=...

# 不选预设，走 OpenAI 兼容接口 / no preset: an OpenAI-compatible speech API
export FLOWGIT_TTS_API_KEY=...
export FLOWGIT_TTS_BASE_URL=https://example.com/v1
export FLOWGIT_TTS_MODEL=tts-1
export FLOWGIT_TTS_VOICE=nova
flowgit run voice
```

自己录的配音优先。把旁白录成 `voice.mp3`（或 `voice.m4a`、`voice.wav`、`配音.mp3`、`narration.mp3` 等）放进 `assets/`，剪辑阶段会用它，而不是 `voice/voice.mp3`。然后重跑剪辑和导出。剪辑阶段会：

- 把配音写进 `timeline.json`，导出时从头播放；
- 让镜头时长跟着配音走：按每个镜头旁白的字数，把配音的总长分给各个镜头，每段画面大致对上它的那句话；
- 有背景音乐时自动把音乐压低到 0.2，免得盖过人声。

Record the narration from `script.md` as one audio file (a phone recording is fine), name it `voice.mp3` (or `voice.m4a`, `voice.wav`, `配音.mp3`, `narration.mp3`, …), put it in `assets/` and re-run the edit and export stages. The edit stage:

- adds the voiceover to `timeline.json`, played from the start on export;
- fits the clips to the voice: the voiceover's length is shared between the clips by how much narration each one has, so each shot is roughly on screen while its line is spoken;
- turns background music down to 0.2 so it doesn't drown out the voice.

自动分配只是起点：哪个镜头切早了或切晚了，直接改 `timeline.json` 里那个镜头的 `duration`，再跑导出。配音比视频长时，导出会提示，结尾会被截掉。

The automatic split is a starting point: if a cut comes too early or late, change that clip's `duration` in `timeline.json` and export again. If the voiceover is longer than the video, the export says so and its end is cut.

```json
{
  "voice": { "path": "voice/voice.mp3", "volume": 1 },
  "music": { "path": "assets/music.mp3", "volume": 0.2 }
}
```

自己录进 `assets/` 时，`voice.path` 会是 `assets/voice.mp3`。

When you record into `assets/`, `voice.path` is `assets/voice.mp3` instead.

## 背景音乐 / Music

把音乐文件命名为 `music.mp3`（或 `music.m4a`、`music.wav`、`bgm.mp3` 等）放进 `assets/`，剪辑阶段会把它写进 `timeline.json`，导出时自动循环或截到视频长度，开头淡入、结尾淡出。有配音时，音乐在人声下面用 FFmpeg 的 `sidechaincompress` 压低（参数和范围见 [ffmpeg 文档](https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress)），人声过去之后再回来。音量可以在看板上拖，也可以改 `timeline.json`：

Put a music file named `music.mp3` (or `music.m4a`, `music.wav`, `bgm.mp3`, …) in `assets/`. The edit stage adds it to `timeline.json`, and the export loops or trims it to the video's length with a fade in and out. When there is a voiceover, FFmpeg `sidechaincompress` ducks the music under the voice (the parameters and their ranges are in the [ffmpeg docs](https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress)) and lets it return after the voice. Drag the volume on the board, or change it in `timeline.json`:

```json
{ "music": { "path": "assets/music.mp3", "volume": 0.6 } }
```

请只用你有权使用的音乐。/ Only use music you have the rights to.

## 平台预设 / Platform presets

`platform` 决定导出用哪一套规格。数字只来自平台自己的文档或创作者后台；某一项没有官方出处就留空，导出时不猜。出处和取舍写在 `scripts/platforms.json`。时间线上会画出有出处的安全区；没有安全区数字的平台会写明。

`platform` picks the export spec. A number is included only when that platform's own docs or creator center publish it; anything without a source is left empty and the export does not guess. Sources and the choices are in `scripts/platforms.json`. The timeline draws a safe-area guide when a source gives one, and says so when it does not.

| 平台 / Platform | 尺寸 / Size | 帧率 / fps | 时长上限 / Max length | 码率 / Bitrate | 安全区 / Safe area | 来源 / Source |
| --- | --- | --- | --- | --- | --- | --- |
| 抖音 `douyin` | 720×1280 | （没有公布 / not published） | 15 分钟 / 15 min | （没有公布 / not published） | （没有公布 / not published） | [发布方案](https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-publish-solution)、[上传样例 720×1280](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/create/upload/) |
| 视频号 `channels` | （建议 1080p 及以上，没有像素 / 1080p or above, no pixels） | （没有公布 / not published） | 电脑 2 小时，手机 30 分钟 / 2 h on a computer, 30 min on a phone | （没有公布 / not published） | （没有公布 / not published） | [微信开放社区](https://developers.weixin.qq.com/community/minihome/doc/000e62d83dcb4069b7bfc5d4057000) |
| 小红书 `xiaohongshu` | （建议 1080P 及以上，没有像素 / 1080P or above, no pixels） | （没有公布 / not published） | 4 小时 / 4 h | （没有公布 / not published） | （没有公布 / not published） | [创作服务平台发布页](https://creator.xiaohongshu.com/publish/publish) |
| 哔哩哔哩 `bilibili` | （上限 4096×2160，不是建议尺寸 / ceiling 4096×2160, not a suggested size） | （上限 120，不是建议值 / ceiling 120, not a suggested value） | 小于 5 小时 / under 5 h | （峰值上限 60 Mbps，不是建议值 / peak ceiling 60 Mbps, not a suggested value） | （没有公布 / not published） | [开放平台上传预处理](https://open.bilibili.com/doc/4/0c532c6a-e6fb-0aff-8021-905ae2409095) |
| YouTube Shorts `youtube-shorts` | 1080×1920 | 30（列出的常见帧率之一 / one of the listed common rates） | 3 分钟 / 3 min | 视频 8 Mbps，立体声 384 kbps / video 8 Mbps, stereo 384 kbps | 上 288、右 192、下 672、左 48（竖版广告安全区，1080×1920） / top 288, right 192, bottom 672, left 48 (vertical ad safe zone, 1080×1920) | [3 分钟](https://support.google.com/youtube/answer/15424877?hl=en)、[1080p](https://support.google.com/youtube/answer/10059070?hl=en)、[码率](https://support.google.com/youtube/answer/1722171?hl=en)、[9:16](https://support.google.com/youtube/answer/6375112?hl=en)、[安全区 PDF](https://services.google.com/fh/files/helpcenter/ytadsafezones.pdf) |
| TikTok `tiktok` | 720×1280 | （没有公布 / not published） | 30 分钟（Studio） / 30 min (Studio) | （没有把广告下限 516 kbps 当成建议值 / the 516 kbps ad minimum is not used as a suggestion） | （没有单一数字 / no single number） | [创作者工具](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok)、[信息流广告](https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads) |

抖音文档同时写了“16:9、720p（1280×720）”和“竖版”，上传接口的响应样例是 720×1280，所以用样例这组像素。视频号和小红书只说了 1080p 及以上，没有像素，导出就保持时间线原来的尺寸。B 站写的是上限，不是建议的竖屏尺寸。YouTube 的安全区来自竖版视频广告 PDF，不是 Shorts 自然播放界面的实测。TikTok 的相机工具页仍写应用内上传最长 3 分钟，和 Studio 的 30 分钟不一致，这里用 Studio。

Douyin's docs say both "16:9, 720p (1280×720)" and "vertical"; the upload sample response is 720×1280, so that is the size used. WeChat Channels and Xiaohongshu only say 1080p or above, with no pixels, so the export keeps the timeline's size. Bilibili publishes ceilings, not a suggested vertical size. YouTube's safe area is the vertical video-ad PDF, not a measurement of the organic Shorts player. TikTok's camera-tools page still says in-app uploads last up to 3 minutes, which disagrees with Studio's 30 minutes; Studio is what this preset uses.

## 在时间线上剪辑 / Edit on the timeline

剪辑阶段写出 `timeline.json` 之后，在看板上打开它，直接在时间线上改，不用手改 JSON。

After the edit stage writes `timeline.json`, open it on the board and change it on the timeline instead of editing the JSON by hand.

- 拖动镜头改变顺序，拖边缘改变时长。拖边缘时，靠近配音结尾会吸附到配音的长度；「吸附配音」按配音总长重分各镜头。
- 双击字幕改文字。点一个镜头，从 `assets/` 里已上传的文件换素材。
- 刻度可以缩放，播放头可以拖。预览用画面、字幕、配音和背景音乐播放，镜头之间的转场在预览里也能看到。字幕的位置、字号和描边跟 FFmpeg 导出一致，规则在 `scripts/caption-style.json`（剪辑阶段会抄一份到时间线上，预览读这份；导出时 `render.mjs` 再读这个文件）。选了平台之后，有官方安全区的会在预览上画出参考线。背景音乐的音量在音乐条上拖。
- 键盘：Tab 选中镜头，左右键移动，`[` `]` 改变时长，空格播放。撤销和重做保留 50 步。系统开了「减少动态效果」时，预览不再做推拉镜头。
- 保存后，这次修改成为手动修改，导出阶段显示为需要重跑。时间线顶部的「重新导出」会再跑导出。

- Drag a shot to reorder it, or drag an edge to change its length. An edge near the end of the voiceover snaps to that length; "Snap to voice" shares the voiceover across the shots.
- Double-click a caption to edit the text. Click a shot to swap its asset for a file already in `assets/`.
- Zoom the ruler and drag the playhead. The preview plays picture, captions, voice and music, including the transition between shots. Caption position, size and outline match the FFmpeg export; the rules live in `scripts/caption-style.json` (the edit stage copies them onto the timeline for the preview, and `render.mjs` reads the file again on export). When the platform publishes a safe area, the preview draws it. Drag the music volume on the music bar.
- Keyboard: Tab selects a shot, the arrow keys move it, `[` and `]` change its length, and Space plays. Undo and redo keep 50 steps. With "reduce motion" on, the preview does not zoom the picture.
- Saving stores the change as a hand edit, and the export stage shows that it needs a re-run. "Re-export" at the top of the timeline runs the export again.

## 改一步，重跑后面 / Change one step, re-run what follows

- 不满意分镜：直接改 `storyboard.json`，或改 `prompts/storyboard.md` 后 `flowgit run storyboard`。
- `flowgit status` 会把受影响的下游阶段标成"需重跑"，`flowgit run all` 只重跑这些；你手改过的产物会先存成一个版本，不会被覆盖。
- 想回到之前的版本：`flowgit log storyboard` 看历史，`flowgit restore storyboard 1` 回退。

- Not happy with the storyboard? Edit `storyboard.json` directly, or change `prompts/storyboard.md` and run `flowgit run storyboard`.
- `flowgit status` marks the affected downstream stages as needing a re-run, and `flowgit run all` re-runs only those. Your hand edits are saved as a version first and never overwritten.
- To go back: `flowgit log storyboard` shows the history, and `flowgit restore storyboard 1` rolls back.

导出需要本机安装 [FFmpeg](https://ffmpeg.org/download.html)。字幕需要中文字体，找不到时可以设置 `FLOWGIT_FONT=/path/to/font.ttc`。

Export needs [FFmpeg](https://ffmpeg.org/download.html) installed. Captions need a font with Chinese glyphs; if none is found, set `FLOWGIT_FONT=/path/to/font.ttc`.
