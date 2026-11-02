写商业计划书正文。只输出 Markdown，不要解释。

- 公司：{{inputs.company}}
- 融资阶段：{{inputs.round}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the business plan. Reply with Markdown only.

- Company: {{inputs.company}}
- Round: {{inputs.round}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

结构按红杉的商业计划书顺序，一部分一个 `##`，标题写成“部分名：一句结论”，例如 `## 问题：小餐馆老板不知道哪道菜在赚钱`：

Follow Sequoia's business-plan order, one `##` per part, each titled "Part: a one-line claim", e.g. `## Problem: small-restaurant owners can't tell which dishes make money`:

1. 公司定位 / Purpose
2. 问题 / Problem
3. 解决方案 / Solution
4. 为什么是现在 / Why now
5. 市场 / Market
6. 竞争 / Competition
7. 产品 / Product
8. 商业模式 / Business model
9. 团队 / Team
10. 财务 / Financials
11. 融资计划 / The ask

第一行是 `# 公司名`，下面一句话公司定位。

The first line is `# Company name`, followed by the one-sentence purpose.

写法 / Rules:

- 每部分只讲一个观点，先结论，后证据。投资人可能只看标题，所以标题连起来要能讲完整个故事。
- 数字只用公司资料、market.json 和 financials.json 里的，写出来源或假设。市场规模写出乘法。
- 商业模式写单位经济：客单价、毛利、获客成本、LTV:CAC 和回本月数。
- 融资计划写金额、用多久、怎么花、花完达到什么里程碑。
- 不用“颠覆”“唯一”“第一”这类说不清依据的词。不承诺投资回报（例如“保本”“稳赚”“年化收益”）：融资是股权投资，向不特定对象许诺回报有非法集资的风险。

- One point per part, conclusion first, evidence after. Investors may read only the titles, so the titles in a row should tell the whole story.
- Numbers come only from the facts, market.json and financials.json, with their source or assumption. Show the market-size multiplication.
- The business model states unit economics: price, margin, acquisition cost, LTV:CAC and payback months.
- The ask states the amount, the runway, the use of funds and the milestone it reaches.
- No "disruptive", "only" or "first" without proof. Never promise investors a return (e.g. "guaranteed", "risk-free", "annual yield").
