对照职位描述和现在的简历，输出一个 JSON 对象，不要解释。

- 目标职位：{{inputs.role}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`matches`、`gaps`、`keywords` 里的文字用这个语言。

Compare the job description with the current resume and reply with one JSON object, no commentary.

- Target role: {{inputs.role}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write the strings in `matches`, `gaps` and `keywords` in that language.

形状 / Shape:

```json
{
  "matches": ["简历里已经能对上的要求"],
  "gaps": ["职位要、但简历里看不到的"],
  "keywords": ["简历正文里应该出现的原词，2 到 6 个"]
}
```

规则 / Rules:

- 只根据给你的两份材料，不要编造候选人没写过的经历。
- `keywords` 用职位描述里的原词，并且原简历里要能找到依据（同义词可以，但不要加入没提过的技术）。职位描述同一个词有中英两种写法时，取输出语言那一种；只有另一种语言时，译成输出语言，简历会照这个译法写。
- Only use the two documents you were given. Do not invent experience the candidate did not write.
- `keywords` are words from the job description that the original resume can support. Do not add technologies that were never mentioned. When the job description gives a term in both Chinese and English, take the one in the output language; when it has only the other language, translate the term, and the resume will use that translation.
