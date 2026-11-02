按教学目标写教案。只输出 Markdown，不要解释。

- 课题：{{inputs.topic}}
- 年级：{{inputs.grade}}
- 课时：{{inputs.minutes}} 分钟
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the lesson plan from the objectives. Reply with Markdown only.

- Topic: {{inputs.topic}}
- Grade: {{inputs.grade}}
- Length: {{inputs.minutes}} minutes
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式 / Format:

```
# <课题>

## 导入（5 分钟）
目标：o1
教师：……
学生：……
```

规则 / Rules:

- 每个环节一个 `##`，标题末尾写分钟数：中文写 `（N 分钟）`，英文写 `(N min)`。所有环节加起来等于 {{inputs.minutes}} 分钟。
- 每个环节写一行 `目标：`（英文 `Objectives:`）列出它服务的目标 id。每个目标至少出现在一个环节里。
- 写清楚老师说什么、做什么，学生做什么。最后一个环节留出当堂检测或小结。
- One `##` per step, ending with the minutes: `(N min)` in English, `（N 分钟）` in Chinese. The steps add up to {{inputs.minutes}} minutes.
- Each step has an `Objectives:` line listing the ids it serves. Every objective appears in at least one step.
- Say what the teacher says and does and what the students do. The last step is a quick check or a wrap-up.
