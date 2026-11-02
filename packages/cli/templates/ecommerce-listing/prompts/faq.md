写客服问答：买家下单前和收货后最常问的问题。只输出 Markdown，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the customer Q&A: what buyers ask most before ordering and after delivery. Reply with Markdown only.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式：第一行 `# 客服问答`（英文写 `# Customer Q&A`），之后每个问题一个 `## 问题`，下面是回答。写 6 到 10 个。

Format: first line `# 客服问答` (or `# Customer Q&A` in English), then one `## question` per item with the answer below. 6 to 10 items.

回答只用商品资料里的事实。资料里没有的，回答“这个我帮您确认一下”，不要编。 / Answers use only the product facts. When the facts do not say, answer "let me check that for you" instead of guessing.
