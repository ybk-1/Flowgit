# 旅行攻略 / Travel guide

从目的地、天数和同行的人做出一份能照着走的攻略。做法参考有经验的攻略作者：先把备选地点按区域列出来，再一天只排一片区域、按地理顺序走；每天两三个主要景点、留出空闲时间；每天准备一个雨天或约满时的备选。开放时间、闭馆日、门票和预约规则经常变，模型也可能记错，所以这些都放进“出发前核实”清单，不写成确定的事实。

Make a guide you can follow from a destination, a number of days and who is going. The method follows experienced guide writers: list candidate places by area, give each day one area in geographic order, keep to two or three main sights a day with free time, and have a backup for rain or sold-out bookings. Opening hours, closing days, prices and booking rules change often and a model may remember them wrong, so they all go on a "check before you go" list instead of being stated as fact.

## 阶段 / Stages

1. **备选地点 places**（模型）：`places.json`。景点、吃饭、街区和住宿区域，每个写区域、建议游玩时长、每人大概花费、要不要预约，以及出发前必须核实的信息。
2. **按天行程 itinerary**（模型）：`itinerary.json`。每天一片区域，每站的时间、时长和到下一站的交通方式和分钟数，每天的空闲时间和雨天备选，以及每人预算明细。
3. **攻略笔记 guide**（模型）：`guide.md`。标题（地点、天数、适合谁）、行程概览、每天怎么走、交通、预算表、避坑、出发前核实清单，适合发小红书或朋友圈。
4. **检查 check**（脚本）：`check-report.md`。每天的主要景点有没有超过节奏（悠闲 2 个、正常 3 个、紧凑 4 个）；空闲时间够不够 60 分钟（这个流程的默认值）；上一站的开始时间加游玩时长加交通，是不是赶得上下一站；跨区域有没有写交通时间；每天有没有备选；行程里的地点是不是都在备选地点里；预算有没有超；要预约或要核实的地点有没有进“出发前核实”清单；正文里有没有把开放时间写成确定的数字。

1. **places** (model): `places.json` with sights, food, neighborhoods and areas to stay, each with its area, suggested time, rough cost per person, whether booking is needed, and what must be verified before going.
2. **itinerary** (model): `itinerary.json`, one area a day, each stop's time and length and the mode and minutes to the next, free time and a rainy-day backup each day, and the budget per person.
3. **guide** (model): `guide.md` with a title (place, days, who it suits), overview, each day, transport, a budget table, pitfalls and the check-before-you-go list, ready for a social post.
4. **check** (script): `check-report.md`. Main sights per day against the pace (relaxed 2, normal 3, packed 4); at least 60 free minutes (this flow's default); whether each stop's start plus time there plus the transfer reaches the next stop in time; transfers between areas with no time given; a backup every day; stops that are not candidate places; the budget; places needing a booking or verification missing from the checklist; and opening hours stated as fact in the body.

## 怎么跑 / How to run

```bash
flowgit init ~/trip-quanzhou -t travel-guide
cd ~/trip-quanzhou
flowgit inputs set destination=泉州 days=3 month=10月 travelers=两个成年人 budget=3000 pace=normal
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- 慢节奏行程：多篇攻略建议每天只排 2 到 3 个景点、中午休息、留出自由活动时间，反对“特种兵式”赶路；带老人或孩子时更要少排。[新浪：带父母旅游每日景点砍半](https://www.sina.cn/news/article/niututc2043955.html)、[新浪：暑假亲子游慢节奏](https://k.sina.cn/article_7879777378_1d5abdc6206801iebm.html)、[新浪：每天只去 2 个景点怎么玩](https://www.sina.cn/news/article/niututc2011306.html)。“每天至少 60 分钟空闲”是这个流程的默认值，不是来自某个标准。/ Two or three sights a day and time to rest; the 60-minute minimum is this flow's own default.
- 开放时间和预约以官方渠道为准：很多博物馆周一闭馆、要提前实名预约，但节假日常有例外（例如假期里的周一照常开放），时间也会随季节调整。[新浪：内蒙古博物院开放时间和预约](https://www.sina.cn/gc/article/niucuem4604053.html)、[新浪：国家博物馆五一周一不闭馆](https://k.sina.cn/article_1644114654_61ff32de020024u7o.html)、[新浪：青州博物馆周一开放公告](https://www.sina.cn/weibo/detail/5356871754974179.html)。/ Hours and bookings follow official channels; Monday closures have holiday exceptions.
- 小红书上的旅游笔记已超过 485 万篇，约四分之一是攻略；读者要的是实用和避坑。[搜狐](https://www.sohu.com/a/760072016_723902)。/ Travel notes on Xiaohongshu and what readers want from them.
- 收藏了很多攻略还是排不出行程，难点在于按天、按区域把地点排进时间里。[π 旅行：收藏了 100 篇小红书攻略，为什么还做不出一份行程](https://www.pitravel.cn/ourblog/xhs-itinerary-guide)。/ Why saved notes don't add up to an itinerary.
