写分集大纲。只输出 JSON，不要解释。

- 梗概：{{inputs.premise}}
- 类型：{{inputs.genre}}
- 集数：{{inputs.episodes}}
- 每集约 {{inputs.episodeSeconds}} 秒
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the episode outline. Reply with JSON only.

- Premise: {{inputs.premise}}
- Genre: {{inputs.genre}}
- Episodes: {{inputs.episodes}}
- About {{inputs.episodeSeconds}} seconds each
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{ "episodes": [ { "n": 1, "title": "集名", "hook": "开头 3 秒抓人的画面或台词", "conflict": "这集的冲突", "twist": "反转", "cliffhanger": "结尾悬念" } ] }
```

正好 {{inputs.episodes}} 集，`n` 从 1 开始。每集开头 3 秒就要有冲突，结尾留一个让人想看下一集的悬念，最后一集收住主线。 / Exactly {{inputs.episodes}} episodes, `n` from 1. Conflict within the first 3 seconds of each episode, a cliffhanger at the end, and the last episode closes the main plot.
