按产品资料和定位，写对外的常见问题和给客服、销售的内部问答。只输出 Markdown，不要解释，不要放进代码块。

- 产品：{{inputs.product}}
- 给谁：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write a public FAQ and internal Q&A for support and sales from the product facts and the messaging. Reply with Markdown only: no commentary and no code fence.

- Product: {{inputs.product}}
- For: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

格式：

```
# 常见问题：产品名

## 对外常见问题

### 问题？

回答。

## 内部问答（给客服和销售，不公开）

### 问题？

回答。
```

1. 对外常见问题 6 到 10 个：客户用之前真会问、资料答得了的事（答不了的放进内部问答）。它是什么、给谁用；怎么用上（版本、平台）；多少钱，什么免费；隐私（照片和数据去哪了）；它不做什么（照资料「不要说的话」反过来说，例如它不报税）；做错了怎么办。
2. 内部问答 5 到 8 个：客服和销售会被问到、但不该写在网页上的，包括难回答的：准确率有多高、和别的产品比怎么样、能不能退款或取消、数据怎么删、下一步做什么。每个回答写清楚可以怎么说，必要时加一句不能说什么。
3. 每个回答一到三句话，只用资料里的事实，每个数字都要在资料里找得到。
4. 资料里没有答案的，回答以「【待确认】」开头（标题只写问题，不加这个标记），写要确认什么、该问谁，不要猜。资料已经给了说法的（比如「没有准确率数据」「不要说某句话」），照资料回答，不标「【待确认】」。
5. 不提别的公司和产品的名字，不贬低别人。引用客户原话时一字不改，并在同一句写明这个人和你的关系（例如内测期间免费使用 Pro）。
6. 不写「最好」「第一」「首款」「唯一」，不写「限时」这类紧迫感；资料「不要说的话」一句都不写。

交之前查一遍：对外 6 到 10 个、内部 5 到 8 个；资料里没有答案的都标了「【待确认】」；每个数字都在资料里。
语言：全部用输出语言写（zh = 中文，en = English）；英文的标题写 `# FAQ: product name`、`## Public FAQ` 和 `## Internal Q&A (for support and sales, not public)`，待确认写成「[To confirm]」。

Format:

```
# FAQ: product name

## Public FAQ

### Question?

Answer.

## Internal Q&A (for support and sales, not public)

### Question?

Answer.
```

1. A public FAQ of 6 to 10 questions customers really ask before they try it and the facts can answer (the rest go in the internal Q&A): what it is and who it is for; how to get it (version, platforms); what it costs and what is free; privacy (where photos and data go); what it doesn't do (the facts' "Do not say" turned around, for example it doesn't file taxes); what to do when it gets something wrong.
2. Internal Q&A of 5 to 8 questions that support and sales will hear but that don't belong on the website, the hard ones included: how accurate it is, how it compares with other products, refunds or cancelling, deleting data, what comes next. Each answer says what to say and, when needed, what not to say.
3. One to three sentences per answer, from the facts only; every number must be in the facts.
4. When the facts have no answer, start the answer with "[To confirm]" (the heading is the question only, without the marker) and say what needs confirming and whom to ask. Don't guess. When the facts do settle it (for example "there are no accuracy figures" or "don't say X"), answer from the facts without "[To confirm]".
5. Don't name or run down other companies or products. If you quote a customer, use their words exactly and say in the same sentence how they are tied to you (for example, free Pro during the beta).
6. No "best", "number one", "world's first" or "the only", no urgency such as "limited time", and nothing from the facts' "Do not say".

Before you reply, check: 6 to 10 public and 5 to 8 internal questions; every question the facts can't answer is marked "[To confirm]"; every number is in the facts.
Language: write everything in the output language (zh = Chinese, en = English); in Chinese the headings are `# 常见问题：产品名`, `## 对外常见问题` and `## 内部问答（给客服和销售，不公开）`, and "to confirm" is 「【待确认】」.
