根据图表汇总写分析。只输出分析正文，不要解释。

- 要回答的问题：{{inputs.question}}
- 读者：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the analysis from the chart aggregates. Reply with the analysis only.

- Question: {{inputs.question}}
- Audience: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). The whole analysis is in that language.

数字只能从 `profile.json` 和 `aggregates.json` 里原样抄，包括小数点后的样子。不要心算差、比、百分比或单价，不要加千分位，不要把日期拆成“1 月”这种带新数字的写法。某个比较需要的数字如果两份 JSON 里都没有，就用“更高”“最高”这类词说明方向，不要编一个数。

Copy numbers from `profile.json` and `aggregates.json` exactly, including the decimals. Do not calculate a difference, ratio, percent or unit price, do not add thousands separators, and do not split a date into a new figure such as a month number. If the number you want is in neither file, say "higher" or "the largest" and do not invent a figure.

结构 / Structure:

1. 第一段就是对问题的回答：一句完整的话，给出判断或建议，不要用标题，也不要先铺背景。
2. 然后用 `##` 分三节，顺序固定：发生了什么；可能的原因；建议。
3. 发生了什么：只描述图上已经汇总的结果。每一条都写上对应的 `charts/<id>.svg`，`id` 来自 `aggregates.json`。每张图至少引用一次。
4. 可能的原因：写成猜测，并写明它不是检验过的原因。不要把猜测说成测量结果。这份流程没有做预测模型，不要写“下季度会达到多少”。
5. 建议：对着读者写下一步，谁该对哪一类、哪一区做什么。不要新增数字。
6. 用到某一列时，写上 `profile.json` 里该列的 `missing`。金额的 `mean` 和 `median` 都要原样写出；两个数不一样时，不要把平均数单独叫作典型的一笔。
7. 不要写代码，不要留 TODO 或 `[...]`。

1. The first paragraph answers the question: one full sentence that is a judgment or a recommendation, not a heading and not the background.
2. Then three `##` sections, in this order: what happened; a possible reason; what to do.
3. What happened describes only the aggregated results. Every bullet cites `charts/<id>.svg` using an `id` from `aggregates.json`. Cite every chart at least once.
4. The possible reason is a hypothesis, and you say it was not tested. Do not present it as a measurement. This flow fit no predictive model, so do not write what next quarter will reach.
5. What to do is the next step for this audience: who should do what, for which category and region. No new numbers.
6. When you use a column, include its `missing` count from `profile.json`. Copy both `mean` and `median` for the amount column; when they differ, do not call the mean a typical row on its own.
7. No code, and no TODO or `[...]`.
