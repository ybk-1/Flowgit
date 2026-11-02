为结构化面试出题。只输出 JSON，不要解释。

- 岗位：{{inputs.role}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the questions for a structured interview. Reply with JSON only.

- Role: {{inputs.role}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "questions": [
    {
      "id": "q1",
      "competency": "c1",
      "type": "behavioral",
      "question": "请讲一次你……的经历。",
      "probes": [ "当时的情况是什么？", "你具体做了什么？", "结果怎样，用数字说？" ],
      "anchors": { "1": "1 分的回答是什么样", "3": "3 分", "5": "5 分" }
    }
  ],
  "workSample": "如果有 assess 为 work-sample 的能力项，这里写一个 60 分钟内能完成的工作样本任务；没有就写空字符串"
}
```

方法 / Method:

- `assess` 为 `interview` 的能力项每项 2 道题，`work-sample` 的每项 1 道（再加下面的工作样本），`resume` 的不出题。`competency` 填能力项的 id。所有候选人问同样的题、按同样的标准打分。
- 以行为题为主（`behavioral`：问过去真实发生的事，用 STAR 追问情境、任务、行动、结果），情景题为辅（`situational`：“如果……你会怎么做”）。
- `anchors` 写 1、3、5 分各是什么样的回答，用具体行为描述（行为锚定评分），面试官照着打分。
- 不出脑筋急转弯和与岗位无关的题。不问婚育、生育计划、年龄、户籍、民族、宗教、病史这类问题。

- Two questions for each competency assessed by `interview`, one for each assessed by `work-sample` (plus the work sample below), none for `resume`. `competency` holds the competency's id. Every candidate gets the same questions and the same scoring.
- Mostly behavioral (`behavioral`: what really happened, probed with STAR: situation, task, action, result), some situational (`situational`: "what would you do if…").
- `anchors` describe a 1, 3 and 5 answer as concrete behavior (behaviorally anchored rating), so interviewers score against them.
- No brainteasers or off-topic questions. Never ask about marriage, plans for children, age, household registration, ethnicity, religion or medical history.
