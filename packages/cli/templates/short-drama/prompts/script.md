按人物和分集大纲写完整剧本。只输出剧本，不要解释。

- 梗概：{{inputs.premise}}
- 类型：{{inputs.genre}}
- 每集约 {{inputs.episodeSeconds}} 秒
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the full script from the characters and the episode outline. Reply with the script only.

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

- 每集一个 `## E<集号>`，集号和大纲一致。
- 场景和动作用 `△` 开头，台词写成 `人物名：台词`（英文用 `Name: line`），人物名和人物表一致。
- 台词要短，像真人说话。按大约每秒 4 个汉字（英文每秒 2.5 个词）控制台词总量。
- 每集最后一行用 `【悬念】`（英文写 `[Cliffhanger]`）开头。
- One `## E<number>` per episode, numbered as in the outline.
- Scene and action lines start with `△`; dialogue is `Name: line`, with names from the character list.
- Short, natural lines. Budget about 4 Chinese characters (2.5 English words) of dialogue per second.
- Each episode's last line starts with `【悬念】` (or `[Cliffhanger]` in English).
