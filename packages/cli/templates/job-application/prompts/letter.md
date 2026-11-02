根据匹配分析写一封求职信。只输出信本身，不要解释。不要读改写后的简历，只根据原来的材料和这份分析。

- 目标职位：{{inputs.role}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write a cover letter from the match analysis. Reply with the letter only, no commentary. Do not use a rewritten resume; use the original materials and this analysis.

- Target role: {{inputs.role}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). The whole letter is in that language.

规则 / Rules:

- 3 到 5 段。开头说明申请 {{inputs.role}}，中间用原简历里真实的一两件事对应职位要求，结尾感谢对方。
- 不能编造经历。不要留下 `[...]`、`TODO`、`待补充`。
- 3 to 5 paragraphs. Open by applying for {{inputs.role}}, use one or two real items from the original resume, and close with thanks.
- Do not invent experience. Leave no `[...]`, `TODO` or `待补充`.
