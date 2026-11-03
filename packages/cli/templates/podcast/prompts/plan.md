根据资料策划这一期播客。只输出 JSON，不要解释。

- 节目：{{inputs.show}}
- 主持人：{{inputs.host}}
- 这一期的主题：{{inputs.topic}}
- 形式：{{inputs.format}}（interview = 访谈，solo = 独播）
- 嘉宾：{{inputs.guest}}
- 目标时长：{{inputs.minutes}} 分钟
- 听众：{{inputs.audience}}（空的就按资料里写的）
- 赞助：{{inputs.sponsor}}（空的就是这一期没有广告）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Plan this podcast episode from the notes. Reply with JSON only.

- Show: {{inputs.show}}
- Host: {{inputs.host}}
- Topic: {{inputs.topic}}
- Format: {{inputs.format}} (interview or solo)
- Guest: {{inputs.guest}}
- Target length: {{inputs.minutes}} minutes
- Listeners: {{inputs.audience}} (when empty, use the notes)
- Sponsor: {{inputs.sponsor}} (when empty, this episode has no ad)
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

```json
{
  "angle": "…",
  "titles": ["…", "…", "…"],
  "segments": [{ "kind": "intro", "name": "…", "minutes": 1, "goal": "…" }],
  "questions": [{ "segment": "…", "question": "…", "followUp": "…" }],
  "facts": [{ "claim": "…", "source": "…" }]
}
```

规则 / Rules:

- `angle`：一句话，说清这一期只讲哪一件事、给谁听、听完能带走什么。整期都围绕这一件事。
- `titles`：三个候选标题。先放最具体、最吸引人的信息，比如嘉宾的名字或一个具体的做法。一句话，不加副标题。不写节目名、期数（第 3 期、EP 3、#3）或日期，播客应用会另外显示这些。
- `segments`：按播出顺序。`kind` 只能是 `cold-open`（可选，最多 1 分钟，用节目里一句最有力的话开场）、`intro`（节目名、主持人、嘉宾、这一期讲什么）、`talk`（正文，每段回答一个小问题）、`ad`、`outro`（一句总结、请听众做一件事、道别）。有赞助时放一个 `ad`，约 1 分钟，放在中段；没有赞助就不要 `ad`。所有 `minutes` 加起来正好等于目标时长：交之前把它们逐个加一遍。`talk` 段有 3 到 L 个，L 是目标分钟数除以 10 去掉小数再加 1（20 分钟 L = 3，30 分钟 L = 4，45 分钟 L = 5，60 分钟 L = 7）：发布时一个 `talk` 段就是一个章节，Apple 建议每小时不超过 6 个章节。
- `questions`：访谈时每个 `talk` 段 2 到 4 个问题；独播时写主持人要替听众回答的问题。`segment` 照抄那一段的 `name`。问题用开放式的问法（怎么、为什么、讲讲那一次……），不要能用“是”或“不是”答完的问题。一个问题只问一件事，只有一个问号。每个问题配一个往深处追的 `followUp`。
- `facts`：节目里要说的事实和数字，只从资料里拿，`source` 照资料写。资料里写在“待核实”下面的说法不要放进来。不要写资料里没有的数字。

- `angle`: one sentence on the one thing this episode is about, who it is for, and what they take away. The whole episode serves it.
- `titles`: three candidates. Lead with the most specific, most compelling detail, such as the guest's name or a concrete practice. One sentence, no subtitle. No show name, no episode number (Episode 3, EP 3, #3) and no date; podcast apps show those separately.
- `segments`: in airing order. `kind` is one of `cold-open` (optional, at most 1 minute, open on the strongest line from the episode), `intro` (show, host, guest, what this episode is about), `talk` (the body; each one answers one smaller question), `ad`, and `outro` (a one-line takeaway, one thing to ask listeners to do, goodbye). With a sponsor, add one `ad` of about 1 minute in the middle; with no sponsor, no `ad`. The `minutes` add up to exactly the target length: add them one by one before you reply. Have 3 to L `talk` segments, where L is the target minutes divided by 10, with the decimals dropped, plus 1 (20 minutes: L = 3; 30: L = 4; 45: L = 5; 60: L = 7): each `talk` segment becomes one chapter when the episode is published, and Apple suggests no more than six chapters an hour.
- `questions`: for an interview, 2 to 4 per `talk` segment; for a solo show, the questions the host answers for listeners. `segment` copies that segment's `name`. Ask open questions (how, why, tell me about the time…), never one that a yes or a no can finish. One thing per question, with a single question mark. Each has a `followUp` that digs deeper.
- `facts`: the facts and numbers the episode will state, taken only from the notes, with `source` as the notes give it. Leave out anything the notes list as unverified. No number that is not in the notes.

语言：`angle`、`titles`、每段的 `name` 和 `goal`、`questions` 和 `facts` 全部用输出语言写（zh = 中文，en = English），即使资料或上面的说明是另一种语言。`kind` 保持英文代码。
Language: write `angle`, `titles`, every segment's `name` and `goal`, the `questions` and the `facts` in the output language (zh = Chinese, en = English), even when the notes or the instructions above are in another language. Keep `kind` as the English code.
