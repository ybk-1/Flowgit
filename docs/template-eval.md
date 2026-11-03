# 模板评测 / Template evaluation

2026 年 11 月 2 日，我们用 DeepSeek（`deepseek/deepseek-chat`）把每个自带模板从头跑了一遍，中文、英文各一次，人工阶段用模板自带的示例材料。我们对照每个模板 README 里的依据和检查脚本的规则读产物、打分，然后改提示词和检查（每个模板一个提交），再用同样的材料重跑。这份报告记下方法、分数、改了什么和还没解决的问题。

On 2 November 2026 we ran every bundled template end to end on DeepSeek (`deepseek/deepseek-chat`), once in Chinese and once in English, with each template's own sample materials for the human stages. We read the outputs against the sources in each template's README and the rules its check script enforces, scored them, fixed prompts and checks (one commit per template), and ran again with the same materials. This report records the method, the scores, what changed and what is still open.

## 怎么跑 / How it runs

- `scripts/eval-templates.mjs` 在一个目录里用 `flowgit init` 建好每个模板，填上样例输入（脚本里的 `SAMPLES`），再 `flowgit run` 跑完整条流程。人工阶段用模板自带的材料：模板已经带着的产物直接用；旁边有 `sample-<名字>` 或 `example-<名字>` 就复制进去；要上传一个文件夹的，给一个空文件夹。
- 每个阶段记下模型调用次数、输入和输出 token、耗时、schema 是否一次通过、修复了几次，写进 `results.json` 和 `summary.md`；检查脚本最后一行的结论（比如“有 2 处要看一下”）也记在 `summary.md` 的“检查”一栏。
- 第一轮在改动之前：20 个模板，40 次运行。改的过程中只重跑改过的模板。最后一轮在全部改动之后：21 个模板（加上新合并的 `meeting-notes`），42 次运行。
- 模型每次的输出都不一样，而每个模板每种语言一轮只跑一次。所以下面的分数说的是“这个模板在 DeepSeek 上常出什么问题”，不是精确的统计。

- `scripts/eval-templates.mjs` creates each template in a directory with `flowgit init`, fills in sample inputs (`SAMPLES` in the script), and runs the whole flow with `flowgit run`. Human stages use the template's own materials: an output the template already ships is used as is, a `sample-<name>` or `example-<name>` beside it is copied in, and an empty folder stands in for a folder of uploads.
- For each stage it records model calls, input and output tokens, time, whether a JSON schema passed on the first try, and how many repairs it took, in `results.json` and `summary.md`; the last line of the check script (such as "2 things to look at") goes in the Check column of `summary.md`.
- Round one came before any change: 20 templates, 40 runs. While fixing, only the changed templates were run again. The final round came after every change: 21 templates (with the newly merged `meeting-notes`), 42 runs.
- Model output differs from run to run, and each template ran once per language per round. The scores below say what tends to go wrong with a template on DeepSeek; they are not precise statistics.

## 怎么打分 / Scoring

每次运行打 1 到 5 分，靠人读产物：

- **5**：照依据里的标准做，可以直接用；检查没报问题，或者只剩要人确认的事。
- **4**：改一两处就能用。
- **3**：能用，但要认真改：漏了标准的一部分，或者有超长、对不上的地方。
- **2**：要大改：大段用错语言，编了资料里没有的事实或数字，或者结构不对。
- **1**：没跑通，或者产物不能用。

看五件事：结构是否照标准（比如金字塔原理、黄金三章）；平台和法规的硬规则（字数、绝对化用语、价格）；有没有编资料里没有的事实和数字；英文流程是不是全用英文；schema 和检查脚本的结果。README 没有写依据的 6 个模板（`article`、`job-application`、`research-report`、`short-video`、`support-sop`、`weekly-report`）只能按它自己 README 的说明打分，下表里标了 \*。

Each run gets 1 to 5, from reading the outputs:

- **5**: Follows the standard in the sources and can be used as is; the check is clean or only lists things a person must confirm.
- **4**: Usable after one or two small edits.
- **3**: Usable after real edits: part of the standard is missing, or something runs over a limit or doesn't add up.
- **2**: Needs rework: large parts in the wrong language, facts or numbers the materials don't have, or the wrong structure.
- **1**: Did not run, or the output can't be used.

Five things count: structure per the standard (the Pyramid Principle, the golden three chapters, and so on); hard platform and legal rules (lengths, absolute claims, prices); no facts or numbers beyond the materials; English throughout in an English flow; and the schema and check results. The six templates whose README cites no sources (`article`, `job-application`, `research-report`, `short-video`, `support-sop`, `weekly-report`) can only be scored against their own README, and carry a \* below.

## 结果 / Results

- **跑通**：第一轮 40 次里 39 次跑通，`slides` 英文在 schema 修复那一步失败。最后一轮 42 次里 41 次跑通：`job-application` 英文的检查失败（关键词抄了中文原词），修好后中英文各重跑两次都通过。
- **英文流程写成中文**：第一轮 `novel-serial` 的设定和细纲（汉字占 83%、79%）、`online-course` 的学员分析（69%）写成了中文。最后一轮每个英文流程的模型产物都是英文；唯一的例外是上面那次 `job-application` 的关键词，已经修了。
- **检查报的问题**：第一轮 30 处，最后一轮 18 处，其中 `meeting-notes` 的 2 处是示例故意留的“没说日期”。`novel-serial` 的字数不够只写在报告里，不算进这个数。
- **schema**：带 schema 的阶段（`data-report`、`meeting-notes`、`short-video`、`slides`、`social-posts`）第一轮只有 `slides` 英文没有一次通过；最后一轮全部一次通过，没用到修复。
- **平均分**：中文 3.98 → 4.14，英文 3.60 → 4.14（第一轮 20 个模板，最后一轮 21 个；只算两轮都有的 20 个，中英文都是 4.12）。有一种语言低于 4 分的模板从 12 个降到 5 个：`article`、`job-application`、`novel-serial`、`social-posts` 和 `travel-guide`。
- **用量**：一整轮（中英文各一次）第一轮是 19.3 万输入、13.8 万输出 token，最后一轮是 21.0 万输入、13.1 万输出。提示词加长了一点，输出差不多。一次运行的中位数是 7,178 token，最多的是 `event-plan` 中文，20,628。一次运行 2 到 70 秒，最长的是 `novel-serial`。

- **Ran clean**: 39 of 40 runs in round one; `slides` in English failed at the schema repair. 41 of 42 in the final round: the `job-application` check failed in English (its keywords copied the Chinese terms), and after the fix two more runs in each language passed.
- **English flows writing Chinese**: in round one the `novel-serial` setting and outline (83% and 79% Han characters) and the `online-course` learner analysis (69%) came back in Chinese. In the final round every model output of an English flow was English; the one exception was the `job-application` keywords above, now fixed.
- **Problems the checks reported**: 30 in round one, 18 in the final round, 2 of them the date the `meeting-notes` sample leaves out on purpose. Short `novel-serial` chapters are listed in its report but not counted here.
- **Schema**: of the stages with a schema (`data-report`, `meeting-notes`, `short-video`, `slides`, `social-posts`), only `slides` in English missed the first try in round one; in the final round every one passed first time and no repair was needed.
- **Average score**: Chinese 3.98 → 4.14, English 3.60 → 4.14 (20 templates in round one, 21 in the final round; over the 20 in both rounds, 4.12 in each language). Templates scoring below 4 in either language went from 12 to 5: `article`, `job-application`, `novel-serial`, `social-posts` and `travel-guide`.
- **Tokens and time**: a full round (each language once) took 193k input and 138k output tokens in round one, 210k and 131k in the final round. Prompts grew a little; output stayed about the same. The median run used 7,178 tokens; the largest was `event-plan` in Chinese at 20,628. A run took 2 to 70 seconds, the longest being `novel-serial`.

## 分数 / Scores

前 → 后：第一轮 → 最后一轮。检查一栏是检查阶段报的问题数（中文/英文），`-` 表示这个模板没有检查阶段。

Before → after: round one → the final round. The check column is the number of problems the check stage reported (Chinese/English); `-` means the template has no check stage.

| 模板 Template | 中文 zh | 英文 en | 检查 Check | 改了 Changed |
| --- | --- | --- | --- | --- |
| article \* | 4 → 4 | 3.5 → 3.5 | - | 否 no |
| business-plan | 3 → 4 | 3.5 → 4.5 | 1/2 → 3/0 | 是 yes |
| data-report | 4.5 → 4.5 | 4.5 → 4.5 | 0/0 → 0/0 | 否 no |
| ecommerce-listing | 4.5 → 4.5 | 2.5 → 4 | 0/8 → 0/2 | 是 yes |
| event-plan | 4.5 → 4.5 | 4.5 → 4.5 | 0/0 → 0/0 | 否 no |
| hiring | 4.5 → 4.5 | 4.5 → 4.5 | 0/0 → 0/0 | 否 no |
| job-application \* | 3.5 → 3.5 | 3.5 → 3.5 | 0/0 → 0/0 | 是 yes |
| landing-page | 4.5 → 4.5 | 4.5 → 4.5 | 0/0 → 0/0 | 否 no |
| lesson-plan | 5 → 4.5 | 4.5 → 4.5 | 0/0 → 1/0 | 否 no |
| live-selling | 3.5 → 4 | 3 → 4 | 2/5 → 1/1 | 是 yes |
| meeting-notes | 新 new → 4.5 | 新 new → 4.5 | → 1/1 | 否 no |
| novel-serial | 3.5 → 3.5 | 2.5 → 3 | 0/0 → 0/0 | 是 yes |
| online-course | 4 → 4.5 | 2.5 → 4.5 | 1/0 → 0/0 | 是 yes |
| research-report \* | 4 → 4 | 4 → 4 | 0/0 → 1/0 | 否 no |
| short-drama | 4.5 → 4.5 | 3.5 → 4.5 | 0/6 → 0/0 | 是 yes |
| short-video \* | 3.5 → 4 | 4 → 4 | - | 是 yes |
| slides | 3 → 4.5 | 1 → 4 | 0/失败 fail → 0/1 | 是 yes |
| social-posts | 4 → 3.5 | 3.5 → 4 | 1/1 → 2/1 | 是 yes |
| support-sop \* | 4 → 4 | 4.5 → 4.5 | - | 否 no |
| travel-guide | 3.5 → 3.5 | 4 → 4 | 2/1 → 1/2 | 是 yes |
| weekly-report \* | 4 → 4 | 4 → 4 | 0/0 → 0/0 | 否 no |

“否”的模板只改了英文检查报告里的单复数（见下面“全部模板”一节），提示词没动，两轮的差别来自模型的随机性。

The templates marked "no" only got the singular and plural fix in their English check reports (see "Every template" below). Their prompts did not change, so any difference between rounds is model variance.

## 改了的模板 / Templates that changed

每条先写依据，再写第一轮看到的问题、改了什么、最后一轮的结果。提交标题写在括号里。

Each entry gives the standard, then what round one showed, what changed, and how the final round came out. The commit subject is in brackets.

### slides

依据：Minto 的金字塔原理，Alley 的 assertion-evidence（标题是一句结论，正文是证据），Mayer 的多媒体学习原则。
Standard: Minto's Pyramid Principle, Alley's assertion-evidence slides (the title is a claim, the body is evidence), Mayer's multimedia principles.

- 第一轮：中文把大纲示例里的“每周省 2 小时”照抄成“每人每周省约 2 小时”，主题里没有这个数据。英文把“没有数据就用画面或步骤”读成 `layout: "image"`，schema 不通过，修复回复又变成中文，整次运行失败。改到一半时，目标 6 页做出了 9 页，英文标题写到 18 到 20 个词（上限 15），下一步写成“[owner] … [date]”。
- 改了：示例换成不带数字的结论，数字只能来自主题、听众或确定的事实；`layout` 只有六种；大纲第 1 页就是封面，论点 2 到 4 个，页数紧时每个论点只占 1 页；两个提示词结尾都核对页数、首尾 layout、标题长度和方括号占位；检查报告列出留下的占位符。（`slides：不编数字，layout 只用六种，页数和标题长度照目标，英文流程写英文`）
- 最后一轮：中英文都是 6 页，中文检查全过，英文只有一页屏幕上的字偏多。
- Round one: the Chinese deck copied the outline example "save 2 hours a week" as "saves about 2 hours per person per week", with no such data in the topic. The English run read "use a visual or steps when there is no data" as `layout: "image"`, failed the schema, and its repair came back in Chinese, so the run failed. Midway through the fixes a 6-slide target came out as 9 slides, English titles ran to 18 to 20 words (the cap is 15), and the next step read "[owner] … [date]".
- Changed: the example is a claim without a number, and numbers must come from the topic, the audience or known facts; there are six layouts; slide 1 of the outline is the cover, there are 2 to 4 arguments, and one slide each when slides are tight; both prompts end by checking the slide count, the first and last layouts, title length and bracket placeholders; the check report lists placeholders left in. (`slides: no invented numbers, six layouts only, slide count and title length on target, English means English`)
- Final round: 6 slides in each language; the Chinese check is clean, and the English one flags one slide with a little too much text.

### novel-serial

依据：网文“黄金三章”、细纲写法（目标情绪、章首钩子、爽点）、手机阅读的段落长度、国家新闻出版署关于网络文学出版的通知。
Standard: the web-fiction "golden three chapters", chapter outlines (target emotion, opening hook, payoff), paragraph length for phone reading, and the NPPA notice on online literature publishing.

- 第一轮：英文流程的设定和细纲写成了中文，默认类型“都市”和中文的 JSON 示例把模型带偏了。第 2 章只写到目标的七成多（1,816 / 2,500）。重跑时中文有一次只写了第 1 章就停了。
- 改了：三个提示词结尾都说 en 时每个字符串都写英文；每章写 3 到 4 场戏；三章都要写完；检查在少于 3 章时列出“缺的正文”。（`novel-serial：英文流程的设定和细纲写英文，三章写完、每章写够场次`）
- 最后一轮：语言对了，三章都写了；但每章仍写不够，中文 1,559 到 1,979 字，英文 967 到 1,397 词，目标都是 2,500。见“遗留问题”。
- Round one: the English flow's setting and outline came back in Chinese, pulled over by the default genre "都市" and the Chinese JSON examples. Chapter 2 reached about three quarters of the target (1,816 of 2,500). In one re-run the Chinese flow stopped after chapter 1.
- Changed: all three prompts end by saying that en means every string in English; 3 to 4 scenes per chapter; all three chapters must be written; the check lists "Missing chapters" when there are fewer than 3. (`novel-serial: English setting and outline in an English flow, all three chapters with enough scenes`)
- Final round: the language is right and all three chapters are there, but they still run short: 1,559 to 1,979 Chinese characters and 967 to 1,397 English words, against 2,500. See "Open issues".

### online-course

依据：ADDIE，Guo、Kim 和 Rubin（2014）对 edX 视频的研究（6 分钟以内），布鲁姆修订版目标分类，《广告法》第二十四条（教育培训广告不得承诺效果）。
Standard: ADDIE, Guo, Kim and Rubin (2014) on edX videos (six minutes or less), the revised Bloom's taxonomy, and Advertising Law art. 24 (no promised results in training ads).

- 第一轮：英文流程的学员分析 69% 是中文，默认学员“想入门的上班族”把模型带偏了。中文检查误报了两处：模型给“练习”也标了时长，检查就说分段对不上；课程页写“课程不对学习结果作任何保证”，检查却把“保证”当成承诺。
- 改了：四个提示词结尾都说 en 时全部写英文；检查只数讲课的分段，否定词往前看 16 个字。（`online-course：英文流程的学员分析写英文，检查不再误报练习时长和“不作任何保证”`）
- 最后一轮：中英文检查全过，英文全是英文。
- Round one: the English learner analysis was 69% Chinese, pulled over by the default audience "想入门的上班族". The Chinese check raised two false alarms: the model gave "Practice" a time, so the check said the segments did not match; and the course page said the course gives "no guarantee of any kind" about results, yet the check read "guarantee" as a promise.
- Changed: all four prompts end by saying that en means English throughout; the check counts only teaching segments, and a negation is looked for up to 16 characters back. (`online-course: English learner analysis in an English flow; no false alarms on a timed practice or "no guarantee of any kind"`)
- Final round: both checks are clean, and the English flow is all English.

### business-plan

依据：红杉《Writing a Business Plan》，自下而上测市场（客户数 × 每个客户每年付的钱），LTV:CAC，《防范和处置非法集资条例》。
Standard: Sequoia's *Writing a Business Plan*, bottom-up market sizing (customers × what each pays a year), LTV:CAC, and the regulation on illegal fundraising.

- 第一轮：中文把客单价填成月费 100 元，客户数 × 客单价 × 12 才等于市场规模，几处数字互相对不上。英文有一个资料里没有的 4.5，第二年收入是第一年的 3 倍，检查提醒要有假设撑住。
- 改了：`price.value` 一定填一年的钱；检查认得出像月费的客单价。（`business-plan：客单价一定填一年的钱，检查能认出月费`）
- 最后一轮：市场规模算得上。英文检查全过；中文的 3 处提醒是“若最终为 200 万家”这种假设情景里资料没有的数字，写明了是估算。
- Round one: the Chinese plan used a monthly fee of 100 yuan as the price, so the market size only worked with an extra × 12 and the numbers did not agree. The English plan had a 4.5 the materials lack and a second year at 3× the first, which the check asked to justify.
- Changed: `price.value` is always the yearly amount, and the check spots a price that looks monthly. (`business-plan: the price is always yearly, and the check spots a monthly one`)
- Final round: the market maths adds up. The English check is clean; the 3 Chinese warnings are numbers in a "what if it is 2 million stores" scenario that the materials lack, labelled as an estimate.

### ecommerce-listing

依据：《广告法》第九条和第十七条，《广告绝对化用语执法指南》，《明码标价和禁止价格欺诈规定》，FABE 卖点法，中文平台标题 60 个字符（汉字算 2 个），亚马逊标题规则。
Standard: Advertising Law arts. 9 and 17, the enforcement guide on absolute terms, the price-marking rules, FABE selling points, the 60-character title limit on Chinese platforms (a Han character counts 2), and Amazon's title rules.

- 第一轮：英文的三个标题是 91、83、83 个字符（上限 60），英文详情页用的是“第 1 屏：好处先行”这样的中文标签。
- 改了：超过上限的标题必须删到以内，中文平台的英文标题大约 8 到 10 个词，交之前再数一次；英文详情页用英文标签；检查不再把“卖点 3”、钟点当成资料里没有的数字。（`ecommerce-listing：标题真的删到上限以内，英文详情页用英文标签`）
- 最后一轮：英文标题 52、57、58。还剩一句“比 2 叶或 4 叶刀头更均匀”是资料里没有的比较，检查标了出来。
- Round one: the three English titles were 91, 83 and 83 characters (the cap is 60), and the English detail page used Chinese labels such as "第 1 屏：好处先行".
- Changed: an over-long title must be cut to the limit (about 8 to 10 English words on a Chinese platform) and counted again before replying; English labels on an English detail page; the check no longer reads "selling point 3" or a time of day as a number the facts lack. (`ecommerce-listing: titles really cut to the limit, English labels on an English detail page`)
- Final round: English titles of 52, 57 and 58. One line, "more evenly than a 2- or 4-blade setup", compares against something the facts don't cover, and the check flags it.

### live-selling

依据：《网络直播营销管理办法（试行）》，《广告法》第九条和第十七条，《明码标价和禁止价格欺诈规定》第十九条，直播话术分类（留人、塑品、互动、逼单）。
Standard: the rules on live-stream marketing, Advertising Law arts. 9 and 17, art. 19 of the price-marking rules, and the four kinds of live-selling lines (hold, build value, interact, close).

- 第一轮：演示里报了资料没有的秒数（“十秒钟”“三十秒”）；英文写了 retail price，暗示一个资料里没有的原价。
- 改了：演示只报资料里的数字；不写原价、零售价更高这类比较；交之前逐句核对数字和语言。（`live-selling：演示不报资料里没有的秒数，价格不暗示原价`）
- 最后一轮：中文只剩流程表 8 分钟对目标 10 分钟；英文还有一句“花 30 多块买一杯果昔”，检查标了出来。
- Round one: the demo gave timings the facts don't have ("ten seconds", "thirty seconds"), and the English script said "retail price", implying a former price the facts don't support.
- Changed: the demo states only numbers from the facts; no "was" or "retail price is higher" comparison; a line-by-line check of numbers and language before replying. (`live-selling: no demo timings the facts lack, no implied "was" price`)
- Final round: the Chinese rundown totals 8 minutes against a 10-minute target; the English script still says a smoothie costs "30+ yuan", and the check flags it.

### short-drama

依据：小程序微短剧的形态（每集 1 到 2 分钟，付费卡点），情绪钩子和黄金三秒，国家广电总局的分类分层审核。
Standard: the mini-program short-drama format (1 to 2 minutes an episode, a paywall), emotional hooks and the first three seconds, and the NRTA's tiered review.

- 第一轮：英文人物表写成“Lin Wen (林文)”，剧本里用的是“Lin Wen”，检查就把 5 个人物都报成没出场。
- 改了：`name` 只写剧本里用的名字，用输出语言，不加括号译名；检查也会去掉括号再找。（`short-drama：人名不带括号译名，检查认得出`）
- 最后一轮：中英文检查全过。
- Round one: the English cast list had "Lin Wen (林文)" while the script said "Lin Wen", so the check reported all 5 characters as never appearing.
- Changed: `name` is only the name the script uses, in the output language, with no bracketed translation; the check also looks for the name without brackets. (`short-drama: names without a bracketed translation, and the check recognizes them`)
- Final round: both checks are clean.

### social-posts

依据：小红书 `postNote`（标题 20 个字符）和社区规范，微博客服的字数、话题和贡献度规则，X 的 `twitter-text` 加权长度，抖音、LinkedIn 和朋友圈的规则，《广告法》。
Standard: Xiaohongshu `postNote` (20-character titles) and its community rules, Weibo's help pages on length, topics and contribution, X's `twitter-text` weighted length, the Douyin, LinkedIn and WeChat Moments rules, and the Advertising Law.

- 第一轮：中文的微博话题“手写字”只有 3 个字（规则是 4 到 32 个字）；英文的微博话题没写进正文。改的过程中，小红书英文标题写到 24 到 39 个字符（上限 20），X 整条写到 301（上限 280），微博话题带了空格；一版带中文示例的核对还把英文流程的小红书和微博帖子带成了中文。
- 改了：长度写成好数的说法：小红书英文标题最多 3 个词，X 中文 110 个字、英文 40 个词以内；微博话题是一个短语，英文连着写（WeekendLetterWriting），放在正文第一句；结尾逐项核对，不带中文示例，语言说明点名每个平台。（`social-posts：长度和话题用好数的写法，交之前再核对，英文流程每个平台都写英文`）
- 最后一轮：英文只剩小红书标题 23/20。中文在改的过程中跑了 6 次，只有 2 次全过；用最后的提示词跑的 2 次，微博话题都是 3 个字的“手写信”，而且放在正文末尾。检查每次都标了出来，见“遗留问题”。
- Round one: the Chinese Weibo topic "手写字" had 3 characters (the rule is 4 to 32), and the English Weibo topic was missing from the body. During the fixes, English Xiaohongshu titles ran to 24 to 39 characters (the cap is 20), a whole X post to 301 (the cap is 280), and Weibo topics carried spaces; one version of the closing check with a Chinese example pulled the English flow's Xiaohongshu and Weibo posts into Chinese.
- Changed: lengths are stated in countable terms: an English Xiaohongshu title is 3 words at most, an X post stays within 110 Chinese characters or 40 English words; a Weibo topic is a short phrase, with English words run together (WeekendLetterWriting), in the body's first sentence; the prompt ends with an item-by-item check that has no Chinese example, and the language line names every platform. (`social-posts: lengths and hashtags in countable terms, a check before replying, English on every platform in an English flow`)
- Final round: the English flow is down to a Xiaohongshu title at 23/20. The Chinese flow ran 6 times during the fixes and was clean twice; both runs with the final prompt used the 3-character topic "手写信" and put it at the end of the body. The check flagged it every time; see "Open issues".

### travel-guide

依据：慢节奏行程（每天 2 到 3 个景点、留空闲），开放时间和预约以官方为准，按天按区域排点。
Standard: slow itineraries (2 to 3 sights a day, with free time), official opening hours and booking, and planning by day and by area.

- 第一轮：中文按 normal 节奏（每天最多 3 个主要景点）把第 1 天排了 4 个；英文报告写成“1 main sights”。
- 改了：结尾逐天数主要景点，多出来的写进 `backup` 或挪到别的天，`food` 和 `walk` 不算；英文报告按数量用单复数。（`travel-guide：交之前逐天数主要景点，英文报告单复数`）
- 最后一轮：英文按节奏排好了，剩下的 2 处是两个吃饭的地方没列进出发前要核对的清单。中文第 1 天排了 5 个主要景点，比第一轮还多。另外试过加一个 `sights` 字段让模型先报数：它报了 3 个，还是排了 4 个，所以没留下。见“遗留问题”。
- Round one: at the normal pace (3 main sights a day at most) the Chinese flow put 4 on day 1, and the English report said "1 main sights".
- Changed: the prompt ends with a per-day count of main sights, an extra one goes to `backup` or another day, and `food` and `walk` stops do not count; the English report uses the singular where it should. (`travel-guide: count main sights per day before replying; singular in the English report`)
- Final round: the English itinerary keeps the pace, and its 2 warnings are two food stops missing from the check-before-you-go list. The Chinese flow put 5 main sights on day 1, more than in round one. A `sights` field asking the model to state the count first was tried and dropped: it stated 3 and still scheduled 4. See "Open issues".

### short-video \*

README 没有写依据。按它自己的说明：口播会变成字幕，画面要能拍出来。
The README cites no sources. Against its own description: the voiceover becomes captions, and each shot can be filmed.

- 第一轮：中文口播里有半角逗号（“四面有墙,上面有顶,”），会直接进字幕。
- 改了：中文口播用全角标点；英文流程全用英文。（`short-video：口播用全角标点，英文流程写英文`）
- 最后一轮：中文没有半角标点了。口播里“研究发现……”没有出处，这要等补上依据时一起处理。
- Round one: the Chinese voiceover had half-width commas ("四面有墙,上面有顶,") that go straight into the captions.
- Changed: full-width punctuation in Chinese voiceover; English throughout in an English flow. (`short-video: full-width punctuation in Chinese voiceover; English means English`)
- Final round: no half-width punctuation in Chinese. The voiceover's "research shows…" has no source; that waits for the template's own sources.

### job-application \*

README 没有写依据。按它自己的说明：只用两份材料，不编经历，关键词写进简历。
The README cites no sources. Against its own description: only the two documents, no invented experience, and the keywords worked into the resume.

- 第一轮：两种语言都跑通，内容忠实但单薄，中文求职信有“我不要求带团队”这样别扭的句子。最后一轮英文失败了：匹配分析照抄了职位描述里的中文原词（“订单服务”“复盘”），英文简历写的是 order service，检查按原词找不到。
- 改了：同一个词有中英两种写法时取输出语言那一种，只有另一种语言时译过来；简历照原词写。（`job-application：关键词用输出语言，简历照原词写`）
- 之后：中英文各重跑两次，关键词都是输出语言，检查都通过。
- Round one: both languages ran clean; the content was faithful but thin, and the Chinese cover letter had an awkward "I don't ask to lead a team". In the final round the English run failed: the match analysis copied the Chinese terms from the job description ("订单服务", "复盘"), the English resume said "order service", and the check found no exact match.
- Changed: when the job description gives a term in both languages, take the one in the output language, and translate it when only the other language is there; the resume uses each keyword word for word. (`job-application: keywords in the output language, used word for word in the resume`)
- After: two more runs in each language gave keywords in the output language, and every check passed.

## 没改提示词的模板 / Templates whose prompts did not change

- `data-report`（Minto、Stephen Few、FT Visual Vocabulary、WCAG 对比度）：结论在前，每条发现引用图；两轮的检查都全过。 / (Minto, Stephen Few, the FT Visual Vocabulary, WCAG contrast): the answer comes first and each finding cites a chart; both rounds' checks were clean.
- `event-plan`（活动方案结构、run of show、10% 到 15% 预备金、《大型群众性活动安全管理条例》）：方案完整，最长的一次写了约 2.9 万字；两轮的检查都全过。 / (proposal structure, run of show, a 10% to 15% contingency, the regulation on large public events): complete proposals, the longest about 29,000 characters; both rounds' checks were clean.
- `hiring`（《就业促进法》和反性别歧视规定、结构化面试、STAR、BARS）：评分表每一档都有行为锚点；两轮的检查都全过。 / (equal-employment law and the rules against gender discrimination in hiring, structured interviews, STAR, BARS): every scorecard level has a behavioral anchor; both rounds' checks were clean.
- `landing-page`（NN/g、Unbounce、WCAG 2.2、各地收集告知规则）：两轮都没有必须修的问题，各留 2 项上线前确认。 / (NN/g, Unbounce, WCAG 2.2, notice-at-collection rules): nothing to fix in either round, with 2 items to confirm before going live each time.
- `lesson-plan`（逆向设计、布鲁姆修订版、2022 年版课标、“双减”作业时长）：目标用可观察的动词，评价和练习对得上；最后一轮中文的四个环节合计 37 分钟，对不上 40 分钟的课时。 / (backward design, the revised Bloom's taxonomy, the 2022 curriculum standards, the homework-time rules): observable objectives with matching assessment and exercises; in the final round the four Chinese segments added up to 37 minutes against a 40-minute lesson.
- `meeting-notes`（罗伯特议事规则、密歇根州立大学的纪要写法、RACI、SMART、《个人信息保护法》）：纪要只记议定事项，每条决定都标了起始时间；检查各报 1 处，是示例故意没说日期的那条待办。 / (Robert's Rules of Order, Michigan State's guide to minutes, RACI, SMART, the Personal Information Protection Law): the minutes record what was decided, each decision with its start time; the 1 warning in each language is the action the sample leaves without a date on purpose.
- `article` \*：中文开头抓人、三个理由、结尾互动；英文偏泛，有几句推测没有出处。 / The Chinese post has a strong hook, three reasons and a closing call to comment; the English one is generic, with a few unsourced guesses.
- `research-report` \*：只引用给它的资料，问题都答了；最后一轮中文有 1 段没有出处。 / It cites only the sources it was given and answers every question; in the final round one Chinese paragraph had no citation.
- `support-sop` \*：中文 9 条用例里 7 条处理到位、2 条只答了一半；英文 8 条都到位。 / 7 of 9 Chinese cases are handled fully and 2 partly; all 8 English cases are handled.
- `weekly-report` \*：短、准，只写给它的笔记。 / Short and accurate, using only the notes it was given.

## 核心修复 / The core fix

第一轮唯一失败的那次（`slides` 英文）暴露了 schema 修复的问题：以前修复只把截到 4000 字的回复贴回去，不带原来的提示词，修复说明又是中文在前，所以长 JSON 会被改坏，英文流程的修复也会变成中文；回复不是 JSON 时，这次调用的 token 也没有记下来。现在修复接着原来的对话：先发原来的提示词和模型完整的回复，再说要改哪里，并要求内容和语言保持不变；失败的运行也记下 token。（`llm：schema 修复接着原来的对话，不再截断回复`）

The one failure in round one (`slides` in English) exposed the schema repair. It used to paste back the reply cut to 4,000 characters, without the original prompt and with Chinese-first instructions, so long JSON came back broken and an English flow's repair could come back in Chinese; and when a reply was not JSON at all, that call's tokens went unrecorded. Now the repair continues the original conversation: the original prompt and the model's whole reply come first, then what to fix, keeping the content and the language as they were; a failed run records its tokens too. (`llm: the schema repair continues the conversation instead of a truncated reply`)

## 全部模板 / Every template

评测时看到英文检查结果写成“1 things to look at”，会议纪要写成“thing(s)”“action(s)”。13 个模板的检查脚本都按数量用单数或复数。（`模板检查：只有一处时英文写单数`）

The evaluation turned up "1 things to look at" in English check output, and "thing(s)" and "action(s)" in the meeting-notes check. The check scripts of 13 templates now use the singular or the plural by count. (`Template checks: singular English when there is one issue`)

## 新模板 / New templates

评测之后又加了 4 个模板（#123）。每个都按上面的方法用 DeepSeek 中英文实跑：读产物，改提示词、脚本和检查，再跑，直到剩下的问题都能由检查标出来。

After the evaluation, four templates were added (#123). Each went through the same method on DeepSeek in both languages: read the outputs, fix the prompts, scripts and checks, and run again until what was left is flagged by the checks.

### podcast

依据：Apple Podcasts、Spotify 和 YouTube 的章节和音频要求，FTC 背书指南和国内的广告标明规定，NPR Training 的采访、录音和口播写作方法。
Standard: Apple Podcasts, Spotify and YouTube chapter and audio guidance, the FTC Endorsement Guides and China's ad disclosure rules, and NPR Training on interviewing, recording and writing for the ear.

- 第一轮：中英文都跑通。30 分 40 秒的单集按 Apple“每小时不超过 6 个”最多 4 个章节，中文写了 6 个、英文 5 个；其他检查都过。
- 改了：文字稿开头写出按时长算的章节上限；节目简介每个访谈段最多一个章节，位置和名字照文字稿；策划把访谈段限制在 3 到“分钟数 ÷ 10 + 1”个，录前检查核对；英文章节名用标题式大小写、各章不重复用词（检查）。还修了两处误报：“第一，……”“第一个月”不是绝对化用语，“怎么判断……是不是”是开放式问题。
- 最后一轮（第 9 轮）：中文录前检查和发布检查都是 0 处，4 个章节（00:00、06:40、13:40、20:30）和内容对得上。英文录前检查 1 处（资料里没有的数字 100），发布检查 3 处（5 个章节超过上限 4 个，两个章节名是 5 个词）。
- 遗留：英文简介常把开场单独算一章、章节名写到 5 个词，检查每次都能标出来。
- Round one: both languages ran clean. A 30:40 episode allows 4 chapters under Apple's "no more than six an hour"; the Chinese show notes had 6 and the English 5. Every other check passed.
- Changed: the transcript header states the chapter limit worked out from the length; the show notes give each talk segment at most one chapter, placed and named from the transcript; the plan keeps talk segments between 3 and minutes ÷ 10 + 1, and the pre-record check counts them; English chapter titles use title case and repeat no word across chapters (checked). Two false alarms went: "第一，……" and "第一个月" are not absolute claims, and "怎么判断……是不是" is an open question.
- Final round (round 9): the Chinese pre-record and publish checks are both clean, with 4 chapters (00:00, 06:40, 13:40, 20:30) that match the content. In English the pre-record check has 1 finding (the number 100, not in the notes) and the publish check 3 (5 chapters against a limit of 4, two 5-word titles).
- Open: English show notes tend to make the opening a chapter of its own and to use 5-word titles; the check flags both every time.

### picture-book

依据：童书编辑和 SCBWI 的写作规则，KDP 的印刷和无障碍要求，Dark Horse 的漫画脚本格式，《人工智能生成合成内容标识办法》和美国版权局的指引。
Standard: children's book editors and SCBWI on writing, KDP's print and accessibility requirements, Dark Horse's comic script format, China's AI content labeling measures, and the US Copyright Office's guidance.

- 第一轮：中英文都跑通，schema 一次通过。中文的重复句开头（“黄帽子，黄帽子，……”）出现在 6 个分页单元里，提示词说的是三次左右；英文第 30–31 页没有翻页钩子，模型把它当成了结尾，其实后面还有第 32 页。两种语言都在最后一页之前揭晓了结局（小鸟），第 32 页又说了一次；这一点检查不查，留给编辑。
- 改了：重复句放在 3 个单元、最多 4 个，开头几个字不在别的单元出现；只有第 `{{inputs.pages}}` 页所在的单元可以没有翻页钩子，倒数第二个也要有；单页单元的插图按一页画；这几条都写进提示词结尾的核对。试过“结局只放在最后一个单元”，DeepSeek 在英文的插图说明里自言自语（“Wait—should this be the reveal…”），中文还是提前揭晓，就撤回了。
- 最后一轮（第 4 轮）：录前检查中英都是 0 处（中文 242 字、英文 181 词，重复句都在 3 个单元）；印刷检查各 1 处，是 16 张还没画的插图（评测里 art/ 是空的）。漫画（8 页）中英也都跑通，只提醒 8 页少于 KDP 平装书最少的 24 页。
- 遗留：中文故事里的尝试有时会往“爬高”上走（站上石头、踩着狗背），资料里写了不要爬高；检查查不出来，留给编辑。
- Round one: both languages ran clean, schemas on the first try. The Chinese refrain's opening ("黄帽子，黄帽子，…") appeared in 6 units where the prompt asked for about three; the English pages 30–31 had no page-turn hook, because the model took them for the end, though page 32 follows. Both revealed the ending (the baby birds) before the last page and again on page 32; the check doesn't look at that, it is the editor's call.
- Changed: the refrain goes in 3 units, 4 at most, and its opening words stay out of the other units; only the unit with page `{{inputs.pages}}` may have no turn, the second-to-last included; art for a single-page unit is drawn as one page; all of these are in the prompt's closing check. "The ending goes in the last unit only" was tried and dropped: DeepSeek thought aloud inside English art notes ("Wait—should this be the reveal…") and still revealed early in Chinese.
- Final round (round 4): the pre-record check is clean in both languages (242 Chinese characters, 181 English words, the refrain in 3 units each); the print check has 1 finding each, the 16 pictures not drawn yet (art/ is empty in the evaluation). The comic (8 pages) runs clean in both languages too, with only a note that 8 pages is under KDP's 24-page paperback minimum.
- Open: in the Chinese story the tries sometimes drift toward climbing (standing on a stone, on the dog's back) though the brief says no climbing; no check can see it, so it is left to the editor.

### product-launch

依据：April Dunford 的定位方法，PR Newswire 的新闻稿写法，CAN-SPAM 和 Gmail 的发信要求，Product Hunt 和 X 的规则，FTC 和《广告法》。
Standard: April Dunford on positioning, PR Newswire on press releases, CAN-SPAM and Gmail's sender requirements, Product Hunt's and X's rules, the FTC and China's Advertising Law.

- 第一轮：两种语言都停在帖子那一步。Product Hunt 简介写了 321（英文）和 370（中文）个字符，schema 的上限 260 没通过，修复之后还是太长，后面的阶段都没跑。
- 改了：长度从 schema 里拿掉（别的模板也不在 schema 里限长度），改成检查和发布汇总里的提醒，汇总会标出超长的字段；提示词给好数的上限（标语 10 个词以内，简介一两句、30 个词以内，附一个别的行业 131 个字符的例子），价格和平台留给第一条评论。第 2 到 4 轮又改了：说法里不列发布日期；引用客户时在同一句写明关系；只有资料答不了的问题才标“待确认”，标在回答开头，不进标题，对外的常见问题只放资料能答的；已有产品的新功能是二级或三级发布；出处只抄输出语言那一半，检查把“中文 / 英文”的两半分开查。
- 最后一轮（第 5 轮）：简介 174 和 171 个字符，两种语言都定为二级发布，X 帖子按加权都是 253。中文检查起初把内部问答里的“「首款」「唯一」「第一款」同样不写”当成用了这些词，检查改成跳过同一句后面说“不写”的词和“能不能说……”的问题。最后中英各 4 处：资料答不了的 3 个问题（退款、删数据、接下来做什么），加上落地页检查的上线前确认（没有隐私政策网址、没有照片）。
- Round one: both languages stopped at the posts. The Product Hunt description came back at 321 (English) and 370 (Chinese) characters, failed the schema's limit of 260, and was still too long after the repair, so nothing after it ran.
- Changed: lengths left the schema (no other template limits lengths there) for warnings in the check and the launch kit, which marks a field that runs over; the prompt gives countable limits (a tagline of 10 words or fewer; a description of one or two sentences and 30 words or fewer, with a 131-character example from another field) and leaves price and platforms to the first comment. Rounds 2 to 4 also changed: claims leave out the launch date; a customer quote carries the customer's tie in the same sentence; only questions the facts can't answer are marked to confirm, at the start of the answer and never in a heading, and the public FAQ keeps to questions the facts answer; a new feature in an existing product is tier 2 or 3; proof and source copy only the output-language half, and the check looks up each half of "Chinese / English".
- Final round (round 5): descriptions of 174 and 171 characters, tier 2 in both languages, X posts at 253 weighted characters each. The Chinese check at first flagged an internal answer that rules the words out ("「首款」「唯一」「第一款」同样不写"), so the check now skips terms ruled out later in the same phrase and "can we say…" questions. That leaves 4 findings in each language: the 3 questions the facts can't answer (refunds, deleting data, what comes next) and the landing check's confirm-before-live items (no privacy policy URL, no photos).

### micro-course

依据：Guo 等（2014）、Brame（2016）、Szpunar 等（2013）、Mayer 的多媒体学习原则、Garner 和 Alley（2013）、Haladyna 等（2002）的出题准则，WCAG 2.2，Netflix 字幕规范，Udemy 的视频要求，AES TD1004，《人工智能生成合成内容标识办法》和《广告法》。
Standard: Guo et al. (2014), Brame (2016), Szpunar et al. (2013), Mayer's multimedia principles, Garner and Alley (2013), Haladyna et al.'s (2002) item-writing guidelines, WCAG 2.2, Netflix's timed text guides, Udemy's video requirements, AES TD1004, China's AI content labeling measures and Advertising Law.

- 第一轮：中英都跑通，schema 一次通过，但按讲稿估的时长超出目标三成多（中文 8.3 分钟、英文 8 分钟，目标 6 分钟）；录前检查中文 8 处、英文 10 处：标题太长，一张幻灯片上有 4 项字，正确选项比错误选项长得多，中文 4 道题的答案都在同一个位置。
- 改了：提示词给好数的上限（标题 28 个字或 80 个字符、约 12 个词；问题幻灯片的标题写短说法，完整的问题放进讲稿；屏幕上最多 3 项，同类的词合成一项，放不下就写个数；选项差不多长，正确的不超过最长错误选项的 1.5 倍，也不带解释和列举；答案分在至少 3 个位置；收尾最多 3 点）；幻灯片上的字放不下时，渲染脚本缩小字号。讲稿长度试过“每段的张数 = 分钟数 × 2”，结果英文短了四分之一，就改成数句子：一分钟大约 9 到 10 句，一张 4 到 5 句，短了就加一张讲资料里的下一个例子。
- 第 5 轮的字幕检查发现，中文字幕把 =SUMIF(C:C, F2, B:B) 切成了三条，还丢了冒号和逗号（“SUMIF(C C F2 B”）。中文字幕改成按词切（用 Node.js 自带的分词）：带括号的公式、1,000、10:30 这类不拆开，标点也不动；每句切成差不多长的几条，在逗号、冒号处断开，数字和量词、列号和“列”不分开；读不完的字幕从前后字幕匀一点时间。新加的测试在旧脚本上会失败。
- 最后一轮（第 6 轮；第 5 轮中英各跑了两次）：中文按讲稿估 5 分 11 秒（−14%，在录前检查允许的 20% 以内），英文 5 分 38 秒（−6%）；录前检查中文 1 处（“四列：日期 金额 分类 备注”13 个字，上限 12），英文 0 处；上架前检查各 6 处，都是评测里预料的：3 段没有讲解（没有录音）、3 段没有截图。字幕在两种语言都没有问题。
- 遗留：中文讲稿有一次把“C:C”念成“C 比 C”（应该念“冒号”）；检查查不出来，录之前读一遍提词稿时改。
- Round one: both languages ran clean with schemas on the first try, but the narration ran a third over its target (8.3 minutes in Chinese, 8 in English, against 6), and the pre-record check found 8 problems in Chinese and 10 in English: long headlines, 4 items on one slide, right options much longer than the wrong ones, and all 4 Chinese answers at the same position.
- Changed: countable limits in the prompts (headlines of 28 characters or 80 characters, about 12 words; a question slide's headline is the short form and the full question goes in the narration; at most 3 items on screen, like words merged into one, the count when they don't fit; options about the same length, the right one no longer than 1.5 times the longest wrong one and without explanations or lists; answers spread over at least 3 positions; at most 3 recap points); the render script shrinks on-screen words that don't fit. For narration length, "slides per segment = minutes × 2" was tried and left English a quarter short, so the prompt counts sentences instead: about 9 to 10 a minute, 4 to 5 a slide, and a slide on the brief's next example when it runs short.
- Round 5's caption check found that the Chinese captions cut =SUMIF(C:C, F2, B:B) into three and dropped its colons and commas ("SUMIF(C C F2 B"). Chinese captions are now cut between words (with the word segmentation built into Node.js): a bracketed formula, 1,000 and 10:30 stay whole with their punctuation; each sentence is cut into captions of about equal length at commas and colons, never separating a number from its measure word or a column letter from 「列」; a caption too short to read borrows time from its neighbours. The new test fails on the old script.
- Final round (round 6; round 5 ran twice in each language): the Chinese narration comes to 5:11 (−14%, inside the 20% the pre-record check allows) and the English to 5:38 (−6%); the pre-record check has 1 finding in Chinese (「四列：日期 金额 分类 备注」, 13 characters against 12) and none in English; the pre-publish check has 6 in each, all expected in an evaluation: 3 segments with no narration (nothing was recorded) and 3 with no screenshots. Captions are clean in both languages.
- Open: the Chinese narration once read "C:C" as "C 比 C" (it should be 冒号); no check can catch it, so it is fixed when someone reads the teleprompter script before recording.

### 新模板最后一轮的数字 / New templates' final-round numbers

| 模板 Template | 语言 Lang | 轮数 Rounds | 调用 Calls | 输入 In | 输出 Out | 秒 Secs | schema 一次通过 First pass | 检查 Check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| podcast | zh | 9 | 4 | 16,582 | 4,617 | 26.4 | 1/1 | 0 |
| podcast | en | 9 | 4 | 16,439 | 5,125 | 28.6 | 1/1 | 3 |
| picture-book | zh | 4 | 2 | 6,876 | 2,662 | 16.0 | 2/2 | 1 |
| picture-book | en | 4 | 2 | 6,847 | 2,730 | 17.4 | 2/2 | 1 |
| product-launch | zh | 5 | 7 | 28,100 | 5,227 | 29.7 | 2/2 | 4 |
| product-launch | en | 5 | 7 | 28,191 | 5,088 | 28.5 | 2/2 | 4 |
| micro-course | zh | 6 | 2 | 8,518 | 3,034 | 34.6 | 2/2 | 6 |
| micro-course | en | 6 | 2 | 8,762 | 3,387 | 35.9 | 2/2 | 6 |

`product-launch` 的调用里有 2 次在落地页子流程里，中文检查的 4 处是改了检查之后重跑检查得到的。`micro-course` 的时间里大约 15 秒花在本机渲染视频上。

Two of `product-launch`'s calls are in the landing page sub-flow, and its Chinese check count is from re-running the check after the fix above. About 15 seconds of `micro-course`'s time goes to rendering the videos locally.

## 遗留问题 / Open issues

1. **数不准长度。** DeepSeek 常把小红书标题、微博话题和电商标题写超，自己报的长度也不对。改成好数的说法（几个词、放在第一句）有用，但不能根除；检查阶段每次都能标出来。
2. **小说章节写不够。** 一次调用写三章，改完后重跑几次，每章中文 1,559 到 2,169 字、英文 967 到 2,008 词，目标都是 2,500。建议把正文拆成每章一次调用，前面的章节作为上游传下去。
3. **旅行节奏。** 中文流程在 normal 节奏下，第 1 天总排 4 到 5 个主要景点。检查能标出来；更稳的做法可能是先让模型按天分好区域、每天只给 3 个名额，再填细节。
4. **微博话题的长度单位。** 规则来自微博客服《如何创建话题》：“词长 4 到 32 个字”。这次评测的环境连不上 weibo.com，没法再核对这里的“字”是汉字还是字符（一个汉字算 2 个字符）。如果是后者，3 个汉字的话题其实合规，检查就是误报。要在能打开 weibo.com 的地方再查一次。
5. **6 个模板没有依据。** `article`、`job-application`、`research-report`、`short-video`、`support-sop`、`weekly-report` 的 README 没有“依据 / Sources”，只能按自己的说明打分。建议像 #104、#111 那样按行业做法补上研究和出处，`article` 和 `job-application` 优先。
6. **中文默认值。** 有 20 个流程输入的默认值是中文（比如“公司同事”“想入门的上班族”）。英文流程靠提示词结尾的语言说明压住；有几个默认值脚本也会读，所以这次没改。可以考虑按语言给默认值。

1. **Lengths are miscounted.** DeepSeek often runs over on Xiaohongshu titles, Weibo topics and e-commerce titles, and misreports its own lengths. Stating limits in countable terms (a number of words, the first sentence) helps but does not cure it; the check stage flags it every time.
2. **Novel chapters run short.** With three chapters in one call, re-runs after the fix gave 1,559 to 2,169 Chinese characters and 967 to 2,008 English words per chapter, against 2,500. Splitting the chapters into one call each, with earlier chapters passed down as upstream, should help.
3. **Travel pace.** At the normal pace the Chinese flow keeps putting 4 or 5 main sights on day 1. The check flags it; a steadier approach might be to have the model assign an area to each day with 3 slots first, then fill in the details.
4. **The unit of the Weibo topic length.** The rule comes from Weibo's help page on creating topics: "词长 4 到 32 个字". This evaluation could not reach weibo.com to check whether "字" means a Han character or a character unit in which a Han character counts 2. If it is the latter, a 3-character topic is fine and the check is wrong. Check again somewhere that can open weibo.com.
5. **Six templates have no sources.** The READMEs of `article`, `job-application`, `research-report`, `short-video`, `support-sop` and `weekly-report` have no "依据 / Sources", so they can only be scored against themselves. Research them as #104 and #111 did, `article` and `job-application` first.
6. **Chinese defaults.** 20 flow inputs have Chinese defaults (such as "公司同事" and "想入门的上班族"). English flows rely on the language line at the end of each prompt; some of those defaults are also read by scripts, so they were left alone. Defaults per language are worth considering.

## 复现 / Reproduce

先 `pnpm build`，并把 DeepSeek 的密钥放在环境变量 `DEEPSEEK_API_KEY` 里（不要写进文件）。

Run `pnpm build` first, with the DeepSeek key in the `DEEPSEEK_API_KEY` environment variable (never in a file).

```bash
node scripts/eval-templates.mjs --out eval-out                        # 全部模板，中英文 / every template, zh and en
node scripts/eval-templates.mjs --only slides,social-posts --lang en  # 只跑几个 / just a few
node scripts/eval-templates.mjs --mock                                 # 用固定回复，不调用模型 / canned replies, no model
```

`--model` 换模型（默认 `deepseek/deepseek-chat`），`--concurrency` 设同时跑几个（默认 3），`--timeout` 是每次运行的分钟上限（默认 20）。每次运行留在 `<out>/<模板>-<语言>/`，可以直接读产物和 `runs/`；数字在 `<out>/results.json` 和 `<out>/summary.md`。

`--model` picks another model (default `deepseek/deepseek-chat`), `--concurrency` sets how many run at once (default 3), and `--timeout` is the minute limit per run (default 20). Each run stays in `<out>/<template>-<lang>/`, where you can read the outputs and `runs/`; the numbers are in `<out>/results.json` and `<out>/summary.md`.

### 最后一轮的数字 / Final-round numbers

| 模板 Template | 语言 Lang | 跑通 OK | 调用 Calls | 输入 In | 输出 Out | 秒 Secs | schema 一次通过 First pass | 修复 Repairs | 检查 Check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| article | zh | ✓ | 3 | 2,755 | 1,494 | 13.6 | - | 0 | - |
| article | en | ✓ | 3 | 2,826 | 1,556 | 13.6 | - | 0 | - |
| business-plan | zh | ✓ | 3 | 5,908 | 3,895 | 23.5 | - | 0 | 3 |
| business-plan | en | ✓ | 3 | 6,216 | 3,923 | 23.6 | - | 0 | 0 |
| data-report | zh | ✓ | 2 | 5,016 | 1,067 | 8.1 | 1/1 | 0 | 0 |
| data-report | en | ✓ | 2 | 4,694 | 947 | 7.5 | 1/1 | 0 | 0 |
| ecommerce-listing | zh | ✓ | 4 | 6,430 | 3,078 | 20.1 | - | 0 | 0 |
| ecommerce-listing | en | ✓ | 4 | 6,816 | 2,909 | 19.2 | - | 0 | 2 |
| event-plan | zh | ✓ | 5 | 9,934 | 10,694 | 56.0 | - | 0 | 0 |
| event-plan | en | ✓ | 5 | 9,825 | 10,433 | 56.4 | - | 0 | 0 |
| hiring | zh | ✓ | 3 | 3,920 | 3,652 | 26.5 | - | 0 | 0 |
| hiring | en | ✓ | 3 | 3,791 | 3,201 | 21.2 | - | 0 | 0 |
| job-application | zh | ✓ | 3 | 2,478 | 429 | 6.1 | - | 0 | 0 |
| job-application | en | ✓ | 3 | 2,563 | 453 | 6.5 | - | 0 | 0 |
| landing-page | zh | ✓ | 2 | 4,939 | 997 | 7.0 | - | 0 | 0 |
| landing-page | en | ✓ | 2 | 4,963 | 1,150 | 7.6 | - | 0 | 0 |
| lesson-plan | zh | ✓ | 4 | 5,235 | 3,638 | 24.6 | - | 0 | 1 |
| lesson-plan | en | ✓ | 4 | 5,287 | 4,944 | 29.7 | - | 0 | 0 |
| live-selling | zh | ✓ | 3 | 3,503 | 2,191 | 16.3 | - | 0 | 1 |
| live-selling | en | ✓ | 3 | 3,735 | 2,863 | 20.2 | - | 0 | 1 |
| meeting-notes | zh | ✓ | 3 | 6,315 | 1,324 | 8.9 | 1/1 | 0 | 1 |
| meeting-notes | en | ✓ | 3 | 6,195 | 1,169 | 8.3 | 1/1 | 0 | 1 |
| novel-serial | zh | ✓ | 3 | 6,817 | 7,696 | 59.3 | - | 0 | 0 |
| novel-serial | en | ✓ | 3 | 8,409 | 9,193 | 70.4 | - | 0 | 0 |
| online-course | zh | ✓ | 4 | 6,692 | 4,013 | 26.4 | - | 0 | 0 |
| online-course | en | ✓ | 4 | 6,718 | 3,606 | 25.4 | - | 0 | 0 |
| research-report | zh | ✓ | 3 | 1,669 | 2,124 | 17.6 | - | 0 | 1 |
| research-report | en | ✓ | 3 | 1,768 | 2,158 | 18.8 | - | 0 | 0 |
| short-drama | zh | ✓ | 4 | 9,165 | 4,803 | 37.4 | - | 0 | 0 |
| short-drama | en | ✓ | 4 | 8,344 | 4,465 | 36.4 | - | 0 | 0 |
| short-video | zh | ✓ | 2 | 1,159 | 922 | 48.6 | 1/1 | 0 | - |
| short-video | en | ✓ | 2 | 1,111 | 825 | 50.5 | 1/1 | 0 | - |
| slides | zh | ✓ | 2 | 3,228 | 1,458 | 11.6 | 1/1 | 0 | 0 |
| slides | en | ✓ | 2 | 3,211 | 1,533 | 11.7 | 1/1 | 0 | 1 |
| social-posts | zh | ✓ | 2 | 3,852 | 1,301 | 11.9 | 2/2 | 0 | 2 |
| social-posts | en | ✓ | 2 | 3,825 | 1,337 | 11.7 | 2/2 | 0 | 1 |
| support-sop | zh | ✓ | 3 | 7,166 | 4,805 | 26.2 | - | 0 | - |
| support-sop | en | ✓ | 3 | 7,361 | 4,601 | 25.7 | - | 0 | - |
| travel-guide | zh | ✓ | 3 | 8,076 | 5,117 | 27.5 | - | 0 | 1 |
| travel-guide | en | ✓ | 3 | 7,366 | 4,968 | 29.4 | - | 0 | 2 |
| weekly-report | zh | ✓ | 1 | 446 | 106 | 2.4 | - | 0 | 0 |
| weekly-report | en | ✓ | 1 | 444 | 113 | 2.4 | - | 0 | 0 |

`job-application` 这两行是修好关键词之后重跑的那次；修之前那次英文的检查失败了。`short-video` 的时间大多花在本机渲染视频上。

The two `job-application` rows are the re-run after the keyword fix; the run before it failed its English check. Most of `short-video`'s time is spent rendering the video locally.
