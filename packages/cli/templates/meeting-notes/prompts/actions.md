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
  { "owner": "周衡", "task": "交出下一版结构草图，做不到目标就写上实际估重", "due": "2026-03-11", "source": "8:50" },
  { "owner": "沈予", "task": "把问答草稿先发给林夏看", "due": "", "source": "28:50" }
]
```

每条待办 / Each action（一人负责、写清楚做什么、写明何时；RACI 的 Accountable 只有一个，Doran 的 SMART：Specific、Assignable、Time-related）:

- 只收会上说定要做的事。还在讨论、没说定的，或者只是"可以考虑"的，不算待办。
- `owner`：一个具体的人，姓名和记录里一致。通常是发言人；会上点名让不在场的人做，就写那个人。不要写「团队」「大家」「产品组」，也不要写两个名字。说定了要做、但没人接下的事，`owner` 写 `""`，不要编一个负责人，检查会提醒指定。
- `task`：一件可以完成的事，用动词开头，写成记录里说的那样，不要加记录里没有的承诺。
- `due`：`YYYY-MM-DD`。把记录里的日期或「3 月 11 日」按会议日期换算。没有说日期的，`due` 写 `""`，不要猜一个日子，检查会提醒补上。日期不能早于 `{{inputs.date}}`。
- `source`：这件事说定的那一段的起始时间，不要方括号，例如 `12:30`。必须是 clean.md 里某一段开头的时间。
- 同一人、同一件事只留一条。没有待办就输出 `[]`。
- Only what the meeting agreed to do. Something still being discussed, or only "worth a look", is not an action.
- `owner` is one person, spelled as in the transcript: usually a speaker, or someone absent whom the meeting named. Not "the team" and not two names. If a task was agreed but nobody took it, `owner` is `""`; do not invent one. The check asks for an owner.
- `task` is one finishable action, a verb first, and only what was said.
- `due` is `YYYY-MM-DD`, converted from the date they named and the meeting date. If they named no date, `due` is `""`; do not guess one. The check asks for a date. It must not be before `{{inputs.date}}`.
- `source` is that block's start without brackets, for example `12:30`, and it must open a block in clean.md.
- One row per owner and task. No actions means `[]`.
