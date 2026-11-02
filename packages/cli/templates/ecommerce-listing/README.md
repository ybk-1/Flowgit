# 电商商品上架 / E-commerce listing

从一份商品资料写出整套上架文案：卖点、标题、5 张主图、详情页和客服问答。做法来自电商运营常用的 FABE 卖点法和“好处先行”的详情页结构，检查按《广告法》、价格规定和各平台的标题规则来。每一步都能单独改、单独重跑；改了卖点，后面的标题和详情页会提示需要重跑。

Write a complete product listing from one page of product facts: selling points, titles, 5 main images, the detail page and customer Q&A. It follows the FABE method and the benefit-first detail page that e-commerce operators use, and checks against China's Advertising Law, the price rules and each platform's title rules. Every step can be edited and re-run on its own; change a selling point and the titles and detail page are marked stale.

## 阶段 / Stages

1. **商品资料 materials**（你）：`materials/product.md`，写真实的参数、材质、包装、售后和“不适合”的情况。后面每句文案、每个数字都只能从这里来。示例是虚构的榨汁杯。
2. **卖点 points**（模型）：`points.json`。每个卖点按 FABE 写全：特征（资料里的事实）→ 优势（比同类强在哪）→ 好处（买家在什么场景得到什么）→ 证据。再列出买家下单前的顾虑和会搜的词。
3. **标题 titles**（模型）：`titles.json`，3 个候选。中文平台按“核心词 + 属性词 + 卖点词”，重要的词放前面；亚马逊按“品牌 + 商品类型 + 关键属性”，不写促销语和特殊符号。
4. **主图和详情页 detail**（模型）：`detail.md`。主图第 1 张讲最大的好处和场景，2 到 4 张各讲一个卖点和证据，第 5 张讲包装或售后。详情页 6 到 9 屏：好处和场景 → 痛点 → 每屏一个卖点 → 证据和对比 → 参数 → 使用须知 → 包装售后。
5. **客服问答 faq**（模型，和详情页并行）：`faq.md`，按卖点阶段列出的顾虑来写，先给结论再给依据；资料里没有的回答“帮您确认一下”。
6. **检查 check**（脚本）：`check-report.md`，只提醒不拦：
   - 标题长度按平台口径算：淘宝、拼多多、抖店 60 个字符（汉字算 2 个），亚马逊 75 个字符；`titleMax` 可以改。
   - 标题里重复超过两次的词、没用上的关键词；亚马逊标题里的促销语、特殊符号和全大写。
   - 《广告法》第九条的绝对化用语、第十七条的医疗用语。
   - “原价”“划线价”之类的价格比较，提醒要有真实依据。
   - 文案里出现、但商品资料里找不到的数字，例如编出来的销量或检测数据。

1. **materials** (you): `materials/product.md` with the real specs, materials, box contents, after-sales terms and what the product is not for. Every later line and number must come from here. The sample is a fictional blender cup.
2. **points** (model): `points.json`. Each point is full FABE: feature (a fact) → advantage (over similar products) → benefit (what the buyer gets, in which scene) → evidence. Plus buyers' worries and search terms.
3. **titles** (model): `titles.json`, 3 candidates. Chinese platforms: core term + attributes + selling point, most important first. Amazon: brand + product type + key attributes, no promotional phrases or special symbols.
4. **detail** (model): `detail.md`. Main image 1 is the biggest benefit in its scene, 2 to 4 one point and its evidence each, 5 the box or after-sales. The detail page has 6 to 9 screens: benefit and scene → pain point → one point per screen → evidence and comparison → specs → usage notes → box and after-sales.
5. **faq** (model, in parallel with detail): `faq.md`, written from the worries listed with the points, answer first and then the support; anything the facts do not say gets "let me check that for you".
6. **check** (script): `check-report.md`. It warns and never blocks:
   - title length counted the platform's way: 60 characters on Taobao, Pinduoduo and Douyin (a Chinese character counts as 2), 75 on Amazon; `titleMax` overrides it;
   - words repeated more than twice in a title and unused keywords; promotional phrases, special symbols and all caps in Amazon titles;
   - absolute terms (Advertising Law art. 9) and medical wording (art. 17);
   - price comparisons such as "was" or strike-through prices, which need a real basis;
   - numbers in the copy that the product facts do not contain, such as invented sales counts or test results.

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

## 参考资料 / References

规则会变，发布前请以平台后台和官方原文为准。检查只做提醒，不能代替平台审核和法律意见。

Rules change. Check the platform's seller center and the official texts before publishing. The checks are reminders, not platform review or legal advice.

- 《中华人民共和国广告法》第九条（绝对化用语）、第十七条（非医疗广告不得涉及疾病治疗功能）、第二十八条（虚假广告）。全文：[维基文库](https://zh.wikisource.org/wiki/%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E5%B9%BF%E5%91%8A%E6%B3%95)；英文译本：[China Law Translate](https://www.chinalawtranslate.com/advertising-law-2021/)。/ Advertising Law of the PRC, arts. 9, 17 and 28.
- 市场监管总局《广告绝对化用语执法指南》（2023 年第 6 号公告）：哪些情形不算违法（例如只表达经营理念、商品分级用语），以及医疗、药品、保健食品领域从严。[湖南省政府转载](https://www.hunan.gov.cn/zqt/zcsd/202303/t20230320_29282723.html)。/ SAMR enforcement guide on absolute terms in advertising (2023).
- 《明码标价和禁止价格欺诈规定》（市场监管总局令第 56 号，2022 年 7 月 1 日施行）第十九条：虚假折价、虚假价格比较、误导性的价格标示。[司法部](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/202305/t20230511_478601.html)。/ Provisions on clearly marked prices and price fraud (2022), art. 19.
- FABE 卖点法和“好处先行”的详情页顺序：[人人都是产品经理：FABE 模型](https://www.woshipm.com/share/6027803.html)、[详情页文案](https://www.woshipm.com/copy/3903006.html)。/ The FABE method and benefit-first detail pages (practitioner articles).
- 中文平台标题按 60 个字符、汉字算 2 个，拼多多搜索页只显示前十几个字，是卖家经验文章里的一致说法，没有找到官方原文：[知乎：拼多多标题技巧](https://zhuanlan.zhihu.com/p/457155374)、[抖店上架规范](https://www.cnblogs.com/doudaxia/p/22344557)。/ The 60-character (CJK = 2) limit on Chinese platforms is consistent across seller guides; no official text was found.
- 亚马逊：2026 年 7 月 27 日起，除图书、音乐、影视外，标题上限 75 个字符；超长的会被亚马逊改写，次要信息可以放进 125 个字符的 Item Highlights。[ZonGuru](https://www.zonguru.com/blog/amazon-75-character-title-limit)、[SellerEngine](https://sellerengine.com/amazon-product-title-update-2026/)。/ Amazon's 75-character title limit for non-media categories from 2026-07-27 (seller guides; check Seller Central).
