按卖点和关键词写 3 个候选商品标题。只输出 JSON，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 标题最多 {{inputs.titleMax}} 个字
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write 3 candidate product titles from the points and keywords. Reply with JSON only.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- At most {{inputs.titleMax}} characters per title
- Output language: {{inputs.language}} (zh = Chinese, en = English)

```json
{ "titles": [ { "text": "标题", "angle": "这个标题主打什么" } ] }
```

3 个标题合起来要用上每一个关键词（原样写出），每个标题尽量包含不同的关键词组合，不要堆砌重复的词，不要用绝对化说法。 / Together the 3 titles use every keyword, spelled exactly as given; each title should use a different mix of keywords, no keyword stuffing, no absolute claims.
