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
  "slides": [
    { "layout": "cover", "title": "封面标题", "notes": "开场白" },
    { "layout": "bullets", "title": "页标题", "bullets": ["要点"], "notes": "这页怎么讲" },
    { "layout": "statement", "title": "一句话大字", "notes": "……" },
    { "layout": "section", "title": "章节名", "notes": "……" }
  ]
}
```

规则 / Rules:

- 和大纲一页对一页，第一页是 `cover`。
- `bullets` 页最多 5 条要点，每条一行，中文不超过 30 个字（英文不超过 12 个词）。细节放进 `notes`。
- 每页都写 `notes`：讲者照着说的两三句话。
- One slide per outline slide; the first is `cover`.
- A `bullets` slide has at most 5 bullets, one line each (12 words at most in English, 30 characters in Chinese). Detail goes in `notes`.
- Every slide has `notes`: two or three sentences the speaker can say.
