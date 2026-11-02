# 老师备课 / Lesson prep

从一个课题备好一节课：先写教学目标，再同时写教案和练习题，最后生成发给学生的练习单和老师用的答案。脚本会检查时间加起来对不对、每个目标有没有讲到、有没有练到。

Prepare a lesson from a topic: write the objectives, then the lesson plan and exercises side by side, and finally a student worksheet and the teacher's answer key. A script checks that the minutes add up and that every objective is taught and practiced.

## 阶段 / Stages

1. **教学目标 objectives**（模型）：`objectives.json`，3 到 5 个能检验的目标（o1、o2…），加重点和难点。先在这里改，教案和题目都会提示需要重跑。
2. **教案 plan**（模型）：`lesson-plan.md`，每个环节标题写分钟数，下面写对应的目标、老师做什么、学生做什么。
3. **练习题 exercises**（模型，和教案并行）：`exercises.json`，6 到 10 道从易到难的题，每题对应一个目标，带答案和解析。
4. **练习单 worksheet**（脚本）：`worksheet.md`（学生用，不带答案）、`answer-key.md`（老师用）和 `check-report.md`。

1. **objectives** (model): `objectives.json`, 3 to 5 checkable objectives (o1, o2, …), plus the key point and the hard part. Edit here first; the plan and the exercises are marked stale.
2. **plan** (model): `lesson-plan.md`. Each step's heading carries its minutes, followed by the objectives it serves and what the teacher and the students do.
3. **exercises** (model, in parallel with the plan): `exercises.json`, 6 to 10 exercises from easy to hard, each tied to an objective, with answers and explanations.
4. **worksheet** (script): `worksheet.md` (for students, no answers), `answer-key.md` (for the teacher) and `check-report.md`.

模型出的题和答案一定要自己过一遍再发给学生。

Always read the model's exercises and answers yourself before handing them out.

## 怎么跑 / How to run

```bash
flowgit init ~/my-lesson -t lesson-plan
cd ~/my-lesson
flowgit inputs set topic=分数的初步认识
flowgit inputs set grade=小学三年级
flowgit inputs set minutes=40
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```
