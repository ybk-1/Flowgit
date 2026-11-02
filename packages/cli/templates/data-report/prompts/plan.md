为这份数据写图表规格。只输出 JSON，不要解释，不要写代码。

- 要回答的问题：{{inputs.question}}
- 读者：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。`title` 用这个语言。

Write a chart spec for this data. Reply with JSON only. No explanation and no code.

- Question: {{inputs.question}}
- Audience: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Write every `title` in that language.

上游附了 `profile.json` 的全文。`data/` 里的 CSV 只给出文件名，没有附上每一行，所以你看不到分组之后的合计，也不要猜哪一类最大。

The prompt includes the full `profile.json`. The CSV under `data/` is listed by name only, not row by row, so you do not have the grouped totals and must not guess which group is largest.

```json
{
  "charts": [
    {
      "id": "category-amount",
      "type": "bar",
      "x": "category",
      "y": "amount",
      "agg": "sum",
      "filter": "",
      "title": "比较各类目的销售额合计。"
    }
  ]
}
```

字段只允许这些 / Only these fields:

- `id`：小写字母开头，只用小写字母、数字和连字符。会变成 `charts/<id>.svg`。
- `type`：`bar`、`line` 或 `table`。不要饼图，不要别的图。
- `x`、`y`：必须是 `profile.json` 里的列名。
- `agg`：`sum`（合计）、`mean`（平均数）、`count`（行数）、`median`（中位数）。
- `filter`：空字符串，或 `列=值`、`列>=值`、`列<=值`、`列>值`、`列<值`。多个条件用 `&` 表示并且。不要引号，不要函数，不要 JavaScript。
- `title`：一句话，说明这张图在比较什么。不要写分组后的总数，也不要点名谁最大。不要写出 `profile.json` 里没有的数字。

- `id`: starts with a letter; lowercase letters, digits and hyphens only. It becomes `charts/<id>.svg`.
- `type`: `bar`, `line` or `table`. No pie charts and no other marks.
- `x` and `y`: column names from `profile.json`.
- `agg`: `sum`, `mean`, `count` or `median`.
- `filter`: empty, or `column=value`, `column>=value`, `column<=value`, `column>value`, `column<value`. Join conditions with `&` for AND. No quotes, no functions, no JavaScript.
- `title`: one sentence naming the comparison. Do not write a grouped total or which group wins. Do not write a number that is not already in `profile.json`.

选图 / Which chart:

1. 比较类目、地区这类名称，或要排出高低：`bar`。名称比较长时也用 `bar`。不要饼图。
2. 看随时间的变化，`x` 用日期列：`line`。
3. 读者需要按名称查阅某一个精确值：`table`，`agg` 用 `median` 或 `sum`。问“典型的一笔”时，若这一列的 `mean` 和 `median` 不一样，用 `median`，不要只用平均数。
4. 写 4 到 6 张图，每张只做一个比较。`id` 不要重复。至少一张 `bar`、一张 `line`、一张 `table`。筛选不是必须的；要用就写一个简单比较。

1. Comparing categories or regions, or ranking them: `bar`. Use `bar` when the names are long. Do not use a pie.
2. Change over time, with the date column on `x`: `line`.
3. The reader must look up one exact value by name: `table`, with `agg` `median` or `sum`. For a typical value, use `median` when that column's `mean` and `median` differ. Do not use the mean alone.
4. Four to six charts, one comparison each, unique ids. Include at least one `bar`, one `line` and one `table`. A filter is optional; if you use one, keep it a simple comparison.
