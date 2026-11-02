为每个教学目标设计评价任务。只输出 JSON，不要解释。

- 课题：{{inputs.topic}}
- 学科：{{inputs.subject}}
- 年级：{{inputs.grade}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Design an assessment task for each objective. Reply with JSON only.

- Topic: {{inputs.topic}}
- Subject: {{inputs.subject}}
- Grade: {{inputs.grade}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{ "tasks": [ { "id": "a1", "objective": "o1", "task": "课上让学生做什么来证明达成了目标", "success": "怎样算达成" } ] }
```

这是逆向设计的第二步：在设计教学活动之前，先决定用什么证据判断学生学会了。每个目标至少一个任务，`id` 用 a1、a2 递增。任务要在课上就能完成、老师能当场看到（说一说、写一写、做一做、判断并说理由），层级和目标的布鲁姆层级一致；`success` 写具体的达成标准。

This is step two of backward design: before planning activities, decide what evidence shows students learned. At least one task per objective, `id` a1, a2, …. Tasks happen in class and are visible to the teacher on the spot (say, write, do, judge and explain), at the same Bloom level as the objective; `success` states a concrete criterion.
