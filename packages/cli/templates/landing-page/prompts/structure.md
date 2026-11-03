根据简报，设计落地页的区块结构和表单。只输出 JSON，不要解释。

- 产品：{{inputs.product}}
- 访问者：{{inputs.audience}}
- 希望访问者做的事：{{inputs.goal}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`purpose`、`points`、`alt` 和 `label` 全部用这个语言写。是 en 时，即使简报和下面的示例是中文，也写英文。

Design the landing page blocks and its form from the brief. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- Visitor: {{inputs.audience}}
- What the visitor should do: {{inputs.goal}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write every `purpose`, `points`, `alt` and `label` in that language. When it is `en`, write English even though the brief and the examples below are in Chinese.

形状 / Shape:

```json
{
  "blocks": [
    {
      "id": "hero",
      "purpose": "这个区块要让访问者理解的一件事",
      "points": ["必须出现的事实或卖点"],
      "image": "hero.jpg",
      "alt": "这张图应该拍什么，一句话"
    }
  ],
  "form": {
    "fields": [{ "id": "email", "label": "邮箱", "type": "email", "required": true }],
    "consent": ""
  }
}
```

规则 / Rules:

1. 区块按这个顺序：`hero`、`features`、`testimonial`、`faq`、`cta`。`testimonial` 只在简报「证据」里有真实的用户原话时才放；没有就去掉它，只留四个区块。
2. 一页只有一个目标：页面上每个按钮都通往同一件事（「希望访问者做的事」），不放别的链接。
3. `hero` 接住简报「访问者从哪里来」里那句承诺，用访问者能得到的结果来说，而不是公司介绍。按钮要放在这里：很多人不往下滑。
4. `features` 每条 `points` 先说访问者得到什么，再说靠的是哪个特点。
5. `testimonial` 的 `points` 照抄简报里的原话，并写明是谁说的、和你有没有利益关系（例如免费试用、员工、亲友）。不要改写，也不要编。
6. `faq` 回答访问者下决定前会担心的事：适不适合自己、材料、什么时候能买，只用简报里的事实。
7. `cta` 再说一次要做的事，并说明留下的信息谁收、用来做什么、保存多久、怎么撤回，只用简报「表单和隐私」里的说法。
8. `points` 两条到四条，每条一句短话，只来自简报，不新增事实；简报「不要说的话」不要写进去。
9. `image` 是建议的文件名：小写英文、数字和连字符，以 `.jpg` 结尾，例如 `hero.jpg`。没有合适的图就写成空字符串。
10. `alt` 用一句话写这张图应该拍什么。生成网页时它就是图片的替代文本，读屏软件会念出来：不要以「图片」「照片」开头，也不要重复标题。`image` 是空字符串时，`alt` 也是空字符串。
11. `form.fields` 只放完成目标必需的字段，通常只有一个。`type` 只能是 `email`、`tel`、`name` 或 `text`。`required` 写明是否必填。
12. `form.consent` 默认是空字符串。只有简报说要定期发营销信息时，才写一句让访问者自己勾选的同意说明，页面上不会预先勾选。
13. 交出之前再看一遍语言：{{inputs.language}} 是 en 时，每一段文字都必须是英文；简报里的原话照规则 5 写，并翻译成英文、注明是翻译。
14. 只输出 JSON。

1. Blocks in this order: `hero`, `features`, `testimonial`, `faq`, `cta`. Include `testimonial` only when the brief's "proof" section has a real customer quote; otherwise leave it out and keep four blocks.
2. One page, one goal: every button on the page leads to the same action (what the visitor should do). No other links.
3. `hero` picks up the promise from the brief's "where visitors come from", stated as what the visitor gets, not as a company introduction. The button belongs here, because many people never scroll.
4. Each `features` point says what the visitor gets first, then which feature delivers it.
5. `testimonial` points copy the quote from the brief word for word and say who said it and any tie to you (a free sample, an employee, a friend or relative). Never reword or invent a quote.
6. `faq` answers what visitors worry about before deciding: whether it fits them, materials, when they can buy. Only facts from the brief.
7. `cta` repeats the action and says who receives the details, what for, how long they are kept and how to withdraw, using only the brief's "form and privacy" section.
8. `points` is two to four short sentences, only facts from the brief. Nothing from the brief's "do not say" section.
9. `image` is a suggested file name: lowercase letters, digits and hyphens, ending in `.jpg`, such as `hero.jpg`. Use an empty string when no image fits.
10. `alt` says in one sentence what the photo should show. The page uses it as the image's text alternative, which screen readers read aloud, so do not start with "image of" or "photo of" and do not repeat the heading. When `image` is empty, `alt` is empty too.
11. `form.fields` holds only the fields the goal needs, usually one. `type` is one of `email`, `tel`, `name` or `text`. `required` says whether it must be filled in.
12. `form.consent` is an empty string by default. Write one sentence for a box the visitor ticks themselves only when the brief says you will send regular marketing; the page never pre-ticks it.
13. Check the language before you answer: when {{inputs.language}} is `en`, every string must be in English; a quote from the brief follows rule 5, translated into English and marked as a translation.
14. Reply with JSON only.
