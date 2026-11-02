# 商业计划书 / Business plan

从你公司的真实数据写一份融资用的商业计划书（BP）。结构按红杉资本公开的商业计划书写法：公司定位、问题、解决方案、为什么是现在、市场、竞争、产品、商业模式、团队、财务，再加融资计划。市场规模用自下而上的算法（客户数 × 客单价），商业模式写清单位经济（LTV:CAC 和回本月数），每个数字都只能来自你填的资料。

Write a fundraising business plan from your company's real numbers. It follows the business-plan outline Sequoia Capital published: purpose, problem, solution, why now, market, competition, product, business model, team, financials, plus the ask. Market size is bottom-up (customers × price), the business model states unit economics (LTV:CAC and payback), and every number must come from the facts you provide.

## 阶段 / Stages

1. **公司资料 company facts**（人）：`materials/company.md`。做什么、给谁、现在的数据（用户、收入、留存）、价格和成本、获客成本、团队、想融多少和怎么花。示例是虚构的“店小算”。
2. **市场和竞争 market**（模型）：`market.json`。一句话公司定位、客户的痛、为什么是现在、自下而上的市场规模（客户数和价格都写出处，没有出处就标“估算，需要核实”）、直接和间接竞争对手、你凭什么赢。
3. **单位经济和财务 financials**（模型）：`financials.json`。每个客户每月收入、毛利率、获客成本、月流失率、LTV、回本月数，三年预测和每条假设，资金用途和里程碑。
4. **BP 正文 plan**（模型）：`business-plan.md`。每部分一个标题，标题写成一句结论，连起来就能讲完整个故事；不写“颠覆”“唯一”这类没依据的词，不承诺投资回报。
5. **检查 check**（脚本）：`check-report.md`。缺了哪部分；“为什么是现在”是不是按红杉的顺序放在市场之前；标题有没有结论；客户数 × 客单价是不是等于市场规模，SOM、SAM、TAM 的大小关系；按公式重算 LTV 和回本月数，LTV:CAC 低于 3 或回本超过 12 个月时提醒；收入 − 成本是不是等于利润，收入一年涨三倍以上要写依据；资金用途加起来是不是等于融资额；正文里有没有资料和两个 JSON 里都找不到的数字；有没有“保本”“稳赚”“年化收益”这类承诺回报的说法。

1. **materials** (person): `materials/company.md`: what you do and for whom, today's numbers (users, revenue, retention), pricing and costs, acquisition cost, the team, and the raise and its use. The sample is a fictional company, "ShopTally".
2. **market** (model): `market.json` with the one-sentence purpose, the customer's pain, why now, a bottom-up market size (customer count and price both sourced, or marked "estimate, needs checking"), direct and indirect competitors, and why you win.
3. **financials** (model): `financials.json` with monthly revenue per customer, gross margin, acquisition cost, monthly churn, LTV and payback, a three-year projection with each assumption, the use of funds and milestones.
4. **plan** (model): `business-plan.md`, one titled part each, every title a one-line claim so the titles alone tell the story; no unproven "disruptive" or "only", and no promised returns.
5. **check** (script): `check-report.md`. Missing parts; whether "why now" comes before the market, as in Sequoia's order; titles without a claim; whether customers × price equals the stated market size, and the SOM ≤ SAM ≤ TAM order; LTV and payback recomputed from the formulas, with a warning below 3:1 or above 12 months; revenue − costs = profit, and a note when revenue grows more than threefold in a year; whether the use of funds adds up to the ask; numbers in the plan found in neither the facts nor the two JSON files; and wording that promises returns ("guaranteed", "risk-free", "annual yield").

BP 是给投资人看的判断材料，不是向公众募资的广告。不要把它当成理财产品去宣传。

A business plan is material for investors to judge, not an advertisement to raise money from the public. Don't market it like an investment product.

## 怎么跑 / How to run

```bash
flowgit init ~/my-bp -t business-plan
cd ~/my-bp
# 先把 materials/company.md 换成你的资料 / first replace materials/company.md with your facts
flowgit inputs set company=店小算 round=天使轮
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- 红杉资本《Writing a Business Plan》：用一句陈述句定义公司；问题、解决方案、为什么是现在、市场潜力、竞争、商业模式、团队、财务等部分；“为什么是现在”是核心问题，要讲清这件事为什么之前没人做成，它排在问题和解决方案之后、市场之前。[Sequoia](https://sequoiacap.com/article/writing-a-business-plan)、[原文转录](https://rtgiordano.notion.site/Writing-a-Business-Plan-58e4b0a681de4971850bc0e5f15b66e8)。/ Sequoia's business-plan outline.
- 模板只是检查清单，真正要做的是讲好故事：标题本身要讲故事，“为什么是现在”要用技术、政策或用户习惯的变化来回答，而不是“我们快没钱了”。[Scott Sage, Medium](https://medium.com/@scott_sage/fundraising-why-you-shouldnt-just-copy-sequoia-s-pitch-deck-template-4b32ac60d93a)、[Rodrigo, Ask a VC](https://rodrigo.medium.com/ask-a-vc-what-is-a-good-pitch-deck-790f7077fb95)、[VC pitch deck templates](https://medium.com/@claire_4505/vc-pitch-deck-templates-if-youre-thinking-of-using-one-then-read-on-83ecf17cfee1)。/ Templates are checklists; titles and "why now" carry the story.
- 自下而上算市场规模：目标客户数 × 每个客户每年付的钱；自上而下的数字只是引用一个统计，读者只能选择信或不信，可以作背景，但核心要用自下而上的算法。[Point Nine](https://medium.com/point-nine-news/how-to-bulletproof-your-fundraising-deck-d18c0de6d93d)、[Dreamit](https://medium.com/@dreamit/5-tips-for-creating-the-perfect-tam-slide-for-vc-pitches-e970a0bb1b02)、[TechCrunch](https://techcrunch.com/2021/11/16/5-critical-pitch-deck-slides-most-founders-get-wrong/)。/ Bottom-up market sizing.
- 单位经济：LTV:CAC 3:1 是 A 轮常见的参考线；B2B SaaS 的获客回本期中位数约 15 个月，做得好的在 12 个月以内；LTV 要按毛利算，CAC 要算全（不能只算投放费用）。不同行业和阶段差别很大，这些只是参考。[CRV](https://www.crv.com/content/ltv-cac)、[Chargebee](https://www.chargebee.com/resources/glossaries/ltv-cac-ratio/)、[Forecastr](https://www.forecastr.co/blog/cac-vs-ltv)、[a16z：16 个创业指标](https://a16z.com/16-startup-metrics/)。/ Unit-economics benchmarks and how to compute them honestly.
- 国务院《防范和处置非法集资条例》（2021）第二条：未经许可、以许诺还本付息或者给予其他投资回报等方式、向不特定对象吸收资金，属于非法集资。[每日经济新闻](https://www.nbd.com.cn/articles/2021-02-10/1627381.html)、[中证网](https://cs.com.cn/xwzx/hg/202102/t20210211_6139124.html)。/ China's 2021 rules on illegal fund-raising, art. 2.
