根据整理后的记录写会议纪要。只输出纪要，不要解释。

- 会议：{{inputs.meeting}}
- 日期：{{inputs.date}}
- 出席：{{inputs.attendees}}
- 体例：{{inputs.style}}（brief = 简要，formal = 正式）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the minutes from the cleaned transcript. Reply with the minutes only.

- Meeting: {{inputs.meeting}}
- Date: {{inputs.date}}
- Attendees: {{inputs.attendees}}
- Style: {{inputs.style}} (brief or formal)
- Output language: {{inputs.language}} (zh = Chinese, en = English). The whole document is in that language.

记什么 / What to record（Robert's Rules：纪要记做成的事，不记说过的每一句；《党政机关公文处理工作条例》的纪要记载主要情况和议定事项）:

- 按议题组织。每个议题先写要点（会上说了什么事实），再写决定。不要把记录改写成逐字稿，也不要写记录人的评价。
- 决定用中性说法。中文用「决定：」，英文用 `Decision:`. 正式体改成「会议决定：」和 `The meeting decided:`. 没说定的、还在商量的，写成要点，不要写成决定。
- 每条决定的末尾紧跟整理稿里那段的起始时间，方括号，例如 `[12:30]`。时间必须是 clean.md 里某一段开头的 `[m:ss]` 或 `[h:mm:ss]`，不要编一个记录里没有的时间，也不要改用别的格式。
- 数字、价格、日期、人名只使用记录或上面的会议信息里出现过的。出席没填时，用记录里的发言人，不要编没发言的人。
- Group by topic. A point is a fact that was said; a decision is something the meeting settled. Do not write a transcript, and do not add the note-taker's opinion.
- Decisions are neutral. In brief style start them with `决定：` or `Decision:`. In formal style use `会议决定：` or `The meeting decided:`. Anything not settled stays a point.
- End every decision with the block start from clean.md, in brackets, for example `[12:30]`. Use only a timestamp that opens a block. Do not invent one and do not change the form.
- Numbers, prices, dates and names come only from the transcript or the meeting fields above. If attendees is empty, use the speakers. Do not add a person who never speaks.

体例 / Shape:

- `brief`：标题是会议名。下面三行：会议、日期、出席。然后 `## 议题` / `## Topics`，每个议题一个 `###`，下面是 `- 要点：` / `- Point:` 和 `- 决定：` / `- Decision:`。
- `formal`：先一段概况（会议名、日期、出席；记录里能看出谁在主持就写上）。然后每个议题一段，用「会议认为」「会议决定」或 `The meeting noted` / `The meeting decided`。决定句的末尾同样是 `[12:30]`。
- 两种体例都不要写待办清单，待办是下一步。不要留下 `[...]` 或 TODO。
- `brief`: the title is the meeting name, then three lines for meeting, date and attendees, then `## 议题` or `## Topics`, one `###` per topic, with `- 要点：` / `- Point:` and `- 决定：` / `- Decision:`.
- `formal`: an opening paragraph (name, date, attendees, and the chair if the transcript shows one), then one paragraph block per topic using `会议认为` / `会议决定` or `The meeting noted` / `The meeting decided`. Decision sentences still end with `[12:30]`.
- Neither style lists the action items; those are the next stage. Leave no `[...]` or TODO.

简要示例（正式体把「决定：」换成「会议决定：」并写成段落）/ Brief shape (formal uses `会议决定：` or `The meeting decided:` inside paragraphs):

```
# 轻杯 Mini 产品周会

- 会议：轻杯 Mini 产品周会
- 日期：2026-03-04
- 出席：林夏、周衡、沈予

## 议题

### 材料和重量
- 要点：试用里有人觉得约 420 克偏沉。
- 决定：这周不改材料，这批仍按约 420 克销售。[7:30]
```
