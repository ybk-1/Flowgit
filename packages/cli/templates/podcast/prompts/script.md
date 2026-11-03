根据策划和资料写这一期的台本。只输出台本，不要解释。

- 节目：{{inputs.show}}
- 主持人：{{inputs.host}}
- 形式：{{inputs.format}}（interview = 访谈，solo = 独播）
- 嘉宾：{{inputs.guest}}
- 目标时长：{{inputs.minutes}} 分钟
- 赞助：{{inputs.sponsor}}（空的就是没有广告）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write this episode's script from the plan and the notes. Reply with the script only.

- Show: {{inputs.show}}
- Host: {{inputs.host}}
- Format: {{inputs.format}} (interview or solo)
- Guest: {{inputs.guest}}
- Target length: {{inputs.minutes}} minutes
- Sponsor: {{inputs.sponsor}} (when empty, there is no ad)
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

- 第一行 `# ` 加 `titles` 的第一个。下面三行：节目和主持人、嘉宾（独播写“独播”）、时长。
- 然后按 `segments` 的顺序，每段一个 `## [开始时间] 段名（N 分钟）`。开始时间是前面各段分钟数之和，写成 `m:ss`，第一段是 `[0:00]`。
- `cold-open`、`intro`、`ad`、`outro` 写逐字稿：主持人要说的每一句话。
- `talk` 段写：一句串场的话；`问题：` 下面列这一段的问题，每个问题下一行写 `追问：`；`事实卡：` 下面列这一段会提到的事实，每条后面括号写出处。独播的 `talk` 段写成要讲的几句话，同样带事实卡。
- First line: `# ` and the first of `titles`. Then three lines: show and host, guest (or "Solo"), length.
- Then one `## [start] Segment name (N min)` per segment, in the order of `segments`. The start is the sum of the earlier segments' minutes as `m:ss`; the first is `[0:00]`.
- `cold-open`, `intro`, `ad` and `outro` are word for word: every sentence the host says.
- A `talk` segment has one transition line, then `Questions:` with this segment's questions, each followed by a `Follow-up:` line, then `Fact cards:` with the facts this segment will use, each with its source in brackets. In a solo show, a `talk` segment is the few things the host will say, with fact cards too.

写给耳朵听 / Written for the ear:

- 用说话的方式写：短句，一句只说一个意思。英文用 don't、it's 这样的缩写。
- 不要在开头一口气塞进所有信息。一段里最多说两个数字。
- 嘉宾或地名难念时，第一次出现在后面括号标一下怎么念。
- Write the way you talk: short sentences, one idea each. Use contractions in English.
- Do not pack every fact into the opening. At most two numbers in one passage.
- When a name is hard to say, add how to say it in brackets the first time.

广告 / The ad（只在有赞助时 / only with a sponsor）:

- 第一句就说明这是广告。中文要把“广告”两个字说出来，例如“插一段广告，本期节目由……赞助。”英文用 “A quick ad: this episode is sponsored by …”。
- 只说资料里“能说的卖点”和优惠。资料里“不能说”的话一句也不要。不用“最”“第一”“顶级”或 best、number one、#1 这类说法。
- 主持人的亲身体验只能写资料里写到的那一条，不要扩展。
- 约 60 秒的话。
- The first sentence says it is an ad. In Chinese, say the word 广告 out loud, for example “插一段广告，本期节目由……赞助。” In English, use “A quick ad: this episode is sponsored by …”.
- Say only the approved claims and the offer from the notes, never the banned ones, and no “best”, “number one”, “#1” or similar.
- The host's own experience is only what the notes say, no more.
- About 60 seconds of speech.

其他 / Everything else:

- 事实和数字只用资料里的。资料里“待核实”下面的说法不能当事实说；嘉宾自己提起时，台本里提醒主持人追问出处或说明“这是嘉宾的印象”。
- 结尾：一句总结，请听众做一件事（只选一件，例如转给一个朋友），谢谢嘉宾，道别。
- 不要留下 `[...]`、TODO 或待补充。
- Facts and numbers come only from the notes. Anything under Unverified is never stated as fact; if the guest raises it, the script tells the host to ask where it comes from or to say it is the guest's impression.
- The close: a one-line takeaway, one thing for listeners to do (only one, such as sharing it with a friend), thanks to the guest, goodbye.
- Leave no `[...]`, TODO or placeholder.

语言：标题、每段的标题、逐字稿、问题、追问和事实卡全部用输出语言写（zh = 中文，en = English），即使资料、策划或上面的例子是另一种语言。
Language: write the title, every segment heading, the spoken lines, questions, follow-ups and fact cards in the output language (zh = Chinese, en = English), even when the notes, the plan or the examples above are in another language.
