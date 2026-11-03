根据产品资料，写这次发布的定位和信息。只输出 JSON，不要解释。

- 产品：{{inputs.product}}
- 给谁：{{inputs.audience}}
- 发布日期：{{inputs.launchDate}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write the positioning and messaging for this launch from the product facts. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- For: {{inputs.audience}}
- Launch date: {{inputs.launchDate}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "alternatives": ["…"],
  "attributes": [{ "attribute": "…", "value": "…" }],
  "bestFit": "…",
  "category": "…",
  "statement": "…",
  "headline": "…",
  "subhead": "…",
  "pillars": [{ "title": "…", "message": "…", "proof": "…" }],
  "boilerplate": "…",
  "tier": { "level": 2, "why": "…" },
  "claims": [{ "claim": "…", "source": "…" }]
}
```

定位按 April Dunford 的五个部分，一个推出下一个：

1. `alternatives`：资料「现在怎么做」里，最合适的客户今天用的办法，1 到 4 条。不要编资料里没有的竞品。
2. `attributes`：资料「只有它有的」里的每个特点，`value` 写这个特点给客户带来的结果（客户在乎的事，不是功能本身）。
3. `bestFit`：最在乎这些结果的那群人，比「{{inputs.audience}}」更具体，一句话。
4. `category`：把它放进客户已经熟悉的一个市场类别，让人一看就懂它的价值，几个字。
5. `statement`：内部用的定位，两三句：给谁、他们现在怎么做、它属于什么类别、带来什么结果、和现在的办法比有什么不同。

信息：

6. `headline`：发布标题，新闻稿、邮件、帖子和落地页都用它。说客户得到的结果，不超过 60 个字符（这是邮件标题和 Product Hunt 标语的上限），越短越好。
7. `subhead`：一句话补充它是什么、给谁。
8. `pillars`：正好 3 条。`message` 一句话；`proof` 照抄资料里能证明它的一句（事实、数字或原话），资料是中英对照的就只抄输出语言那半句；资料里没有就写空字符串。
9. `boilerplate`：新闻稿结尾「关于公司」的一段，只用资料「公司简介」里的事实。英文不超过 100 个词，中文不超过 200 个字。
10. `tier`：发布分级，`level` 是 1、2 或 3。1：新产品、进入新市场或公司方向的大变化，要全套物料和媒体。2：影响很多用户的功能，用网页、邮件、帖子，新闻稿可选。3：小改进，告诉现有用户就够。已有产品里的新功能不算新产品：很多现有用户会用就是 2，少数人用得到就是 3。`why` 一句话，说按资料里的哪一点定的。
11. `claims`：物料里会用到的每一个事实说法，一条一项：数字、价格、版本、功能、内测的时间、谁说的话（客户的话带上和你的关系）。发布日期和时间来自流程输入，不算说法，不要列。`source` 是资料里支持它的那一句，一字不改地复制过来（资料是中英对照的，只抄输出语言那半句）。资料里找不到原文的说法不要写进 `claims`，也不要用在别处。

规则：

- 只用资料里的事实。不编数字、客户、奖项、媒体报道和准确率。资料「不要说的话」里的说法一句都不用。
- 不写「最好」「第一」「首款」「唯一」这类话，除非资料给了证据。
- 不写「限时」「仅剩」「最后机会」，除非资料里有真实的截止日期或库存。

交之前查一遍：`pillars` 正好 3 条；每条 `claims` 的 `source` 都能在资料里找到一模一样的文字；`headline` 不超过 60 个字符。
语言：除了照抄原文的 `source` 和 `proof`，其余全部用输出语言写（zh = 中文，en = English），即使资料或上面的说明是另一种语言。

Positioning follows April Dunford's five components, each leading to the next:

1. `alternatives`: from the facts' "What they do today", what the best-fit customers use today, 1 to 4 items. Don't invent competitors the facts don't name.
2. `attributes`: each feature under "What only it has"; `value` is the result it gives the customer (what they care about, not the feature itself).
3. `bestFit`: the people who care most about those results, narrower than "{{inputs.audience}}", in one sentence.
4. `category`: a market category customers already know, in which the value is obvious, in a few words.
5. `statement`: the internal positioning in two or three sentences: who it is for, what they do today, its category, the result it brings, and how it differs from today's way.

Messaging:

6. `headline`: the launch headline, used by the press release, email, posts and landing page. State the customer's result in at most 60 characters (the limit for an email subject and a Product Hunt tagline); shorter is better.
7. `subhead`: one sentence on what it is and who it is for.
8. `pillars`: exactly 3. `message` is one sentence; `proof` copies the line from the facts that proves it (a fact, a number or a quote), only the half in the output language when the facts are bilingual; an empty string when the facts have none.
9. `boilerplate`: the "About the company" paragraph for the press release, from the facts' "About the company" only. At most 100 words in English, 200 characters in Chinese.
10. `tier`: the launch tier, `level` 1, 2 or 3. 1: a new product, a new market or a big change of direction, with every asset and press. 2: a feature that matters to many users, with a web page, email and posts, a press release optional. 3: a small improvement, enough to tell current users. A new feature in an existing product is not a new product: it is 2 when many current users will use it, 3 when few will. `why` is one sentence on which fact decided it.
11. `claims`: every factual statement the assets will use, one per item: numbers, prices, versions, features, when the beta ran, who said what (a customer's words with how they are tied to you). The launch date and time come from the flow inputs; they are not claims, so leave them out. `source` is the line from the facts that supports it, copied character for character (the facts are bilingual; copy only the half in the output language). A claim with no such line stays out of `claims` and out of every asset.

Rules:

- Facts from the fact file only. No invented numbers, customers, awards, press coverage or accuracy rates. Nothing from the facts' "Do not say".
- No "best", "number one", "world's first" or "the only" unless the facts prove it.
- No "limited time", "only a few left" or "last chance" unless the facts give a real deadline or stock level.

Before you reply, check: `pillars` has exactly 3 items; every `claims` `source` appears word for word in the facts; `headline` is 60 characters or fewer.
Language: except for `source` and `proof`, which copy the facts, write everything in the output language (zh = Chinese, en = English), even when the facts or these instructions are in another language.
