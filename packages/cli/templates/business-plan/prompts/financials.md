根据公司资料和市场分析算单位经济，做三年财务预测。只输出 JSON，不要解释。

- 公司：{{inputs.company}}
- 融资阶段：{{inputs.round}}
- 这轮融资：{{inputs.ask}}（0 表示从资料里读）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Work out the unit economics and a three-year projection from the facts and the market analysis. Reply with JSON only.

- Company: {{inputs.company}}
- Round: {{inputs.round}}
- This round: {{inputs.ask}} (0 means read it from the facts)
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "currency": "元",
  "unit": {
    "arpa": 0,
    "grossMargin": 0.8,
    "cac": 0,
    "monthlyChurn": 0.03,
    "ltv": 0,
    "paybackMonths": 0
  },
  "years": [ { "year": 1, "customers": 0, "revenue": 0, "costs": 0, "profit": 0 } ],
  "assumptions": [ "每条假设一句话，写清依据" ],
  "ask": 0,
  "useOfFunds": [ { "item": "", "amount": 0 } ],
  "milestones": [ "这笔钱花完时要达到的、可以检验的目标" ]
}
```

算法 / Method:

- `arpa` 是每个客户每月的收入，`grossMargin` 是 0 到 1 的毛利率，`cac` 是平均获客成本（把销售和推广的人力也算进去），`monthlyChurn` 是 0 到 1 的月流失率。
- `ltv = arpa × grossMargin ÷ monthlyChurn`，`paybackMonths = cac ÷ (arpa × grossMargin)`。
- `years` 写三年，`profit = revenue − costs`。增长要从现在的数据和这轮钱的用途推出来，每条推算写进 `assumptions`。
- `useOfFunds` 的金额加起来等于 `ask`。
- 只用资料里的事实；资料里没有的数，写进 `assumptions` 说明是假设。

- `arpa` is monthly revenue per customer, `grossMargin` a 0–1 margin, `cac` the average cost to win a customer (sales and marketing staff included), `monthlyChurn` a 0–1 monthly churn rate.
- `ltv = arpa × grossMargin ÷ monthlyChurn`, `paybackMonths = cac ÷ (arpa × grossMargin)`.
- Three `years`, with `profit = revenue − costs`. Derive growth from today's numbers and what this round pays for, and put every step in `assumptions`.
- `useOfFunds` amounts add up to `ask`.
- Use only the facts; anything not in them goes into `assumptions` as an assumption.
