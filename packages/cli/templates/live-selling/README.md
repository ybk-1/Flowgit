# 直播带货脚本 / Live-selling script

从一份商品资料写出一场直播的脚本：先排流程表，再逐段写主播的话术、动作和互动，同时准备弹幕里最常被问的问题。最后检查分钟数、价格和违禁词。

Write the script for selling a product on a live stream: plan a rundown, write the host's lines, actions and chat prompts segment by segment, and prepare answers to the questions viewers ask most. Finally check the timing, the price and banned words.

## 阶段 / Stages

1. **商品资料 materials**（你）：`materials/product.md`。示例是虚构的榨汁杯，和电商上架模板用的是同一份。
2. **流程表 rundown**（模型）：`rundown.json`，4 到 7 段（开场留人、痛点、演示、价格、逼单、返场），分钟数加起来等于 `minutes`。
3. **话术 script**（模型）：`script.md`，每段写话术、动作和互动。
4. **弹幕问答 qa**（模型，和话术并行）：`qa.md`，资料里没有的不编。
5. **检查 check**（脚本）：`check-report.md`。分钟数对不对、哪段没写、话术里有没有说出 `price` 里的价格、绝对化用语和占位符。只提醒，不拦。

1. **materials** (you): `materials/product.md`. The sample is a fictional blender cup, the same one the e-commerce listing template uses.
2. **rundown** (model): `rundown.json`, 4 to 7 segments (hook, pain point, demo, price, close, recap) whose minutes add up to `minutes`.
3. **script** (model): `script.md`, with the lines, actions and chat prompts for each segment.
4. **qa** (model, in parallel with the script): `qa.md`; nothing the facts do not say.
5. **check** (script): `check-report.md`. Do the minutes add up, which segment is missing, does the script state the price from `price`, absolute claims and placeholders. It warns; it does not block.

违禁词只是常见的一部分，不能代替平台审核。

The banned-word list covers common cases only and does not replace the platform's review.

## 怎么跑 / How to run

```bash
flowgit init ~/my-live -t live-selling
cd ~/my-live
# 先把 materials/product.md 换成你的商品 / replace materials/product.md with your product first
flowgit inputs set product=便携榨汁杯
flowgit inputs set "price=直播间 99 元，前 100 单送杯套"
flowgit inputs set minutes=10
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```
