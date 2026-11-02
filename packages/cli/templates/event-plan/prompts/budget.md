做活动预算。只输出 JSON，不要解释。

- 总预算：{{inputs.budget}}（包括预备金）
- 预计人数：{{inputs.attendees}}
- 场地：{{inputs.venue}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Make the event budget. Reply with JSON only.

- Total budget: {{inputs.budget}} (contingency included)
- Expected attendance: {{inputs.attendees}}
- Venue: {{inputs.venue}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "currency": "元",
  "items": [ { "category": "场地", "item": "", "qty": 1, "unit": "天", "price": 0, "total": 0 } ],
  "contingency": 0,
  "notes": [ "单价是估算的地方写在这里，要拿报价核实" ]
}
```

规则 / Rules:

- 类别至少考虑：场地、搭建和物料、设备（音响灯光屏幕）、人员、餐饮、宣传、交通和物流、安保和保险。
- `total = qty × price`。所有 `total` 加上 `contingency` 不超过总预算。
- `contingency` 是预备金，占各项合计的 10% 到 15%，用于超支和突发情况。
- 单价是估算的，在 `notes` 里说明，提醒拿供应商报价核实。

- Consider at least: venue, build and materials, equipment (sound, light, screens), staff, catering, promotion, transport and logistics, security and insurance.
- `total = qty × price`. All `total`s plus `contingency` stay within the total budget.
- `contingency` is 10% to 15% of the line items, for overruns and surprises.
- Unit prices are estimates; say so in `notes` and remind the reader to get quotes.
