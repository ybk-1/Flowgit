为这个商品排一份直播流程表。只输出 JSON，不要解释。

- 商品：{{inputs.product}}
- 价格和优惠：{{inputs.price}}
- 总时长：{{inputs.minutes}} 分钟
- 主播风格：{{inputs.host}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Plan the rundown for selling this product on a live stream. Reply with JSON only.

- Product: {{inputs.product}}
- Price and offer: {{inputs.price}}
- Total: {{inputs.minutes}} minutes
- Host style: {{inputs.host}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{ "segments": [ { "id": "s1", "name": "开场留人", "minutes": 1, "goal": "这一段要达到什么" } ] }
```

4 到 7 段，`id` 用 s1、s2 递增，`minutes` 加起来等于总时长。一般顺序：开场留人 → 痛点 → 演示 → 价格 → 逼单 → 返场。 / 4 to 7 segments, `id` s1, s2, …, and the minutes add up to the total. A usual order: hook → pain point → demo → price → close → recap.
