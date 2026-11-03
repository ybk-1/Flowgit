根据匹配分析，改写一份简历。只输出简历本身，不要解释。

- 目标职位：{{inputs.role}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Rewrite the resume from the match analysis. Reply with the resume only, no commentary.

- Target role: {{inputs.role}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). The whole resume is in that language.

规则 / Rules:

- 不能编造经历、公司、数字或头衔。每句都能在原来的 `materials/resume.md` 里找到依据。
- 把 `keywords` 里的每个词原样、自然地写进正文（检查按原词找），不要堆成关键词列表。
- 第一行是 `# 姓名`。不要留下 `[...]`、`TODO`、`待补充`。
- Do not invent experience, employers, numbers or titles. Every sentence must trace back to `materials/resume.md`.
- Work every word in `keywords` into the prose exactly as written (the check looks for the exact words). Do not dump them as a keyword list.
- The first line is `# Name`. Leave no `[...]`, `TODO` or `待补充`.
