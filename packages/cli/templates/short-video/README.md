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
- **转场**：镜头之间交叉淡化，开头淡入、结尾淡出，总时长不变。

- **Images** slowly zoom in or out (in on odd shots, out on even ones). A landscape picture in a vertical video sits on a blurred, darkened copy of itself instead of black bars.
- **Videos** get the same blurred fill.
- **Shots without an asset** become text cards on a slowly moving two-colour gradient (FFmpeg 6.0+; a flat colour on older builds).
- **The title** shows over the first shot for about 2.5 seconds, then fades; **captions** sit on a translucent box.
- **Transitions**: clips cross-fade, with a fade in at the start and out at the end; the total length stays the same.

在 `timeline.json` 里可以调整 / You can tweak these in `timeline.json`:

```json
{
  "transition": { "type": "fade", "duration": 0.4 },
  "clips": [{ "id": "s1", "motion": "zoom-out" }]
}
```

`transition.type` 写 `"none"` 关掉转场；镜头的 `motion` 可以是 `"zoom-in"`、`"zoom-out"` 或 `"none"`（只对图片有效）。

Set `transition.type` to `"none"` to turn transitions off; a clip's `motion` can be `"zoom-in"`, `"zoom-out"` or `"none"` (images only).

## 配音 / Voiceover

配音阶段（`scripts/tts.mjs`）读 `script.md`，去掉标题、画面说明和其他不念出来的部分，调用语音接口把口播合成 `voice/voice.mp3`。一段太长时会拆开请求，再用 FFmpeg 拼成一条（导出视频本来就要装 FFmpeg）。

The voice stage (`scripts/tts.mjs`) reads `script.md`, drops headings, visual notes and anything else that is not spoken, and calls a speech API to write `voice/voice.mp3`. A long script is split into several requests and joined with FFmpeg (you already need FFmpeg to export).

密钥只从环境变量读，不会写进文件。没设置 `FLOWGIT_TTS_API_KEY` 时这一步不失败：它写下 `voice/README.md` 然后继续，你可以之后自己录音。

The key is read only from the environment and never written to a file. With no `FLOWGIT_TTS_API_KEY` the stage does not fail: it writes `voice/README.md` and continues, so you can record the voice later.

| 变量 / Variable | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `FLOWGIT_TTS_API_KEY` | （没有 / unset） | 语音合成的密钥 | Speech API key |
| `FLOWGIT_TTS_BASE_URL` | `https://api.openai.com/v1` | 兼容 OpenAI 语音接口的服务地址，不要自己加上 `/audio/speech` | Base URL of an OpenAI-compatible speech service; do not append `/audio/speech` |
| `FLOWGIT_TTS_MODEL` | `gpt-4o-mini-tts` | 模型 | Model |
| `FLOWGIT_TTS_VOICE` | `alloy` | 声音 | Voice |

```bash
export FLOWGIT_TTS_API_KEY=...
# PowerShell: $env:FLOWGIT_TTS_API_KEY = "..."
# 换一家兼容 OpenAI 语音接口的服务 / another OpenAI-compatible speech service
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

把音乐文件命名为 `music.mp3`（或 `music.m4a`、`music.wav`、`bgm.mp3` 等）放进 `assets/`，剪辑阶段会把它写进 `timeline.json`，导出时自动循环或截到视频长度，开头淡入、结尾淡出。音量在 `timeline.json` 里改：

Put a music file named `music.mp3` (or `music.m4a`, `music.wav`, `bgm.mp3`, …) in `assets/`. The edit stage adds it to `timeline.json`, and the export loops or trims it to the video's length with a fade in and out. Change the volume in `timeline.json`:

```json
{ "music": { "path": "assets/music.mp3", "volume": 0.6 } }
```

请只用你有权使用的音乐。/ Only use music you have the rights to.

## 改一步，重跑后面 / Change one step, re-run what follows

- 不满意分镜：直接改 `storyboard.json`，或改 `prompts/storyboard.md` 后 `flowgit run storyboard`。
- `flowgit status` 会把受影响的下游阶段标成"需重跑"，`flowgit run all` 只重跑这些；你手改过的产物会先存成一个版本，不会被覆盖。
- 想回到之前的版本：`flowgit log storyboard` 看历史，`flowgit restore storyboard 1` 回退。

- Not happy with the storyboard? Edit `storyboard.json` directly, or change `prompts/storyboard.md` and run `flowgit run storyboard`.
- `flowgit status` marks the affected downstream stages as needing a re-run, and `flowgit run all` re-runs only those. Your hand edits are saved as a version first and never overwritten.
- To go back: `flowgit log storyboard` shows the history, and `flowgit restore storyboard 1` rolls back.

导出需要本机安装 [FFmpeg](https://ffmpeg.org/download.html)。字幕需要中文字体，找不到时可以设置 `FLOWGIT_FONT=/path/to/font.ttc`。

Export needs [FFmpeg](https://ffmpeg.org/download.html) installed. Captions need a font with Chinese glyphs; if none is found, set `FLOWGIT_FONT=/path/to/font.ttc`.
