写活动风险预案（风险登记表）。只输出 JSON，不要解释。

- 活动：{{inputs.event}}
- 预计人数：{{inputs.attendees}}
- 面向：{{inputs.audience}}（invite = 邀请制，public = 面向社会公众）
- 场地：{{inputs.venue}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。所有文字用这个语言。

Write the risk register. Reply with JSON only.

- Event: {{inputs.event}}
- Expected attendance: {{inputs.attendees}}
- Audience: {{inputs.audience}} (invite = invite-only, public = open to the public)
- Venue: {{inputs.venue}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Every string in that language.

```json
{
  "risks": [
    { "category": "crowd", "risk": "", "likelihood": 3, "impact": 4, "prevention": "事前怎么防", "response": "发生了谁做什么", "owner": "负责岗位" }
  ]
}
```

`category` 用这些值：`crowd`（人流和拥挤）、`fire`（消防和场地安全）、`weather`（天气）、`tech`（设备和供电）、`medical`（受伤和急病）、`schedule`（嘉宾或环节延误）、`supplier`（供应商出问题）、`reputation`（舆情和投诉）。前六类每类至少一条；室内活动的 `weather` 写到场和撤场的影响。

`likelihood` 和 `impact` 用 1 到 5 分。每条都要有具体的 `prevention`、`response` 和 `owner`。人流风险要写清场地容量、入口和疏散通道、限流办法。

`category` takes these values: `crowd`, `fire` (fire and venue safety), `weather`, `tech` (equipment and power), `medical`, `schedule` (late guests or segments), `supplier`, `reputation`. At least one for each of the first six; for an indoor event, `weather` covers arrival and departure.

`likelihood` and `impact` are 1 to 5. Every risk has a concrete `prevention`, `response` and `owner`. Crowd risks state the venue capacity, entrances and exits, and how numbers are limited.
