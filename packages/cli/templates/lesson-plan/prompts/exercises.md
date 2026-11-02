按教学目标出练习题。只输出 JSON，不要解释。

- 课题：{{inputs.topic}}
- 年级：{{inputs.grade}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write exercises for the objectives. Reply with JSON only.

- Topic: {{inputs.topic}}
- Grade: {{inputs.grade}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{ "exercises": [ { "id": "e1", "objective": "o1", "level": "basic", "question": "题目", "answer": "答案和简短解析" } ] }
```

6 到 10 题，`id` 用 e1、e2 递增，`level` 是 `basic`、`medium` 或 `challenge`，从易到难排。每个目标至少有一题。答案要正确，并写一句解析。 / 6 to 10 exercises, `id` e1, e2, …, `level` one of `basic`, `medium`, `challenge`, ordered easy to hard. Every objective gets at least one. Answers must be correct, with a one-line explanation.
