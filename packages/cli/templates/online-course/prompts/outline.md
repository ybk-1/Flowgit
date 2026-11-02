写课程大纲，共 {{inputs.lessons}} 节课。只输出 JSON，不要解释。

- 主题：{{inputs.topic}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the syllabus, {{inputs.lessons}} lessons. Reply with JSON only.

- Topic: {{inputs.topic}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "lessons": [
    {
      "n": 1,
      "title": "课名写成学完能做的事",
      "outcomes": ["o1"],
      "segments": [ { "title": "这一段讲什么", "minutes": 5 } ],
      "practice": "这节课后学员马上动手做的一件事，做完能看到结果"
    }
  ]
}
```

规则 / Rules:

- 每节课对应一到两个学习成果，所有成果都要有课讲到。从学员最常碰到的问题开始，由浅入深。
- 视频按小段拆：每段不超过 6 分钟（学员看 6 分钟以内的视频几乎看完，越长看得越少）。一节课 2 到 4 段。
- 每节课都有 `practice`：用自己的数据或真实场景做一件小事，不是“复习本节内容”。
- 第一节是试听课：要让学员在这一节就做成一件小事。

- Each lesson serves one or two outcomes, and every outcome is taught. Start from the learner's most common problem and build up.
- Cut video into segments of six minutes or less (learners watch nearly all of a video under six minutes and less the longer it runs). Two to four segments a lesson.
- Every lesson has a `practice`: a small task on the learner's own data or a real situation, not "review this lesson".
- Lesson 1 is the free trial: the learner should get one small thing done in it.
