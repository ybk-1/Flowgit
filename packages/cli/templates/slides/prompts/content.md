按大纲写每一页的内容。只输出 JSON，不要解释。

- 主题：{{inputs.topic}}
- 听众：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write every slide from the outline. Reply with JSON only.

- Topic: {{inputs.topic}}
- Audience: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "title": "演示稿标题",
  "subtitle": "副标题或讲者",
  "governingThought": "大纲里的核心结论",
  "slides": [
    { "layout": "cover", "title": "封面标题", "notes": "开场白，用 SCQA 讲到核心结论" },
    { "layout": "statement", "title": "一句话结论，大字", "notes": "……" },
    { "layout": "evidence", "title": "一句话结论", "evidence": { "kind": "chart", "caption": "图注", "unit": "小时", "data": [ { "label": "以前", "value": 3 }, { "label": "现在", "value": 1 } ] }, "notes": "……" },
    { "layout": "evidence", "title": "一句话结论", "evidence": { "kind": "image", "description": "要放的照片或截图是什么样" }, "notes": "……" },
    { "layout": "evidence", "title": "一句话结论", "evidence": { "kind": "quote", "text": "引用原话", "source": "谁说的" }, "notes": "……" },
    { "layout": "evidence", "title": "一句话结论", "evidence": { "kind": "steps", "items": ["第一步", "第二步", "第三步"] }, "notes": "……" },
    { "layout": "bullets", "title": "一句话结论", "bullets": ["要点"], "notes": "……" },
    { "layout": "section", "title": "章节名", "notes": "……" },
    { "layout": "close", "title": "下一步：谁、做什么、什么时候", "bullets": ["具体行动"], "notes": "……" }
  ]
}
```

规则 / Rules:

- 和大纲一页对一页，页数和大纲相同：大纲的第 1 页（封面）是 `cover`，最后一页是 `close`。不要加大纲里没有的页，包括额外的 `statement` 或 `section` 页。
- 除了 `cover` 和 `section`，每页的 `title` 都是一句完整的结论，中文 8 到 30 个字，英文 4 到 15 个词。
- 优先用 `evidence` 页：图表、画面、引用或步骤。`bullets` 页不超过全部页数的三分之一，每页最多 4 条，每条一行。
- 屏幕上的字越少越好（中文每页不超过 60 个字，英文不超过 35 个词，不算标题）。细节、过渡和例子都写进 `notes`，`notes` 不要重复屏幕上的字。
- `layout` 只能是 `cover`、`statement`、`evidence`、`bullets`、`section`、`close` 这六种。图表、画面、引用和步骤都是 `evidence` 页，用 `evidence.kind` 区分（`chart`、`image`、`quote`、`steps`），不要写成 `layout: "image"`。
- 图表数据只用大纲里有的或你确定的；没有真实数据时改用 `evidence.kind` 为 `image` 或 `steps` 的证据页，不要编数字。标题和讲稿里也不要出现大纲没有的数字。
- One slide per outline slide, as many slides as the outline: its slide 1 (the cover) is `cover`, its last slide is `close`. Add no slide the outline lacks, extra `statement` or `section` slides included.
- Except `cover` and `section`, every `title` is a full-sentence claim (4 to 15 words in English, 8 to 30 characters in Chinese).
- Prefer `evidence` slides: a chart, a visual, a quote or steps. `bullets` slides are at most a third of the deck, with at most 4 one-line bullets.
- Keep on-screen text minimal (at most 35 words per slide in English, 60 characters in Chinese, title excluded). Detail, transitions and examples go in `notes`, which should not repeat the slide.
- `layout` is one of six: `cover`, `statement`, `evidence`, `bullets`, `section`, `close`. Charts, visuals, quotes and steps are all `evidence` slides, told apart by `evidence.kind` (`chart`, `image`, `quote`, `steps`); never write `layout: "image"`.
- Chart data comes only from the outline or facts you are sure of; without real data use an evidence slide whose `evidence.kind` is `image` or `steps`. Never invent numbers, in titles and notes either: no number the outline does not have.

交之前数一遍：页数和大纲相同，第一页的 `layout` 是 `cover`，最后一页是 `close`；每个 `title` 中文不超过 30 个字、英文不超过 15 个词，超了就删短；没有 [负责人]、[日期] 这样的方括号占位。
Before replying, count once more: as many slides as the outline, the first slide's `layout` is `cover` and the last one's is `close`; every `title` within 15 words in English or 30 characters in Chinese, cut down when it is longer; no bracket placeholder such as [owner] or [date].

输出语言是 {{inputs.language}}。是 en 时，JSON 里每一个字符串都写英文，即使主题、听众或上面的示例是中文；是 zh 时写中文。
The output language is {{inputs.language}}. If it is en, every string in the JSON is English, even when the topic, the audience or the examples above are in Chinese; if it is zh, Chinese.
