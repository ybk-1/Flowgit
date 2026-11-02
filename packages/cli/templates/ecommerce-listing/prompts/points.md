用 FABE 法从商品资料里提炼卖点。只输出 JSON，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 买家：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Build selling points from the product facts with FABE. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- Buyers: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write every string in that language.

```json
{
  "points": [
    {
      "id": "p1",
      "feature": "特征：资料里的事实（参数、材质、工艺）",
      "advantage": "优势：这个特征比同类强在哪",
      "benefit": "好处：买家在什么场景下得到什么，用买家的话说",
      "evidence": "证据：资料里能证明它的内容（数字、认证、售后承诺）"
    }
  ],
  "worries": ["买家下单前最担心的事"],
  "keywords": ["买家会搜的词"]
}
```

规则 / Rules:

- 3 到 6 个卖点，`id` 用 p1、p2 递增，按对目标买家的重要程度排序。先想买家是谁、在什么场景用，再挑特征；只写到“特征”和“优势”不算卖点，必须写到“好处”。
- `feature` 和 `evidence` 必须来自商品资料，资料里没有的不写，不编数字。
- `worries` 写 4 到 8 条：价格、质量、尺寸是否合适、售后、使用限制等。客服问答会按它来写。
- `keywords` 写 4 到 8 个：买家真实会搜的短词，每个 2 到 4 个字，不要把商品名拼进去（写“迷你”，不要写“迷你榨汁杯”）。不要用别的品牌名。
- 不要用“最好”“第一”“顶级”“100%”这类绝对化说法，普通商品不要写治疗、预防疾病之类的功效。
- 3 to 6 points, `id` p1, p2, …, ordered by how much the buyer cares. Start from who buys it and where they use it; a point that stops at feature or advantage is not done until it states the benefit.
- `feature` and `evidence` come only from the product facts. No invented numbers.
- `worries`: 4 to 8 things buyers fear before ordering (price, quality, fit, after-sales, limits). The Q&A is written from these.
- `keywords`: 4 to 8 short terms buyers actually search for, one to three words each, without the product name glued on ("cordless", not "cordless blender cup"). No other brands' names.
- No absolute claims ("best", "No.1", "100%"), and no disease-treatment or prevention claims for ordinary goods.
