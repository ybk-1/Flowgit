为一个主题写 3 到 5 个可以发在社交平台上的角度。只输出 JSON，不要解释。

- 主题：{{inputs.topic}}
- 受众：{{inputs.audience}}
- 语气：{{inputs.tone}}
- 平台：{{inputs.platforms}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。`id` 用英文短词，方便挑选阶段引用。

Write 3 to 5 social angles for one topic. Reply with JSON only.

- Topic: {{inputs.topic}}
- Audience: {{inputs.audience}}
- Tone: {{inputs.tone}}
- Platforms: {{inputs.platforms}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language. Keep `id` a short English slug so the pick stage can name it.

```json
{
  "angles": [
    {
      "id": "desk",
      "hook": "读者第一眼看到的那一句",
      "audience": "一个具体的人，在一个具体的场景",
      "whyItSpreads": "这个人会把帖子转给谁，因为发生了什么"
    }
  ]
}
```

规则 / Rules:

- 写 3、4 或 5 个角度。并行方案至少 3 个才有得选，多于 5 个就不值得再加（Nielsen Norman Group，并行设计）。
- 每个角度只服务一个受众、一件事。钩子必须是后面的帖子做得到的事：小红书社区规范 4.1.3 禁止标题党和图文不符。
- `whyItSpreads` 写这个受众会转发的真实场景。用当事人的经历，少用商家宣传腔（小红书 4.1.4）。不编播放量、点赞和销量（小红书 3.1.2 虚假宣传；抖音社区自律公约禁止不实信息和虚假数据；微博社区公约禁止垃圾信息和虚假阅读）。
- 不要写「国家级」「最高级」「最佳」以及「最好」「第一名」「best」「number one」这类绝对化说法（《广告法》第九条第三项，及含义相同的用语）。不要写治疗、治愈、疗效（《广告法》第十七条；抖音未认证账号不得发布诊疗内容）。
- 不要留下 `{{`、`TODO`、`TBD`、`待补充`、`待填`。
- 材料若是示例，保持虚构，不要安到真实的品牌上。
- Write 3, 4 or 5 angles. Fewer than 3 leaves no real choice; more than 5 is not worth adding (Nielsen Norman Group, parallel design).
- One audience and one idea per angle. The hook must be something the post can deliver: Xiaohongshu community rule 4.1.3 bans clickbait and a mismatch between the picture and the words.
- `whyItSpreads` is a real scene in which that audience passes the post on. Use a lived detail and little merchant-slogan wording (Xiaohongshu 4.1.4). Do not invent views, likes or sales (Xiaohongshu 3.1.2; Douyin community convention on false information and fake metrics; Weibo community convention on spam and fake reads).
- Do not use absolute claims such as 国家级, 最高级, 最佳, 最好, 第一名, "best" or "number one" (Advertising Law art. 9(3) and equivalent wording). Do not claim to treat or cure (Advertising Law art. 17; uncertified Douyin accounts may not post diagnosis or treatment).
- Leave no `{{`, `TODO`, `TBD`, `待补充` or `待填`.
- If the material is the sample, keep it fictional. Do not attach it to a real brand.
