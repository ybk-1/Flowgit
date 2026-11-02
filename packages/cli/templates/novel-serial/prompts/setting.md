为一本连载网文做设定。只输出 JSON，不要解释。

- 点子：{{inputs.premise}}
- 类型：{{inputs.genre}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Build the setting for a serialized web novel. Reply with JSON only.

- Idea: {{inputs.premise}}
- Genre: {{inputs.genre}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "title": "书名",
  "logline": "一句话卖点：谁，想要什么，凭什么，挡在前面的是什么",
  "hook": "读者为什么点开第一章：这本书和同类书最不一样的一点",
  "protagonist": { "name": "", "goal": "", "flaw": "", "edge": "金手指或特长", "cost": "金手指的限制或代价" },
  "rivals": [ { "name": "", "role": "", "want": "" } ],
  "rules": [ "世界或能力的规则，写成能推出冲突的限制" ],
  "promises": [ { "id": "p1", "text": "读者会一直等着看的一件事", "payoff": "大概在第几章、以什么方式兑现" } ],
  "arc": "第一卷的起点和终点"
}
```

写法：

- 网文靠“期待感”留人：`promises` 写 3 到 5 件读者会追着看的事（打脸谁、揭开什么秘密、关系走到哪一步、实力到什么程度），每件都要能在后面兑现。
- 金手指要有限制或代价（`cost`），不然没有冲突；`rules` 写限制，不写百科。
- `hook` 要具体，避免“热血”“爽文”这类空话；行业正在抵制模式化、同质化的写法，卖点要有自己的新意。
- 内容导向要正，不写低俗、血腥猎奇和歧视的内容。

How to write it:

- Serials keep readers through anticipation: `promises` lists 3 to 5 things readers will follow the book for (who gets put in their place, what secret comes out, where a relationship goes, how strong the hero gets), each one payable later.
- The edge needs a limit or cost (`cost`), or there is no conflict; `rules` are limits, not an encyclopedia.
- Make `hook` concrete, not "exciting" or "satisfying". Avoid formula and copycat setups; give the book something of its own.
- Keep the content clean: nothing vulgar, gratuitously gory or discriminatory.
