写活动简报。只输出 JSON，不要解释。

- 活动：{{inputs.event}}
- 目的：{{inputs.goal}}
- 预计人数：{{inputs.attendees}}
- 面向：{{inputs.audience}}（invite = 邀请制，public = 面向社会公众）
- 总预算：{{inputs.budget}}
- 场地：{{inputs.venue}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the event brief. Reply with JSON only.

- Event: {{inputs.event}}
- Purpose: {{inputs.goal}}
- Expected attendance: {{inputs.attendees}}
- Audience: {{inputs.audience}} (invite = invite-only, public = open to the public)
- Total budget: {{inputs.budget}}
- Venue: {{inputs.venue}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "title": "活动名",
  "purpose": "为什么办",
  "objectives": [ { "text": "目标", "measure": "用什么衡量", "target": "具体数值和截止时间" } ],
  "audience": "谁来，他们为什么愿意来",
  "message": "来的人离开时要记住的一句话",
  "format": "活动形式和主要环节",
  "date": "建议日期和时段",
  "venue": "场地和容量要求"
}
```

`objectives` 写 2 到 4 个 SMART 目标：具体、可衡量、可实现、和目的相关、有时间。`target` 一定带数字（例如“活动后 7 天内新增会员 80 人”），不写“提升品牌影响力”这类量不出来的话。

`objectives` holds 2 to 4 SMART objectives: specific, measurable, achievable, relevant and time-bound. Every `target` has a number (e.g. "80 new members within 7 days of the event"), never "raise brand awareness".
