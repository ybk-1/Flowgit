用备选地点排出按天的行程。只输出 JSON，不要解释。

- 天数：{{inputs.days}}
- 同行：{{inputs.travelers}}
- 每人预算：{{inputs.budget}}（不含往返大交通）
- 节奏：{{inputs.pace}}（relaxed 每天 2 个主要景点，normal 3 个，packed 4 个）
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Build a day-by-day itinerary from the candidate places. Reply with JSON only.

- Days: {{inputs.days}}
- Travelers: {{inputs.travelers}}
- Budget per person: {{inputs.budget}} (excluding getting there and back)
- Pace: {{inputs.pace}} (relaxed: 2 main sights a day, normal: 3, packed: 4)
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "days": [
    {
      "day": 1,
      "area": "这一天主要在哪一片",
      "items": [
        { "time": "09:00", "place": "p1", "minutes": 120, "transport": { "mode": "步行", "minutes": 15 } }
      ],
      "free": 90,
      "backup": "下雨或满约时换去哪里（写备选地点的 id 或名字）"
    }
  ],
  "budget": [ { "item": "住宿", "perPerson": 0 } ]
}
```

规则 / Rules:

- 一天只排一片区域，按地理顺序走，不来回折返。`place` 填备选地点的 `id`。
- `transport` 是从这一站到下一站：方式和分钟数；最后一站写回住处。下一站的 `time` 不早于这一站的 `time` 加 `minutes` 加交通时间。
- `type` 为 `sight` 的主要景点每天不超过节奏的上限。每天留出至少 60 分钟空闲（`free`），不要排成打卡式赶路。
- 每天都要有 `backup`：下雨、太热或约满时的室内或替代去处。
- `budget` 列住宿、餐饮、门票、市内交通、其他，每人合计不超过预算。

- One area per day, in geographic order, no backtracking. `place` holds a place `id`.
- `transport` is from this stop to the next: mode and minutes; the last stop goes back to the hotel. Each `time` is no earlier than the previous `time` plus its `minutes` plus the transfer.
- Main sights (`type` `sight`) per day stay within the pace. Leave at least 60 minutes free (`free`) every day; no box-ticking rush.
- Every day has a `backup`: an indoor or alternative option for rain, heat or sold-out bookings.
- `budget` covers stay, food, tickets, local transport and other, adding up to no more than the budget per person.

交之前逐天数一遍：地点清单里 `type` 是 `sight` 的站，relaxed 每天不超过 2 个，normal 不超过 3 个，packed 不超过 4 个。超了就把多的那个写进 `backup`，或者挪到别的天；`food` 和 `walk` 的站不算主要景点。输出语言是 {{inputs.language}}：是 en 时全部写英文，地名可以在英文后面括注中文。
Before replying, count each day's stops whose place has `type` `sight`: at most 2 for relaxed, 3 for normal, 4 for packed. If a day has more, put the extra one in `backup` or move it to another day; `food` and `walk` stops are not main sights. The output language is {{inputs.language}}: if it is en, everything is English, and a place name may carry its Chinese name in brackets after the English.
