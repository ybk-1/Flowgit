把调研题目拆成 3 到 6 个子问题。只输出 JSON，不要解释。

- 题目：{{inputs.topic}}
- 读者：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`text` 用这个语言。

Split the research topic into 3 to 6 sub-questions. Reply with JSON only, no commentary.

- Topic: {{inputs.topic}}
- Reader: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write `text` in that language.

```json
{ "questions": [ { "id": "q1", "text": "一句要回答的话" } ] }
```

`id` 用 q1、q2 这样递增。每个 `text` 只有一句话。 / `id` is q1, q2, and so on. Each `text` is one sentence.
