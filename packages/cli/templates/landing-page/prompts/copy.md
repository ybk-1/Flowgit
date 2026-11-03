根据简报和区块结构，为每个区块写文案。只输出 JSON，不要解释。

- 产品：{{inputs.product}}
- 访问者：{{inputs.audience}}
- 希望访问者做的事：{{inputs.goal}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`heading`、`body`、`button` 和 `note` 全部用这个语言写。是 en 时，即使简报和下面的示例是中文，也写英文。

Write the copy for every block from the brief and the structure. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- Visitor: {{inputs.audience}}
- What the visitor should do: {{inputs.goal}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write every `heading`, `body`, `button` and `note` in that language. When it is `en`, write English even though the brief and the examples below are in Chinese.

`blocks` 的键必须和 structure.json 里每个区块的 `id` 一一对应，不多不少。 / The keys of `blocks` match each block `id` in structure.json, one to one, no extras and no gaps.

形状 / Shape:

```json
{
  "blocks": {
    "hero": { "heading": "短标题", "body": "一两句正文", "button": "按钮文字" },
    "cta": { "heading": "短标题", "body": "一两句正文", "button": "按钮文字", "note": "谁收、做什么用、存多久、怎么撤回" }
  }
}
```

规则 / Rules:

1. `heading` 不超过 40 个字符，`body` 不超过 400 个字符。最有信息量的词放在最前面：很多人只扫一眼标题的开头。检查会把标题超过 80 个字符、正文超过 500 个字符判为过长。
2. `hero` 的标题用访问者能得到的结果来说，并且接住简报「访问者从哪里来」里的那句承诺。
3. `button` 写成「动词 + 会发生什么」，例如「留下邮箱，开卖时通知我」。不要只写「提交」「了解更多」「点击这里」。所有按钮都做同一件事。这个区块不需要按钮时用空字符串；`testimonial` 没有按钮。
4. 只用简报里的事实和卖点。不编造数字、价格、评价、医疗效果或送达日期。不写「最好」「第一」这类绝对化的话，除非简报给了证据。
5. 不制造紧迫感：简报里没有真实的截止日期或库存，就不写「限时」「仅剩」「最后机会」这类话，也不写倒计时。
6. `testimonial`（结构里有它时）把简报里的原话一字不改放进「」，后面写是谁说的，以及和你有没有利益关系（例如免费试用、员工、亲友）。输出语言和原话不同时，忠实翻译并注明「译」。不改写、不删减、不编造评价。
7. `cta` 的 `note` 是放在表单下面的收集说明，一两句：谁收集（名称和联系方式）、用来做什么、保存多久、怎么撤回或退订。只用简报「表单和隐私」里的说法；简报没写到的项写成「待补充：……」，检查会提醒你补上。
8. 不要写 HTML 或 Markdown。页面会转义这些文字。
9. 交出之前再看一遍语言：{{inputs.language}} 是 en 时，JSON 里的每一段文字都必须是英文。页面的 `lang` 按这个设置，内容对不上会被检查判为必须修。
10. 只输出 JSON。

1. Keep `heading` within 40 characters and `body` within 400. Put the most informative words first: many people only glance at the start of a heading. The check flags a heading over 80 characters or a body over 500.
2. The `hero` heading states what the visitor gets and picks up the promise from the brief's "where visitors come from".
3. Write `button` as a verb plus what happens, such as "Notify me when it launches". Never just "Submit", "Learn more" or "Click here". Every button does the same thing. Use an empty string when the block has no button; `testimonial` has none.
4. Use only facts and selling points from the brief. Do not invent numbers, a price, a review, a medical claim or a delivery date. No superlatives such as "best" or "number one" unless the brief gives the evidence.
5. No false urgency: unless the brief states a real deadline or stock level, do not write "limited time", "only a few left", "last chance" or a countdown.
6. `testimonial` (when the structure has it) puts the brief's quote in quotation marks, word for word, then says who said it and any tie to you (a free sample, an employee, a friend or relative). When the output language differs from the quote, translate it faithfully and mark it "(translated)". Never reword, cut or invent a review.
7. The `cta` block's `note` is the notice shown under the form, one or two sentences: who collects the details (name and contact), what for, how long they are kept, and how to withdraw or unsubscribe. Only use the brief's "form and privacy" section; for anything the brief leaves out, write "To add: …" and the check will remind you.
8. Do not write HTML or Markdown. The page escapes this text.
9. Check the language before you answer: when {{inputs.language}} is `en`, every string in the JSON must be in English. The page's `lang` follows this setting, and the check fails a page whose text does not match it.
10. Reply with JSON only.
