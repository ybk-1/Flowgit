写分集节拍。只输出 JSON，不要解释。

- 梗概：{{inputs.premise}}
- 类型：{{inputs.genre}}
- 集数：{{inputs.episodes}}，每集约 {{inputs.episodeSeconds}} 秒
- 付费卡点：第 {{inputs.paywallAt}} 集结尾（0 表示不设）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the episode beats. Reply with JSON only.

- Premise: {{inputs.premise}}
- Genre: {{inputs.genre}}
- Episodes: {{inputs.episodes}}, about {{inputs.episodeSeconds}} seconds each
- Paywall: end of episode {{inputs.paywallAt}} (0 for none)
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "episodes": [
    {
      "n": 1,
      "title": "集名",
      "hook": "前 3 秒的画面或台词：一上来就是冲突",
      "suppression": "压抑：主角被压、被误会、吃亏的地方",
      "payoff": "爆发：反转、打脸或心动的那一下",
      "cliffhanger": "结尾悬念：让人马上想看下一集",
      "paywall": false
    }
  ]
}
```

节奏 / Rhythm:

- 正好 {{inputs.episodes}} 集，`n` 从 1 开始。每集都按“钩子 → 压抑 → 爆发 → 悬念”走，一集至少一个爆发点。
- 第 1 集前 3 秒就要有冲突，交代清楚主角是谁、想要什么、被谁挡住；前几集兑现设定里答应观众的爽点。
- 第 {{inputs.paywallAt}} 集的 `paywall` 设为 true：结尾放在情绪最高、悬念最强的地方，而不是故事自然停下的地方。
- 爆发要有前面的铺垫，反转要合理；不要连着几集重复同一种打脸。
- Exactly {{inputs.episodes}} episodes, `n` from 1, each going hook → suppression → payoff → cliffhanger, with at least one payoff per episode.
- Episode 1 opens on conflict within 3 seconds and makes clear who the lead is, what they want and who blocks them; the early episodes deliver the promise.
- Episode {{inputs.paywallAt}} has `paywall: true` and ends at the emotional peak with the strongest question, not where the story naturally rests.
- Payoffs are set up earlier and twists make sense; do not repeat the same kind of payoff episode after episode.
