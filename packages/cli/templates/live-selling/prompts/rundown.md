为这个商品排一份直播讲解流程表。只输出 JSON，不要解释。

- 商品：{{inputs.product}}
- 价格和优惠：{{inputs.price}}
- 总时长：{{inputs.minutes}} 分钟
- 主播风格：{{inputs.host}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Plan the rundown for pitching this product on a live stream. Reply with JSON only.

- Product: {{inputs.product}}
- Price and offer: {{inputs.price}}
- Total: {{inputs.minutes}} minutes
- Host style: {{inputs.host}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "segments": [
    { "id": "s1", "type": "hook", "name": "开场留人", "minutes": 1, "goal": "这一段要达到什么" }
  ]
}
```

`type` 只能是 / `type` is one of:

- `hook` 留人：刚进来的人平均只停几秒，开口就给一个留下的理由（福利、悬念或和他有关的场景）。
- `pain` 痛点：说出目标人群在什么场景下的麻烦。
- `demo` 塑品演示：现场演示好处，不念参数表；把参数翻译成“对你有什么用”。
- `trust` 信任：材质、售后、使用限制，资料里有什么讲什么，主动说清不适合的情况。
- `price` 价格：讲清直播价、赠品、怎么下单。
- `close` 逼单：对还在犹豫的人消除顾虑，提醒下单方式。
- `recap` 返场：给晚进来的人快速讲一遍。
- `hook` grabs newcomers within seconds with a reason to stay (an offer, a question, a scene that is theirs).
- `pain` names the target viewer's problem in a real scene.
- `demo` shows the benefit live; turn specs into "what it does for you".
- `trust` covers materials, after-sales and limits, saying plainly what it is not for.
- `price` states the stream price, gifts and how to order.
- `close` answers the doubts of people still hesitating and repeats how to order.
- `recap` re-pitches quickly for late arrivals.

规则：5 到 8 段，`id` 用 s1、s2 递增，`minutes` 加起来等于总时长；每种类型都要有，`hook` 在最前，`recap` 在最后。 / 5 to 8 segments, `id` s1, s2, …, minutes add up to the total; every type appears, `hook` first and `recap` last.
