# 活动策划方案 / Event plan

从一个活动想法写出能拿去审批、也能照着执行的策划方案。先写活动简报，目标按 SMART 原则写成能衡量的数字；再并行做流程表（run of show）、预算和风险登记表；最后合成一份完整方案。检查脚本会算流程时间接不接得上、预算乘法和预备金，看风险有没有漏掉的类别，并在 1000 人以上的公开活动时提醒申请大型群众性活动安全许可。

Turn an event idea into a plan you can get signed off and actually run. The brief comes first, with SMART objectives written as measurable numbers; then the run of show, budget and risk register in parallel; then one complete proposal. The check script verifies the timing and the budget arithmetic and contingency, looks for missing risk categories, and flags the large-event safety permit for public events of 1,000 people or more.

## 阶段 / Stages

1. **活动简报 brief**（模型）：`brief.json`。目的、2 到 4 个 SMART 目标（每个写衡量方法和带数字的目标值）、目标人群、核心信息、形式、时间和场地。
2. **流程表 runsheet**（模型）：`runsheet.json`。从搭建、彩排、入场到散场和撤场，每项有开始时间、时长、负责人和备选方案，一项接一项。
3. **预算 budget**（模型，和流程表、风险并行）：`budget.json`。按类别列数量、单价、小计，留 10% 到 15% 的预备金，单价是估算的地方写明要拿报价核实。
4. **风险预案 risks**（模型）：`risks.json`。人流、消防和安全、天气、设备和供电、医疗、延误（以及供应商、舆情），每条有可能性和影响（1 到 5 分）、预防措施、发生后怎么做和负责人。
5. **策划方案 proposal**（模型）：`proposal.md`。概要、目标和衡量、活动内容、流程表、人员分工、宣传和邀约、预算、风险预案、效果评估和复盘。
6. **检查 check**（脚本）：`check-report.md`。目标值有没有数字；流程每一项的开始时间加时长是不是等于下一项的开始时间，有没有空档或重叠；每项有没有负责人；预算的数量 × 单价是不是等于小计，加上预备金有没有超过总预算，预备金是不是不到 10%，有没有场地、人员、安保和保险；六类核心风险有没有漏，每条有没有预防、应对和负责人，列出高风险项；方案缺哪部分；面向社会公众又预计 1000 人以上时，提醒提前 20 天向公安机关申请安全许可（5000 人以上找市级）。

1. **brief** (model): `brief.json` with the purpose, 2 to 4 SMART objectives (each with a measure and a numeric target), the audience, the key message, the format, the date and the venue.
2. **runsheet** (model): `runsheet.json`, from setup and rehearsal through doors, the programme, exit and teardown, each item with a start, length, owner and fallback, back to back.
3. **budget** (model, in parallel with the run of show and risks): `budget.json`, lines by category with quantity, unit price and subtotal, a 10% to 15% contingency, and a note wherever a price is an estimate to be quoted.
4. **risks** (model): `risks.json` covering crowds, fire and safety, weather, equipment and power, medical, delays (plus suppliers and reputation), each with likelihood and impact (1 to 5), prevention, response and an owner.
5. **proposal** (model): `proposal.md` with the summary, objectives and measures, programme, run of show, roles, promotion, budget, risks, and measuring and review.
6. **check** (script): `check-report.md`. Every target has a number; each item's start plus length equals the next start, with no gaps or overlaps; every item has an owner; quantity × price equals each subtotal, the total with contingency stays within budget, the contingency is at least 10%, and venue, staff, security and insurance are budgeted; none of the six core risk categories is missing and each risk has prevention, response and owner, with high risks listed; missing proposal parts; and for a public event of 1,000 or more, a reminder to apply to the public-security bureau for a safety permit 20 days ahead (the city level for 5,000 or more).

## 怎么跑 / How to run

```bash
flowgit init ~/my-event -t event-plan
cd ~/my-event
flowgit inputs set event=咖啡馆五周年市集 goal=带来新会员 attendees=300 budget=50000 venue=店门前广场
flowgit run all
```

没有 API key 时，用固定回复跑通（示例是 1200 人的公开市集）：

Without an API key, the canned replies run the flow (the sample is a public market for 1,200 people):

```bash
flowgit inputs set attendees=1200 audience=public
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- 活动方案的常见结构：执行摘要、目标、目标人群、活动细节、宣传、预算、执行安排和应急预案；目标按 SMART 原则写并配上衡量指标。[EventX](https://www.eventx.io/blog/writing-an-event-proposal)。/ Event proposal structure and SMART objectives.
- 流程表（run of show）：按开始时间、时长和负责人把活动从头到尾排清楚。[Accounts-OS 活动服务合同样本](https://accounts-os.com/contracts/templates/statement-of-work-event-management)。/ Run of show with start, length and owner.
- 预备金：常见建议是总预算的 10% 到 15%（也有说 10% 到 20%），户外、跨国或第一次办的形式要更高；预备金用来应对天气、加班和临时的合规要求，要单独列一行，并写清谁能批准动用。[Boroondara 市政府户外活动指南](https://www.boroondara.vic.gov.au/services/spaces-venues-and-facilities/planning-outdoor-event-council-land-boroondara/boroondara-outdoor-event-guide/financial-management-and-budgets)、[Accounts-OS 活动服务合同样本](https://accounts-os.com/contracts/templates/statement-of-work-event-management)、[Zoho Backstage 活动预算指南](https://www.zoho.com/backstage/event-budgeting-guide.html)。/ Contingency reserves.
- 国务院《大型群众性活动安全管理条例》（2007，国务院令第 505 号）：第二条，面向社会公众、每场预计 1000 人以上的活动适用；第六条，安全工作方案要写清时间地点、安全工作人员、消防措施、场所容量和预计人数、疏散和应急救援预案等；第十二条，1000 到 5000 人由县级公安机关许可，5000 人以上由设区的市级公安机关许可；第十三条，举办日 20 日前申请。[公安部网站](https://www.mps.gov.cn/n6557558/c8238968/content.html)、[司法部法规库](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzxzfg/200709/t20070922_350489.html)、[深圳市公安局：申请要交哪些材料](https://ga.sz.gov.cn/szsgajgkml/szsgajgkml/zcwdpt/content/post_10844217.html)。各地还有自己的规定（例如[北京](https://www.bjrd.gov.cn/rdzl/dfxfgk/dfxfg/202101/t20210106_2200080.html)、[浙江](https://www.gov.cn/zhengce/2021-12/27/content_5719236.htm)），以举办地为准。/ China's 2007 regulations on large-scale mass activities; local rules add to them.
