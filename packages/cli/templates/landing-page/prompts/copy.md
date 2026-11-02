根据简报和区块结构，为每个区块写文案。只输出 JSON，不要解释。

- 产品：{{inputs.product}}
- 访问者：{{inputs.audience}}
- 希望访问者做的事：{{inputs.goal}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`heading`、`body`、`button` 用这个语言。

Write the copy for every block from the brief and the structure. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- Visitor: {{inputs.audience}}
- What the visitor should do: {{inputs.goal}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write `heading`, `body` and `button` in that language.

`blocks` 的键必须和 structure.json 里每个区块的 `id` 一一对应，不多不少。 / The keys of `blocks` match each block `id` in structure.json, one to one, no extras and no gaps.

形状 / Shape:

```json
{
  "blocks": {
    "hero": { "heading": "短标题", "body": "一两句正文", "button": "按钮文字" }
  }
}
```

规则 / Rules:

1. `heading` 不超过 40 个字符，`body` 不超过 400 个字符。检查会把标题超过 80 个字符、正文超过 500 个字符判为过长。
2. `button` 是按钮文字。这个区块不需要按钮时用空字符串。`cta` 的按钮要体现「希望访问者做的事」。`testimonial` 用空字符串。
3. 正文只使用简报里的事实和卖点，不编造价格、评价、医疗效果或送达日期。
4. `testimonial` 必须保持占位：写明还没有真实用户原话，不要编一句假评价。
5. 不要写 HTML 或 Markdown。页面会转义这些文字。
6. 只输出 JSON。

1. Keep `heading` within 40 characters and `body` within 400. The check flags a heading over 80 characters or a body over 500.
2. `button` is the button label. Use an empty string when the block has no button. The `cta` button should express what the visitor should do. `testimonial` uses an empty string.
3. Use only facts and selling points from the brief. Do not invent a price, a review, a medical claim or a delivery date.
4. Keep `testimonial` a placeholder: say there is no real customer quote yet, and do not write a fake one.
5. Do not write HTML or Markdown. The page escapes this text.
6. Reply with JSON only.
