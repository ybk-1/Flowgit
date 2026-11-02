写弹幕问答：直播时观众最常问的问题，每个配一句主播能马上回的话。只输出 Markdown，不要解释。

- 商品：{{inputs.product}}
- 价格和优惠：{{inputs.price}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the chat Q&A: what viewers ask most during the stream, each with a line the host can say right away. Reply with Markdown only.

- Product: {{inputs.product}}
- Price and offer: {{inputs.price}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

格式：第一行 `# 弹幕问答`（英文写 `# Chat Q&A`），之后每条 `- **问题** 回答`。写 8 到 12 条。只用商品资料里的事实，资料里没有的回答“这个我让助理查一下，马上回你”。

Format: first line `# 弹幕问答` (or `# Chat Q&A` in English), then `- **question** answer` per item, 8 to 12 items. Only facts from the product notes; when they do not say, answer "let me have my assistant check and get right back to you".
