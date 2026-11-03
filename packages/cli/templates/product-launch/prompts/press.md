按产品资料、定位和媒体资料写新闻稿。只输出新闻稿本身的 Markdown，不要解释，不要放进代码块。

- 产品：{{inputs.product}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write the press release from the product facts, the messaging and the fact sheet. Reply with the press release in Markdown only: no commentary and no code fence.

- Product: {{inputs.product}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

结构，照这个顺序（倒金字塔：最重要的放最前面）：

1. 第一行：照抄 fact-sheet.md 里「新闻稿第一行」冒号后面的文字，单独一行。
2. `# 标题`：说清楚谁发布了什么、读者得到什么，不超过 70 个字符。可以用 messaging.json 的 `headline`，但要让人一看就知道是哪家公司的什么产品。
3. 副标题（可选）：一句话，用 `subhead`。
4. 第一段以 fact-sheet.md 的「电头」开头，紧接导语：一两句话交代谁、发布了什么、什么时候、在哪儿能用、为什么要紧。
5. 两三段正文：先讲客户现在的麻烦（`alternatives`），再讲它怎么解决（`attributes` 和 `pillars`），用资料里的事实和数字。
6. 发言人引语：资料「发言人」里那个人说的一段话，用引号括起来，后面写「XX 说，她/他是 YY」。说为什么做这个、对客户意味着什么，不要重复前面的事实，不要夸张。资料允许起草时才起草，检查会提醒发之前让本人确认。
7. 资料「证据」里有客户原话时，可以引用，一字不改，并写明这个人和公司的关系（例如内测期间免费使用）。没有就不写，绝不编造客户的话。
8. 价格和购买方式：照资料「价格和购买方式」写。
9. `## 关于XX`（英文 `## About XX`）：照抄 messaging.json 的 `boilerplate`，一个字都不改。
10. `## 媒体联系人`（英文 `## Media contact`）：照抄资料「媒体联系人」。

长度：英文正文 300 到 500 个词；中文 500 到 1000 个字。

规则：

- 只用资料里的事实，每个数字都要在资料里找得到。资料「不要说的话」一句都不写。
- 不写「最好」「第一」「首款」「唯一」「革命性」这类话；不写「限时」之类的紧迫感。
- 日期照抄电头里的写法，不另写别的日期或星期。
- 不请读者点赞、转发。

交之前查一遍：第一行和电头和 fact-sheet.md 一字不差；`关于` 一节就是 `boilerplate` 原文；引语后面写了说话人的名字和职位；英文在 300 到 500 个词之间。
语言：全部用输出语言写（zh = 中文，en = English），客户原话如果是另一种语言，忠实翻译并注明「译」/「(translated)」。

Structure, in this order (an inverted pyramid: the most important first):

1. First line: copy the text after the colon in fact-sheet.md's "Release line", on its own line.
2. `# Headline`: who is launching what and what the reader gets, at most 70 characters. You may use the `headline` from messaging.json, but make the company and the product obvious.
3. Subheading (optional): one sentence, from `subhead`.
4. The first paragraph starts with fact-sheet.md's "Dateline", then the lede: one or two sentences on who, what, when, where it is available and why it matters.
5. Two or three body paragraphs: the customer's problem today (`alternatives`), then how it solves it (`attributes` and `pillars`), with facts and numbers from the fact file.
6. A spokesperson quote: a short paragraph in quotation marks from the person under "Spokesperson", followed by "said NAME, TITLE." Say why the company built it and what it means for customers, without repeating the facts above or overselling. Draft it only when the facts allow it; the check reminds you to have that person approve it.
7. When the facts' "Proof" has a customer quote, you may use it word for word and say how the person is tied to the company (for example, free use during the beta). Otherwise leave it out; never invent a customer's words.
8. Price and availability, as the facts' "Price and availability" says.
9. `## About COMPANY`: copy `boilerplate` from messaging.json, unchanged.
10. `## Media contact`: copy the facts' "Media contact".

Length: 300 to 500 words in English; 500 to 1,000 characters in Chinese.

Rules:

- Facts from the fact file only; every number must be in the facts. Nothing from the facts' "Do not say".
- No "best", "number one", "world's first", "the only" or "revolutionary", and no urgency such as "limited time".
- Write the date the way the dateline does, and add no other date or weekday.
- Don't ask readers to upvote or share.

Before you reply, check: the first line and the dateline match fact-sheet.md exactly; the About section is `boilerplate` word for word; the quote is followed by the speaker's name and title; English is 300 to 500 words.
Language: write everything in the output language (zh = Chinese, en = English); a customer quote in another language is translated faithfully and marked "(translated)" / 「译」.
