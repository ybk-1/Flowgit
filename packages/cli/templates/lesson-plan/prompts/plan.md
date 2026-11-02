按教学目标和评价任务写教案。只输出 Markdown，不要解释。

- 课题：{{inputs.topic}}
- 学科：{{inputs.subject}}
- 年级：{{inputs.grade}}
- 课时：{{inputs.minutes}} 分钟
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the lesson plan from the objectives and assessment tasks. Reply with Markdown only.

- Topic: {{inputs.topic}}
- Subject: {{inputs.subject}}
- Grade: {{inputs.grade}}
- Length: {{inputs.minutes}} minutes
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式 / Format:

```
# <课题>

## 导入（5 分钟）
目标：o1　评价：a1
教师：……
学生：……

## 板书设计
……

## 作业设计
……
```

规则 / Rules:

- 这是逆向设计的第三步：每个环节都为某个目标和它的评价任务服务，评价任务要在课上真正发生，体现“教—学—评”一致。
- 每个环节一个 `##`，标题末尾写分钟数：中文写 `（N 分钟）`，英文写 `(N min)`。所有环节加起来等于 {{inputs.minutes}} 分钟。`板书设计` 和 `作业设计` 不写分钟数。
- 每个环节写一行 `目标：… 评价：…`（英文 `Objectives: … Assessment: …`），列出 id。每个目标、每个评价任务至少出现在一个环节里。
- 写清楚老师说什么、做什么，学生做什么；在难点处写出学生可能的错误和老师怎么回应。学生动手、讨论的时间要多于老师讲的时间。最后一个环节做当堂检测或小结。
- 作业设计写分层作业（基础、提高、可选挑战）和预计完成时间，遵守“双减”：小学一、二年级不布置家庭书面作业；三到六年级所有科目的书面作业每天平均不超过 60 分钟，初中不超过 90 分钟，所以一科只占其中一部分。不布置机械重复、惩罚性的作业。
- Step three of backward design: every step serves an objective and its assessment task, and the tasks actually happen in class.
- One `##` per step, ending with the minutes: `(N min)` in English, `（N 分钟）` in Chinese. The steps add up to {{inputs.minutes}} minutes. The board plan and homework sections have no minutes.
- Each step has an `Objectives: … Assessment: …` line with ids. Every objective and every task appears in at least one step.
- Say what the teacher says and does and what students do; at the hard part, name likely mistakes and how to respond. Students should do and discuss more than they listen. The last step is a quick check or wrap-up.
- Homework is tiered (basic, medium, optional challenge) with an estimated time, following China's double-reduction rules: no written homework for grades 1 and 2; written homework across all subjects averages at most 60 minutes a day for grades 3 to 6 and 90 for junior high, so one subject gets a share of that. No rote or punitive homework.
