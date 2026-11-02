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

格式 / Format（英文用 `**Lines**:`、`**Action**:`、`**Chat**:` 和 `(N min)`）:

```
# <商品>直播脚本

## s1 开场留人（1 分钟）
**话术**：……
**动作**：……
**互动**：……
```

写法 / Craft:

- 每段一个 `##`，开头写流程表里的 id（s1、s2…）。话术是主播能直接念的口语，短句，多用“你”。
- 塑品不念参数：先说谁在什么场景用，再说参数带来的好处，边说边演示。
- 互动要具体：让观众打一个字、选一个颜色、问一个问题，而不是“扣 1”刷屏。
- 逼单段分三句话：对刚进来的人讲最核心的好处，对看了没下的人回答最大的顾虑（例如售后、不适合的情况），对已经下单的人讲怎么用好、怎么联系售后，减少退货。不要用恐吓或贬低观众的话。
- Lines the host can read out as-is: short sentences, spoken to "you".
- The demo turns specs into benefits for a person in a scene, shown live.
- Chat prompts are concrete (type one word, pick a color, ask one question), not spam.
- The close has three parts: the core benefit for newcomers, the biggest doubt answered for viewers who have not bought (after-sales, what it is not for), and how to use it and reach support for buyers, to cut returns. No pressure or put-downs.

合规（《网络直播营销管理办法（试行）》第十八条、《广告法》、《明码标价和禁止价格欺诈规定》）/ Compliance:

- 每个说法、每个数字都要能在商品资料或价格里找到。不编销量、库存、在线人数、好评数，不说“已经卖了几万单”“最后几单”“马上涨价”，除非资料里写了。
- 价格段说清价格和优惠；没有给价格时写“价格看购物车”。不说“原价”“专柜价”“全网最低”，除非资料里有真实依据。
- 不用“最好”“第一”“100%”这类绝对化说法；普通商品不说治疗、预防疾病的功效。
- 主动说出资料里写的使用限制。不要留 `[...]` 或 TODO。
- Every claim and number must be in the product facts or the price. Never invent sales counts, stock, viewer numbers or reviews ("sold 30,000 already", "last few left", "price goes up soon") unless the facts say so.
- The price segment states the price and offer; with no price given, say "check the cart for the price". No "was" price, "retail price" or "lowest anywhere" without a real basis.
- No absolute claims and no disease-treatment claims for ordinary goods.
- Say the usage limits from the facts out loud. Leave no `[...]` or TODO.
