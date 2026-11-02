按设定和分集节拍写剧本。只输出剧本，不要解释。

- 梗概：{{inputs.premise}}
- 类型：{{inputs.genre}}
- 每集约 {{inputs.episodeSeconds}} 秒
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the scripts from the bible and the beats. Reply with the script only.

- Premise: {{inputs.premise}}
- Genre: {{inputs.genre}}
- About {{inputs.episodeSeconds}} seconds per episode
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式 / Format:

```
# <剧名>

## E1 <集名>

△ 场景：地点，时间
△ 动作或镜头（竖屏，近景为主）
人物名：台词
人物名（小声）：台词

【悬念】结尾的一句话或画面
```

规则 / Rules:

- 每集一个 `## E<集号>`，集号和节拍一致；付费卡点那一集最后一行写 `【付费卡点】`（英文写 `[Paywall]`），其他集写 `【悬念】`（英文写 `[Cliffhanger]`）。
- 第一行就进冲突，不要用旁白交代背景；背景放进动作和台词里。
- `△` 写场景和动作，一行就是一个镜头，大约 3 到 6 秒。台词写成 `人物名：台词`，人物名和人物表一致。台词要短，像真人说话；按每秒约 4 个汉字（英文 2.5 个词）控制总量。
- 内容遵守广电总局对微短剧的管理提示：不渲染奢华拜金，不用低俗、色情、血腥暴力的画面吸引人，人设和剧情不要极端反智、离谱。
- One `## E<number>` per episode, numbered as in the beats. The paywall episode's last line starts with `[Paywall]` (`【付费卡点】` in Chinese); the others end with `[Cliffhanger]` (`【悬念】`).
- Start inside the conflict; no voice-over exposition. Background comes through action and dialogue.
- Each `△` line is one shot of about 3 to 6 seconds. Dialogue is `Name: line`, names from the character list, short and natural; budget about 2.5 English words (4 Chinese characters) per second.
- Follow NRTA guidance on micro-dramas: no glamorized wealth worship, no vulgar, sexual or gory images as the draw, no absurd or anti-intellectual characters or plots.
