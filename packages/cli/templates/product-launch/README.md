# 新品发布物料包 / Product launch kit

从一份产品资料做出一次发布要用的全部物料：定位和信息、发布计划和时间表、媒体资料、新闻稿、发布邮件、Product Hunt 文案、X 和 LinkedIn 帖子、常见问题，以及一个落地页。所有物料用同一句发布标题、同一份事实；最后一步把每条说法、数字和原话对回资料，并查邮件的退订和地址、各平台的字数、绝对化用语和紧迫感。

Every asset a launch needs, from one product fact file: positioning and messaging, a launch plan and timeline, a fact sheet, a press release, a launch email, the Product Hunt listing, X and LinkedIn posts, an FAQ, and a landing page. Every asset leads with the same headline and rests on the same facts; the last step checks each claim, number and quote against the facts, along with the email's unsubscribe and address, each platform's length limits, absolute claims and urgency.

示例是虚构的「拍小票」：虚构的小店记账 App「店小算」的新功能，拍一张纸质小票，金额、日期和商家就记进账本。2026 年 12 月 1 日上午 9 点（上海时间）公开发布，新闻稿先禁发给记者。公司、人和数字都是编的。

The sample is a fictional feature, ShopTally Snap, in a fictional bookkeeping app for small shops, ShopTally: snap a paper receipt and the amount, date and vendor go into the books. It launches at 9 a.m. Shanghai time on Dec. 1, 2026, with the press release sent to reporters under embargo first. The company, the people and the numbers are invented.

## 阶段 / Stages

1. **产品资料 facts**（你）：`materials/facts.md`。产品是什么（有英文名就写上）、给谁、他们现在怎么做、只有它有的、卖点、价格和购买方式、语气、必须写上的事实、证据（客户原话要对方同意，并写明和你的关系）、发言人、公司简介和电头城市、媒体联系人、发件信息（发件人、地址、谁同意了接收、怎么退订）、表单和隐私、不要说的话。后面的阶段和落地页按这些标题找内容，标题照原样留着。
2. **定位和信息 messaging**（模型）：`messaging.json`。按 April Dunford 的五个部分一步推一步：现在的替代做法 → 只有它有的特点 → 带来的价值 → 最在乎的客户 → 市场类别，再写一段内部用的定位。然后是所有物料共用的发布标题（60 个字符以内）、副标题、正好三条信息支柱（每条带资料原文作证据）、关于公司的一段、发布分级（一、二、三级）和每一条事实说法的出处（照抄资料原文）。
3. **发布计划和媒体资料 plan**（脚本）：`launch-plan.md` 和 `fact-sheet.md`。按发布日期、时间、时区和分级排时间表：提前一个月定稿信息、在 Product Hunt 排期；禁发时提前两周发给记者；提前一周邮件定稿、内部问答发给客服和销售；发布当天；Product Hunt 在太平洋时间 0:01 上线，换算成你的时区；发布后 48 小时（Gmail）和 10 个工作日（CAN-SPAM）的退订期限；两周后复盘。每一行写依据，没有出处的写「模板建议」。媒体资料写新闻稿第一行（即时发布，或禁发到哪天几点、哪个时区）、电头、价格、关键事实、关于公司、发言人、媒体联系人和要准备的图。
4. **新闻稿 press**（模型）：`press-release.md`。倒金字塔：第一行、标题（70 个字符以内）、副标题、电头加导语（谁、发布了什么、什么时候、在哪能用、为什么要紧）、正文、发言人引语、客户原话（一字不改，写明关系）、价格和购买方式、关于公司（照抄）、媒体联系人。英文 300 到 500 个词。
5. **发布邮件 email**（模型）：`email.md`。主题（60 个字符以内）、预览文字（150 个字符以内）、几段短正文、一个按钮，页脚写为什么收到、发件人和地址、怎么退订。
6. **Product Hunt 和社交帖子 posts**（模型）：`posts.json`。Product Hunt 只收英文：名称（只写产品名）、标语（60 个字符以内）、简介（260 个字符以内）、maker 的第一条评论；输出语言是中文时另附一份中文对照。X 一条（加权 280 以内），LinkedIn 一条（3000 个字符以内）。不请人点赞。
7. **常见问题 faq**（模型）：`faq.md`。对外 6 到 10 个，给客服和销售的内部问答 5 到 8 个（包括准确率、和别人比、退款、删数据、下一步这类难回答的）。资料里没有答案的标「【待确认】」。
8. **落地页简报 landing-brief**（脚本）：`subflows/landing-page/brief.md`。从资料里取落地页要的几节，再写上「访问者从哪里来」：这次发布的物料都用同一句发布标题，页面开头接住它。
9. **落地页 landing**（子流程）：运行 `subflows/landing-page`，把 `site/` 和它的检查报告 `landing-check.md` 复制回来。见下一节。
10. **汇总 kit**（脚本）：`launch-kit.md`。发布当天要复制粘贴的都在这里：关键时间、Product Hunt 的每一栏（带字数）、X 和 LinkedIn 帖子（带字数）、邮件的主题和预览文字，以及每份物料在哪。
11. **检查 check**（脚本）：`check-report.md`。新闻稿第一行和电头对不对得上媒体资料；和发布日期不一样的日期、星期；新闻稿的标题长度、字数、关于公司是不是原文、媒体联系人有没有邮箱或电话、发言人引语有没有写职位；邮件主题长度、装成回信的主题、预览文字、按钮个数、页脚的发件人、地址和退订；Product Hunt 的长度、汉字和名称；X 和 LinkedIn 的长度；请人点赞；发布标题的长度；每条说法的出处；资料里没有的数字、网址和邮箱；客户原话和关系；绝对化用语；要有证据的说法；紧迫感；资料说不要写的话；待确认的回答；占位符；落地页检查的结论和页面主标题是否接住发布标题。只提醒，不拦；`messaging.json` 或 `posts.json` 的形状不对才停下。报告最后列出脚本看不到、发布前要人确认的事。

1. **facts** (you): `materials/facts.md`. What it is (with its English name if it has one), who it is for, what they do today, what only it has, selling points, price and availability, tone, must-have facts, proof (customer quotes only with permission, saying how the person is tied to you), the spokesperson, the company and its dateline city, the media contact, sender details (sender, postal address, who agreed to hear from you, how to unsubscribe), form and privacy, and what not to say. Later stages and the landing page find content by these headings, so keep them.
2. **messaging** (model): `messaging.json`. April Dunford's five components, each leading to the next: competitive alternatives → unique attributes → value → best-fit customers → market category, then an internal positioning statement. Then the launch headline every asset shares (60 characters or fewer), a subhead, exactly three message pillars (each with a line from the facts as proof), the boilerplate, a launch tier (1, 2 or 3), and the source of every factual claim (copied from the facts).
3. **plan** (script): `launch-plan.md` and `fact-sheet.md`. A timeline from the launch date, time, time zone and tier: lock the messaging and schedule Product Hunt a month out; send the press release under embargo two weeks out; finish the email and brief support and sales a week out; launch day; Product Hunt live at 12:01 a.m. Pacific, converted to your zone; the 48-hour (Gmail) and 10-business-day (CAN-SPAM) unsubscribe deadlines; a review two weeks later. Each row names its basis, or "template suggestion" when it has none. The fact sheet gives the release line (immediate, or embargoed until a date, time and zone), the dateline, price, key facts, the boilerplate, the spokesperson, the media contact and the images to prepare.
4. **press** (model): `press-release.md`. An inverted pyramid: the release line, a headline of 70 characters or fewer, a subhead, the dateline and lede (who, what, when, where, why it matters), body, a spokesperson quote, a customer quote (word for word, with the tie disclosed), price and availability, the boilerplate (copied) and the media contact. 300 to 500 words in English.
5. **email** (model): `email.md`. A subject of 60 characters or fewer, preview text of 150 or fewer, a few short paragraphs, one button, and a footer saying why they got it, the sender and postal address, and how to unsubscribe.
6. **posts** (model): `posts.json`. Product Hunt takes English only: the name (just the product name), a tagline of 60 characters or fewer, a description of 260 or fewer, and the maker's first comment, with a Chinese translation alongside when the output language is Chinese. One X post (280 weighted) and one LinkedIn post (3,000 characters). No asking for upvotes.
7. **faq** (model): `faq.md`. 6 to 10 public questions, and 5 to 8 internal ones for support and sales (the hard ones too: accuracy, comparisons, refunds, deleting data, what comes next). Answers the facts can't give are marked "[To confirm]".
8. **landing-brief** (script): `subflows/landing-page/brief.md`. The sections a landing page needs, taken from the facts, plus "Where visitors come from": every asset in this launch leads with the same headline, and the top of the page picks it up.
9. **landing** (sub-flow): runs `subflows/landing-page` and copies `site/` and its check report, `landing-check.md`, back. See the next section.
10. **kit** (script): `launch-kit.md`. Everything to copy and paste on launch day: the key times, each Product Hunt field (with its length), the X and LinkedIn posts (with their lengths), the email's subject and preview text, and where every asset is.
11. **check** (script): `check-report.md`. Whether the press release's first line and dateline match the fact sheet; dates and weekdays that differ from the launch date; the press release's headline length, word count, boilerplate (word for word), media contact (an email or phone) and the spokesperson's title; the email's subject length, subjects posing as replies, preview text, number of buttons, and the footer's sender, address and unsubscribe; Product Hunt's lengths, Chinese characters and name; X and LinkedIn length; asking for upvotes; the launch headline's length; the source of every claim; numbers, URLs and email addresses not in the facts; customer quotes and their ties; absolute claims; claims that need proof; urgency; things the facts rule out; answers to confirm; placeholders; the landing page check's verdict and whether the page's main heading picks up the launch headline. Warnings only; a wrongly shaped `messaging.json` or `posts.json` stops the stage. The report ends with what the script can't see and a person confirms before launch.

`rules.md` 里是检查和汇总用的数字和词表（JSON 块），改上限或词表就改那里。

The numbers and word lists the check and the kit use are the JSON block in `rules.md`; change limits or lists there.

## 落地页子流程 / The landing page sub-flow

`subflows/landing-page/` 是自带的 `landing-page` 模板的一份拷贝（提示词和脚本一样，有测试保证两份不走样）：结构 → 文案 → 照片 → 生成 → 检查。它的简报由「落地页简报」阶段从产品资料写出来，不用另外维护；照片放进 `subflows/landing-page/images/`，文件名见那里的 `structure.json`，没有照片也能生成。子流程把自己的运行记录留在 `subflows/landing-page/runs/`。落地页检查里「必须修」的问题（比如缺替代文本、对比度不够）会让「落地页」这一步失败，和单独用 `landing-page` 模板时一样；「上线前确认」只提醒。

`subflows/landing-page/` is a copy of the bundled `landing-page` template (same prompts and scripts, kept identical by a test): structure → copy → photos → build → check. The landing-brief stage writes its brief from the fact file, so there is nothing else to keep up to date. Put photos in `subflows/landing-page/images/`, named from `structure.json` there; the page builds without them. The sub-flow keeps its own run history in `subflows/landing-page/runs/`. A "must fix" issue in the landing check (missing alt text, low contrast and so on) fails the landing stage, as it does in the `landing-page` template; "confirm before going live" items are warnings.

## 怎么跑 / How to run

```bash
flowgit init ~/my-launch -t product-launch
cd ~/my-launch
# 把 materials/facts.md 换成你的产品资料，或先用示例 / replace materials/facts.md, or try the sample first
flowgit inputs set "product=拍小票" "audience=开小店的人" "goal=留下邮箱，收到下载链接" launchDate=2026-12-01 embargo=true
# 发布时间和时区默认是 09:00、Asia/Shanghai / the launch time and zone default to 09:00, Asia/Shanghai
# flowgit inputs set launchTime=10:00 timezone=America/New_York
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一份：

Without an API key, the canned replies run the flow. Chinese and English each have a directory:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
# 英文示例 / English sample:
# flowgit inputs set language=en "product=ShopTally Snap" "audience=owners of small shops" "goal=leave an email to get the download link"
# FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
```

固定回复里，常见问题故意留了三个资料答不了的内部问题（退款、删数据、以后的计划），检查会列出来；示例没有照片，也没填隐私政策网址，落地页检查会提醒这两件事。

In the canned replies, the FAQ leaves three internal questions the facts can't answer (refunds, deleting data, future plans) on purpose, and the check lists them; the sample has no photos and no privacy policy URL, and the landing page check flags both.

## 隐私 / Privacy

产品资料里有客户的名字和原话、发言人和媒体联系人。客户原话要先征得本人同意，写明和你的关系；发言人的引语是起草的，发之前请本人确认。分享这个流程之前，先自己通读 `materials/facts.md` 和生成的物料，再运行 `flowgit share`。

The fact file holds customers' names and words, the spokesperson and the media contact. Quote customers only with their permission and say how they are tied to you; the spokesperson's quote is a draft that person approves before it goes out. Before you share this flow, read `materials/facts.md` and the generated assets yourself, then run `flowgit share`.

## 规则 / Rules

下面每条都对应文末的一条依据。

Each rule below maps to an entry under Sources.

1. 先定位，再写文案：按 April Dunford 的五个部分一步推一步，只用资料里的替代做法和特点；定位不是填空题，五个部分要互相对得上。依据：April Dunford《A Quickstart Guide to Positioning》《An Introduction to Positioning》。
2. 所有物料用同一句发布标题：新闻稿、邮件、帖子和落地页开头说的是同一件事，从邮件或帖子点进落地页的人一眼认得出来（message match）。依据：Unbounce《Message match》。
3. 发布分级决定做哪些物料：一级是新产品、新市场或方向的大变化，全套物料加媒体；二级是影响很多用户的功能，网页、邮件、帖子这些基本的；三级是小改进，告诉现有用户就够。依据：Product Marketing Alliance 和 Adobe、Aircall 的发布分级访谈。
4. 每条事实说法都要在资料里找得到出处；客观的说法在发布前就要有证据；「首款」「唯一」「100%」拿不出证据就不写；中国广告不能用「国家级」「最高级」「最佳」这类绝对化用语。依据：FTC《广告证据政策声明》；《广告法》第九条第（三）项；市场监管总局《广告绝对化用语执法指南》。
5. 不制造紧迫感：没有真实的截止日期或库存，就不写「限时」「仅剩」。依据：欧盟《不公平商业行为指令》附件一第 7 项和欧盟委员会的指引；FTC 暗黑模式报告。
6. 客户原话只用真实的、对方同意引用的，一字不改，写明对方和你的关系（例如免费试用）；不编客户的话。依据：FTC《背书指南》问答；FTC 禁止虚假评价和推荐的规则（16 CFR 465）；《广告法》第二十八条。
7. 新闻稿：第一行写「即时发布」，或「禁发至」日期、时间和时区；标题 70 个字符以内；电头放在第一段开头（英文城市名大写，后接破折号）；导语交代谁、什么、什么时候、在哪、为什么；倒金字塔；一段发言人引语、一段客户原话、怎么用上；关于公司约 100 个词，放在结尾、媒体联系人之前；媒体联系人要有邮箱或电话；全文 300 到 500 个词。中文电头按同样的位置写成「城市，日期——」，中文长度按英文换算，这两点是模板的做法。依据：PR Newswire《How to Write a Press Release》《What Is a Press Release Boilerplate?》《How to Write an AP Style Press Release》《How to Use Embargos & Exclusives in PR》《How to Write, Translate and Distribute International Press Releases》；Business Wire 新闻稿模板；Amazon《Working Backwards PR/FAQ》（Amazon 内部写的 PR/FAQ 用设想的客户原话，公开的新闻稿只用真实的）。
8. 发布邮件只发给同意接收的人；写明发件人的真实身份、有效的邮寄地址和简单、免费的退订方式；退订在 10 个工作日内生效（CAN-SPAM），Gmail 要求 48 小时内处理；每天给 Gmail 发 5000 封以上的营销邮件要支持一键退订（List-Unsubscribe，RFC 8058）；主题不能误导人。依据：《广告法》第四十三条；FTC《CAN-SPAM Act: A Compliance Guide for Business》；英国 ICO《Electronic mail marketing》；Gmail《Email sender guidelines》及其问答、《Email subscription guidelines for senders》。
9. 邮件主题建议 60 个字符以内，预览文字最多 150 个字符，用来补充主题没说的。依据：Mailchimp《Create a Regular Email》。
10. Product Hunt：文案只收英文；名称只写产品名，不加描述和表情；标语最多 60 个字符；简介最多 260 个字符（另一页写 500，模板按更严的 260）；太平洋时间 0:01 上线，最多提前一个月排期；maker 上线后马上发第一条评论（拿到当日、当周、当月产品的有七成都有）；缩略图 240×240、3 MB 以内，图集至少 2 张 1270×760；不请人点赞。依据：Product Hunt《Launch Guide》《Prepare for your Product Hunt launch》《How to Post: Media》《Sharing your launch》、社区准则、帮助中心问答和《Why was my comment or post removed?》。
11. X 一条按 twitter-text v3 加权不超过 280（汉字算 2，网址算 23）；LinkedIn 一条最多 3000 个字符。依据：X 开发者文档《Counting characters》和 twitter-text v3 配置；LinkedIn 帮助中心。
12. 检查只提醒，好让人自己通读和判断；只有 `messaging.json` 或 `posts.json` 的形状不对才停下。落地页子流程沿用 `landing-page` 模板的规则，「必须修」会让那一步失败。

1. Position before you write: April Dunford's five components, each leading to the next, using only the alternatives and attributes in the facts; positioning is not a fill-in-the-blanks statement, and the five parts have to agree. Sources: April Dunford, "A Quickstart Guide to Positioning" and "An Introduction to Positioning".
2. One launch headline across every asset: the press release, email, posts and landing page lead with the same promise, so someone who clicks through from the email or a post recognizes the page (message match). Source: Unbounce, "Message match".
3. The launch tier decides the assets: tier 1 is a new product, a new market or a big change of direction, with every asset plus press; tier 2 is a feature that matters to many users, with the basics (a web page, email, posts); tier 3 is a small improvement, enough to tell current users. Sources: Product Marketing Alliance interviews with Adobe and Aircall on launch tiers.
4. Every factual claim has its source in the facts; objective claims need proof before they run; "world's first", "the only" or "100%" stay out without proof; ads in China can't use absolute terms such as 国家级, 最高级 or 最佳. Sources: FTC Policy Statement Regarding Advertising Substantiation; China's Advertising Law art. 9(3); SAMR's enforcement guide on absolute terms.
5. No false urgency: no "limited time" or "only a few left" without a real deadline or stock level. Sources: EU Unfair Commercial Practices Directive annex I point 7 and the Commission's guidance; FTC dark patterns report.
6. Customer quotes are real, used with permission, word for word, with the person's tie to you (such as free use) disclosed; never invent a customer's words. Sources: FTC, "Endorsement Guides: What People Are Asking"; the FTC rule banning fake reviews and testimonials (16 CFR 465); China's Advertising Law art. 28.
7. The press release: the first line is "FOR IMMEDIATE RELEASE" or "EMBARGOED UNTIL" a date, time and time zone; a headline of 70 characters or fewer; the dateline at the start of the first paragraph (the city in capitals in English, then a dash); a lede with who, what, when, where and why; an inverted pyramid; a spokesperson quote, a customer quote and how to get it; a boilerplate of about 100 words at the end, before the media contact; a media contact with an email or phone; 300 to 500 words. The Chinese dateline in the same place as "城市，日期——" and the Chinese length converted from English are the template's own choices. Sources: PR Newswire, "How to Write a Press Release", "What Is a Press Release Boilerplate?", "How to Write an AP Style Press Release", "How to Use Embargos & Exclusives in PR" and "How to Write, Translate and Distribute International Press Releases"; Business Wire's press release template; Amazon's Working Backwards PR/FAQ (Amazon's internal PR/FAQ uses an imagined customer quote; a published release uses only a real one).
8. The launch email goes only to people who agreed to it; it gives the sender's real identity, a valid postal address and a simple, free way to unsubscribe; opt-outs take effect within 10 business days (CAN-SPAM), and Gmail asks for 48 hours; marketing mail to Gmail at 5,000 or more a day supports one-click unsubscribe (List-Unsubscribe, RFC 8058); the subject line can't mislead. Sources: China's Advertising Law art. 43; FTC, "CAN-SPAM Act: A Compliance Guide for Business"; UK ICO, "Electronic mail marketing"; Gmail, "Email sender guidelines" and its FAQ, and "Email subscription guidelines for senders".
9. An email subject of 60 characters or fewer is recommended, and preview text runs to 150 characters, adding what the subject doesn't say. Source: Mailchimp, "Create a Regular Email".
10. Product Hunt: the listing is English only; the name is just the product's name, with no description or emoji; a tagline of at most 60 characters; a description of at most 260 (another page says 500; the template uses the stricter 260); live at 12:01 a.m. Pacific, scheduled up to a month ahead; the maker's first comment posted right away (70% of Product of the Day, Week or Month winners had one); a 240 × 240 thumbnail under 3 MB and at least two 1270 × 760 gallery images; never ask for upvotes. Sources: Product Hunt, "Launch Guide", "Prepare for your Product Hunt launch", "How to Post: Media", "Sharing your launch", the Community Guidelines, the help center answer on asking for upvotes, and "Why was my comment or post removed?".
11. An X post weighs at most 280 under twitter-text v3 (a Han character counts 2, a URL 23); a LinkedIn post is at most 3,000 characters. Sources: X developer docs, "Counting characters", and the twitter-text v3 config; LinkedIn Help.
12. The checks only warn, so a person still reads and decides; only a wrongly shaped `messaging.json` or `posts.json` stops a stage. The landing page sub-flow keeps the `landing-page` template's rules, where a "must fix" fails that stage.

## 依据 / Sources

- April Dunford,《A Quickstart Guide to Positioning》：定位从「如果没有你的产品，客户会怎么做」开始，依次是替代做法、独有的特点、这些特点带来的价值、最在乎这些价值的客户、让价值一看就懂的市场类别。[链接](https://www.aprildunford.com/post/a-quickstart-guide-to-positioning)。/ Start from what customers would do without you, then unique attributes, the value they enable, the customers who care most, and the market category that makes the value obvious.
- April Dunford,《An Introduction to Positioning》：五个部分互相关联，定位不是一句填空的陈述。[链接](https://www.aprildunford.com/post/an-introduction-to-positioning)。/ The five components depend on each other; positioning is not a fill-in-the-blank statement.
- Unbounce,《Message match》：落地页的标题要和访问者点进来的广告或链接说的一致。[链接](https://unbounce.com/conversion-glossary/definition/message-match/)。/ The landing page headline matches the ad or link the visitor clicked.
- Product Marketing Alliance,《Product launches at big and small companies: Q&A with Adobe》：一级是希望所有人都在谈的重要产品，有活动、视频和媒体；二级影响很多客户，用博客、网页和销售资料这些基本的；三级多是只影响一小部分客户的升级，一篇博客加内部通知。[链接](https://www.productmarketingalliance.com/product-launches-at-big-and-small-companies-q-a-with-adobe/)。/ Tier 1: strategic launches with events, video and press; tier 2: many customers, the basics; tier 3: upgrades for a subset of customers, a blog post and an internal heads-up.
- Product Marketing Alliance,《How Aircall aligns PMM and enablement for revenue impact》：一级是带来新收入、要全套赋能的发布。[链接](https://www.productmarketingalliance.com/how-aircall-aligns-pmm-and-sales-enablement-for-revenue-impact/)。/ Tier 1 launches drive new revenue and get the full enablement treatment.
- 美国联邦贸易委员会（FTC）,《FTC Policy Statement Regarding Advertising Substantiation》：客观的说法默示广告主有合理依据，发布前没有依据就违反《FTC 法》第 5 条。[链接](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation)。/ Objective claims imply a reasonable basis, which the advertiser must have before the ad runs.
- 《中华人民共和国广告法》（中国政府网）第九条第（三）项：不得使用「国家级」「最高级」「最佳」等用语。[链接](https://www.gov.cn/zhengce/2015-04/25/content_2853642.htm)。/ China's Advertising Law art. 9(3): no 国家级, 最高级, 最佳 and similar terms.
- 国家市场监督管理总局《广告绝对化用语执法指南》（2023 年第 6 号公告）：绝对化用语包括「国家级」「最高级」「最佳」以及含义相同或者近似的用语。[链接](https://www.samr.gov.cn/ggjgs/tzgg/art/2023/art_183b5cb48d9e4f0dba67f9f912a913ba.html)。/ SAMR's enforcement guide: absolute terms include those three and terms of the same or similar meaning.
- 欧盟《不公平商业行为指令》（2005/29/EC）附件一第 7 项：谎称产品只在很短时间内供应或只在很短时间内有这个条件，在任何情况下都属不公平；欧盟委员会 2021 年的指引举了虚假倒计时和「库存有限」的例子。[指令](https://eur-lex.europa.eu/eli/dir/2005/29/oj/eng)；[委员会指引](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A52021XC1229%2805%29)。/ UCPD annex I point 7, with the Commission's 2021 guidance on fake timers and limited-stock claims.
- FTC,《Bringing Dark Patterns to Light》（2022）：虚假的倒计时和「仅剩几件」会误导消费者。[报告 PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf)。/ Fake countdowns and false scarcity mislead consumers.
- FTC,《FTC's Endorsement Guides: What People Are Asking》：推荐的人免费拿到产品、是员工或亲友时，要写明这层关系。[链接](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)。/ Disclose material connections such as a free product, employment or family ties.
- FTC,《Federal Trade Commission Announces Final Rule Banning Fake Reviews and Testimonials》（16 CFR 465，2024 年 10 月 21 日生效）。[链接](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)。/ The FTC rule banning fake reviews and testimonials.
- 《广告法》第二十八条（虚构使用商品的效果、用无法验证的引用语作证明的，属于虚假广告）。[北京市市场监督管理局](https://scjgj.beijing.gov.cn/cxfw/flfgcxfw/ggl/202204/t20220401_2646388.html)。/ China's Advertising Law art. 28: invented effects and unverifiable quotes make an ad false.
- PR Newswire,《How to Write a Press Release: Tips and Best Practices》：全文 300 到 500 个词；标题 70 个字符左右，最重要的词放在前 55 到 70 个字符里，那是多数搜索引擎和邮箱截断的地方；导语交代五个 W。[链接](https://www.prnewswire.com/resources/articles/how-to-write-a-press-release-tips-and-best-practices/)。/ 300 to 500 words; a headline of about 70 characters, with the key words in the first 55 to 70, where most search engines and inboxes cut off; a lede with the five Ws.
- PR Newswire,《What Is a Press Release Boilerplate?》：关于公司的一段 100 个词左右，每篇新闻稿都用同一段。[链接](https://www.prnewswire.com/resources/articles/press-release-boilerplate/)。/ About 100 words, the same text in every release.
- PR Newswire,《How to Write an AP Style Press Release》：电头放在第一段开头，城市名全部大写，不太知名的城市加州名缩写，后接破折号；关于公司的一段通常在结尾、媒体联系人之前。[链接](https://www.prnewswire.com/resources/articles/ap-style-press-release/)。/ The dateline starts the lead paragraph, the city in capitals (with a state abbreviation for a less-known one), followed by a dash; the boilerplate usually sits at the end, before the media contact.
- PR Newswire,《How to Use Embargos & Exclusives in PR》：没有时区的时间没有意义，禁发要写清日期、时间和时区。[链接](https://www.prnewswire.com/resources/articles/embargoes-exclusives-in-pr/)。/ A time without a time zone means nothing; label the embargo's date, time and zone.
- PR Newswire,《How to Write, Translate and Distribute International Press Releases》：国际发布用一个城市作电头，按当地的新闻节奏和节假日安排时间，翻译要带上语境。[链接](https://www.prnewswire.com/resources/articles/international-press-release-best-practices/)。/ One city in the dateline, timing around local news cycles and holidays, translation with context.
- Business Wire,《Free Press Release Template: Enter Your Information》：媒体联系人要有邮箱或电话。[链接](https://www.businesswire.com/resources-education/guides/press-release-template)。/ The media contact needs an email address or phone number.
- Working Backwards,《The Amazon Working Backwards PR/FAQ Process》：新闻稿的标题让目标客户看懂产品，副标题说清客户和好处；一段公司发言人引语、一段客户引语，然后是怎么开始用。[链接](https://workingbackwards.com/concepts/working-backwards-pr-faq-process/)。/ A heading customers understand, a subheading naming the customer and benefit, one spokesperson quote, one customer quote, then how to get started.
- 《中华人民共和国广告法》（中国政府网，2021 年修正）第四十三条：未经当事人同意或者请求，不得以电子信息方式向其发送广告；以电子信息方式发送广告的，应当明示发送者的真实身份和联系方式，并向接收者提供拒绝继续接收的方式。[链接](https://www.gov.cn/guoqing/2021-10/29/content_5647620.htm)。/ China's Advertising Law art. 43: electronic ads only with consent, with the sender's real identity and contact details and a way to refuse more.
- FTC,《CAN-SPAM Act: A Compliance Guide for Business》：写上有效的邮寄地址；说明怎么退订；退订要在 10 个工作日内生效，退订方式在发出后至少 30 天内有效；不用虚假或误导的主题。[链接](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)。/ A valid postal address, a clear opt-out honored within 10 business days and working for 30 days, no deceptive subject lines.
- 英国信息专员办公室（ICO）,《Electronic mail marketing》：没有具体同意就不要发营销邮件（老客户的 soft opt-in 是有限的例外）；不要隐藏身份；提供有效的退订地址，退订要简单、免费，不要求登录。[链接](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/)。/ Consent (with the limited soft opt-in for existing customers), no hidden identity, a valid opt-out address, simple and free, no login.
- Gmail 帮助,《Email sender guidelines》及《Email sender guidelines FAQ》：每天给 Gmail 发 5000 封以上的发件人要求做身份验证、垃圾邮件率低于 0.3%、营销邮件支持一键退订（RFC 8058 的 List-Unsubscribe 头）。[指南](https://support.google.com/a/answer/81126?hl=en)；[问答](https://support.google.com/mail/answer/14229414?hl=en)。/ For senders of 5,000+ messages a day to Gmail: authentication, a spam rate below 0.3%, one-click unsubscribe (RFC 8058 List-Unsubscribe) on marketing mail.
- Gmail 帮助,《Email subscription guidelines for senders》：退订请求在 48 小时内处理。[链接](https://support.google.com/mail/answer/15263077)。/ Process unsubscribe requests within 48 hours.
- Mailchimp,《Create a Regular Email》：主题最多 150 个字符，建议 60 个字符以内；预览文字也最多 150 个字符，可以不填。[链接](https://mailchimp.com/help/create-and-send-regular-email/)。/ Subjects up to 150 characters, 60 or fewer recommended; preview text up to 150, optional.
- Product Hunt,《Launch Guide》：标语最多 60 个字符，简介最多 260 个字符；太平洋时间 0:01 上线；请人点赞违反规则，会让发布失去资格。[链接](https://help.producthunt.com/en/articles/17350772-launch-guide)。/ Tagline 60 characters, description 260; live at 12:01 a.m. Pacific; asking for upvotes can disqualify the launch.
- Product Hunt,《Prepare for your Product Hunt launch》：名称只写产品名，不加描述和表情；简介最多 500 个字符；首页按太平洋时间 24 小时轮换；最多提前一个月排期；maker 的第一条评论显示在图集下面，拿到当日、当周、当月产品的有 70% 有这条评论；缩略图 240×240、3 MB 以内，图集建议 1270×760、至少 2 张。[链接](https://www.producthunt.com/launch/preparing-for-launch)。/ The name only, no description or emoji; description up to 500; a 24-hour Pacific-time cycle; scheduling up to a month ahead; the first comment under the gallery, on 70% of Product of the Day, Week or Month winners; a 240 × 240 thumbnail under 3 MB and 1270 × 760 gallery images, at least two.
- Product Hunt,《How to Post: Media》：图集图片的尺寸和张数。[链接](https://help.producthunt.com/en/articles/5473122-how-to-post-media)。/ Gallery image sizes and count.
- Product Hunt,《Sharing your launch》：专门请人点赞违反政策，可能要求删掉相关的帖子。[链接](https://www.producthunt.com/launch/sharing-your-launch)。/ Asking specifically for upvotes is against policy, and posts may have to come down.
- Product Hunt,《Community Guidelines》：请人点赞、用好处换点赞等人为操纵都不允许，可能导致账号或产品被移除。[链接](https://help.producthunt.com/en/articles/3615694-community-guidelines)。/ Asking for or incentivizing upvotes is not allowed and can remove the account or product.
- Product Hunt,《Can I ask my community/friends/family to upvote a product?》：请不要这样做，可能让产品排名下降或被移出首页。[链接](https://help.producthunt.com/en/articles/484935-can-i-ask-my-community-friends-family-to-upvote-a-product)。/ Please don't; it can drop the product's rank or take it off the homepage.
- Product Hunt,《Why was my comment or post removed?》：所有提交都要用英文。[链接](https://help.producthunt.com/en/articles/3539992-why-was-my-comment-or-post-removed)。/ All submissions must be in English.
- X 开发者文档,《Counting characters》：中日韩文字算 2 个字符，纯中文最多 140 个字；权重来自 twitter-text 的配置。[文档](https://docs.x.com/fundamentals/counting-characters)；[v3.json](https://raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json)。/ CJK glyphs count as two characters, so a CJK-only post holds 140; the weights come from the twitter-text config.
- LinkedIn 帮助中心,《Post and share updates》：一条 post 最多 3000 个字符。[链接](https://www.linkedin.com/help/linkedin/answer/a528176)。/ A post holds up to 3,000 characters.
