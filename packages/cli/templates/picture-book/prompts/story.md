根据创作说明写这本书的故事设计。只输出 JSON，不要解释。

- 形式：{{inputs.format}}（picture-book = 绘本，comic = 漫画）
- 读者年龄：{{inputs.age}} 岁
- 页数：{{inputs.pages}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Design this book's story from the brief. Reply with JSON only.

- Format: {{inputs.format}} (picture-book or comic)
- Reader age: {{inputs.age}}
- Pages: {{inputs.pages}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "title": "…",
  "logline": "…",
  "theme": "…",
  "characters": [{ "name": "…", "role": "main", "look": "…", "want": "…" }],
  "setting": "…",
  "refrain": "…",
  "beats": [{ "beat": "opening", "what": "…" }],
  "solvedBy": "…",
  "ending": "…",
  "style": "…"
}
```

规则 / Rules:

- `title`：短，好念，说明里给了书名就用它。
- `logline`：一句话：谁，想要什么，什么挡着他。
- `theme`：故事下面藏着的那种感觉或想法，一句话。它只写在这里，书里的文字不会说出来。
- `characters`：只用说明里的角色，名字用输出语言里的那个。`role` 只能是 `main`（主角，只有一个，是读者那么大的孩子或者像孩子的角色）、`friend`、`adult`、`other`。`look` 写画家照着画、每页都画得一样的外观：年纪或物种、头发或毛色、衣服和颜色、一件有辨识度的东西；说明里写了的照抄。`want` 写这个角色想要什么，没有就写空字符串。
- `setting`：在哪里、什么季节和天气，一句话。
- `refrain`：一句会反复出现的短句，孩子能跟着念，一般在开头、中间和结尾附近各出现一次；说明里不要就写空字符串。
- `beats`：按顺序。`beat` 只能是 `opening`（开头，主角和他在乎的东西）、`problem`（出了什么事）、`try`（主角想办法，一共三次，一次比一次难或一次比一次好笑）、`turn`（转折：最低点，或主角看到了以前没看到的）、`resolution`（主角自己做决定或自己想出办法）、`ending`（结尾）。`what` 一句话，写发生了什么。
- `solvedBy`：在 `resolution` 里解决问题或做决定的角色名字，必须是主角。不要让大人、魔法或运气来解决。
- `ending`：最后一页：一个小惊喜，或者回应开头的画面。不要用一句道理收尾。
- `style`：画风建议：材料、颜色、光线和气氛，说明里写了的照抄。
- 只用说明里的事。说明里“一定要有”的都要放进去，“不要有”的都不能出现。
- 读者是 {{inputs.age}} 岁：绘本由大人读给孩子听，孩子主要看图。

- `title`: short and easy to say; use the brief's title when it gives one.
- `logline`: one sentence: who, what they want, what stands in the way.
- `theme`: the feeling or idea under the story, in one sentence. It stays here; the book's words never say it.
- `characters`: only the brief's characters, named as in the output language. `role` is one of `main` (the one main character: a child the reader's age, or a child-like character), `friend`, `adult` and `other`. `look` is what an illustrator draws the same way on every page: age or species, hair or fur, clothes and colours, one recognisable thing; copy what the brief says. `want` is what the character wants, or an empty string.
- `setting`: where, what season and weather, in one sentence.
- `refrain`: a short line that comes back so children can say it along, usually once near the beginning, the middle and the end; an empty string if the brief doesn't want one.
- `beats`: in order. `beat` is one of `opening` (the main character and what they care about), `problem` (what goes wrong), `try` (the main character tries; three tries in all, each harder or funnier than the last), `turn` (the low point, or the main character sees something new), `resolution` (the main character decides or works it out), and `ending`. `what` is one sentence on what happens.
- `solvedBy`: the name of the character who solves the problem or makes the choice in the `resolution`. It must be the main character: no grown-up, magic or luck does it.
- `ending`: the last page: a small surprise, or an echo of the opening. Never end on a lesson.
- `style`: an art style: medium, colours, light and mood; copy what the brief says.
- Use only what the brief says. Everything it says must be there goes in; nothing it rules out appears.
- The reader is {{inputs.age}}: a picture book is read aloud by an adult, and the child mostly follows the pictures.

交之前查一遍：`try` 正好三个，`solvedBy` 是 `role` 为 `main` 的那个角色。
Before you reply, check: exactly three `try` beats, and `solvedBy` is the character whose `role` is `main`.

语言：`title`、`logline`、`theme`、角色名字和外观、`setting`、`refrain`、每个 `what`、`ending` 和 `style` 全部用输出语言写（zh = 中文，en = English），即使说明是另一种语言或两种都有；`role` 和 `beat` 照上面的英文写。
Language: write `title`, `logline`, `theme`, the characters' names and looks, `setting`, `refrain`, every `what`, `ending` and `style` in the output language (zh = Chinese, en = English), even when the brief is in another language or both; `role` and `beat` stay as the English values above.
