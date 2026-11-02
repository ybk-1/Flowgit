为这节课写学情分析和教学目标。只输出 JSON，不要解释。

- 课题：{{inputs.topic}}
- 学科：{{inputs.subject}}
- 年级：{{inputs.grade}}
- 课时：{{inputs.minutes}} 分钟
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the learner analysis and objectives for this lesson. Reply with JSON only.

- Topic: {{inputs.topic}}
- Subject: {{inputs.subject}}
- Grade: {{inputs.grade}}
- Length: {{inputs.minutes}} minutes
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "learners": "学情分析：学生已经会什么、容易在哪里出错",
  "objectives": [ { "id": "o1", "level": "apply", "verb": "能算出", "text": "学生能……" } ],
  "keyPoint": "教学重点",
  "difficulty": "教学难点，以及为什么难"
}
```

规则 / Rules:

- 这是逆向设计的第一步：先想清楚课后学生能做到什么，再谈怎么教。
- 3 到 5 个目标，`id` 用 o1、o2 递增。每个目标写成学生课后能做到、老师在课上能看到的行为，`verb` 是可观察的动词（说出、写出、算出、画出、比较、解释、设计），不要用“理解”“了解”“体会”“掌握”这类看不见的词。
- `level` 用布鲁姆修订版的六个层级之一：`remember` 记忆、`understand` 理解、`apply` 应用、`analyze` 分析、`evaluate` 评价、`create` 创造。一节课里不要全是 `remember`，至少有一个 `apply` 或更高。
- 目标要符合这个年级和课程标准对这一内容的要求，并体现学科核心素养，不要超纲。
- This is step one of backward design: decide what students can do after class before deciding how to teach.
- 3 to 5 objectives, `id` o1, o2, …. Each is an observable behavior; `verb` is observable (name, write, calculate, draw, compare, explain, design), never "understand", "know", "appreciate" or "master".
- `level` is one of the six revised-Bloom levels: `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`. Not all `remember`; at least one `apply` or higher.
- Fit the grade and what the curriculum standard expects for this content; stay within the syllabus.
