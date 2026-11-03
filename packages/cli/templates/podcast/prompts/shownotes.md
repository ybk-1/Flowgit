根据文字稿、策划和资料写这一期的节目简介（发布时贴进单集描述）。只输出简介，不要解释。

- 节目：{{inputs.show}}
- 主持人：{{inputs.host}}
- 形式：{{inputs.format}}（interview = 访谈，solo = 独播）
- 嘉宾：{{inputs.guest}}
- 赞助：{{inputs.sponsor}}（空的就是没有广告）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）

Write this episode's show notes (what goes in the episode description) from the transcript, the plan and the notes. Reply with the show notes only.

- Show: {{inputs.show}}
- Host: {{inputs.host}}
- Format: {{inputs.format}} (interview or solo)
- Guest: {{inputs.guest}}
- Sponsor: {{inputs.sponsor}} (when empty, there is no ad)
- Output language: {{inputs.language}} (zh = Chinese, en = English)

形状 / Shape:

- `# 标题`：从策划的候选标题里挑最贴合实际内容的一个，或按文字稿里真正聊到的改一改。先放最具体的信息（嘉宾名或一个具体的做法）。一句话。不写节目名、期数或日期。
- 第一段：一两句，说这一期聊什么、给谁听、听完能带走什么。不写节目名，应用会另外显示。
- 可以再写一段：两三个文字稿里真的聊到的具体点。
- `## 嘉宾`（访谈才有）：一句介绍，只用资料里的。
- `## 时间线`：3 到 N 行章节（N 见下面“章节”），每行 `mm:ss 章节名`，例如 `06:40 会员年卡怎么定`。
- `## 提到的内容`：节目里提到的东西，只列资料和文字稿里有的。不要编链接。
- `## 赞助`（有赞助才有）：这一行以“广告：”开头，写赞助商、能说的卖点和优惠。
- `## 制作`：主持、嘉宾。
- `## 文字稿`：一句话说明完整文字稿和音频一起发布。
- `# Title`: the candidate from the plan that best fits what was actually said, or one adjusted to the transcript. Lead with the most specific detail (the guest's name or a concrete practice). One sentence. No show name, episode number or date.
- First paragraph: one or two sentences on what the episode covers, who it is for, and what they take away. No show name; apps show it separately.
- Optionally a second paragraph with two or three specifics the transcript really covers.
- `## Guest` (interviews only): one line, from the notes only.
- `## Chapters`: 3 to N chapter lines (N is explained under “Chapters” below), one `mm:ss Chapter Title` per line, for example `06:40 Pricing the Annual Pass`.
- `## Mentioned`: things the episode mentions, only from the notes and the transcript. Do not invent links.
- `## Sponsor` (only with a sponsor): a line that starts with `Ad:` and gives the sponsor, its approved claims and the offer.
- `## Credits`: host and guest.
- `## Transcript`: one line saying the full transcript is published with the audio.

章节 / Chapters:

`## 时间线` 跟着策划里的访谈段（`kind` 是 `talk`）走：
1. 一个访谈段最多一个章节；录音里没聊到的访谈段跳过。冷开场、介绍、广告和结尾不单独成章。
2. 第一个章节是 `00:00`，开场算在里面。
3. 其余每个章节的时间，是文字稿里这个访谈段的话题开始的那一段的 `[m:ss]`，写成两位数（`[6:40]` 写成 `06:40`）。
4. 章节名按这一章在文字稿里实际聊的写。
5. 文字稿开头有一行“章节上限：N 个”。章节多于 N 个时，把相邻、话题相近的合成一个，最后不超过 N 行。

`## Chapters` follows the talk segments in the plan (`kind` is `talk`):
1. At most one chapter per talk segment; skip a segment the recording never got to. The cold open, the introduction, the ad and the outro are not chapters of their own.
2. The first chapter is `00:00` and includes the opening.
3. Every other chapter's time is the `[m:ss]` of the transcript block where that segment's topic starts, in two-digit form (`[6:40]` becomes `06:40`).
4. Name each chapter after what the transcript actually covers in it.
5. The transcript header has a line “Chapter limit: N”. With more than N chapters, merge neighbouring ones on related topics, so there are no more than N lines.

- 按时间先后排，每章至少 2 分钟。章节名说清这一章大部分时间在聊什么，最后一章也一样。
- 章节名要短：中文不超过 12 个字；英文 2 到 4 个词，每个实词首字母大写（`Pricing the Annual Pass` 是 4 个词；`The Revenue Behind the Card` 是 5 个，太长）。各章节名不要重复用同一个词。不要编号，不要表情符号。
- 广告不单独做一个章节。
- In time order, each at least 2 minutes long. A chapter title says what most of that chapter is about, the last one included.
- Short titles: at most 12 characters in Chinese; 2 to 4 words in English, in title case (`Pricing the Annual Pass` is 4 words; `The Revenue Behind the Card` is 5, too long). Don't repeat a word across chapter titles. No numbering, no emoji.
- The ad is not a chapter.

事实 / Facts:

- 只写文字稿或资料里有的事实和数字。资料里“待核实”下面的说法，就算嘉宾在节目里说了，也不要写进简介。
- 来自嘉宾、没有审计的数字，写明是嘉宾提供的。
- 不用“最”“第一”或 best、number one、#1 这类说法。
- 不要留下 `[...]`、TODO 或待补充。
- Only facts and numbers that are in the transcript or the notes. Leave out anything the notes list as unverified, even if the guest said it on air.
- Unaudited numbers from the guest are credited to the guest.
- No “best”, “number one”, “#1” or similar.
- Leave no `[...]`, TODO or placeholder.

写完再查一遍：`## 时间线` 下面的行数不超过 N（超过了就把相邻、话题相近的章节合并，留前一个的时间）；每个英文章节名不超过 4 个词。
Before you reply, check: no more than N lines under `## Chapters` (if there are more, merge neighbouring chapters on related topics and keep the earlier time), and no English chapter title over 4 words.

语言：标题、正文、小标题、章节名和赞助那一行全部用输出语言写（zh = 中文，en = English），即使文字稿、资料或上面的例子是另一种语言。中文小标题用上面的中文写法，英文用上面的英文写法。
Language: write the title, the text, the headings, the chapter titles and the sponsor line in the output language (zh = Chinese, en = English), even when the transcript, the notes or the examples above are in another language. Use the Chinese headings above for Chinese and the English ones for English.
