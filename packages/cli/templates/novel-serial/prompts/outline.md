按设定写前 {{inputs.chapters}} 章的细纲。只输出 JSON，不要解释。

- 类型：{{inputs.genre}}
- 每章目标字数：{{inputs.chapterWords}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Outline the first {{inputs.chapters}} chapters from the setting. Reply with JSON only.

- Genre: {{inputs.genre}}
- Target length per chapter: {{inputs.chapterWords}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "chapters": [
    {
      "n": 1,
      "title": "章名",
      "goal": "主角这一章想做成什么",
      "conflict": "谁或什么挡住他",
      "payoff": "这一章让读者爽或者揪心的那个点（反击、打脸、突破、揭秘、心动）；没有就写空字符串",
      "hook": "最后一句停在哪里，让人想点下一章",
      "edge": false,
      "promises": ["p1"]
    }
  ]
}
```

规则 / Rules:

- 每章都要有 `goal`、`conflict` 和 `hook`。`hook` 是一个没解决的问题或刚出现的危机，不是总结。
- 黄金三章：第 1 章就进入冲突；主角的金手指（设定里的 `edge`）最晚在第 3 章亮出来，亮出来的那一章 `edge` 写 true；第 3 章结尾要让读者明白这本书的主线是什么。
- 爽点不能断太久：最多连续两章 `payoff` 为空。先压后扬，压抑的章节后面要跟上兑现。
- `promises` 填设定里的期待 id。每件期待在这些章节里至少推进一次。

- Every chapter has a `goal`, a `conflict` and a `hook`. The hook is an open question or a fresh threat, not a summary.
- The first three chapters: chapter 1 starts in conflict; the hero's edge (`edge` in the setting) shows by chapter 3 at the latest, and that chapter sets `edge` to true; chapter 3 ends with the main line of the book clear.
- Don't let payoffs lapse: at most two chapters in a row with an empty `payoff`. A low stretch must be followed by a payoff.
- `promises` lists ids from the setting. Each expectation moves forward at least once in these chapters.

输出语言是 {{inputs.language}}。是 en 时，JSON 里每一个字符串都写英文，人名和设定里的一致，即使设定、类型或上面的示例是中文；是 zh 时写中文。
The output language is {{inputs.language}}. If it is en, every string in the JSON is English, with the names as the setting has them, even when the setting, the genre or the examples above are in Chinese; if it is zh, Chinese.
