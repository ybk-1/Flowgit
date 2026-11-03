按产品资料和定位，写 Product Hunt 的发布文案和 X、LinkedIn 各一条帖子。只输出 JSON，不要解释。

- 产品：{{inputs.product}}
- 给谁：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write the Product Hunt listing and one post each for X and LinkedIn from the product facts and the messaging. Reply with JSON only, no commentary.

- Product: {{inputs.product}}
- For: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "productHunt": {
    "name": "…",
    "tagline": "…",
    "description": "…",
    "firstComment": "…",
    "translation": "…"
  },
  "x": "…",
  "linkedin": "…"
}
```

Product Hunt（只收英文，所以 `productHunt` 里除了 `translation` 都写英文，输出语言是 zh 也一样）：

1. `name`：只写产品名。资料「产品是什么」里有英文名就用它，不加描述、口号或表情。
2. `tagline`：不超过 60 个字符，也就是 10 个英文词以内。一句话说它为谁做什么，可以从 `headline` 改写成英文。
3. `description`：不超过 260 个字符。写一到两句、30 个英文词以内：它是什么，解决什么问题。价格和平台留给第一条评论。长度参考（约 130 个字符，内容和这次发布无关）：「A desk lamp that dims itself as daylight fades, so your screen and your room stay in balance. Set it once and it learns your hours.」
4. `firstComment`：maker 的第一条评论，上线后马上发，显示在图集下面。三四个短段落：你是谁、为什么做它、现在能做什么、想听什么反馈。可以引用资料里的客户原话，一字不改并写明关系。
5. `translation`：输出语言是 zh 时，把 `tagline`、`description` 和 `firstComment` 翻成中文，让人知道自己提交的是什么；是 en 时写空字符串。

X（`x`）：一整条帖子，用输出语言写。按 X 的加权长度不超过 280：汉字和全角标点算 2，英文字母、数字和半角符号算 1，每个网址算 23。中文写 110 个字以内，英文 40 个词以内。网址只用资料里出现过的。

LinkedIn（`linkedin`）：一整条帖子，用输出语言写，不超过 3000 个字符。比 X 多讲一点为什么做它和内测里看到的事，像一个人在讲，不像新闻稿。

规则：

- 不请人点赞、投票、转发（Product Hunt 不允许请人投票）；可以请人看看、提问题、给反馈。
- 只用资料里的事实，每个数字都要在资料里找得到。资料「不要说的话」一句都不写。
- 不管在哪一条里引用客户原话，都一字不改，并在同一句写明这个人和你的关系（例如内测期间免费使用 Pro）。
- 不写「最好」「第一」「首款」「唯一」，不写 best、number one、world's first、the only、revolutionary，也不写「限时」、limited time 这类紧迫感。
- 不要写 `{{`、`TODO`、`TBD` 这类占位符。

交之前查一遍：`name`、`tagline`、`description` 和 `firstComment` 里没有一个汉字；`tagline` 不超过 10 个词，`description` 不超过两句话、30 个词；X 按加权数到 280 以内。
语言：`productHunt` 除 `translation` 外都用英文；`x` 和 `linkedin` 用输出语言（zh = 中文，en = English）。

Product Hunt (English only, so everything in `productHunt` except `translation` is English, even when the output language is zh):

1. `name`: the product's name only. Use the English name from the facts' "What it is" when there is one, with no description, slogan or emoji.
2. `tagline`: at most 60 characters, which is 10 words or fewer: one line on what it does and for whom; you may rework the `headline` into English.
3. `description`: at most 260 characters. Write one or two sentences of 30 words or fewer: what it is and the problem it solves. Leave the price and platforms to the first comment. For length only (about 130 characters, unrelated to this launch): "A desk lamp that dims itself as daylight fades, so your screen and your room stay in balance. Set it once and it learns your hours."
4. `firstComment`: the maker's first comment, posted as soon as the launch is live; it shows under the gallery. Three or four short paragraphs: who you are, why you built it, what it does now, and what feedback you want. You may quote a customer from the facts, word for word, with how they are tied to you.
5. `translation`: when the output language is zh, a Chinese translation of `tagline`, `description` and `firstComment`, so the person knows what they are submitting; an empty string when it is en.

X (`x`): one whole post in the output language. On X's weighted count it stays within 280: Han characters and fullwidth punctuation count 2, Latin letters, digits and ASCII symbols count 1, and each URL counts 23. Keep Chinese within 110 characters and English within 40 words. Only URLs that appear in the facts.

LinkedIn (`linkedin`): one whole post in the output language, at most 3,000 characters. Say a little more than on X about why you built it and what the beta showed, as a person talking, not a press release.

Rules:

- Don't ask anyone to upvote, vote or share (Product Hunt does not allow asking for votes); asking people to take a look, ask questions or give feedback is fine.
- Facts from the fact file only; every number must be in the facts. Nothing from the facts' "Do not say".
- Wherever you quote a customer, use their words exactly and say in the same sentence how they are tied to you (for example, free Pro during the beta).
- No 最好, 第一, 首款, 唯一, "best", "number one", "world's first", "the only" or "revolutionary", and no urgency such as 限时 or "limited time".
- No placeholders such as `{{`, `TODO` or `TBD`.

Before you reply, check: `name`, `tagline`, `description` and `firstComment` contain no Chinese characters; `tagline` has 10 words or fewer and `description` two sentences of 30 words or fewer; the X post weighs 280 or less.
Language: `productHunt` is English except `translation`; `x` and `linkedin` are in the output language (zh = Chinese, en = English).
