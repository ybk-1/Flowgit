写一封会后跟进邮件。只输出邮件正文，不要解释。

- 会议：{{inputs.meeting}}
- 日期：{{inputs.date}}
- 出席：{{inputs.attendees}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the follow-up note. Reply with the note only.

- Meeting: {{inputs.meeting}}
- Date: {{inputs.date}}
- Attendees: {{inputs.attendees}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). The whole note is in that language.

这封邮件要让没参会的人也能往下转发（先写短摘要和清楚的待办）。 / Someone who missed the meeting should be able to forward it (a short summary, then the actions).

- 标题用会议名。开头点名收件人：填了出席就用出席，否则用纪要里的发言人。
- 用几句话写下已经定下的事，每件都可以带上纪要里的 `[12:30]`。不要新加决定，不要新加待办，不要改负责人和日期。
- 然后按 actions.json 列出待办：谁、做什么、哪一天。`owner` 或 `due` 是空的，照样列出，写「负责人待定」或「日期待定」，再用一句话请大家确认。
- 检查报告里如果有「要看一下」的条目，用一句话请收件人核对，不要把报告原文贴进来。
- 不要粘贴转录，不要逐段复述发言，不要写电话、邮箱或别人的私事。示例里的人和公司都是虚构的，换成你的会议后也一样：转录里的内容先当私人信息。
- 不要留下 `[...]` 或 TODO。
- Title it with the meeting name. Address the recipients: the attendees field, or the speakers if that field is empty.
- Summarize only decisions already in the minutes. You may keep a `[12:30]` cite. Do not add a decision, an action, or a different owner or date.
- Then list actions.json: who, what, and the date. If `owner` or `due` is empty, still list it as "owner TBD" or "date TBD" and ask the readers to confirm it in one sentence.
- If the check report says something needs a look, ask the reader to check it in one sentence. Do not paste the report.
- Do not paste the transcript, retell the discussion line by line, or add a phone number, an email address, or a private detail. Treat the transcript as private.
- Leave no `[...]` or TODO.
