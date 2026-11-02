按流程表写直播话术。只输出 Markdown，不要解释。

- 商品：{{inputs.product}}
- 价格和优惠：{{inputs.price}}
- 主播风格：{{inputs.host}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the live-stream script from the rundown. Reply with Markdown only.

- Product: {{inputs.product}}
- Price and offer: {{inputs.price}}
- Host style: {{inputs.host}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式 / Format:

```
# <商品>直播脚本

## s1 开场留人（1 分钟）
**话术**：……
**动作**：……
**互动**：……
```

规则 / Rules:

- 每段一个 `##`，开头写流程表里的 id（s1、s2…）。英文写 `**Lines**:`、`**Action**:`、`**Chat**:` 和 `(N min)`。
- 话术是主播能直接念的口语。每个卖点都要能在商品资料里找到，不编参数。
- 价格段要说清价格和优惠；没有给价格时写“价格看购物车”。
- 不要用“最好”“第一”“全网最低”“100%”这类绝对化说法，不要承诺疗效。不要留 `[...]` 或 TODO。
- One `##` per segment, starting with the rundown id (s1, s2, …).
- Lines the host can read out as-is. Every claim must be in the product facts; no invented specs.
- The price segment states the price and offer; with no price given, say "check the cart for the price".
- No absolute claims ("best", "No.1", "lowest price ever", "100%") and no health promises. Leave no `[...]` or TODO.
