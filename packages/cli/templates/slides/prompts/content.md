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

- 和大纲一页对一页。第一页是 `cover`，最后一页是 `close`。
- 除了 `cover` 和 `section`，每页的 `title` 都是一句完整的结论，中文 8 到 30 个字，英文 4 到 15 个词。
- 优先用 `evidence` 页：图表、画面、引用或步骤。`bullets` 页不超过全部页数的三分之一，每页最多 4 条，每条一行。
- 屏幕上的字越少越好（中文每页不超过 60 个字，英文不超过 35 个词，不算标题）。细节、过渡和例子都写进 `notes`，`notes` 不要重复屏幕上的字。
- 图表数据只用大纲里有的或你确定的；没有真实数据时改用 `image` 或 `steps`，不要编数字。
- One slide per outline slide; the first is `cover`, the last is `close`.
- Except `cover` and `section`, every `title` is a full-sentence claim (4 to 15 words in English, 8 to 30 characters in Chinese).
- Prefer `evidence` slides: a chart, a visual, a quote or steps. `bullets` slides are at most a third of the deck, with at most 4 one-line bullets.
- Keep on-screen text minimal (at most 35 words per slide in English, 60 characters in Chinese, title excluded). Detail, transitions and examples go in `notes`, which should not repeat the slide.
- Chart data comes only from the outline or facts you are sure of; without real data use `image` or `steps`. Never invent numbers.
