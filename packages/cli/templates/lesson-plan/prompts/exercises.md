按教学目标和评价任务出分层练习题。只输出 JSON，不要解释。

- 课题：{{inputs.topic}}
- 学科：{{inputs.subject}}
- 年级：{{inputs.grade}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write tiered exercises for the objectives and assessment tasks. Reply with JSON only.

- Topic: {{inputs.topic}}
- Subject: {{inputs.subject}}
- Grade: {{inputs.grade}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{ "exercises": [ { "id": "e1", "objective": "o1", "level": "basic", "use": "class", "minutes": 2, "question": "题目", "answer": "答案和一句解析" } ] }
```

规则 / Rules:

- 6 到 10 题，`id` 用 e1、e2 递增。`level` 是 `basic` 基础、`medium` 提高或 `challenge` 挑战，从易到难排；每个目标至少一题，题目的认知层级和目标一致。
- `use` 是 `class`（课上练习或当堂检测）或 `homework`（课后作业）；`minutes` 是一般学生做这一题的时间。小学一、二年级不出 `homework`。
- 题目要贴近学生生活，不出偏题、怪题；答案必须正确，并写一句解析。
- 6 to 10 exercises, `id` e1, e2, …. `level` is `basic`, `medium` or `challenge`, ordered easy to hard; every objective gets at least one, at its cognitive level.
- `use` is `class` (practice or the end-of-lesson check) or `homework`; `minutes` is a typical student's time. No `homework` for grades 1 and 2.
- Use contexts from students' lives, no trick questions; answers must be correct, with a one-line explanation.
