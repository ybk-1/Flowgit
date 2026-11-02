把行程写成一篇可以直接发的旅行攻略。只输出 Markdown，不要解释。

- 目的地：{{inputs.destination}}
- 天数：{{inputs.days}}
- 同行：{{inputs.travelers}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the itinerary up as a travel guide ready to post. Reply with Markdown only.

- Destination: {{inputs.destination}}
- Days: {{inputs.days}}
- Travelers: {{inputs.travelers}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

结构 / Structure:

1. `# 标题`：写清地点、天数和适合谁，例如“泉州 3 天 2 晚｜带娃不累的慢节奏路线”。
2. `## 行程概览`：每天一行。
3. 每天一个 `## 第 N 天：区域`（英文 `## Day N: area`）：按时间写每一站、怎么过去、为什么去、吃什么，以及雨天备选。
4. `## 交通`：怎么到、市内怎么走。
5. `## 预算`：表格，照 itinerary.json 的 budget。
6. `## 避坑`：真实会踩的坑（排队、预约、闭馆、天气、人多的时段），不写空话。
7. `## 出发前核实`（英文 `## Check before you go`）：把备选地点里的 `verify` 和所有要预约的地点逐条列出，提醒去官方渠道确认。

规则 / Rules:

- 开放时间、门票和预约规则只写“出发前核实”，不要写成确定的数字。
- 地点、时间和花费只用 places.json 和 itinerary.json 里的，不新增。
- 语气像朋友分享，短句、分段，适合手机看；可以用少量 emoji 做小标题。

- Opening hours, prices and booking rules appear only as "check before you go", never as definite numbers.
- Places, times and costs come only from places.json and itinerary.json; add none.
- Write like a friend sharing tips: short sentences and paragraphs for phones; a few emoji in subheads are fine.
