从商品资料里提炼卖点。只输出 JSON，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 买家：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Pull selling points from the product facts. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- Buyers: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write every string in that language.

```json
{
  "points": [ { "id": "p1", "title": "一句话卖点", "detail": "展开说明", "evidence": "资料里的依据" } ],
  "keywords": ["买家会搜的词"]
}
```

规则 / Rules:

- 3 到 6 个卖点，`id` 用 p1、p2 递增。每个 `evidence` 必须来自商品资料，资料里没有的不要写。
- 4 到 8 个关键词，是买家真实会搜的短词，每个 2 到 4 个字，不要把商品名拼进去（写“迷你”，不要写“迷你榨汁杯”）。
- 不要用“最好”“第一”“顶级”“100%”这类绝对化说法。
- 3 to 6 points, `id` p1, p2, …. Every `evidence` must come from the product facts; leave out anything they do not say.
- 4 to 8 keywords: short terms buyers actually search for, one to three words each, without the product name glued on ("cordless", not "cordless blender cup").
- No absolute claims such as "best", "No.1", "100%".
