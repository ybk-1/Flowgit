根据公司资料写市场和竞争分析。只输出 JSON，不要解释。

- 公司：{{inputs.company}}
- 融资阶段：{{inputs.round}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the market and competition analysis from the company facts. Reply with JSON only.

- Company: {{inputs.company}}
- Round: {{inputs.round}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "purpose": "一句话说清公司做什么、给谁",
  "problem": "客户现在的痛，以及他们现在怎么凑合",
  "whyNow": ["最近什么变了，让这件事现在能做成"],
  "customers": { "segment": "目标客户", "count": 0, "source": "这个数从哪来" },
  "price": { "value": 0, "per": "每个客户每年付多少", "source": "资料里的价格" },
  "sam": { "value": 0, "formula": "客户数 × 每年客单价" },
  "som": { "value": 0, "basis": "3 到 5 年能拿到多少，按什么推算" },
  "tam": { "value": 0, "source": "更大的市场，可以写 0 表示不估" },
  "competitors": [ { "name": "", "type": "direct", "strength": "", "weakness": "" } ],
  "advantage": "为什么你能赢，最好是别人难复制的东西"
}
```

方法 / Method:

- 市场规模用自下而上的算法：目标客户数 × 每个客户每年付的钱，`sam.value` 就是这个乘积。客户数和价格都写出处；资料里没有的，`source` 写“估算，需要核实”，不要编一个权威来源。`tam` 只做背景，可以不估。
- `purpose` 是一句陈述句，说清做什么，不罗列功能。
- `whyNow` 写具体的变化（技术、政策、习惯、成本），不写“市场空间巨大”。
- 竞争对手要有直接的，也要有间接的（客户现在凑合用的办法，比如 Excel、纸本、外包）。
- 只用资料里的事实，不编数据。

- Size the market bottom-up: target customers × what each pays per year; `sam.value` is that product. Source both numbers; when the facts do not give one, write "estimate, needs checking" as the `source` rather than inventing an authority. `tam` is context only and may be 0.
- `purpose` is one declarative sentence about what you do, not a list of features.
- `whyNow` lists concrete changes (technology, regulation, habits, cost), not "the market is huge".
- Include direct competitors and indirect ones (how customers make do today: spreadsheets, paper, outsourcing).
- Use only the facts given. Invent no data.
