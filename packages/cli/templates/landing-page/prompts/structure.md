根据简报，设计落地页的区块结构。只输出 JSON，不要解释。

- 产品：{{inputs.product}}
- 访问者：{{inputs.audience}}
- 希望访问者做的事：{{inputs.goal}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`purpose` 和 `points` 用这个语言。

Design the landing page blocks from the brief. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- Visitor: {{inputs.audience}}
- What the visitor should do: {{inputs.goal}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write `purpose` and `points` in that language.

形状 / Shape:

```json
{
  "blocks": [
    {
      "id": "hero",
      "purpose": "这个区块要让访问者理解的一件事",
      "points": ["必须出现的事实或卖点"],
      "image": "hero.jpg"
    }
  ]
}
```

规则 / Rules:

1. 正好五个区块，顺序固定：`hero`、`features`、`testimonial`、`faq`、`cta`。
2. `purpose` 一句话。`points` 两条到四条，每条一句短话，只来自简报，不新增事实。
3. `image` 是建议的文件名：小写英文、数字和连字符，以 `.jpg` 结尾，例如 `hero.jpg`。没有合适的图就写成空字符串。
4. `testimonial` 是占位，不是真实评价。`purpose` 里要写明还没有用户原话。
5. 简报里「不要说的话」不要写进 `points`。
6. 只输出 JSON。

1. Exactly five blocks, in this order: `hero`, `features`, `testimonial`, `faq`, `cta`.
2. `purpose` is one sentence. `points` is two to four short sentences, only facts from the brief.
3. `image` is a suggested file name: lowercase letters, digits and hyphens, ending in `.jpg`, such as `hero.jpg`. Use an empty string when no image fits.
4. `testimonial` is a placeholder, not a real quote. Its `purpose` must say there is no customer quote yet.
5. Do not put anything from the brief's "do not say" section into `points`.
6. Reply with JSON only.
