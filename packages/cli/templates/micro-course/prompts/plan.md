根据课程资料，设计这一节微课视频的教学。只输出 JSON，不要解释。

- 这节课教什么：{{inputs.topic}}
- 给谁学：{{inputs.audience}}
- 目标时长：{{inputs.minutes}} 分钟
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Design the teaching for this micro-lesson video from the brief. Reply with JSON only, no commentary.

- What it teaches: {{inputs.topic}}
- For: {{inputs.audience}}
- Target length: {{inputs.minutes}} minutes
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "title": "…",
  "objective": { "text": "…", "verb": "…", "level": "apply" },
  "prerequisites": ["…"],
  "hook": "…",
  "segments": [
    { "id": "s1", "title": "…", "minutes": 2, "teaches": "…", "question": { "prompt": "…", "answer": "…" } }
  ],
  "quiz": [
    { "question": "…", "options": ["…", "…", "…"], "answer": 1, "feedback": "…", "segment": "s2" }
  ],
  "practice": "…",
  "recap": ["…", "…"]
}
```

规则：

1. `title`：这节课的标题，说学员能做成什么。资料的标题合适就用它。
2. `objective`：照资料「学完能做成的一件事」写成一句话。`verb` 是这句话里看得见、能检验的动词（做出、填好、找出、算出、判断……），不用「理解」「了解」「掌握」「熟悉」「知道」。`level` 是这件事在修订版布鲁姆分类里的层级：`remember`、`understand`、`apply`、`analyze`、`evaluate` 或 `create`。
3. `prerequisites`：学这节课之前要会的事，从资料「学员」里拿。
4. `hook`：开头的问题，一两句话，说学员现在的真实处境（资料「学员」）。不吓人，不制造焦虑。
5. `segments`：2 到 4 段，`id` 依次是 `s1`、`s2`、`s3`、`s4`。每段只讲清一件事（`teaches`）。`minutes` 每段不超过 6，全部加起来正好等于目标时长：交之前逐个加一遍。目标时长超过 24 分钟时写满 4 段、每段 6 分钟，录前检查会建议拆成两节课。第一段从开头的问题讲起，说清学完能做成什么；最后一段包括小结和练习，时间算在这一段里。
6. 每段的 `question`：这一段讲完后问学员的一道小问题，要动手或动脑才答得出（算一算、找一找、判断一下），不问「听懂了吗」。`answer` 写答案和一句为什么。
7. `quiz`：3 到 5 道选择题，考的是能不能做成学习目标里的事，不考记忆细节。每道 3 到 4 个选项，只有一个对。错误选项从资料「常见错误」里来，要像真的会有人选。不用「以上都对」，少用「以上都不对」。选项长短差不多：正确选项的字数不超过最长的错误选项的 1.5 倍。正确选项不加解释、不列清单：写「先用 5 个」，不写「先用 5 个：吃饭、交通、购物、娱乐、其他」，细节放进 `feedback`。`answer` 是正确选项的序号，从 0 开始；正确选项的位置要分散，整套测验至少用到三个不同的位置（比如各题依次是 0、2、1、3）。`feedback` 说为什么对、错的选项错在哪。`segment` 写考的是哪一段的 `id`。
8. `practice`：照资料「练习」写，看完马上能做。
9. `recap`：两到四句，每句一个要点。

只用资料里的事实和例子，不编数字、研究或学员故事。资料「不要说的话」一句都不写，也不承诺学完的效果。

交之前查一遍：`segments` 的 `minutes` 加起来等于 {{inputs.minutes}}，每段不超过 6；每段都有 `question`；`quiz` 有 3 到 5 道，每道的 `answer` 指向对的选项，正确选项不比别的选项长出一半，位置至少有三种。
语言：除了 `level` 和 `id`，全部用输出语言写（zh = 中文，en = English）。资料每行斜杠前是中文、后面是英文，只用输出语言那一半。

Rules:

1. `title`: the lesson's title, saying what the learner will be able to do. Use the brief's title if it fits.
2. `objective`: the brief's "The one thing they can do after" as one sentence. `verb` is the observable, checkable verb in it (build, fill in, find, calculate, decide…), never "understand", "know", "learn about", "master" or "be familiar with". `level` is its level in the revised Bloom's taxonomy: `remember`, `understand`, `apply`, `analyze`, `evaluate` or `create`.
3. `prerequisites`: what the learner must know first, from the brief's "Learners".
4. `hook`: the opening problem in one or two sentences, from the learner's real situation in the brief's "Learners". No scare tactics and no anxiety.
5. `segments`: 2 to 4 segments with the ids `s1`, `s2`, `s3`, `s4` in order. Each makes one thing clear (`teaches`). Each `minutes` is 6 or less, and together they add up to exactly the target length: add them one by one before you reply. If the target is over 24 minutes, write four segments of six minutes; the pre-record check will suggest splitting the lesson in two. The first segment starts from the opening problem and says what the learner will be able to do; the last one includes the recap and the practice, counted in its minutes.
6. Each segment's `question`: a short question asked after the segment that takes doing or thinking to answer (work it out, find it, decide), never "did that make sense?". `answer` gives the answer and one sentence on why.
7. `quiz`: 3 to 5 multiple-choice questions that test whether the learner can do what the objective says, not whether they remember details. Each has 3 or 4 options with exactly one right. The wrong options come from the brief's "Common mistakes" and should look like something a real learner would pick. No "all of the above", and "none of the above" rarely. Keep the options about the same length: the right one is at most 1.5 times as long as the longest wrong one. The right option gets no explanation and no list: write "Start with five", not "Start with five: food, transport, shopping, fun, other", and put the details in `feedback`. `answer` is the index of the right option, from 0; spread the right answers out, using at least three different positions across the quiz (for example 0, 2, 1, 3 in order). `feedback` says why it is right and what the wrong options miss. `segment` is the `id` of the segment it tests.
8. `practice`: from the brief's "Practice", something to do right after watching.
9. `recap`: two to four sentences, one point each.

Use only the facts and examples in the brief: no invented numbers, studies or learner stories. Nothing from the brief's "Do not say", and no promises about what the lesson will achieve.

Before you reply, check: the segments' `minutes` add up to {{inputs.minutes}} with none over 6; every segment has a `question`; the quiz has 3 to 5 questions, each `answer` points to the right option, no right option is half again as long as the others, and the answers sit in at least three positions.
Language: everything except `level` and the ids in the output language (zh = Chinese, en = English). Each line of the brief has the Chinese before the slash and the English after it; use only the half in the output language.
