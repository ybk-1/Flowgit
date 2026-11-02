# 数据报告 / Data report

从一张表回答一个问题，任何带表头的 CSV 都行（示例是销售表）。先给每一列做画像，再让模型只写图表规格（柱状、折线或表格，不写代码），脚本按规格汇总并手画出浅色和深色都能看的 SVG，模型把结论放在第一段、每个发现都点明哪张图，最后合成报告。分析里每个数字都必须已经出现在画像或汇总里，对不上的写进检查，只提醒，不拦住。

Answer one question from a table: any CSV with a header row (the sample is sales). A script profiles every column, the model writes a chart spec only (bar, line or table, never code), a script aggregates that spec and draws SVG that stays readable in light and dark, and the model leads with the answer, citing a chart for each finding. Every number in the analysis must already appear in the profile or the aggregates. A miss is listed in the check, which warns and does not block.

示例 `data/sales.csv` 是虚构的 2025 年第一季度销售，208 行，列是 `date`、`category`、`region`、`amount`、`quantity`，有少量空单元格。不要把它当成真实经营数据。

The sample `data/sales.csv` is fictional first-quarter 2025 sales, 208 rows, columns `date`, `category`, `region`, `amount` and `quantity`, with a few empty cells. Do not treat it as a real business.

## 阶段 / Stages

1. **表格 data**（你）：`data/` 里的一个 CSV，第一行是列名，叫什么都行（中文表头也行）。放你的表时删掉示例 `sales.csv`，`data/` 里有两个 CSV 时画像这一步会停下来让你只留一个。UTF-8 和 Excel 默认存的 GBK 都能读。数字不要带千分位和货币符号；日期写成 `2025-01-31` 才算日期列。空着的格子不要补。
2. **画像 profile**（脚本）：`profile.json`。每一列有类型、缺失个数、唯一值个数、最小值、最大值、平均数、中位数；日期列还有日期范围。缺失值只计数，不填补。数字的平均数和中位数保留两位小数；偶数个数字的中位数是中间两数的平均。日期的中位数取排序后靠前的那一个中间日期，平均数留空。
3. **图表规格 plan**（模型）：`charts.json`。每张图只有 `id`、`type`（`bar` | `line` | `table`）、`x`、`y`、`agg`（`sum` | `mean` | `count` | `median`）、`filter`、`title`。模型不写代码，也不猜谁最大：CSV 的每一行不会附在提示词里。柱状图和表格的 `x` 选唯一值不超过 30 的列，折线的 `x` 用日期列；`sum`、`mean`、`median` 只汇总数字列，`count` 数行数。`filter` 只允许 `列=值` 这类比较，用 `&` 表示并且。
4. **出图 charts**（脚本）：`charts/*.svg` 和 `aggregates.json`。柱状图按数值从高到低，长度从 0 起算，旁边写上数字。折线按 `x` 从小到大，每个点有圆点。表格按 `x` 排序，格子里写精确值；`x` 全是数字时按数值排。合计也保留两位小数。柱状图和表格超过 30 组、折线超过 1000 个点，或者拿文字列做合计，这一步会失败并说明怎么改规格。颜色会跟着系统的浅色或深色变，数值不只靠颜色区分。
5. **分析 analysis**（模型）：`analysis.md`。第一段就是对问题的回答。后面三节依次是发生了什么、可能的原因、建议。每个发现都写上 `charts/<id>.svg`。数字从 `profile.json` 或 `aggregates.json` 原样抄，不算新的差、比或百分比。原因要标明是猜测。
6. **报告 report**（脚本）：`report.md`、自包含的 `report.html`（图嵌在页面里，不引用外部文件）和 `check-report.md`。每张图下面写明汇总方式、筛选和用了几行、跳过几行。检查三件事，都只提醒：分析里有、但画像和汇总里没有的数字；分析没引用的图；分析以标题开头、结论不在第一段。文件读不到、JSON 解析失败、图表规格不合法，才会让对应的步骤失败。

1. **data** (you): one CSV in `data/`, with a header row and any column names (Chinese headers too). Delete the sample `sales.csv` when you add yours; with two CSVs in `data/` the profile stage stops and asks you to keep one. UTF-8 and the GBK files Excel saves by default both work. Write numbers without thousands separators or currency signs, and dates as `2025-01-31` for a date column. Leave empty cells empty.
2. **profile** (script): `profile.json`. Each column has a type, missing count, distinct count, min, max, mean and median; a date column also has its date range. Missing values are counted, not filled in. Means and medians of numbers are kept to two decimals; the median of an even count is the average of the two middle values. The median of a date is the earlier of the two middle dates, and the mean is left empty.
3. **plan** (model): `charts.json`. Each chart has only `id`, `type` (`bar` | `line` | `table`), `x`, `y`, `agg` (`sum` | `mean` | `count` | `median`), `filter` and `title`. The model writes no code and does not guess a winner: the CSV rows are not pasted into the prompt. A bar chart or a table groups by a column with 30 distinct values or fewer, and a line by the date column; `sum`, `mean` and `median` only aggregate numeric columns, and `count` counts rows. A `filter` is only a comparison such as `column=value`, joined with `&` for AND.
4. **charts** (script): `charts/*.svg` and `aggregates.json`. Bars are sorted high to low, their length starts at 0, and the number is written beside the bar. A line is sorted by `x` and marks every point. A table is sorted by `x` and prints the exact value; when every `x` is a number, the order is numeric. Sums are kept to two decimals too. More than 30 groups in a bar chart or a table, more than 1000 points in a line, or a sum over a text column fails the stage with a note on how to fix the spec. Colors follow the system light or dark setting, and a value is never carried by color alone.
5. **analysis** (model): `analysis.md`. The first paragraph answers the question. Three sections follow: what happened, a possible reason, and what to do. Every finding cites `charts/<id>.svg`. Numbers are copied from `profile.json` or `aggregates.json`, with no new difference, ratio or percent. A reason is labeled as a guess.
6. **report** (script): `report.md`, a self-contained `report.html` (charts are inlined, nothing is loaded from the network) and `check-report.md`. Each chart's caption gives its aggregation, filter, and how many rows were used and skipped. Three checks, all warnings: numbers in the analysis that are in neither the profile nor the aggregates; charts the analysis never cites; an analysis that starts with a heading. A missing file, JSON that cannot be parsed, or an invalid chart spec fails the stage that hit it.

固定回复是按这份示例表写的。换了 CSV 就不要再用 `demo-replies/`，否则检查会把对不上的数字列出来。

The canned replies were written for this sample table. If you replace the CSV, do not use `demo-replies/` or the check will list the numbers that no longer match.

## 怎么跑 / How to run

```bash
flowgit init ~/my-data -t data-report
cd ~/my-data
# 先把你的 CSV 放进 data/，再删掉示例 sales.csv / put your CSV in data/ and delete the sample sales.csv first
flowgit inputs set "question=哪个类目和地区的销售额最高，下一步该补货还是促销？"
flowgit inputs set audience=区域销售经理
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一个目录：

Without an API key, the canned replies run the flow. Chinese and English each have a directory:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
# 英文 / English:
flowgit inputs set language=en
flowgit inputs set "question=Which category and region brought in the most revenue, and should we restock or run a discount?"
flowgit inputs set "audience=regional sales managers"
FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
```

## 依据 / Sources

下面每一条都对应某一阶段里的一条硬规则。规则会变的是你自己的表；这些出处只约束报告怎么写、图怎么选。

Each entry is the source of a hard rule in a stage. Your own table can say something else; these sources only constrain how the report is written and how the charts are chosen.

- Barbara Minto，The Minto Pyramid Principle，[概念说明](https://barbaraminto.com/concept)。一份说明由一个想法统领，写的时候先把读者带到这个想法，再往下展开。**plan**：每张图的 `title` 是一句比较，不是一个话题标签。**analysis**：第一段就是对问题的回答，后面才是分组的发现；**report** 会提醒以标题开头的分析。/ One thought holds the piece, and the reader is guided down from it. **plan**: each `title` is one comparison, not a topic label. **analysis**: the first paragraph answers the question, then the grouped findings; **report** warns when the analysis starts with a heading.
- Gartner，[What Is Data and Analytics?](https://www.gartner.com/en/topics/data-and-analytics)。描述性分析回答发生了什么，诊断性分析回答为什么，规范性分析回答该做什么；预测是另一类，回答可能会怎样。**analysis**：三节按这个顺序写，原因标明是猜测，不写这份流程没有做的预测。/ Descriptive analytics answers what happened, diagnostic analytics why, and prescriptive analytics what to do; predictive analytics is separate and says what is likely. **analysis**: the three sections follow that order, a reason is marked as a guess, and the flow does not invent a forecast.
- Stephen Few，[Save the Pies for Dessert](https://www.perceptualedge.com/articles/visual_business_intelligence/save_the_pies_for_dessert.pdf)（Perceptual Edge，2007）。比较各部分的大小时，柱状图比饼图准确。**plan**：类目比较只用 `bar`，不用饼图。/ Bars compare the size of parts more accurately than pies. **plan**: a category comparison is a `bar`, never a pie.
- Stephen Few，[Designing Effective Tables and Graphs](https://perceptualedge.com/images/Effective_Chart_Design.pdf)。要查阅单个精确值时用表；要看趋势和一组值的形状时用图。**plan**：需要按名称查精确值时用 `table`，看变化时用 `line`。**charts**：表格把汇总数字写成文字。/ Use a table to look up one exact value, and a graph when the message is the shape. **plan**: `table` for an exact lookup, `line` for change. **charts**: the table prints each aggregated number as text.
- Cole Nussbaumer Knaflic，[bar charts must have a zero baseline](https://www.storytellingwithdata.com/blog/2012/09/bar-charts-must-have-zero-baseline)（storytelling with data，2012）。读者比的是柱的长度，所以柱状图必须从 0 起算；折线不受这条限制。**charts**：柱状图的数量轴包含 0。/ Readers compare bar lengths, so a bar chart starts at zero; a line graph is not bound by this. **charts**: a bar's quantitative axis includes 0.
- Financial Times Visual Vocabulary，[chart-doctor/visual-vocabulary](https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary)。折线是表示时间变化的基本做法，点不规则时给每个点加标记；柱状图适合比较大小，长名称用横向的 bar，排过序的柱更容易读出高低；比较大小的柱必须从 0 起算。**plan**：时间变化用 `line`，类目高低用 `bar`。**charts**：柱按数值从高到低，折线按 `x` 排序并给每个点画圆点。/ A line is the standard time series and markers help when points are irregular; bars compare magnitude, suit long labels, and are easier to rank once sorted; a magnitude column starts at 0. **plan**: change over time is a `line`, a category ranking is a `bar`. **charts**: bars sort high to low; a line sorts by `x` and marks every point.
- NIST/SEMATECH，[Measures of Location](https://www.itl.nist.gov/div898/handbook/eda/section3/eda351.htm)。平均数是总和除以个数；偶数个观测的中位数是中间两数的平均。分布偏的时候平均数会被尾巴拉动，和中位数不是同一个“典型值”。**profile**：数字列同时给出平均数和中位数。**plan**：问典型的一笔、而这列两个数不一样时，用 `median`。**analysis**：两个数不一样时，不要把平均数单独叫作典型的一笔，两个都要原样写出。/ The mean is the sum divided by the count; the median of an even count is the average of the two middle values. In a skewed distribution the mean is pulled by the tail and is not the same typical value as the median. **profile**: a numeric column reports both. **plan**: use `median` for a typical row when the two differ. **analysis**: copy both, and do not call the mean a typical row on its own.
- IETF，[RFC 4180：CSV 文件的通用格式](https://www.rfc-editor.org/rfc/rfc4180)。第一行可以是表头；含逗号、引号或换行的字段放在双引号里，字段里的双引号写成两个。**profile** / **charts**：模板自带的解析器按这几条读表，不依赖外部库。/ The first line may be a header; a field with commas, quotes or line breaks is wrapped in double quotes, and a quote inside it is doubled. **profile** / **charts**: the template's own parser reads the table by these rules, with no library.
- 美国统计协会，[Ethical Guidelines for Statistical Practice](https://www.amstat.org/your-career/ethical-guidelines-for-statistical-practice)（2022）。方法要能复现；要说明数据来源、处理和缺失值怎么处理；不要把结果说成数据里没有的东西。**profile** / **charts**：缺失只计数、不填补，汇总由脚本完成，筛选不会当成代码执行。**plan**：只写规格，不写代码，不编分组总数。**analysis**：数字原样抄，不新算一个差或比。**report**：正文里对不上的数字列出来，报告仍然写出。示例表在 README 里标明是虚构的。/ Methods should be reproducible; say where the data came from, how it was processed, and how missing values were handled; do not state a result the data do not contain. **profile** / **charts**: missing cells are counted and not filled in, the script does the aggregation, and a filter is never executed as code. **plan**: the spec only, no code and no invented total. **analysis**: copy figures, do not compute a new difference or ratio. **report**: numbers that do not match are listed, and the report is still written. This README marks the sample table as fictional.
- W3C，[WCAG 2.2 成功标准 1.4.3 对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。正文和背景要有足够的明暗对比。**charts** / **report**：SVG 和网页用同一套浅色与深色，文字颜色跟着背景一起换。/ Text needs enough contrast against its background. **charts** / **report**: the SVG and the page share one light palette and one dark palette, and the text color changes with the background.
- W3C，[WCAG 2.2 成功标准 1.4.1 颜色的使用](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)。颜色不能是区分信息的唯一手段。**charts**：柱旁、折线的关键点和表格格子里都写上数值，位置和文字同时在。/ Color cannot be the only way to tell values apart. **charts**: the number is written beside each bar, on the key points of a line, and in every table cell, along with its position.
