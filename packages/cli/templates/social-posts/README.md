# 多平台帖子 / Social posts

把一个主题写成几条可以发出去的帖子。先并列写出 3 到 5 个角度，人选一个，再按每个平台已经公布的长度、话题和用词规则写帖，最后导出。示例是虚构的「南风文具社」周末写信会，不是真实品牌。

Turn one topic into posts you could publish. It drafts 3 to 5 angles side by side, a person picks one, then writes each post to the length, hashtag and wording rules that platform has published, and exports them. The sample is a fictional "South Wind Stationery" weekend letter hour, not a real brand.

平台会改规则。发出去之前，请用文末链接再打开官方页面核对一次。检查脚本只做提醒，不能代替平台审核或法律意见。

Platforms change their rules. Before you post, open the official pages linked at the end and check again. The check script only warns. It is not platform review or legal advice.

## 阶段 / Stages

1. **角度 angles**（模型）：`angles.json`，3 到 5 个角度。每个有 `id`、钩子、受众，以及这个受众为什么会转发。钩子必须是后面的帖子做得到的事。
2. **挑选 pick**（你）：`pick.md`，写上要用的角度 `id`。示例已经写了 `desk`，所以 `run all` 不会在这里停下。换主题时改这一份。
3. **帖子 posts**（模型）：`posts.json`，每个平台一条：标题、正文、话题、画面、建议发布时间。字段由 `schemas/posts.schema.json` 约束。
4. **检查 check**（脚本）：`check-report.md`。长度、话题条数和话题格式、绝对化用语、医疗用语、导流痕迹、没替换的占位符，都写进报告。内容问题不拦截。`posts.json` 不是合法的帖子结构时，这个阶段才失败。
5. **导出 export**（脚本）：`posts.md`，每个平台一节。

1. **angles** (model): `angles.json`, 3 to 5 angles. Each has an `id`, a hook, an audience, and why that audience would pass it on. The hook has to be something the post can deliver.
2. **pick** (you): `pick.md` names the angle `id` to use. The sample already says `desk`, so `run all` does not stop here. Change it when the topic changes.
3. **posts** (model): `posts.json`, one post per platform, with a title, body, hashtags, image idea and suggested time. `schemas/posts.schema.json` constrains the fields.
4. **check** (script): `check-report.md`. Length, hashtag count and hashtag shape, absolute claims, medical claims, diversion traces and unreplaced placeholders go into the report. Content problems do not block. This stage fails when `posts.json` is not a valid post structure.
5. **export** (script): `posts.md`, one section per platform.

`platforms` 用逗号分隔，默认 `xiaohongshu,weibo,x`。还可以写 `douyin`、`linkedin`、`wechat-moments`。各平台怎么数字、怎么数话题，写在 `rules.md`，检查脚本读的就是那一份。

`platforms` is comma-separated. The default is `xiaohongshu,weibo,x`. You can also use `douyin`, `linkedin` and `wechat-moments`. How each platform counts characters and hashtags is in `rules.md`. The check script reads that file.

## 怎么跑 / How to run

```bash
flowgit init ~/my-posts -t social-posts
cd ~/my-posts
flowgit inputs set topic=南风文具社的周末写信会
flowgit inputs set platforms=xiaohongshu,weibo,x
flowgit inputs set audience=周末想写信的人
flowgit inputs set tone=口语、具体
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一套，放在 `demo-replies/zh` 和 `demo-replies/en`。中文这套故意在微博里写了「最佳」，并放了 3 个话题；英文这套故意在 X 里写了 best。检查按词匹配，所以「不是最佳」也会被点出来。报告用来给人看，脚本不判断这句话在语境里是否属于执法指南的例外。

Without an API key, canned replies run the flow. Chinese and English each have a set, in `demo-replies/zh` and `demo-replies/en`. The Chinese set deliberately puts 最佳 in the Weibo post and uses 3 topics. The English set deliberately puts "best" in the X post. The check matches the words, so "不是最佳" is reported too. The report is for a person to read. The script does not decide whether the sentence is one of the enforcement guide's exceptions.

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
flowgit inputs set language=en
FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit run all
# PowerShell:
# $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
# flowgit inputs set language=en
# $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/en"; flowgit run all
```

## 依据 / Sources

每一条都打开核对过。规则会变，以你发帖当天的官方页面为准。

Each one was opened and checked. Rules change. The official page on the day you post is the one that counts.

- Nielsen Norman Group，Therese Fessenden，《Parallel & Iterative Design》（2024）：并行方案至少 3 个，5 个大概就是上限，然后由人来选。[https://www.nngroup.com/articles/parallel-and-iterative-design/](https://www.nngroup.com/articles/parallel-and-iterative-design/) 约束 `angles` 的 3 到 5 条，以及 `pick` 由人选定。 / At least 3 parallel options, 5 is about the maximum, then a person chooses. Binds the 3-to-5 count on `angles`, and `pick` being a person's choice.
- 小红书开放平台 `xhs.postNote`（更新于 2025-09-01）：标题最大 20 个字符，正文最大 1000 个字符，话题用英文逗号另传，图片 1 到 18 张或 1 个视频。[https://miniapp.xiaohongshu.com/doc/DC604617](https://miniapp.xiaohongshu.com/doc/DC604617) 约束 `posts` 和 `check` 的小红书标题、正文长度；话题不占那 1000 字，官方没有写条数上限；`imageIdea` 要有一张画面。 / Title max 20 characters, body max 1,000, topics passed separately. Binds the Xiaohongshu title and body limits on `posts` and `check`. Topics do not spend the 1,000, and no count cap is published. `imageIdea` is one frame.
- 《小红书社区规范》（2021-12-24 生效）：4.1.3 禁止标题党、图文不符；4.1.4 要有真实体验，少用商家宣传腔；3.1.2 禁止虚假宣传；3.2 禁止把手机号、微信号、邮箱、地址、网址、二维码用来导流。[https://agree.xiaohongshu.com/h5/terms/ZXXY20221213003/-1](https://agree.xiaohongshu.com/h5/terms/ZXXY20221213003/-1) 约束 `angles` 的钩子和转发理由，`posts` 的真实经历和不导流，以及 `check` 里的网址、手机号、邮箱、微信号、二维码和未写完的占位符。 / Binds the hook and the "why it spreads" line on `angles`, lived detail and no diversion on `posts`, and the URL, phone, email, WeChat ID, QR and unfinished-placeholder warnings on `check`.
- 微博客服《发布微博有字数限制吗？》（2024-09-04）：最多 5000 汉字。[https://kefu.weibo.com/faqdetail?id=21510](https://kefu.weibo.com/faqdetail?id=21510) 约束 `posts` 和 `check` 的微博正文长度。 / Binds the Weibo body length on `posts` and `check`.
- 微博客服《如何创建话题》（2024-10-10）：`#话题#`，词长 4 到 32 个字，词内不能有 `# @ < > &` 和空白。[https://kefu.weibo.com/faqdetail?id=14734](https://kefu.weibo.com/faqdetail?id=14734) 约束 `posts` 和 `check` 的微博话题写法。 / Binds how Weibo topics are written on `posts` and `check`.
- 微博客服《新话题贡献度计算规则》（2024-10-10）：单条带第 3 个话题时第 3 个不计入贡献度，多于 3 个则全部不计入；话题落在正文 140 字之后也不计入。[https://kefu.weibo.com/faqdetail?id=20971](https://kefu.weibo.com/faqdetail?id=20971) 约束 `posts` 和 `check` 的话题位置，以及多于 2 个话题的提醒。 / Binds topic placement, and the warning when there are more than 2 topics, on `posts` and `check`.
- 微博客服《话题阅读数相关问题》（2024-10-10）：建议单条最多 2 个话题，多于 2 个会影响贡献度和阅读量。[https://kefu.weibo.com/faqdetail?id=21594](https://kefu.weibo.com/faqdetail?id=21594) 约束 `posts` 和 `check` 的微博话题条数上限 2。 / Binds the Weibo cap of 2 topics on `posts` and `check`.
- 《微博社区公约》：禁止垃圾信息、虚假阅读和用站外链接导流。[https://service.account.weibo.com/h5/roles/gongyue](https://service.account.weibo.com/h5/roles/gongyue) 约束 `angles` 不编阅读量，`posts` 的话题要和正文相关，`check` 标出微博里的站外链接。 / Binds "do not invent reads" on `angles`, relevant topics on `posts`, and off-site links in Weibo posts on `check`.
- 抖音开放平台「创建视频」：`text` 可以带话题，总字数不能超过 1000；话题不要做成强导流。[https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create) 约束 `posts` 和 `check` 的抖音文案长度。 / Binds the Douyin caption length on `posts` and `check`.
- 《抖音社区自律公约》：禁止不实信息和虚假数据；未认证账号不得发布疾病诊疗；视频里的联系方式、二维码和链接按导流处理；提倡真实表达，不要故意夸大人设。[https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/douyin_creator/40db1b96-0eb0-4754-a052-16e8325af350.html](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/douyin_creator/40db1b96-0eb0-4754-a052-16e8325af350.html) 约束 `angles` 的转发理由，`posts` 的抖音话题和用词，以及 `check` 的医疗用语和导流痕迹。 / Binds the "why it spreads" line on `angles`, Douyin wording on `posts`, and the medical and diversion warnings on `check`.
- LinkedIn Help，《Post and share updates》：一条 post 最多 3000 个字符；定时发布可以选择具体的日期和时间。[https://www.linkedin.com/help/linkedin/answer/a528176](https://www.linkedin.com/help/linkedin/answer/a528176) 约束 `posts` 和 `check` 的 LinkedIn 长度。`suggestedTime` 写成一个可以放进定时发布的具体时段，并标明是作者自己的估计；帮助中心没有公布通用的黄金小时。 / Binds the LinkedIn length on `posts` and `check`. `suggestedTime` is a concrete window a person could schedule, labeled as the author's guess. The Help Center does not publish a universal golden hour.
- LinkedIn Pages Best Practices：需要话题时选 3 到 5 个；帖子尽量带一张图；可以选择具体的发布时间。[https://business.linkedin.com/advertise/linkedin-pages/best-practices](https://business.linkedin.com/advertise/linkedin-pages/best-practices) 约束 `posts` 的话题条数和画面，以及 `check` 在多于 5 个话题时的提醒。 / Binds hashtag count and the image on `posts`, and the warning above 5 hashtags on `check`.
- 腾讯客服《朋友圈发照片/纯文字的方法》：纯文字和照片描述最多约 1500 个汉字，1 个符号算 1 个汉字，2 个数字或英文字母算 1 个汉字；一次最多 9 张照片。[http://kf.qq.com/faq/161223iYjUbm161223eQ3eie.html](http://kf.qq.com/faq/161223iYjUbm161223eQ3eie.html) 约束 `posts` 和 `check` 的朋友圈字数算法；`imageIdea` 只描述一张，平台上限是 9 张。 / Binds the Moments length formula on `posts` and `check`. `imageIdea` describes one photo; the platform allows 9.
- 腾讯客服《朋友圈管理常见问题》：朋友圈是分享生活的地方，不是网络营销平台；违反《微信外部链接内容管理规范》的内容会被拦截。[https://kf.qq.com/faq/161223JfINJV1612237buYri.html](https://kf.qq.com/faq/161223JfINJV1612237buYri.html) 约束 `posts` 把朋友圈写成生活记录，以及 `check` 标出朋友圈里的网址。 / Binds writing Moments as a life note on `posts`, and flagging URLs there on `check`.
- 《中华人民共和国广告法》（中国政府网）：第九条第三项禁止「国家级」「最高级」「最佳」；第十七条禁止非医疗广告涉及疾病治疗和医疗用语；第四条禁止虚假或引人误解的内容。[https://www.gov.cn/zhengce/2015-04/25/content_2853642.htm](https://www.gov.cn/zhengce/2015-04/25/content_2853642.htm) 约束 `angles` 和 `posts` 的用词，以及 `check` 的绝对化词表、医疗词表。占位符未写完，不能当成已经核实的内容。 / Binds wording on `angles` and `posts`, and the absolute and medical lists on `check`. An unfinished placeholder is not verified content.
- 市场监管总局《广告绝对化用语执法指南》（2023 年第 6 号公告）：绝对化用语包括「国家级」「最高级」「最佳」以及含义相同或近似的用语；有些语境可以不适用第九条第三项。[https://www.samr.gov.cn/ggjgs/tzgg/art/2023/art_183b5cb48d9e4f0dba67f9f912a913ba.html](https://www.samr.gov.cn/ggjgs/tzgg/art/2023/art_183b5cb48d9e4f0dba67f9f912a913ba.html) 约束 `rules.md` 里「最好、最优、最强、顶级、极品、全网最低、全网第一、史上最、独一无二、销量第一、排名第一」和英文 best、number one、world's best、#1。`check` 只提醒，因为脚本判断不了例外。 / Binds the equivalent-term list in `rules.md`. `check` only warns, because the script cannot judge the exceptions.
- X 的 `twitter-text` 配置 v3，以及该配置的说明：加权上限 280，`scale` 100，默认权重 200（汉字、全角标点和其余未列入轻权重区间的码位算 2），`transformedURLLength` 23。`emojiParsingEnabled` 把组合表情按一个码位计；本模板的脚本按码位相加，组合表情可能比客户端更长。[v3.json](https://raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json)，[配置说明](https://raw.githubusercontent.com/twitter/twitter-text/master/config/README.md) 约束 `posts` 和 `check` 的 X 加权长度。 / Binds the X weighted length on `posts` and `check`.
