写主图文案和详情页。只输出 Markdown，不要解释。

- 商品：{{inputs.product}}
- 平台：{{inputs.platform}}
- 买家：{{inputs.audience}}
- 输出语言：{{inputs.language}}（zh = 中文，en = English）。全文用这个语言。

Write the main-image copy and the detail page. Reply with Markdown only.

- Product: {{inputs.product}}
- Platform: {{inputs.platform}}
- Buyers: {{inputs.audience}}
- Output language: {{inputs.language}} (zh = Chinese, en = English). Everything in that language.

结构 / Structure:

```
# <选用的标题 / the chosen title>

## 主图 / Main images
1. **大字文案** — 画面：……
（共 5 张 / 5 in total）

## 详情页 / Detail page
### 第 1 屏：……
文案……
画面：……
```

是 en 时，标题和标签也写英文：`## Main images`、`1. **Headline** — Visual: …`、`## Detail page`、`### Screen 1: …`、`Visual: …`，不要出现“第 1 屏”“画面”“文案”这类中文标签。
If the language is en, write the headings and labels in English too: `## Main images`, `1. **Headline** — Visual: …`, `## Detail page`, `### Screen 1: …`, `Visual: …`, with no Chinese labels such as "第 1 屏", "画面" or "文案".

主图顺序 / Main images, in order:

1. 最重要的好处 + 使用场景（买家一眼看懂“这对我有什么用”）。
2. 到 4. 各讲一个卖点，写好处，再用一个证据（数字、认证、对比）撑住。
5. 包装清单或售后承诺。
1. The biggest benefit in its scene, so the buyer sees "what it does for me" at a glance.
2. to 4. One selling point each: the benefit, backed by one piece of evidence (a number, a certification, a comparison).
5. What is in the box, or the after-sales promise.

详情页 6 到 9 屏，按“好处先行”的顺序 / The detail page has 6 to 9 screens, benefit first:

首屏好处和场景 → 买家的痛点 → 每屏一个卖点（好处 → 特征 → 优势 → 证据）→ 证据和对比 → 参数表 → 使用须知（资料里写了“不适合”的要如实写）→ 包装和售后。
Hero benefit and scene → the buyer's pain point → one selling point per screen (benefit → feature → advantage → evidence) → evidence and comparison → spec table → usage notes (state honestly what the facts say it is not for) → box contents and after-sales.

合规 / Compliance:

- 每个说法、每个数字都要能在商品资料里找到，不编检测数据、销量和好评。
- 不用“最好”“第一”“顶级”“100%”“国家级”这类绝对化说法（《广告法》第九条）。
- 普通商品不写治疗、预防疾病的功效，不用医疗用语（《广告法》第十七条）。
- 不写“原价”“划线价”“比某某便宜”这类价格比较，除非资料里有真实的依据（《明码标价和禁止价格欺诈规定》第十九条）。
- 和同类比较时不点名别的品牌，不贬低别人。不要留 `[...]` 或 TODO。
- Every claim and number must be in the product facts. No invented test results, sales counts or reviews.
- No absolute claims such as "best", "No.1", "100%".
- No disease-treatment or prevention claims and no medical wording for ordinary goods.
- No "was" prices, strike-through prices or "cheaper than X" unless the facts give a real basis.
- When comparing, do not name or disparage other brands. Leave no `[...]` or TODO.

交之前再看一遍每个数字：容量、电量、时长、重量、件数，都要能在商品资料里找到原样的数；找不到就删掉这句，不要估一个。输出语言是 {{inputs.language}}：是 en 时全文写英文，即使商品资料是中文。
Before replying, check every number once more (capacity, battery, time, weight, counts): each must appear as is in the product facts; if it does not, delete that sentence rather than estimating one. The output language is {{inputs.language}}: if it is en, everything is English, even when the product facts are in Chinese.
