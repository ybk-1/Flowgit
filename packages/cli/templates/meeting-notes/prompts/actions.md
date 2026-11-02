从整理稿和纪要里抽出待办。只输出 JSON 数组，不要解释。

- 会议：{{inputs.meeting}}
- 日期：{{inputs.date}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`owner` 用记录里的姓名原文；`task` 用这个语言。

Extract the action items from the cleaned transcript and the minutes. Reply with a JSON array only.

- Meeting: {{inputs.meeting}}
- Date: {{inputs.date}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). `owner` is the name as spoken; `task` is in this language.

```json
[
  { "owner": "周衡", "task": "交出下一版结构草图，做不到目标就写上实际估重", "due": "2026-03-11", "source": "8:50" }
]
```

每条待办 / Each action（一人负责、写清楚做什么、写明何时；RACI 的 Accountable 只有一个，Doran 的 SMART：Specific、Assignable、Time-related）:

- `owner`：一个具体的人，必须是 clean.md 里出现的发言人，姓名和记录里一致。不要写「团队」「大家」「产品组」，也不要写两个名字。记录里没人接下的事，不要编一个负责人，直接不写这条。
- `task`：一件可以完成的事，用动词开头，写成记录里说的那样，不要加记录里没有的承诺。
- `due`：`YYYY-MM-DD`。把记录里的日期或「3 月 11 日」按会议日期换算。没有说日期的事不要猜一个日子，这条不写。日期不能早于 `{{inputs.date}}`。
- `source`：这件事说定的那一段的起始时间，不要方括号，例如 `12:30`。必须是 clean.md 里某一段开头的时间。
- 同一人、同一件事只留一条。没有待办就输出 `[]`。
- `owner` is one person who speaks in clean.md, spelled the same way. Not "the team" and not two names. If nobody took the task, omit it.
- `task` is one finishable action, a verb first, and only what was said.
- `due` is `YYYY-MM-DD`, converted from the date they named and the meeting date. If they named no date, omit the action. It must not be before `{{inputs.date}}`.
- `source` is that block's start without brackets, for example `12:30`, and it must open a block in clean.md.
- One row per owner and task. No actions means `[]`.
