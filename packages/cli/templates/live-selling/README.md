# 直播带货脚本 / Live-selling script

从一份商品资料写出一个商品的直播讲解。结构来自直播运营常用的单品讲解节奏：留人 → 痛点 → 塑品演示 → 信任 → 价格 → 逼单 → 返场；检查按《网络直播营销管理办法（试行）》《广告法》和价格规定来，重点抓编出来的销量、库存和数字。

Write the live-stream pitch for one product from a page of product facts. The structure follows the single-product rhythm live-commerce teams use: hook → pain point → value demo → trust → price → close → recap. The checks follow China's live-stream marketing rules, the Advertising Law and the price rules, with a focus on invented sales, stock and numbers.

## 阶段 / Stages

1. **商品资料 materials**（你）：`materials/product.md`。话术里每个说法、每个数字都只能从这里或 `price` 来。示例是虚构的榨汁杯，和电商上架模板用的是同一份。
2. **流程表 rundown**（模型）：`rundown.json`，5 到 8 段，每段有类型（`hook` 留人、`pain` 痛点、`demo` 塑品演示、`trust` 信任、`price` 价格、`close` 逼单、`recap` 返场）、分钟数和目标，分钟数加起来等于 `minutes`。
3. **话术 script**（模型）：`script.md`，每段写话术、动作和互动。塑品不念参数，把参数翻译成“对你有什么用”；互动要具体；逼单分三句：对新来的讲核心好处，对犹豫的回答最大的顾虑，对已下单的讲怎么用好和找售后，减少退货。
4. **弹幕问答 qa**（模型，和话术并行）：`qa.md`，覆盖价格、下单、规格、材质、使用限制、清洗、发货、售后和对比；资料里没有的不编。
5. **检查 check**（脚本）：`check-report.md`，只提醒不拦：
   - 分钟数对不对、哪段没写、七种段落类型齐不齐、话术里有没有说出 `price` 里的价格；
   - “已经卖了几万单”“最后几单”“马上涨价”这类销量、库存和紧迫感说法（资料里没有就是虚构）；
   - 绝对化用语、医疗用语、“原价”“专柜价”这类价格比较；
   - 话术和问答里出现、但资料和价格里找不到的数字。

1. **materials** (you): `materials/product.md`. Every claim and number in the script must come from here or from `price`. The sample is a fictional blender cup, the same one the e-commerce listing template uses.
2. **rundown** (model): `rundown.json`, 5 to 8 segments, each with a type (`hook`, `pain`, `demo`, `trust`, `price`, `close`, `recap`), minutes and a goal; the minutes add up to `minutes`.
3. **script** (model): `script.md` with lines, actions and chat prompts per segment. The demo turns specs into benefits; chat prompts are concrete; the close speaks to newcomers (core benefit), hesitaters (their biggest doubt) and buyers (how to use it and reach support, to cut returns).
4. **qa** (model, in parallel with the script): `qa.md` covering price, ordering, size, materials, limits, cleaning, shipping, after-sales and comparisons; nothing invented.
5. **check** (script): `check-report.md`. It warns and never blocks:
   - do the minutes add up, which segment is missing, are all seven types there, is the price from `price` said out loud;
   - sales, stock and urgency claims such as "sold 30,000 already", "last few left", "price goes up soon" (invented unless the facts say so);
   - absolute terms, medical wording and price comparisons such as "was" or "retail" prices;
   - numbers in the script and Q&A that the facts and the price do not contain.

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

## 参考资料 / References

规则会变，开播前请以平台规则和官方原文为准。检查只做提醒，不能代替平台审核和法律意见。

Rules change. Check the platform's rules and the official texts before going live. The checks are reminders, not platform review or legal advice.

- 《网络直播营销管理办法（试行）》（国家网信办等七部门，2021 年 5 月 25 日施行）第十八条：直播间运营者和直播营销人员要真实、准确、全面地发布商品信息，不得发布虚假或引人误解的信息，不得虚构或篡改交易、关注度、浏览量、点赞量等数据。[湖南省政府转载全文](http://www.hunan.gov.cn/zqt/zcsd/202104/t20210425_16512565.html)、[新华网：8 条红线](http://www.xinhuanet.com/politics/2021-04/24/c_1127368571.htm)。/ Measures for the Administration of Live-Stream Marketing (trial, 2021), art. 18.
- 《中华人民共和国广告法》第九条（绝对化用语）、第十七条（非医疗广告不得涉及疾病治疗功能）。[维基文库全文](https://zh.wikisource.org/wiki/%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E5%B9%BF%E5%91%8A%E6%B3%95)。/ Advertising Law of the PRC, arts. 9 and 17.
- 市场监管总局《广告绝对化用语执法指南》（2023）。[湖南省政府转载](https://www.hunan.gov.cn/zqt/zcsd/202303/t20230320_29282723.html)。/ SAMR enforcement guide on absolute terms (2023).
- 《明码标价和禁止价格欺诈规定》（2022 年 7 月 1 日施行）第十九条：虚假折价、虚假价格比较、误导性的价格标示。[司法部](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/202305/t20230511_478601.html)。/ Price fraud provisions (2022), art. 19.
- 话术分类（留人、塑品、互动、逼单）、观众平均只停留几秒、塑品讲价值不念参数、逼单要分人群、过度逼单带来退货：[人人都是产品经理：直播话术](https://www.woshipm.com/operate/6065985.html)、[直播带货话术拆解](https://www.woshipm.com/share/6044059.html)。/ Practitioner articles on live-selling script types, the few-seconds hook, value-first demos, segmented closing and the return cost of hard closing.
