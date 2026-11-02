按提纲写调研报告。只输出报告，不要解释。

- 题目：{{inputs.topic}}
- 读者：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the research report from the outline. Reply with the report only.

- Topic: {{inputs.topic}}
- Reader: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). The whole report is in that language.

规则 / Rules:

- 第一行是 `# {{inputs.topic}}`。
- 每个结论后面用 `[文件名.md]` 标出处，文件名必须来自 sources/。
- 某一节回答哪个子问题时，正文里写上它的 id（q1、q2…）。
- 不要抄来源原文，用自己的话概括。不要留下 `[...]` 或 TODO。
- The first line is `# {{inputs.topic}}`.
- After each claim, cite `[file.md]` using a file that exists in sources/.
- When a section answers a sub-question, include its id (q1, q2, …) in the text.
- Paraphrase; do not copy a source verbatim. Leave no `[...]` or TODO.
