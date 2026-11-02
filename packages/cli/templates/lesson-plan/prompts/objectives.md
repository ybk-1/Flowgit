为这节课写教学目标。只输出 JSON，不要解释。

- 课题：{{inputs.topic}}
- 年级：{{inputs.grade}}
- 课时：{{inputs.minutes}} 分钟
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the objectives for this lesson. Reply with JSON only.

- Topic: {{inputs.topic}}
- Grade: {{inputs.grade}}
- Length: {{inputs.minutes}} minutes
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "objectives": [ { "id": "o1", "text": "学生能……" } ],
  "keyPoint": "教学重点",
  "difficulty": "教学难点"
}
```

3 到 5 个目标，`id` 用 o1、o2 递增。每个目标写成学生课后能做到、老师能检验的事（“能说出”“能算出”），不要写“理解”“体会”这种查不了的词。符合这个年级的水平。 / 3 to 5 objectives, `id` o1, o2, …. Each is something students can do after class that a teacher can check ("can name", "can calculate"), not "understand" or "appreciate". Fit the grade.
