排活动流程表（run of show），从搭建排到撤场。只输出 JSON，不要解释。

- 预计人数：{{inputs.attendees}}
- 场地：{{inputs.venue}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the run of show from setup to teardown. Reply with JSON only.

- Expected attendance: {{inputs.attendees}}
- Venue: {{inputs.venue}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{ "items": [ { "start": "08:00", "minutes": 120, "item": "场地搭建", "owner": "负责的岗位", "backup": "出状况时怎么办" } ] }
```

规则 / Rules:

- 时间用 24 小时制 `HH:MM`，一项接一项：下一项的 `start` 等于上一项的 `start` 加 `minutes`，不留空档也不重叠。同时进行的事写在同一项的 `item` 里。
- 包括搭建和彩排、签到入场、每个环节、换场、散场疏导和撤场。
- 每一项都有 `owner`（写岗位，例如“舞台监督”“签到组”）和 `backup`。

- 24-hour `HH:MM`, back to back: each `start` is the previous `start` plus its `minutes`, no gaps or overlaps. Things that happen at once go into one `item`.
- Include setup and rehearsal, check-in, every segment, changeovers, guided exit and teardown.
- Every item has an `owner` (a role, e.g. "stage manager", "check-in team") and a `backup`.
