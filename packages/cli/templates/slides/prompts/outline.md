为演示稿写大纲。只输出大纲，不要解释。

- 主题：{{inputs.topic}}
- 听众：{{inputs.audience}}
- 大约 {{inputs.slides}} 页（含封面）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the outline for a slide deck. Reply with the outline only.

- Topic: {{inputs.topic}}
- Audience: {{inputs.audience}}
- About {{inputs.slides}} slides, cover included
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

按金字塔原理组织 / Organize it with the Pyramid Principle:

1. 先写**核心结论**：一句完整的话，是一个判断或建议，不是一个话题（“把周报改成每周一次的固定流程，写的人省事，看的人直接拿到决定”，而不是“关于周报”）。
2. 写 **SCQA 开场**：情境（听众已经认同的现状）→ 冲突（出了什么变化或问题）→ 问题（听众心里会问什么）→ 回答（就是核心结论）。
3. 列出支撑核心结论的 2 到 4 个论点，彼此不重叠、合起来能撑住结论。每个论点下面放 1 到 3 页证据。
4. 最后一页是明确的下一步：谁、做什么、什么时候。主题里没有负责人或日期时，写听众自己能做的具体动作（比如“下次例会定试点组”），一句话写完，不要留 [负责人]、[日期] 这样的方括号。
5. 第 1 页是封面，最后一页是下一步，全部页数就是 {{inputs.slides}} 页左右，最多差 1 页。页数紧时，先让每个论点只占 1 页，再减少论点。

1. Write the **governing thought**: one full sentence that is a claim or recommendation, not a topic ("Turn the weekly report into one fixed weekly flow: less writing, and readers get the decisions", not "About the weekly report").
2. Write the **SCQA opening**: situation (what the audience already agrees with) → complication (what changed or went wrong) → question (what they now wonder) → answer (the governing thought).
3. List 2 to 4 supporting arguments that do not overlap and together hold up the claim, each with 1 to 3 evidence slides.
4. The last slide is a clear next step: who does what, by when. When the topic names no owner or date, write one short, concrete action the audience can take themselves ("pick a pilot team at the next meeting"), never a bracket such as [owner] or [date].
5. Slide 1 is the cover and the last slide is the next step; the whole deck is about {{inputs.slides}} slides, off by one at most. When slides are tight, give each argument one slide before you drop an argument.

格式 / Format:

```
# <演示标题 / deck title>

**核心结论 / Governing thought**：……

**开场 / Opening (SCQA)**：情境……；冲突……；问题……；回答……

## 第 1 页（封面 / Cover）：<演示标题 / deck title>

## 第 2 页：<这一页的结论，一句话 / this slide's claim, one sentence>
证据 / Evidence：<用什么证明：数据、例子、画面、引用 / what proves it: data, an example, a visual, a quote>
```

每页标题都写成一句结论，不超过两行（中文不超过 30 个字，英文不超过 15 个词）；只写一页能讲完的一件事。数据只用你确定的或听众提供的，不确定的写成“需要补充的数据：……”。 / Every slide title is a one-sentence claim of at most two lines (at most 15 words in English, 30 characters in Chinese); one idea per slide. Use only data you are sure of or the audience gave; otherwise write "data to add: …".

不要编数字：核心结论、标题和证据里的数字（省几小时、提高百分之几、多少人）只能来自主题、听众或你确定的事实。没有就不写数字，把论点写成不带数字的判断，在证据里写“需要补充的数据：……”。
Never invent numbers: a number in the governing thought, a title or the evidence (hours saved, a percentage, a head count) must come from the topic, the audience or facts you are sure of. Otherwise state the claim without a number and write "data to add: …" in the evidence.

交之前数一遍：页数（含封面和最后一页）离 {{inputs.slides}} 不超过 1 页；每个标题没有超过上面的字数或词数，超了就删短。
Before replying, count once more: the slides, cover and last slide included, are within one of {{inputs.slides}}; no title is over the word or character limit above, and a long one gets cut.

输出语言是 {{inputs.language}}。是 en 时，大纲里每一句都写英文，即使主题、听众或上面的示例是中文；是 zh 时写中文。
The output language is {{inputs.language}}. If it is en, write every line of the outline in English, even when the topic, the audience or the examples above are in Chinese; if it is zh, write Chinese.
