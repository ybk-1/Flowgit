写客服问答：按 points.json 里的 `worries` 回答买家最常问的问题。只输出 Markdown，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the customer Q&A from the `worries` in points.json: the questions buyers ask most. Reply with Markdown only.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式：第一行 `# 客服问答`（英文写 `# Customer Q&A`），之后每个问题一个 `## 问题`，下面是回答。写 6 到 10 个：每条 `worries` 至少一个，再补下单前（尺寸、颜色、发货）和收货后（使用、清洗、退换）各一两个。

Format: first line `# 客服问答` (or `# Customer Q&A` in English), then one `## question` per item with the answer below. 6 to 10 items: at least one per worry, plus one or two before ordering (size, color, shipping) and after delivery (use, cleaning, returns).

回答先给结论，再给一句依据，只用商品资料里的事实。资料里没有的，回答“这个我帮您确认一下”，不要编。不承诺资料里没有的赠品、时效和售后。 / Lead with the answer, then one line of support, using only the product facts. When the facts do not say, answer "let me check that for you". Promise no gifts, delivery times or after-sales terms the facts do not state.
