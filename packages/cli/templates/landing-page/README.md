# 落地页 / Landing page

从一份简报做出单页网站：简报 → 结构 → 文案 → 照片（可空）→ 生成网页 → 检查。每一步都照公开的研究和规则来做：一页只有一个目标；开头接住访问者点进来之前看到的那句承诺，按钮放在不用往下滑就能看到的地方；表单只收完成目标必需的信息，并在旁边写明谁收、做什么用、存多久、怎么撤回；推荐语只用真实的原话，并写明对方和你的关系；不制造虚假的紧迫感；页面按 WCAG 2.2 AA 生成和检查。依据见文末的“参考资料”。

Build a one-page site from a brief: brief → structure → copy → photos (optional) → build → check. Each step follows published research and rules: one page, one goal; the top of the page picks up the promise the visitor saw before clicking, and the button sits where nobody has to scroll; the form asks only for what the goal needs and says right next to it who collects the data, what for, how long it is kept and how to withdraw; testimonials are real quotes that say how the person is tied to you; no false urgency; and the page is built and checked against WCAG 2.2 AA. Sources are under "References" at the end.

## 阶段 / Stages

1. **简报 brief**（人）：`brief.md`。卖点、访问者从哪里来（点进来之前看到的那句话）、语气、必须写上的事实、证据（真实的用户原话，以及对方和你的关系）、表单和隐私（收什么、谁收、做什么用、存多久、怎么撤回）、不要说的话。示例是虚构的“箱栖”。
2. **结构 structure**（模型，`prompts/structure.md`）：`structure.json`。区块按 hero、features、testimonial、faq、cta 排，只有简报里有真实原话时才放推荐语。每个区块写用途、要点、建议的图片文件名和替代文本（读屏软件会念出来的那句话）。`form` 定下表单只收哪些字段，以及有没有让访问者自己勾选的同意框。
3. **文案 copy**（模型，`prompts/copy.md`）：`copy.json`。每个区块的标题、正文和按钮文字，行动区块还有放在表单下的收集说明（`note`）。标题先说访问者得到什么；按钮写“动词 + 会发生什么”，不写“提交”“了解更多”；只用简报里的事实，不编数字和评价，没有真实的截止日期就不写“限时”。
4. **照片 photos**（人）：`images/`。按结构里的文件名放图，可以空着。
5. **生成 build**（`scripts/build.mjs`）：`site/index.html`、`site/style.css`、`site/images/`。每个字段有看得见的标签、对的输入类型和 `autocomplete`，标签里写明必填还是选填；收集说明紧跟在字段后面，并用 `aria-describedby` 连到字段上；同意框永远不预先勾选；图片带宽和高，第一张优先加载，其余的懒加载；颜色达到 WCAG 的对比度；页面有语言、标题和搜索摘要（meta description）。
6. **检查 check**（`scripts/check.mjs`）：`check-report.md`，分两档，见下面的“检查”。

1. **brief** (person): `brief.md`. Selling points, where visitors come from (the line they saw before clicking), tone, must-have facts, proof (real customer quotes and how each person is tied to you), form and privacy (what you collect, who collects it, what for, how long, how to withdraw), and things not to say. The sample is a fictional product, "BoxNest".
2. **structure** (model, `prompts/structure.md`): `structure.json`. Blocks in the order hero, features, testimonial, faq, cta, with the testimonial only when the brief has a real quote. Each block has a purpose, key points, a suggested image file name and its text alternative (what a screen reader reads out). `form` sets which fields the form asks for and whether there is a consent box the visitor ticks themselves.
3. **copy** (model, `prompts/copy.md`): `copy.json`. Each block's heading, body and button text, plus the notice under the form (`note`) in the action block. Headings lead with what the visitor gets; buttons say the action and what happens, never "Submit" or "Learn more"; only facts from the brief, no invented numbers or reviews, and no "limited time" without a real deadline.
4. **photos** (person): `images/`, named after the structure. It can stay empty.
5. **build** (`scripts/build.mjs`): `site/index.html`, `site/style.css`, `site/images/`. Every field has a visible label, the right input type and an `autocomplete` token, and its label says required or optional; the notice comes right after the fields and is tied to them with `aria-describedby`; a consent box is never pre-ticked; images carry width and height, the first one loads first and the rest lazily; colors meet WCAG contrast; the page has a language, a title and a meta description.
6. **check** (`scripts/check.mjs`): `check-report.md` in two tiers; see "Check" below.

生成的页面用模板自己的 HTML 和 CSS：手机宽度、深色模式。用户写的文字都会转义。页面不加载网络上的脚本、样式、字体或图片；唯一可以指向别处的是隐私政策链接。

The page is the template's own HTML and CSS: phone width and dark mode. User text is escaped. The page loads no remote script, stylesheet, font or image; the only link that may point elsewhere is the privacy policy.

## 输入 / Inputs

| 输入 / Input | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `language` | `zh` | 结构、文案、页面固定文字和检查报告的语言：`zh` 或 `en` | Language of the structure, copy, fixed page text and the check report |
| `product` | （必填 / required） | 产品名称 | Product name |
| `audience` | （必填 / required） | 访问者是谁 | Who the visitor is |
| `goal` | （必填 / required） | 希望访问者做什么，例如留下邮箱 | What the visitor should do, for example leave an email |
| `privacyUrl` | 空 / empty | 隐私政策的网址。填了会接在收集说明后面；只接受 `http(s)` 链接 | Privacy policy URL, added after the notice under the form; only `http(s)` links are used |

## 怎么跑 / How to run

```bash
flowgit init ~/my-page -t landing-page
cd ~/my-page
# 示例简报是虚构的「箱栖」。换成你的产品时，改 brief.md，并改这三项。
# The sample brief is the fictional BoxNest. To use your product, edit brief.md and these three.
flowgit inputs set product=箱栖 audience=养猫的人 goal=留下邮箱
flowgit inputs set language=zh          # 或 en / or en
flowgit inputs set privacyUrl=https://example.com/privacy   # 可选 / optional
flowgit run all
```

没有 API key 时，用模板自带的固定回复。示例回复是中文，对应仓库里的 `brief.md`。

Without an API key, the bundled canned replies run the flow. The demo replies are in Chinese and match the shipped `brief.md`.

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

打开 `site/index.html` 即可看页面。

Open `site/index.html` to read the page.

## 照片 / Photos

把图片放进 `images/`，文件名用 `structure.json` 里的 `image`，例如 `hero.jpg`。`alt` 是这张图的替代文本：换了别的照片，就把它改成照片里真正有的东西。文件夹可以是空的，缺图的区块会显示「图片待补」、文件名和应该拍什么。用到的图片会复制到 `site/images/`。PNG、JPEG、GIF 和 WebP 会读出宽高写进页面，手机竖着拍的 JPEG 按转正后的方向算；其他格式不写宽高，检查会提醒。

Put images in `images/`, named after the `image` field in `structure.json`, for example `hero.jpg`. `alt` is the image's text alternative: if you use a different photo, change it to say what the photo really shows. The folder can be empty; a missing image shows "Image to add", the file name and what the photo should show. Images that were used are copied to `site/images/`. PNG, JPEG, GIF and WebP sizes are written into the page, with a rotated phone JPEG measured upright; other formats get no size, and the check reminds you.

## 检查 / Check

`check-report.md` 开头一句话给结论，然后分两档列出问题，最后用一张表列出每项检查、依据和结果。

**必须修**：有一项就让这一步失败，报告照样写出来。

- 图片没有替代文本（WCAG 1.1.1）
- 空链接（没有 `href`、`href=""` 或 `href="#"`）
- 标题跳级，例如 `h1` 后面直接是 `h3`，或者页面不从 `h1` 开始（W3C WAI 标题教程）
- 过长的区块：标题超过 80 个字符，或正文超过 500 个字符
- `copy.json` 里有、页面上没有的区块
- 页面没有语言或标题，或者 `lang` 和正文的语言对不上（WCAG 3.1.1、2.4.2）
- 输入框没有标签（WCAG 1.3.1、3.3.2）
- 邮箱或电话输入框没有对应的 `autocomplete`（WCAG 1.3.5）
- 预先勾选的框（欧盟法院 Planet49 案；GDPR 鉴于条款 32）
- 输入框旁边没有收集说明，或者说明里只有一个链接（GDPR 第 13 条、CCPA 条例 §7012、个人信息保护法第十七条）
- 文案里没写完的占位：「待补充」「待填」「To add:」「TODO」
- 颜色对比度：文字至少 4.5:1，输入框边框至少 3:1，浅色和深色模式都算（WCAG 1.4.3、1.4.11）

**上线前确认**：只提醒，因为要看脚本看不到的事实。没有隐私政策链接；还没放的图片；表单字段超过一个；含糊的按钮或链接文字；不通往表单的链接；简报里没有依据的紧迫感用语；绝对化用语；简报说不要写的话；推荐语里简报找不到的原话；简报和输入里没有的数字；缺少 meta description 或 viewport；图片没写宽高，或者第一张图被懒加载；`site/` 超过 1,600 KiB；页面没有表单或按钮。

`check-report.md` opens with a one-line verdict, lists problems in two tiers, and ends with a table of every check, the rule behind it and the result.

**Must fix**: any one of these fails the stage, and the report is still written.

- images missing alt text (WCAG 1.1.1)
- empty links (no `href`, `href=""` or `href="#"`)
- skipped heading levels, such as `h1` followed by `h3`, or a page that does not start at `h1` (W3C WAI headings tutorial)
- overly long blocks: a heading over 80 characters or a body over 500
- blocks present in `copy.json` but missing from the page
- no page language or title, or a `lang` that does not match the text (WCAG 3.1.1, 2.4.2)
- inputs without a label (WCAG 1.3.1, 3.3.2)
- email or phone inputs without the matching `autocomplete` (WCAG 1.3.5)
- pre-ticked boxes (CJEU Planet49; GDPR recital 32)
- inputs without a notice at collection next to them, or a notice that is only a link (GDPR art. 13, CCPA regulations § 7012, PIPL art. 17)
- unfinished placeholders in the copy: "待补充", "待填", "To add:", "TODO"
- color contrast: text at least 4.5:1 and input borders at least 3:1, in light and dark mode (WCAG 1.4.3, 1.4.11)

**Confirm before going live**: warnings only, because they depend on facts the script cannot see. No privacy policy link; images not added yet; more than one form field; vague button or link text; links that do not lead to the form; urgency the brief does not back up; absolute claims; words the brief rules out; testimonial quotes the brief does not contain; numbers found in neither the brief nor the inputs; a missing meta description or viewport; images without width and height, or a lazy-loaded first image; `site/` over 1,600 KiB; a page with no form or button.

## 表单不会发出任何东西 / The form sends nothing

生成的表单字段没有 `name`，提交时什么也不会发出去，也不会出现在网址或服务器日志里。接上你自己的表单服务时，给字段加上 `name`，把表单的 `action` 指向这个服务，并让收集说明和实际做法一致。要发营销邮件的话，各地规则不同：欧盟一般要先取得同意（ePrivacy 指令第 13 条，老客户买过的同类产品有例外，但每封都要能退订）；美国 CAN-SPAM 要求每封都能退订，并写上实际的邮寄地址；中国个人信息保护法要求先告知并取得同意（第十三、十四、十七条）。

The generated fields have no `name`, so submitting sends nothing, and nothing ends up in a URL or a server log. When you connect your own form service, add `name` to the fields, point the form's `action` at the service, and keep the notice true to what you actually do. If you will send marketing email, the rules differ by region: the EU generally needs consent first (ePrivacy Directive art. 13, with an exception for existing customers and similar products, and an unsubscribe in every email); the US CAN-SPAM Act needs an unsubscribe in every email and your physical postal address; China's PIPL needs notice and consent first (arts. 13, 14 and 17).

## 参考资料 / References

规则会变，上线前以官方原文为准。检查只做提醒，不能代替无障碍测试和法律意见。

Rules change; check the official texts before going live. The checks are reminders, not accessibility testing or legal advice.

**转化和版面 / Conversion and layout**

- NN/g：访问者 57% 的浏览时间停在首屏，所以最重要的内容和按钮放在首屏。[Scrolling and Attention](https://www.nngroup.com/articles/scrolling-and-attention/)。/ 57% of viewing time is spent above the fold, so the key content and button belong there.
- Unbounce：一页只有一个目标，可以点的东西和目标的比例是 1:1（注意力比例）；落地页的标题要和访问者点进来的广告或帖子说的一致（message match）。[Attention ratio](https://unbounce.com/conversion-centered-design/attention.html)、[Message match](https://unbounce.com/conversion-glossary/definition/message-match/)。/ One page, one goal, with a 1:1 attention ratio; the headline matches the ad or post the visitor clicked.
- NN/g：人们扫读时只看开头两个词，链接和按钮要说清点了会怎样，不要只写“了解更多”。[First 2 Words](https://www.nngroup.com/articles/first-2-words-a-signal-for-scanning/)、[“Learn More” Links](https://www.nngroup.com/articles/learn-more-links/)、[Better Link Labels](https://www.nngroup.com/articles/better-link-labels/)。/ People scan the first two words; labels should say what happens.
- NN/g：社会认同要真实、具体，并说明是谁说的，才可信。[Social Proof in the User Experience](https://www.nngroup.com/articles/social-proof-ux/)。/ Social proof works when it is real, specific and attributed.
- Google 搜索中心：meta description 可能被用作搜索结果里的摘要，要概括这一页。[Snippets](https://developers.google.com/search/docs/appearance/snippet)。/ The meta description may become the search snippet.

**速度 / Performance**

- web.dev：图片写上 width 和 height，避免加载时布局跳动（CLS）；Core Web Vitals 的及格线是 LCP ≤ 2.5 秒、INP ≤ 200 毫秒、CLS ≤ 0.1；首屏的大图不要懒加载，可以加 `fetchpriority="high"`。[Optimize CLS](https://web.dev/articles/optimize-cls)、[Web Vitals](https://web.dev/articles/vitals)、[Lazy loading and LCP](https://web.dev/articles/lcp-lazy-loading)、[Fetch Priority](https://web.dev/articles/fetch-priority)。/ Width and height prevent layout shift; the Core Web Vitals thresholds; do not lazy-load the main image, and raise its priority.
- Lighthouse：整页传输量最好在 1,600 KiB 以内。[Avoid enormous network payloads](https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight)。/ Keep the total page weight under 1,600 KiB.

**表单 / Forms**

- Baymard：必填和选填都要标出来；结账表单平均 11.3 个字段，其实 8 个就够，多出来的字段会让人放弃。[Required and optional fields](https://baymard.com/blog/required-optional-form-fields)、[Checkout form fields](https://baymard.com/research-articles/checkout-flow-average-form-fields)。/ Mark both required and optional fields; extra fields cost completions.
- W3C WAI：每个输入框都要有看得见的标签，用 `for` 和 `id` 关联；技术 H90：必填的提示写在标签里。[Labeling Controls](https://www.w3.org/WAI/tutorials/forms/labels/)、[H90](https://www.w3.org/WAI/WCAG22/Techniques/html/H90)。/ Visible labels tied with `for`/`id`; the required marker inside the label.

**无障碍 / Accessibility**

- WCAG 2.2（W3C 推荐标准）：1.1.1 替代文本；1.3.1 信息和关系；1.3.5 输入用途（`autocomplete`）；1.4.3 文字对比度 4.5:1；1.4.11 非文字对比度 3:1；2.4.2 页面标题；2.4.4 链接目的；2.5.8 点按目标至少 24×24 CSS 像素；3.1.1 页面语言；3.3.2 标签或说明。[WCAG 2.2](https://www.w3.org/TR/WCAG22/)、[1.3.5](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html)、[1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)、[2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)。/ The WCAG 2.2 success criteria the build and check follow.
- W3C WAI 教程：标题不要跳级；替代文本按图片的用途来写。[Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)、[An alt Decision Tree](https://www.w3.org/WAI/tutorials/images/decision-tree/)。/ Don't skip heading ranks; write alt text for the image's purpose.
- 欧盟《欧洲无障碍法》（EAA）：2025 年 6 月 28 日起适用，电子商务服务在范围内，微型企业提供的服务除外。[欧盟委员会](https://digital-strategy.ec.europa.eu/en/news/eu-becomes-more-accessible-all)、[EUR-Lex 摘要](https://eur-lex.europa.eu/EN/legal-content/summary/accessibility-of-products-and-services.html)。/ The European Accessibility Act applies from 28 June 2025, including e-commerce; microenterprises providing services are exempt.
- 美国司法部关于网页无障碍和 ADA 的指引。[ADA.gov](https://www.ada.gov/resources/web-guidance/)。/ US DOJ guidance on web accessibility and the ADA.
- 《中华人民共和国无障碍环境建设法》2023 年 9 月 1 日起施行，鼓励生活购物等领域的网站逐步符合无障碍标准。[中国政府网](https://www.gov.cn/zhengce/202308/content_6899649.htm)、[司法部](https://www.moj.gov.cn/pub/sfbgw/fzgz/fzgzxzlf/fzgzlfgz/202306/t20230629_481613.html)。/ China's Barrier-Free Environment Construction Law (in force 1 September 2023) encourages shopping and other sites to meet the accessibility standards.

**隐私和同意 / Privacy and consent**

- GDPR 第 13 条：收集时告知控制者的身份和联系方式、目的、保存期限、撤回同意等权利；第 5 条第 1 款 c 项：数据最小化；第 4 条第 11 款、第 7 条和鉴于条款 32：同意必须是主动做出的，沉默和预先勾选的框都不算。[第 13 条](https://gdpr-info.eu/art-13-gdpr/)、[GDPR 原文](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)。/ Information at collection, data minimisation, and consent as a clear affirmative act.
- 欧盟法院 Planet49 案（C-673/17，2019）：预先勾选的框不是有效的同意。[新闻稿](https://curia.europa.eu/site/upload/docs/application/pdf/2019-10/cp190125en.pdf)。/ A pre-ticked box is not valid consent.
- 欧盟数据保护机构的透明度指引（WP260 rev.01）：可以分层告知，第一层要说清目的、控制者是谁和访问者的权利。[指引 PDF](https://www.edpb.europa.eu/system/files/documents/2023-09/wp260rev01_en.pdf)。/ Layered notices; the first layer names the purposes, the controller and the rights.
- 欧盟 ePrivacy 指令第 13 条：营销邮件一般要先取得同意。[EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32002L0058)。/ Prior consent for marketing email, with the existing-customer exception.
- 加州 CCPA 条例 §7012：在收集时或收集前告知收集哪些信息、做什么用、会不会出售或共享、保存多久，并链接到隐私政策。[CPPA 条例 PDF](https://cppa.ca.gov/regulations/pdf/20230329_final_regs_text.pdf)。/ The notice at collection.
- 美国 FTC 的 CAN-SPAM 指南：每封营销邮件都要能退订，并写上实际的邮寄地址。[FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)。/ CAN-SPAM: an unsubscribe and a postal address in every marketing email.
- 《个人信息保护法》第六条（最小必要）、第十四条（同意要自愿、明确）、第十五条（可以撤回同意）、第十七条（告知处理者名称和联系方式、目的、种类、保存期限和行使权利的方式）、第十九条（保存期限取实现目的所需的最短时间）。[国家网信办](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)。/ PIPL arts. 6, 14, 15, 17 and 19.

**评价、紧迫感和说法 / Reviews, urgency and claims**

- 美国 FTC 禁止虚假评价和推荐的规则（16 CFR 465），2024 年 10 月 21 日生效。[FTC 公告](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)。/ The FTC rule banning fake reviews and testimonials.
- FTC《背书指南》问答：评价的人免费拿到了产品、是员工或亲友时，要写明这层关系。[What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)。/ Disclose material connections such as a free product.
- FTC 暗黑模式报告（2022）：虚假的倒计时和“仅剩几件”会误导消费者。[报告 PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf)。/ Fake countdowns and false scarcity.
- FTC 广告证据政策：客观的说法在发布前就要有合理依据。[Policy Statement](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation)。/ Objective claims need a reasonable basis before they run.
- 欧盟《不公平商业行为指令》附件一第 7 项：谎称只在很短时间内有货或有这个条件；第 23b、23c 项（由 2019/2161 号指令加入）：没核实就说评价来自真实买家，发布或委托别人发布虚假评价。[指令 2005/29](https://eur-lex.europa.eu/eli/dir/2005/29/oj/eng)、[指令 2019/2161](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A32019L2161)、[委员会指引](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A52021XC1229%2805%29)。/ UCPD annex I no. 7 (false limited time) and nos. 23b and 23c (reviews).
- 《广告法》第九条（不得使用“国家级”“最高级”“最佳”等用语）、第二十八条（虚构使用效果、用无法验证的引用语作证明的，属于虚假广告）、第三十八条（代言人要用过商品）。[北京市市场监管局](https://scjgj.beijing.gov.cn/cxfw/flfgcxfw/ggl/202204/t20220401_2646388.html)。/ China's Advertising Law, arts. 9, 28 and 38.
- 《网络反不正当竞争暂行规定》第九条：不得用编造用户评价等方式虚假宣传，2024 年 9 月 1 日起施行。[中国政府网](https://www.gov.cn/zhengce/202406/content_6959668.htm)。/ China's interim rules against online unfair competition, art. 9 (fabricated reviews).
