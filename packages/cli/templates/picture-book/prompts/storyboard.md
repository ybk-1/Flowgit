按版式把故事分页。只输出 JSON，不要解释。

- 形式：{{inputs.format}}（picture-book = 绘本，comic = 漫画）
- 读者年龄：{{inputs.age}} 岁
- 页数：{{inputs.pages}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Paginate the story to the layout. Reply with JSON only.

- Format: {{inputs.format}} (picture-book or comic)
- Reader age: {{inputs.age}}
- Pages: {{inputs.pages}}
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "format": "picture-book",
  "cover": { "art": "…", "alt": "…" },
  "dedication": "…",
  "units": [
    { "pages": [4, 5], "text": "…", "art": "…", "alt": "…", "turn": "…" }
  ]
}
```

漫画的每个单元再加 `panels` / A comic unit also has `panels`:

```json
{ "pages": [1], "text": "", "art": "…", "alt": "…", "turn": "…",
  "panels": [{ "art": "…", "lines": [{ "kind": "speech", "who": "…", "text": "…" }] }] }
```

单元 / Units:

- `format` 照抄上面的形式。`units` 和版式里“故事单元”表一一对应：表里有几行就写几项，顺序一样，`pages` 照抄那一行的 pages。前页（书名、版权、献词）不写进 `units`。
- `units` follows the “Story units” table in the layout one to one: as many items as rows, in the same order, with `pages` copied from the row. Front matter (title, copyright, dedication) is not a unit.

绘本 / Picture book:

- `text`：这个跨页上印的字，大人念给孩子听。短句，念出来有节奏；一个跨页一个时刻。图能看出来的（颜色、长相、谁在哪儿）不要用字再说一遍，字说图说不出来的：声音、对话、心里想什么、时间过去了多久。图能讲完的跨页，`text` 写空字符串。全书的字加起来：中文不超过 1000 字，英文不超过 600 个词，越短越好。
- 故事的 `refrain` 照它的原话放进 3 个单元，最多 4 个：开头、中间、结尾附近各一次，最后一次可以变一变。其他单元不要用它的开头那几个字，免得读起来全是重复句。
- 不要写成一句道理（“她明白了分享”“The lesson is…”），也不要让大人出来教。主角自己做决定。
- `art`：给画家的插图说明：这一页画什么，尤其是字里没说的东西（角色的反应、藏着的笑点、为翻页埋的伏笔）。角色用名字称呼。脸和重要的东西不要放在跨页正中的中缝上。版式表“位置”写着单页的（比如最后一页），就按一页画，不要写“跨页或单页”。一两句。
- `alt`：给看不见图的读者的图片描述：一句话，现在时，用这个年龄的孩子懂的词，不超过 140 个字符（中文算字数，英文算字母和空格）。
- `turn`：读者为什么想翻到下一页：一个问题、一个没做完的动作或一个快要揭晓的东西，一句话。只有 `pages` 里有第 {{inputs.pages}} 页的那一项（最后一项）写空字符串；其他每一项都要写，倒数第二项也要写：它是翻到最后一页之前的那一下。
- `cover`：封面的 `art` 和 `alt`。`dedication`：说明里的献词，没有就写空字符串。

- `text`: the words printed on the spread, read aloud by an adult. Short sentences with a rhythm; one moment per spread. Don't say in words what the picture shows (colours, looks, who is where); the words say what the picture can't: sounds, dialogue, thoughts, how much time has passed. When the picture tells it all, `text` is an empty string. The whole book: no more than 600 words in English or 1000 characters in Chinese, and shorter is better.
- Put the story's `refrain` in word for word in 3 units, 4 at most: near the beginning, in the middle and near the end; the last time may change it. Other units don't use its opening words, so the book isn't all refrain.
- No line that states a lesson (“she learned to share”, “The lesson is…”), and no grown-up who teaches it. The main character makes the choice.
- `art`: the art note for the illustrator: what the picture shows, especially what the words don't say (reactions, hidden jokes, a set-up for the page turn). Call characters by name. Keep faces and anything important out of the gutter in the middle of a spread. A unit the layout table marks as a single page (such as the last page) is drawn as one page; don't write “spread or single page”. One or two sentences.
- `alt`: an image description for a reader who can't see it: one sentence, present tense, in words a child this age knows, at most 140 characters.
- `turn`: why the reader wants to turn the page: a question, an unfinished action or something about to be revealed, in one sentence. Only the unit whose `pages` holds page {{inputs.pages}} (the last one) has an empty string; every other unit has one, the second-to-last too: it is the turn before the last page.
- `cover`: the cover's `art` and `alt`. `dedication`: the brief's dedication, or an empty string.

漫画 / Comic:

- `text` 写空字符串，字都在 `panels` 里。`art` 写这一页的场景和整体安排，一句话。
- `panels`：这一页的分格，按阅读顺序。每格的 `art` 一两句，画家只画脚本里写了的东西。`lines` 是这一格的字：`kind` 只能是 `speech`（对白）、`thought`（心里想的）、`whisper`（小声说）、`shout`（喊）、`caption`（旁白框）、`sfx`（拟声字）；`who` 写说话的角色名字，旁白和拟声字写空字符串；`text` 是框里的字。
- 字要少：一个对白框中文不超过 40 字、英文不超过 25 个词；一格加起来中文不超过 80 字、英文不超过 50 个词。
- 版式里“翻页”一栏写着翻页的奇数页，最后一格留一个悬念，`turn` 写这个悬念；翻过去的偶数页第一格揭晓。其他页的 `turn` 可以写空字符串。
- `alt` 一句话概括这一页，不超过 140 个字符。

- `text` is an empty string; the words live in `panels`. `art` is the page's setting and overall plan, in one sentence.
- `panels`: the page's panels in reading order. Each panel's `art` is one or two sentences; the artist draws only what the script says. `lines` are the panel's words: `kind` is one of `speech`, `thought`, `whisper`, `shout`, `caption` and `sfx`; `who` is the speaking character's name, or an empty string for captions and sound effects; `text` is what goes in the balloon.
- Few words: at most 25 words (40 Chinese characters) in a balloon, and 50 words (80 characters) in a panel.
- On the odd pages the layout marks with a page turn, end on a hook in the last panel and write it in `turn`; the first panel of the next even page pays it off. Other pages may leave `turn` empty.
- `alt` sums up the page in one sentence of at most 140 characters.

交之前查一遍：`units` 的项数和 `pages` 跟版式的表一样；绘本全书的字数在上限以内；重复句的开头只出现在 3 到 4 个单元里；除了有第 {{inputs.pages}} 页的最后一项，每项的 `turn` 都不是空的；每个 `alt` 不超过 140 个字符。
Before you reply, check: `units` has the same count and `pages` as the layout table; a picture book's words are within the limit; the refrain's opening words appear in 3 or 4 units only; every unit but the last one, with page {{inputs.pages}}, has a non-empty `turn`; every `alt` is 140 characters or fewer.

语言：`text`、`art`、`alt`、`turn`、`dedication`、对白和旁白全部用输出语言写（zh = 中文，en = English），角色名字也用输出语言里的那个，即使说明、故事设计或上面的例子是另一种语言；`format` 和 `kind` 照上面的英文写。
Language: write `text`, `art`, `alt`, `turn`, `dedication`, balloons and captions in the output language (zh = Chinese, en = English), with the characters' names in that language too, even when the brief, the story or the examples above are in another language; `format` and `kind` stay as the English values above.
