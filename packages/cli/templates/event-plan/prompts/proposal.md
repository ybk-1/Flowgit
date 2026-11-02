把简报、流程表、预算和风险预案写成一份完整的活动策划方案，给老板或客户审批。只输出 Markdown，不要解释。

- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Combine the brief, run of show, budget and risk register into one event proposal for sign-off. Reply with Markdown only.

- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

第一行 `# 活动名`。按顺序写这些部分，每部分一个 `##`：

The first line is `# Event name`. Then these parts in order, one `##` each:

1. 概要 / Summary：一段话说清办什么、为什么、什么时候、多少人、花多少钱。
2. 目标和衡量 / Objectives and measures
3. 活动内容 / Programme
4. 流程表 / Run of show：表格，照 runsheet.json。
5. 人员分工 / Roles
6. 宣传和邀约 / Promotion
7. 预算 / Budget：表格，照 budget.json，写出预备金。
8. 风险预案 / Risks：表格，照 risks.json。
9. 效果评估和复盘 / Measuring and review：活动后怎么收集数据、什么时候复盘。

数字只用四个 JSON 里的，不要改动或新增。人数达到 1000 人以上又面向社会公众时，在风险预案里写明要向公安机关申请大型群众性活动安全许可，并准备安全工作方案。

Use only the numbers in the four JSON files; change or add none. When attendance is 1,000 or more and the event is open to the public, say in the risks part that a large-event safety permit must be applied for with the public-security bureau, with a safety plan.
