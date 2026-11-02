为这次旅行列备选地点。只输出 JSON，不要解释。

- 目的地：{{inputs.destination}}
- 天数：{{inputs.days}}
- 时间：{{inputs.month}}
- 同行：{{inputs.travelers}}
- 每人预算：{{inputs.budget}}（不含往返大交通）
- 节奏：{{inputs.pace}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

List candidate places for this trip. Reply with JSON only.

- Destination: {{inputs.destination}}
- Days: {{inputs.days}}
- When: {{inputs.month}}
- Travelers: {{inputs.travelers}}
- Budget per person: {{inputs.budget}} (excluding getting there and back)
- Pace: {{inputs.pace}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "places": [
    {
      "id": "p1",
      "name": "地点名",
      "area": "所在区域，用来把同一片区的地点排在一天",
      "type": "sight",
      "minutes": 120,
      "cost": 0,
      "booking": false,
      "notes": "为什么值得去、适合谁、要注意什么",
      "verify": [ "出发前必须核实的信息，例如开放时间、闭馆日、门票价格、预约方式、是否限流" ]
    }
  ]
}
```

规则 / Rules:

- `type` 用 `sight`（景点）、`food`（吃饭）、`stay`（住宿区域）、`walk`（街区闲逛）。景点数量约为天数 × 节奏对应的每天主要景点数再多两三个备选；每个区域至少一处吃饭。
- `cost` 是每人大概花费（门票或人均），不知道就写 0 并在 `verify` 里写“门票价格”。
- 开放时间、闭馆日、门票、预约规则经常变，而且你可能记错：这些信息都写进 `verify`，不要当成确定的事实。博物馆和热门景点很多要提前预约、周一闭馆，`booking` 拿不准就写 true。
- 考虑同行的人（老人、孩子）和季节（高温、雨季、旺季人流）。

- `type` is `sight`, `food`, `stay` (an area to stay in) or `walk` (a neighborhood to wander). About days × the pace's main sights per day, plus two or three spares; at least one place to eat in each area.
- `cost` is a rough per-person cost (ticket or meal); write 0 when unsure and put "ticket price" in `verify`.
- Opening hours, closing days, prices and booking rules change often, and you may remember them wrong: put them all in `verify`, never state them as fact. Many museums and popular sights need advance booking or close on Mondays; when unsure, set `booking` to true.
- Consider who is traveling (older people, children) and the season (heat, rain, peak crowds).
