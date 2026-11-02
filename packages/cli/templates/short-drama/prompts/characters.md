为这部竖屏微短剧写故事设定和人物。只输出 JSON，不要解释。

- 梗概：{{inputs.premise}}
- 类型：{{inputs.genre}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the story bible and characters for this vertical micro-drama. Reply with JSON only.

- Premise: {{inputs.premise}}
- Genre: {{inputs.genre}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "logline": "一句话故事：谁，想要什么，被什么挡住",
  "emotion": "观众来看的核心情绪，例如：被看不起的人逆袭",
  "promise": "前几集答应观众的爽点或悬念",
  "characters": [ { "name": "名字", "role": "身份和在故事里的位置", "want": "想要什么", "obstacle": "挡住他的是什么", "secret": "藏着什么" } ]
}
```

要点 / Craft:

- 短剧先定情绪再定故事：观众是为了某种情绪来的（扬眉吐气、心动、解气、好奇），`emotion` 要具体。
- 主角的目标要能撑起整部剧，阻碍要具体到人；反派或对手要有自己的道理，不要无脑坏。
- 3 到 5 个人物，名字好记、不重名、不太像。
- 避开广电总局管理提示里点名的问题：不渲染奢华拜金，不靠低俗、血腥暴力吸引人，人设和剧情不要极端反智、离谱；涉及老人、孩子的人物要有尊严。
- Micro-drama starts from the emotion the audience comes for (vindication, a crush, catharsis, curiosity); make `emotion` specific.
- The lead's goal carries the series and the obstacle is a person; the antagonist has their own reasons.
- 3 to 5 characters with names that are easy to tell apart.
- Avoid what China's NRTA guidance calls out: glamorized wealth worship, vulgarity or gore as the draw, absurd or anti-intellectual characters and plots; elderly and child characters keep their dignity.
