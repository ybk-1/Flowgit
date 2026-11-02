# 电商商品上架 / E-commerce listing

从一份商品资料写出整套上架文案：卖点、标题、5 张主图、详情页和客服问答。每一步都能单独改、单独重跑，改了卖点，后面的标题和详情页会提示需要重跑。

Write a complete product listing from one page of product facts: selling points, titles, 5 main images, the detail page and customer Q&A. Every step can be edited and re-run on its own; change a selling point and the titles and detail page are marked stale.

## 阶段 / Stages

1. **商品资料 materials**（你）：`materials/product.md`，写真实的参数、材质、包装和售后。示例是虚构的榨汁杯。
2. **卖点 points**（模型）：`points.json`，3 到 6 个卖点，每个都写依据，再加买家会搜的关键词。
3. **标题 titles**（模型）：`titles.json`，3 个候选标题，不超过 `titleMax` 个字。
4. **主图和详情页 detail**（模型）：`detail.md`，5 张主图的文案和画面，加 5 到 8 屏详情页。
5. **客服问答 faq**（模型，和详情页并行）：`faq.md`，资料里没有的不编。
6. **检查 check**（脚本）：`check-report.md`。标题长度、关键词有没有用上、广告法常见的绝对化用语（例如“最好”“第一”“100%”）和占位符。只提醒，不拦。

1. **materials** (you): `materials/product.md` with the real specs, materials, package contents and after-sales terms. The sample is a fictional blender cup.
2. **points** (model): `points.json`, 3 to 6 selling points with evidence, plus the keywords buyers search for.
3. **titles** (model): `titles.json`, 3 candidate titles within `titleMax` characters.
4. **detail** (model): `detail.md`, copy and visuals for 5 main images and 5 to 8 detail screens.
5. **faq** (model, in parallel with detail): `faq.md`; nothing the facts do not say.
6. **check** (script): `check-report.md`. Title length, keyword use, absolute claims that ad rules commonly ban (such as "best", "No.1", "100%"), and placeholders. It warns; it does not block.

标题字数上限各平台不同，也会调整，请按你上架时平台的规则设 `titleMax`。违禁词只是常见的一部分，不能代替平台审核。

Title limits differ by platform and change over time, so set `titleMax` to your platform's current rule. The banned-word list covers common cases only and does not replace the platform's review.

## 怎么跑 / How to run

```bash
flowgit init ~/my-listing -t ecommerce-listing
cd ~/my-listing
# 先把 materials/product.md 换成你的商品 / replace materials/product.md with your product first
flowgit inputs set product=便携榨汁杯
flowgit inputs set platform=taobao      # pinduoduo、douyin 或 amazon / or pinduoduo, douyin, amazon
flowgit run all
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```
