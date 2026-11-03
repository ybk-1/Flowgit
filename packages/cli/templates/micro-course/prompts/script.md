按课程资料和教学设计，写这节微课视频的幻灯片和讲稿。只输出 JSON，不要解释。

- 这节课教什么：{{inputs.topic}}
- 给谁学：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write the slides and narration for this micro-lesson video from the brief and the lesson plan. Reply with JSON only, no commentary.

- What it teaches: {{inputs.topic}}
- For: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "segments": [
    {
      "id": "s1",
      "slides": [
        { "kind": "intro", "headline": "…", "onScreen": ["…"], "visual": "…", "narration": "…" },
        { "kind": "teach", "headline": "…", "onScreen": [], "visual": "…", "narration": "…" },
        { "kind": "question", "headline": "…", "onScreen": [], "visual": "", "narration": "…" }
      ]
    }
  ]
}
```

规则：

1. `segments` 和教学设计的 `segments` 一一对应，`id` 照抄，顺序一样。每段至少 3 张幻灯片，张数跟着这一段的时长走（见第 6 条的长度）。
2. `kind`：
   - `intro`：只有第一段的第一张。讲师用一句话介绍自己（资料「讲师」），说开头的问题（`hook`），再说清这节课学完你能做成什么（`objective`）。
   - `teach`：讲解。
   - `question`：每段一张，放在这一段的讲解后面。讲稿先问教学设计里这一段的 `question`，说「先暂停视频，自己试一试」，再说答案和为什么。
   - `recap`：只在最后一段，放在这一段的 `question` 后面：说两到四个要点，布置练习（`practice`），最后一句告诉学员下一步做什么。
3. `headline`：一句完整的话，说出这张幻灯片要学员记住的结论，不写主题词（写「四列就能记清一个月的账」，不写「表格结构」）。中文不超过 28 个字，英文不超过 80 个字符（大约 12 个词）。`question` 的 `headline` 是那个问题的短说法，同样不超过 28 个字；带数字和例子的完整问题放在讲稿里。
4. `visual`：这张幻灯片上证明标题的画面：截图、录屏里的哪一步、一张简单的图或对比。写清楚放什么，录制的人照着准备。只用资料「素材」和「要讲的内容」里有的东西。`question` 和 `recap` 可以写空字符串。
5. `onScreen`：屏幕上的字，最多 3 项（中文每项不超过 12 个字，英文不超过 32 个字符）：关键词、数字或公式，不是讲稿里的句子。一组同类的词（几个列名、几个分类）合成一项写，比如「日期 金额 分类 备注」；12 个字放不下时只写个数（「5 个分类」），具体的词留给画面，不要再另起一项列出来。`recap` 也最多放 3 个要点。没有就写空数组。
6. `narration`：讲师在这张幻灯片上说的话，一字一句照着念：
   - 口语，短句，像对着一个学员说话，多用「你」。不念屏幕上的字，用话把它讲明白。
   - 画面上要看的东西用话说出来（「你看 C 列……」），看不到画面的人也跟得上。
   - 长度：一段的讲稿加起来是这一段的 `minutes` × 200 个汉字（英文 × 140 个词），上下不超过一成，大约一分钟 9 句话。一张幻灯片讲 30 秒左右，大约 100 个汉字、四五句话（英文 70 个词），开场、小问题和收尾那张也不要更长；所以 2 分钟的一段 4 张左右（包括小问题那张），一共 360 到 440 个汉字（英文 250 到 310 个词）、18 句话左右。写完每段数一遍：长了就删重复的话和多余的例子，或者把两张并成一张；短了就加一张，讲资料里的下一个例子或常见错误。
   - 公式照资料写；念到公式时，说清每一部分是什么意思。
7. 只用资料里的事实、数字和例子，不编研究、统计或学员故事。资料「不要说的话」一句都不写。不承诺效果（不说「保证学会」「学完就能存下钱」这类话）。
8. 不写 `{{`、`TODO`、`待补充` 这类占位符。

交之前查一遍：第一张是 `intro`；每段都有一张 `question`；最后一段以 `recap` 结尾；每个标题不超过 28 个字，问题也一样；每张屏幕上的字不超过 3 项；每段讲稿的字数是分钟数 × 200，上下不超过一成，不长也不短。
语言：除了 `kind` 和 `id`，全部用输出语言写（zh = 中文，en = English）。资料每行斜杠前是中文、后面是英文，只用输出语言那一半。

Rules:

1. `segments` match the plan's `segments` one for one, with the same `id` and order. Each has at least 3 slides, as many as its length calls for (see the length rule in 6).
2. `kind`:
   - `intro`: the first slide of the first segment only. The instructor introduces themselves in one sentence (the brief's "Instructor"), states the opening problem (`hook`), and says what the learner will be able to do after the lesson (`objective`).
   - `teach`: the teaching.
   - `question`: one per segment, after its teaching. The narration asks the plan's `question` for that segment, says "pause the video and try it yourself", then gives the answer and why.
   - `recap`: the last segment only, after its `question`: two to four key points, the practice task (`practice`), and a last sentence on what to do next.
3. `headline`: one full sentence stating what the learner should take from the slide, never a topic label (write "Four columns are enough to track a month", not "Sheet structure"). At most 28 Chinese characters or 80 English characters (about 12 words). A `question` slide's `headline` is the question in short form, within the same limit; the full question with its numbers and examples goes in the narration.
4. `visual`: what on the slide proves the headline: a screenshot, a step in the screen recording, a simple chart or comparison. Say exactly what to show so whoever records can prepare it. Use only what the brief's "Assets" and "Content and examples" have. It may be an empty string for `question` and `recap`.
5. `onScreen`: the words on screen, at most 3 items (each within 12 Chinese characters or 32 English characters): key terms, numbers or a formula, not sentences from the narration. Put a set of like words (column names, categories) in one item, such as "Date, amount, category, note"; when they don't fit in 32 characters, write the count ("5 categories") and let the visual show the words, without listing them in another item. A `recap` slide also has 3 points at most. Use an empty array when there are none.
6. `narration`: what the instructor says over the slide, word for word:
   - Spoken and in short sentences, as if talking to one learner; say "you". Don't read the screen aloud; explain it.
   - Describe what to look at on screen ("look at column C…") so someone who can't see the picture can follow.
   - Length: a segment's narration adds up to its `minutes` × 140 English words (× 200 Chinese characters), within a tenth either way, which is about 10 sentences a minute. A slide takes about 30 seconds, about 70 words or four or five sentences (100 characters), and the intro, question and recap slides are no longer than that; so a 2-minute segment has about 4 slides (its question slide included), 250 to 310 words in all (360 to 440 characters), about 20 sentences. Count each segment when you finish: if it runs long, cut repetition and extra examples or merge two slides; if it runs short, add a slide on the brief's next example or common mistake.
   - Write formulas exactly as the brief does, and when you read one, say what each part means.
7. Use only the facts, numbers and examples in the brief: no invented studies, statistics or learner stories. Nothing from the brief's "Do not say". No promised results ("guaranteed to learn it", "you'll save money once you finish").
8. No placeholders such as `{{`, `TODO` or `TBD`.

Before you reply, check: the first slide is `intro`; every segment has one `question`; the last segment ends with `recap`; no headline, question included, is over 80 characters; no slide has more than 3 items on screen; each segment's narration is its minutes × 140 words, within a tenth, neither longer nor shorter.
Language: everything except `kind` and the ids in the output language (zh = Chinese, en = English). Each line of the brief has the Chinese before the slash and the English after it; use only the half in the output language.
