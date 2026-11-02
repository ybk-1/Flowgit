# 老师备课 / Lesson prep

从一个课题备好一节课。顺序按“逆向设计”（Understanding by Design）：先定学生课后能做到什么，再定课上用什么证据判断学会了，最后才设计教学活动；目标用布鲁姆修订版的认知层级和可观察的动词来写，体现新课标强调的“教—学—评”一致。作业按“双减”要求分层并控制时长。最后生成发给学生的练习单和老师用的答案。

Prepare a lesson from a topic using backward design (Understanding by Design): decide what students can do after class, then what in-class evidence shows they learned, and only then plan the activities. Objectives use revised-Bloom levels and observable verbs, so teaching, learning and assessment line up as China's 2022 curriculum standards ask. Homework is tiered and time-limited under the double-reduction rules. The flow ends with a student worksheet and the teacher's answer key.

## 阶段 / Stages

1. **教学目标 objectives**（模型）：`objectives.json`。学情分析（学生已经会什么、容易错在哪），3 到 5 个目标，每个标出布鲁姆层级和可观察的动词（说出、写出、算出、比较、解释……，不用“理解”“掌握”），再加重点和难点。
2. **评价任务 assessment**（模型）：`assessment.json`。在设计活动之前，给每个目标定一个课上就能看到的评价任务和达成标准。
3. **教案 plan**（模型）：`lesson-plan.md`。每个环节标分钟数、对应的目标和评价任务，写老师做什么、学生做什么，难点处写出学生可能的错误和应对；最后是板书设计和分层的作业设计。
4. **练习题 exercises**（模型，和教案并行）：`exercises.json`。基础、提高、挑战三层，每题对应一个目标，标出课堂用还是作业、预计几分钟，带答案和解析。
5. **练习单 worksheet**（脚本）：`worksheet.md`（学生用，分课堂练习和课后作业，不带答案）、`answer-key.md`（老师用）和 `check-report.md`。检查：环节时间加起来对不对；每个目标有没有讲到、有没有评价任务、有没有练习；有没有用“理解”“掌握”这类看不见的动词；有没有应用及以上层级的目标；有没有板书和作业设计；作业时长和双减要求（小学一、二年级不布置家庭书面作业，三到六年级所有科目每天平均不超过 60 分钟，初中不超过 90 分钟）。

1. **objectives** (model): `objectives.json` with a learner analysis (what students know, where they slip), 3 to 5 objectives each with a Bloom level and an observable verb (name, write, calculate, compare, explain…, never "understand" or "master"), the key point and the hard part.
2. **assessment** (model): `assessment.json`. Before any activity, one in-class assessment task and success criterion per objective.
3. **plan** (model): `lesson-plan.md`. Each step has its minutes, objectives and assessment tasks, what the teacher and students do, and likely mistakes at the hard part; then the board plan and tiered homework.
4. **exercises** (model, in parallel with the plan): `exercises.json`, basic, medium and challenge tiers, each tied to an objective, marked for class or homework with a time estimate, with answers and explanations.
5. **worksheet** (script): `worksheet.md` (for students, split into class and homework, no answers), `answer-key.md` (for the teacher) and `check-report.md`. It checks that the steps add up to the lesson length; every objective is taught, assessed and practiced; no unobservable verbs; at least one objective at apply level or above; a board plan and homework design; and homework time against the double-reduction rules (no written homework for grades 1 and 2; at most 60 minutes a day across all subjects for grades 3 to 6 and 90 for junior high).

模型出的题和答案一定要自己过一遍再发给学生。

Always read the model's exercises and answers yourself before handing them out.

## 怎么跑 / How to run

```bash
flowgit init ~/my-lesson -t lesson-plan
cd ~/my-lesson
flowgit inputs set topic=分数的初步认识
flowgit inputs set subject=数学 grade=小学三年级 minutes=40
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- Wiggins 和 McTighe 的逆向设计（*Understanding by Design*，2005 年第二版）：确定预期结果 → 确定可接受的证据 → 设计学习体验。[ETSU 概述](https://pressbooks.pub/etsu/?p=99)、[UNH 课程设计](https://www.unh.edu/teaching-learning-resource-hub/planning/course-design)。/ Backward design: desired results → acceptable evidence → learning experiences.
- Anderson 和 Krathwohl 修订的布鲁姆认知目标分类（2001）：记忆、理解、应用、分析、评价、创造；可检验的目标要用可观察的动词。[Faculty Focus](https://www.facultyfocus.com/articles/course-design-ideas/designing-measurable-outcomes-with-backwards-design/print/)、[Iowa State CELT](https://www.celt.iastate.edu/blog/page/10/)。/ Revised Bloom's taxonomy and measurable objectives.
- 教育部《义务教育课程方案和课程标准（2022 年版）》：以核心素养为导向，推进大单元教学和课程内容结构化，强调“教—学—评”一致。[中新网](https://www.chinanews.com.cn/gn/2022/04-21/9734982.shtml)、[人民网解读](https://www.peopleapp.com/column/30039363814-500004352912)。/ China's 2022 compulsory-education curriculum standards.
- 中办、国办《关于进一步减轻义务教育阶段学生作业负担和校外培训负担的意见》（2021）：小学一、二年级不布置家庭书面作业，三到六年级书面作业平均完成时间不超过 60 分钟，初中不超过 90 分钟；鼓励分层、弹性和个性化作业，杜绝重复性、惩罚性作业。[界面新闻转载](https://www.jiemian.com/article/6399737.html)、[中国教育在线](https://www.eol.cn/news/yaowen/202109/t20210909_2153275.shtml)。/ The 2021 double-reduction opinion on homework limits.
- 教案的常见要素（学情分析、目标、重难点、教学过程、板书设计、作业设计、教学反思）：[西安外国语大学教案规范](https://jwc.xisu.edu.cn/6.pdf)、[长江大学教案模板](https://dqkx.yangtzeu.edu.cn/__local/C/60/A8/17F759A6A594692209D8AD0E2D7_55AD9279_10200.doc?e=.doc)。/ Common elements of a Chinese lesson plan.
