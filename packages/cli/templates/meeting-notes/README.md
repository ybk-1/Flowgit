# 会议纪要 / Meeting notes

把一场会的录音转写或字幕整理成纪要、待办和一封会后邮件。纪要记做成的事和议定事项，不把讨论逐句搬进去；每条决定和每条待办都能回到整理稿里的一个起始时间，例如 `[12:30]`。

Turn a transcript or subtitle file into minutes, action items and a follow-up note. The minutes record what was settled, not a line-by-line replay, and every decision and action points back to a block start in the cleaned transcript, such as `[12:30]`.

示例是虚构的南枝日用、轻杯 Mini 产品周会（2026-03-04，约 30 分钟）。人和公司都是编的。

The sample is a fictional 30-minute product weekly at Nanzhi Household for Lightcup Mini (2026-03-04). The people and the company are invented.

## 阶段 / Stages

1. **转录 transcript**（你）：`transcript/` 里放 `.txt`、`.srt` 或 `.vtt`。模板自带 `weekly-zh.srt` 和 `weekly-en.srt`。文件名不带 `zh` 或 `en` 时，整理阶段只用你的文件；否则按 `language` 选用带对应标记的那一份。
2. **整理 clean**（脚本）：`clean.md`。去掉字里的时间码，把同一人连续的发言并成一段，每段保留第一句的起始时间，写成 `[12:30]`（超过一小时写成 `[1:02:03]`）。
3. **纪要 summary**（模型）：`minutes.md`。按议题写要点和决定。`style=brief` 用短列表；`style=formal` 写成「会议认为 / 会议决定」或 `The meeting noted` / `The meeting decided`。每条决定末尾是整理稿里的起始时间。
4. **待办 actions**（模型）：`actions.json`，数组，每条只有 `owner`、`task`、`due`、`source`。负责人是记录里的一个人；`due` 是 `YYYY-MM-DD`，不早于会议日期；`source` 是整理稿里的起始时间，不带方括号。
5. **检查 check**（脚本）：`check-report.md`。核对负责人是否出现在记录里、日期是否有效且不早于会议、出处时间是否存在、有没有重复，以及纪要里的 `[12:30]` 是否对得上。内容问题只提醒，不拦住；`actions.json` 不是这个形状才停下。
6. **跟进邮件 email**（模型）：`follow-up.md`。短摘要加待办，给人转发。不贴转录。

1. **transcript** (you): `.txt`, `.srt` or `.vtt` in `transcript/`. The template includes `weekly-zh.srt` and `weekly-en.srt`. A file whose name has no `zh` or `en` tag is the one that gets cleaned; otherwise the file tagged for `language` is used.
2. **clean** (script): `clean.md`. Timecodes are stripped from the words, consecutive lines from the same speaker merge into one block, and each block keeps its first start time as `[12:30]` (`[1:02:03]` past an hour).
3. **summary** (model): `minutes.md`, topics with points and decisions. `style=brief` is a short list; `style=formal` uses `会议认为` / `会议决定` or `The meeting noted` / `The meeting decided`. Every decision ends with a block start from the cleaned transcript.
4. **actions** (model): `actions.json`, an array of objects with only `owner`, `task`, `due` and `source`. The owner is one person who appears in the transcript; `due` is `YYYY-MM-DD` and not before the meeting; `source` is a block start without brackets.
5. **check** (script): `check-report.md`. It checks that each owner appears in the transcript, each due date is valid and not before the meeting, each source time exists, nothing is duplicated, and each `[12:30]` in the minutes matches a block. Content issues only warn. A wrongly shaped `actions.json` stops the stage.
6. **email** (model): `follow-up.md`, a short note of decisions and actions that someone can forward. The transcript stays out.

`demo-replies/` 里的固定回复是简要体（`style=brief`）。正式体请用真实模型。

The canned replies in `demo-replies/` are the brief style. Formal minutes need a real model.

## 怎么跑 / How to run

```bash
flowgit init ~/my-meeting -t meeting-notes
cd ~/my-meeting
# 换成你的记录，或先用模板里的示例 / replace the transcript, or try the sample first
flowgit inputs set "meeting=轻杯 Mini 产品周会"
flowgit inputs set date=2026-03-04
flowgit inputs set "attendees=林夏、周衡、沈予"
flowgit inputs set style=brief
flowgit inputs set language=zh
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一份：

Without an API key, the canned replies run the flow. Chinese and English each have a directory:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
# 英文示例 / English sample:
# FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit inputs set language=en "meeting=Lightcup Mini product weekly" "attendees=Lin Xia, Zhou Heng, Shen Yu"
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
```

## 隐私 / Privacy

转录里经常有姓名、职务和发言，也可能有健康、财务或其他敏感内容。这些都是可以识别到人的信息。分享这个流程之前，先自己通读 `transcript/`、`clean.md`、`minutes.md` 和 `follow-up.md`，再运行 `flowgit share`。`flowgit share` 会挡住密钥，并提醒邮箱和本机路径；它不会替你判断这段话该不该给别人看。不要把整份转录贴进邮件或公开出去。录音或转写之前，告诉参会的人在录、用来做什么。

A transcript often names people and records what they said, and it may also hold health, financial or other sensitive details. That is information that can identify a person. Before you share the flow, read `transcript/`, `clean.md`, `minutes.md` and `follow-up.md` yourself, then run `flowgit share`. `flowgit share` blocks secrets and points out emails and local paths; it does not decide whether a sentence is safe to hand to someone else. Do not paste the transcript into the email or publish it. Before recording or transcribing, tell the people in the room that you are recording and why.

## 规则 / Rules

下面每条都对应文末的一条依据。

Each rule below maps to an entry under Sources.

1. 纪要记做成的事和议定事项，按议题写要点和决定，不把讨论逐句搬进去。依据：Robert's Rules；密歇根州立大学学术治理；《党政机关公文处理工作条例》第八条、第十九条。
2. 简要体和正式体都写会议名、日期和出席。正式体用「会议认为 / 会议决定」或 `The meeting noted` / `The meeting decided`，并在记录能看出主持人时写上。依据：密歇根州立大学学术治理（日期、出席、动议结果）；条例第八条的「主要情况」。
3. 决定用中性说法，不写记录人的评价，也不把还没说定的话写成决定。依据：密歇根州立大学学术治理（中性语言、不反映记录人意见、动议保留原措辞）；Robert's Rules。
4. 每条决定末尾标整理稿的起始时间 `[12:30]`，而且这个时间必须真的是某一段的开头。依据：条例第二十条（人名、时间、数字要准确）；密歇根州立大学学术治理（记录要准确）。方括号是这个模板用来核对的写法。
5. 每条待办只有一个负责人，而且这个人必须出现在记录里。不写「团队」或两个名字。依据：PMI 的 RACI（Accountable 只有一个）；HBR 的 DRI；Doran 的 Assignable；济源市常务会议议定事项督查办法第三条（第一责任人）、第四条（纪要写明责任）、第五条（多单位由主办单位牵头）。
6. 待办要具体，用动词写出记录里说的那一件事，不另加承诺。依据：Doran 的 Specific。
7. `due` 必须是真实的 `YYYY-MM-DD`，而且不早于会议日期。没有说日期就不要编。依据：Doran 的 Time-related；济源办法第四条的完成时限。
8. `source` 必须对得上整理稿里的起始时间。依据：同第 4 条。
9. 同一人、同一件事只留一条。依据：PMI 的 RACI（两个人都算 Accountable，接下来就会吵）。
10. 跟进邮件只写已经定下的事和待办，方便转发，不贴转录，不写电话、邮箱或私事。依据：HBR《Make Your Meeting More Effective by Following Up》；《个人信息保护法》第四条、第十条、第二十三条、第二十五条；密歇根州立大学学术治理（录音前告知并取得同意）；条例第五条（安全保密）。
11. 检查只提醒，好让人自己通读。只有 `actions.json` 的形状不对才停下。依据：条例第二十条和密歇根州立大学学术治理都要求人来核对准确性，脚本不能代替通读。

1. Minutes record what was settled, by topic, not a transcript of the discussion. Sources: Robert's Rules; Michigan State University academic governance; the official-document regulation, arts. 8 and 19.
2. Both styles name the meeting, the date and the attendees. Formal style uses `The meeting noted` / `The meeting decided` (or the Chinese pair) and names the chair when the transcript shows one. Sources: Michigan State (date, attendees, outcomes); art. 8 on the main facts of the meeting.
3. Decisions stay neutral, carry no note-taker's opinion, and do not promote an open discussion into a decision. Sources: Michigan State (neutral language, no secretary's opinion, keep the wording of the motion); Robert's Rules.
4. Every decision ends with a block start `[12:30]` that really opens a block. Sources: art. 20 (names, times and figures must be accurate); Michigan State (the record has to be accurate). The brackets are how this template keeps that checkable.
5. Each action has one owner, and that person appears in the transcript. Not "the team" and not two names. Sources: PMI RACI (one Accountable); the HBR directly responsible individual; Doran's Assignable; the Jiyuan follow-up rules, arts. 3 (one primary owner), 4 (the minutes name the owner) and 5 (one lead when several units are involved).
6. The task is specific: the one action that was named, with no extra promise. Source: Doran's Specific.
7. `due` is a real `YYYY-MM-DD` and not before the meeting. If no date was named, do not invent one. Sources: Doran's Time-related; the Jiyuan rules, art. 4, on a completion date.
8. `source` matches a block start. Source: rule 4.
9. The same owner and the same task appear once. Source: PMI RACI (two Accountable names are the next argument).
10. The follow-up is a forwardable note of decisions and actions. It does not include the transcript, a phone number, an email address or a private detail. Sources: HBR, "Make Your Meeting More Effective by Following Up"; China's Personal Information Protection Law, arts. 4, 10, 23 and 25; Michigan State (tell attendees and get consent before recording); art. 5 (handle documents securely).
11. The check only warns, so a person still reads the minutes. Only a wrongly shaped `actions.json` stops the stage. Sources: art. 20 and Michigan State both leave accuracy with a person; the script does not replace that reading.

## 依据 / Sources

- Robert's Rules of Order 官方问答：纪要要记会上做成的事，把讨论逐句写进去并不使纪要更完整，那样做并不恰当。引自 RONR（第 12 版）48:2。[官方 FAQ](https://robertsrules.com/frequently-asked-questions/)。/ Official Robert's Rules FAQ: minutes record what was done at a meeting, not what was said. Citing RONR (12th ed.) 48:2.
- 密歇根州立大学学术治理《Writing Minutes》：纪要记做成的事而不是说过的话；写上日期、时间和出席；动议保留通过或否决时的措辞；语言客观，不反映记录人的意见；为了记准纪要而录音时，建议先取得出席者同意并说明用途。[Writing Minutes](https://acadgov.msu.edu/about/writing-minutes)。/ Michigan State University Academic Governance, "Writing Minutes": what was done rather than what was said; date, time and attendees; the wording of the motion as adopted or lost; neutral language with no secretary's opinion; if you record to take accurate minutes, get consent and say why.
- 《党政机关公文处理工作条例》（中办、国办，2012 年 7 月 1 日起施行）第五条（安全保密）、第八条第（十五）项（纪要用于记载会议主要情况和议定事项）、第十九条（内容简洁、表述准确）、第二十条（人名、时间、数字要准确）。[国务院公报](https://www.gov.cn/gongbao/content/2013/content_2344541.htm)。/ Regulation on official documents of Party and government organs (in force 1 July 2012): art. 5, art. 8 item 15, arts. 19 and 20.
- 《济源市人民政府常务会议议定事项督查办法》（2018）：议定事项要有第一责任人；纪要写明责任和完成时限；多个单位承办时由主办单位牵头。[济源市人民政府](https://www.jiyuan.gov.cn/shizf/zfgb/201802/szfbgswj/t817857.html)。/ Jiyuan executive-meeting follow-up rules (2018): one primary owner, the minutes name who does it and by when, and one lead when several units share the work.
- Project Management Institute，RACI：每项工作只有一个 Accountable，负责结果的人写成两个，接下来就会吵；一个都没有，事情就会掉地上。[Stakeholder Management and RACI](https://www.pmi.org/blog/stakeholder-management-raci)。/ PMI on RACI: exactly one Accountable owner per task.
- George T. Doran, "There's a S.M.A.R.T. Way to Write Management's Goals and Objectives", *Management Review*, November 1981：目标要 Specific（具体）、Assignable（写明谁来做）、Time-related（写明何时做成）。[原文 PDF](https://www.decisionskills.com/uploads/5/1/6/0/5160560/doran_1981_s.m.a.r.t-way-management-review.pdf)。/ Doran, Management Review, November 1981: Specific, Assignable, Time-related.
- Paul Axtell, "Two Things to Do After Every Meeting", *Harvard Business Review*, 2015-11-26：议程上的每件事指定一个直接负责人（DRI）。[HBR](https://hbr.org/2015/11/two-things-to-do-after-every-meeting)。/ One directly responsible individual for each item.
- "Make Your Meeting More Effective by Following Up", *Harvard Business Review*, 2017-01-04：会后写一封短摘要，把讨论结果和清楚的待办写下来，方便转给没参会的人，并记下完成日期。[HBR](https://hbr.org/tip/2017/01/make-your-meeting-more-effective-by-following-up)。/ A short follow-up with what was settled, clear actions and due dates, written so it can be forwarded.
- 《中华人民共和国个人信息保护法》（2021 年 11 月 1 日起施行）第四条（可识别自然人的信息；处理包括提供和公开）、第十条（不得非法提供或公开）、第二十三条（向别人提供要告知并取得单独同意）、第二十五条（公开需单独同意）。[中国人大网](http://www.npc.gov.cn/c2/c30834/202108/t20210820_313088.html)。/ Personal Information Protection Law of the PRC (in force 1 November 2021), arts. 4, 10, 23 and 25.
