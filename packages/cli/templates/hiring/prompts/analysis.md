根据岗位需求做岗位分析。只输出 JSON，不要解释。

- 岗位：{{inputs.role}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Analyze the role from the stated need. Reply with JSON only.

- Role: {{inputs.role}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "outcomes": [ "入职一年内要做成的事，带数字" ],
  "competencies": [
    { "id": "c1", "name": "能力项", "definition": "做得好是什么样，写成能观察到的行为", "must": true, "assess": "interview" }
  ]
}
```

方法 / Method:

- 先写 `outcomes`：照需求里的目标写，带数字。能力项从这些结果倒推，不从“理想员工”的形容词出发。
- 4 到 6 个能力项，`id` 用 c1、c2 递增。`definition` 写可观察的行为，不写“有责任心”“抗压”这种看不见的词。
- `must`：入职第一天就必须具备的写 true，可以学的写 false。
- `assess` 写最能看出这项能力的方式：`interview`（面试问过去的行为，大多数能力项用这个）、`work-sample`（工作样本，比如做一份活动方案，最多一两项）或 `resume`（只有看简历就能判断的硬条件，比如行业经验）。
- 只写和工作有关的要求。性别、年龄、婚育、户籍、民族、宗教、身高相貌、健康状况都不能当成能力项。

- Write `outcomes` first, from the need, with numbers. Derive competencies backwards from those results, not from adjectives about an ideal hire.
- 4 to 6 competencies, `id` c1, c2, …. `definition` describes observable behavior, not "responsible" or "handles pressure".
- `must`: true when needed on day one, false when it can be learned.
- `assess` is the best way to see it: `interview` (ask about past behavior; most competencies), `work-sample` (e.g. draft an event plan; one or two at most) or `resume` (only hard facts a resume settles, such as industry experience).
- Job-related requirements only. Gender, age, marriage and children, household registration, ethnicity, religion, looks and health are never competencies.
