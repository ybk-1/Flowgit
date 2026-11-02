为这门线上课做学员分析，定下学习成果。只输出 JSON，不要解释。

- 主题：{{inputs.topic}}
- 学员：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Analyze the learners for this online course and set its outcomes. Reply with JSON only.

- Topic: {{inputs.topic}}
- Learners: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "learner": { "who": "", "now": "他们现在会什么、怎么凑合", "stuck": "卡在哪里，为什么自学没学会" },
  "goal": "学完以后在真实场景里能做成的一件事",
  "outcomes": [ { "id": "o1", "text": "学完能……", "verb": "做出", "level": "apply" } ],
  "prerequisites": [ "需要的基础" ],
  "notFor": [ "不适合谁" ]
}
```

方法 / Method:

- 这是 ADDIE 的“分析”一步：先弄清学员现在在哪、要去哪，课程只教中间的差距。
- 3 到 6 个 `outcomes`，`id` 用 o1、o2 递增。每个用可观察的动词（做出、写出、算出、比较、判断、设计……），不用“了解”“掌握”“理解”；`level` 用布鲁姆修订版的 remember、understand、apply、analyze、evaluate、create，至少一半是 apply 或更高。
- `notFor` 老实写，比如已经会的人、需要考证的人。

- This is the Analysis step of ADDIE: where the learners are, where they need to be; the course teaches only the gap.
- 3 to 6 `outcomes`, `id` o1, o2, …, each with an observable verb (build, write, calculate, compare, judge, design…), never "know", "understand" or "master"; `level` is a revised-Bloom level (remember, understand, apply, analyze, evaluate, create), with at least half at apply or above.
- Be honest in `notFor`: people who already know this, people who need a certificate, and so on.
