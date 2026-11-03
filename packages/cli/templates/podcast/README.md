# 播客单集 / Podcast episode

从选题到上线做一期播客。录音前：策划角度和分段、写给耳朵听的台本、给嘉宾的录前说明，再查一遍时长、问题、广告和数字。录完以后：把文字稿整理成带说话人的 VTT，写节目简介和章节，再查一遍标题、章节、赞助标明和响度。

Make one podcast episode from idea to release. Before recording: the angle and segments, a script written for the ear, a brief for the guest, and a check of the timing, the questions, the ad and the numbers. After recording: a VTT transcript with speakers, show notes with chapters, and a check of the title, the chapters, the sponsor label and the loudness.

示例是虚构的访谈节目「开店手记」：主持人陆遥请半亩书店创始人沈禾，聊一家独立书店怎么靠年卡和读书会活下来，赞助商是虚构的记账应用「店小算」。人、店和赞助商都是编的。

The sample is a fictional interview show, Shop Notes: the host Lu Yao talks with Shen He, founder of Half Acre Books, about how an independent bookstore lives on an annual pass and a book club, sponsored by a fictional bookkeeping app, ShopTally. The people, the shop and the sponsor are invented.

## 阶段 / Stages

1. **资料 materials**（你）：`materials/notes.md`。嘉宾是谁；每个事实和数字的出处；还没核实的说法（写在“待核实”下面，节目里不会当事实说）；赞助能说的卖点、优惠和不能说的话。
2. **策划 plan**（模型）：`plan.json`。一句话角度、三个候选标题、分段（`cold-open`、`intro`、`talk`、`ad`、`outro`）和每段分钟数，加起来等于目标时长；访谈段 3 到 L 个（L 是目标分钟数除以 10 去掉小数再加 1，30 分钟最多 4 个），发布时一个访谈段就是一个章节；每个访谈段 2 到 4 个开放式问题，各带一个追问；节目里要说的事实和出处。
3. **台本 script**（模型）：`script.md`。每段一个 `## [开始时间] 段名`。开场、介绍、广告和结尾写逐字稿；访谈段写串场、问题、追问和事实卡。广告第一句先说明是广告。
4. **录前准备 prep**（模型）：`prep.md`。访谈写给嘉宾的说明：聊什么、只列方向、录音环境、请对方确认同意录音和发布、核对来自嘉宾的数字。独播写主持人自己的录前清单。
5. **录前检查 precheck**（脚本）：`precheck-report.md`。分段加起来是否等于目标、缺不缺介绍和结尾、访谈段个数、有赞助有没有广告段、有没有是非题或一次问两件事、标题里有没有节目名、期数或日期、广告第一句有没有说明、广告里的绝对化用语、资料里找不到的数字、给嘉宾的说明有没有请对方同意、占位符。只提醒，不拦；`plan.json` 形状不对才停下。
6. **录音和转录 recording**（你）：照台本录音、剪辑，把成品的文字稿放进 `recording/`（`.srt`、`.vtt`，或带时间的 `.txt`）。成品音频也可以放进来，装了 FFmpeg 时发布检查会量响度。模板自带 `episode-zh.srt` 和 `episode-en.srt`；文件名不带 `zh` 或 `en` 时只用你的文件。
7. **整理文字稿 transcript**（脚本）：`transcript.md` 和 `publish/transcript.vtt`。去掉时间码，同一人连续的话并成一段（一分钟另起一段），每段保留起始时间，例如 `[13:40]`；开头写时长、说话人和章节上限（每 10 分钟一个，零头也算一个，至少 3 个）。VTT 每句标出说话人（`<v 沈禾>`），可以直接和节目一起发布。
8. **节目简介 shownotes**（模型）：`shownotes.md`，发布时贴进单集描述。标题、开头一两句、嘉宾、章节时间线、提到的内容、赞助（以“广告：”开头）、制作和文字稿说明。一个访谈段最多一个章节（不超过章节上限），时间和章节名按文字稿里实际聊的，开场算进第一个；章节时间只用文字稿里某一段的开头。
9. **发布检查 check**（脚本）：`check-report.md`。实际时长和目标、主持人和嘉宾在不在说话人里、标题、章节（00:00 开头、至少 3 个、时间递增、每章至少 2 分钟、每小时不超过 6 个、章节名长度和大小写、时间对得上文字稿）、简介里的赞助标明、绝对化用语、资料和文字稿里找不到的数字、VTT 有没有说话人、简介长度。`recording/` 里有音频又装了 FFmpeg 时，按 Apple 的建议量响度和真峰值。只提醒，不拦。

1. **materials** (you): `materials/notes.md`. Who the guest is; where each fact and number comes from; claims still unverified (under Unverified, never said as fact); the sponsor's approved claims, offer and banned claims.
2. **plan** (model): `plan.json`. A one-line angle, three candidate titles, segments (`cold-open`, `intro`, `talk`, `ad`, `outro`) with minutes that add up to the target, 3 to L talk segments (L is the target minutes divided by 10, decimals dropped, plus 1: at most 4 for 30 minutes), each of which becomes a chapter, 2 to 4 open questions per interview segment, each with a follow-up, and the facts the episode will state with their sources.
3. **script** (model): `script.md`, one `## [start] Segment` per segment. Word for word for the open, intro, ad and close; a transition, questions, follow-ups and fact cards for each talk segment. The ad says it is an ad in its first sentence.
4. **prep** (model): `prep.md`. For an interview, a brief for the guest: what we'll talk about, directions only, the recording space, a request to confirm consent to record and publish, and the guest's numbers to check. For a solo show, the host's own checklist.
5. **precheck** (script): `precheck-report.md`. Whether the segments add up to the target, a missing intro or close, the number of talk segments, an ad segment when there is a sponsor, yes/no or double questions, show names, episode numbers or dates in titles, an ad whose first sentence doesn't disclose it, absolute claims in the ad, numbers not in the notes, a guest brief that doesn't ask for consent, and placeholders. Warnings only; a wrongly shaped `plan.json` stops the stage.
6. **recording** (you): record and edit from the script, then put the final transcript in `recording/` (`.srt`, `.vtt` or a `.txt` with times). Put the final audio there too and, with FFmpeg installed, the publish check measures its loudness. The template includes `episode-zh.srt` and `episode-en.srt`; a file whose name has no `zh` or `en` tag is the one used.
7. **transcript** (script): `transcript.md` and `publish/transcript.vtt`. Timecodes are stripped, consecutive lines from one speaker merge (a new block each minute), each block keeps its start such as `[13:40]`, and the header gives the length, the speakers and the chapter limit (one per ten minutes, a part counting as one, at least three). The VTT labels every line with its speaker (`<v Shen He>`) and can be published with the episode.
8. **shownotes** (model): `shownotes.md`, for the episode description: title, an opening line or two, the guest, chapters, what was mentioned, the sponsor (a line starting with `Ad:`), credits and a transcript note. At most one chapter per talk segment (within the chapter limit), placed and named by what the transcript actually covers, the opening folded into the first; chapter times come only from block starts in the transcript.
9. **check** (script): `check-report.md`. Real length against the target, whether the host and guest are among the speakers, the title, the chapters (start at 00:00, at least three, increasing, two minutes or more each, at most six an hour, title length and casing, times that match the transcript), the sponsor label, absolute claims, numbers not in the notes or the transcript, speakers in the VTT, and the description's length. With audio in `recording/` and FFmpeg installed, it measures loudness and true peak against Apple's recommendation. Warnings only.

`demo-replies/` 里的固定回复按示例写好，策划里有一个是非题（“会员会不会觉得 399 元贵？”），录前检查会标出来，这是故意留的。示例文字稿里沈禾说了一句没有出处的“杭州的独立书店关了一半”，节目简介不会写进去。

The canned replies in `demo-replies/` follow the sample. The plan has one yes/no question ("Do members think 399 yuan is too much?") on purpose, and the pre-record check flags it. In the sample transcript Shen He repeats an unsourced claim that half of Hangzhou's independent bookstores closed; the show notes leave it out.

## 怎么跑 / How to run

```bash
flowgit init ~/my-episode -t podcast
cd ~/my-episode
# 换成你这一期的资料，或先用模板里的示例 / replace the notes, or try the sample first
flowgit inputs set "show=开店手记" "host=陆遥" "topic=一家独立书店怎么靠会员和活动活下来"
flowgit inputs set "guest=沈禾，半亩书店创始人" "sponsor=店小算" minutes=30 language=zh
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一份：

Without an API key, the canned replies run the flow. Chinese and English each have a directory:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
# 英文示例 / English sample:
# flowgit inputs set "show=Shop Notes" "host=Lu Yao" "topic=How an independent bookstore lives on members and events" "guest=Shen He, founder of Half Acre Books" "sponsor=ShopTally" language=en
# FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
```

`flowgit run all` 会在“录音和转录”停下来等你放文字稿（示例已经放好了）。录完以后只要重跑后面几步：`flowgit run transcript`、`flowgit run shownotes`、`flowgit run check`。

`flowgit run all` waits at the recording stage for your transcript (the sample already has one). After recording, only the later stages need to run: `flowgit run transcript`, `flowgit run shownotes`, `flowgit run check`.

## 隐私和同意 / Privacy and consent

录音和文字稿里有嘉宾的声音、名字和说过的话。录音之前请嘉宾确认同意录音和公开发布，并告诉对方会剪辑；`prep.md` 里写好了这段话。在中国，自然人的声音参照肖像权保护，未经同意不得制作、使用、公开；在美国，有些州要求通话各方都同意才能录音。嘉宾说不能公开的事和数字，不要放进节目、简介或文字稿。分享这个流程之前，先自己通读 `materials/notes.md`、`recording/`、`transcript.md` 和 `shownotes.md`，再运行 `flowgit share`。

The recording and the transcript hold the guest's voice, name and words. Before recording, ask the guest to confirm consent to be recorded and published, and say the episode will be edited; `prep.md` includes that request. In China, a person's voice is protected like their likeness and may not be recorded, used or published without consent; in the US, some states require every party's consent to record a call. Keep anything the guest asks to keep private out of the episode, the show notes and the transcript. Before you share this flow, read `materials/notes.md`, `recording/`, `transcript.md` and `shownotes.md` yourself, then run `flowgit share`.

## 规则 / Rules

下面每条都对应文末的一条依据。

Each rule below maps to an entry under Sources.

1. 一期只讲一件事：策划先写一句话角度，整期围绕它。依据：NPR Training《The journey from print to radio storytelling》（围绕一个主要问题组织，不用倒金字塔）。
2. 访谈问题用开放式问法，一个问题只问一件事，每个问题配一个追问；台本里放问题清单，不照着念。依据：NPR Training《Casting, coaching and cutting》（问不能用“是”或“不是”答完的问题，不要把几个问题塞进一句）；NPR Training《Before the first question》（问题打出来带着，但录音时很少摆在面前）；Rachel Martin《Don't Be Afraid Of Silence》（最好的追问有时是不说话）。
3. 台本写给耳朵听：短句、一句一个意思、用说话的语气，开头不一口气塞进所有信息；难念的名字标读音。依据：NPR Training《'Would you say it that way?'》《The journey from print to radio storytelling》《Marking scripts can help you sound more natural》。
4. 事实和数字只用资料里有出处的；没核实的说法不当事实说，嘉宾提供、没审计的数字说明来源。依据：SPJ《Code of Ethics》（发布前核实，尽量用原始来源）。
5. 广告第一句先说明是广告，中文说出“广告”两个字，英文说 sponsored 或 ad；简介里的赞助也标明。依据：FTC《Endorsement Guides》16 CFR 255.0（听得到的说明要用普通人容易听清的音量、语速和节奏）和第 255.5 条的播客示例；FTC《What People Are Asking》；《广告法》第十四条（广告应当具有可识别性，大众传播媒介发布的广告应当显著标明“广告”）；《互联网广告管理办法》第九条（带购买方式的推销显著标明“广告”）。
6. 广告只说资料里能说的卖点，不用绝对化用语；主持人的亲身体验必须真实，没用过的不推荐。依据：《广告法》第九条第（三）项、第三十八条；FTC 16 CFR 255.1(a)(c)（背书反映真实的看法和体验，说自己在用就必须真的在用）。
7. 录音前请嘉宾确认同意录音和公开发布，并说明会剪辑。依据：《民法典》第一千零一十九条、第一千零二十三条（声音参照肖像权保护）和最高人民法院法答网答问；RCFP《Reporter's Recording Guide》（美国有的州要求各方同意）。
8. 录音环境：安静、软装多的房间，关掉空调和冰箱，不在厨房；全程戴有线耳机；关通知；远程录音各自本地录一份；嘴离麦克风 10 到 15 厘米。依据：NPR Training《Catch audio problems in radio interviews》《Before the first question》《The ear training guide for audio producers》。
9. 标题简短，先放最具体的信息；不写节目名、期数或日期；不超过 150 个字符。描述先说这一期聊什么、听众能得到什么。依据：Apple Podcasts for Creators《Create an episode》《Present your podcast》。
10. 章节：第一个从 00:00 开始，至少 3 个，时间递增；每章至少 2 分钟，每小时不超过 6 个；章节名少于 5 个词、不超过 45 个字符（Spotify 建议 40 以内，模板按 40 查）；不编号；英文章节名用标题式大小写，各章节名不重复用同一个词。章节时间必须是文字稿里某一段的开头，这是模板为了能核对而加的。依据：Apple《Chapters on Apple Podcasts》；Spotify《Episode chapters》；YouTube《Video chapters》。
11. 和节目一起发布文字稿，标出谁在说话；用 VTT 才能在 Apple Podcasts 显示说话人。依据：WCAG 2.2 成功标准 1.2.1（预录纯音频要有文字替代，A 级）和技术 G158（文字稿标出说话人）；Apple《Transcripts on Apple Podcasts》。
12. 成品响度约 -16 LUFS（±1），真峰值不超过 -1 dBFS。依据：Apple Podcasts《Audio requirements》。
13. 检查只提醒，好让人自己通读和判断；只有 `plan.json` 的形状不对才停下。

1. One episode, one thing: the plan starts with a one-line angle and the episode serves it. Source: NPR Training, "The journey from print to radio storytelling" (build around one main question, not an inverted pyramid).
2. Interview questions are open, one thing at a time, each with a follow-up; the script carries the list, not a reading. Sources: NPR Training, "Casting, coaching and cutting" (questions that a yes or no can't answer, never several packed into one); NPR Training, "Before the first question" (type the questions out, rarely keep them in front of you); Rachel Martin, "Don't Be Afraid Of Silence" (sometimes the best follow-up is saying nothing).
3. The script is written for the ear: short sentences, one idea each, the way you talk, no inverted pyramid, and hard names marked. Sources: NPR Training, "'Would you say it that way?'", "The journey from print to radio storytelling", and "Marking scripts can help you sound more natural".
4. Facts and numbers come only from sourced notes; unverified claims are never stated as fact, and a guest's unaudited numbers are credited to the guest. Source: SPJ Code of Ethics (verify before release; use original sources).
5. The ad says it is an ad in its first sentence (the word 广告 in Chinese, "sponsored" or "ad" in English), and the show notes label it too. Sources: FTC Endorsement Guides, 16 CFR 255.0 (an audible disclosure in a volume, speed and cadence ordinary listeners can easily hear and understand) and the podcast example in 255.5; FTC, "What People Are Asking"; China's Advertising Law art. 14; China's Internet Advertising Measures art. 9.
6. The ad uses only the approved claims and no absolute claims; the host's own experience has to be real. Sources: China's Advertising Law arts. 9(3) and 38; FTC 16 CFR 255.1(a) and (c) (an endorsement reflects honest opinion and experience; an endorser who says they use it has to).
7. Before recording, the guest confirms consent to be recorded and published, and knows the episode will be edited. Sources: China's Civil Code arts. 1019 and 1023 (a voice is protected like a likeness) and the Supreme People's Court Q&A; RCFP, Reporter's Recording Guide (some US states require every party's consent).
8. The recording space: a quiet room with soft furnishings, the air conditioning and fridge off, not the kitchen; wired headphones throughout; notifications off; each side records locally when remote; the mouth 4 to 6 inches from the microphone. Sources: NPR Training, "Catch audio problems in radio interviews", "Before the first question" and "The ear training guide for audio producers".
9. Titles are brief and lead with the most specific detail; no show name, episode number or date; 150 characters at most. The description says what the episode covers and what listeners get from it. Sources: Apple Podcasts for Creators, "Create an episode" and "Present your podcast".
10. Chapters start at 00:00, number at least three and run in order; each lasts two minutes or more, at most six an hour; titles have fewer than five words and at most 45 characters (Spotify suggests under 40, which the template checks); no numbering; English titles in title case, with no word repeated across chapters. Each chapter time starts a transcript block, which is how this template keeps them checkable. Sources: Apple, "Chapters on Apple Podcasts"; Spotify, "Episode chapters"; YouTube, "Video chapters".
11. Publish a transcript that says who is speaking; Apple Podcasts shows speakers only from a VTT. Sources: WCAG 2.2 SC 1.2.1 (a text alternative for prerecorded audio, Level A) and technique G158 (identify the speakers); Apple, "Transcripts on Apple Podcasts".
12. The final mix is about -16 LUFS (±1) with a true peak of -1 dBFS at most. Source: Apple Podcasts, "Audio requirements".
13. The checks only warn, so a person still reads and decides; only a wrongly shaped `plan.json` stops a stage.

## 依据 / Sources

- Apple Podcasts for Creators,《Create an episode》：单集标题最多 150 个字符，不写节目名、上传日期或期数（期数放进对应字段）；单集描述最多 10000 个字符；单集类型有 Full、Bonus、Trailer。[链接](https://podcasters.apple.com/support/825-how-to-create-an-episode)。/ Episode titles up to 150 characters, without the show name, upload date or episode number; descriptions up to 10,000 characters; Full, Bonus and Trailer episodes.
- Apple Podcasts for Creators,《Present your podcast》：标题简短、聚焦，先放最吸引人、最重要的信息；描述说清讲什么内容、听众能得到什么，并写进听众会搜的关键词。[链接](https://podcasters.apple.com/support/867-featured-present-your-podcast)。/ Brief, focused titles that lead with the most important information; descriptions that say what the show covers and how listeners benefit, with the words listeners search for.
- Apple Podcasts for Creators,《Chapters on Apple Podcasts》：章节可以写在单集描述的时间戳里，也可以写进音频文件；第一个章节从 00:00:00 开始，至少 3 个；建议每小时不超过 6 个，超过 10 分钟的单集提供章节，每章不短于 2 分钟，章节名不超过 45 个字符、少于 5 个词，各章节名不重复用词，用标题式大小写。[链接](https://podcasters.apple.com/support/5482-using-chapters-on-apple-podcasts)。/ Chapters from timestamps in the description or from the file; the first at 00:00:00 and at least three; no more than six an hour, chapters for episodes over 10 minutes, none shorter than two minutes, titles of 45 characters or fewer and under five words, no word repeated across chapters, title casing.
- Apple Podcasts for Creators,《Transcripts on Apple Podcasts》：创作者可以通过 RSS 的 transcript 标签提供文字稿，格式是 VTT 或 SRT；只有 VTT 能标出说话人。[链接](https://podcasters.apple.com/support/5316-transcripts-on-apple-podcasts)。/ Creator transcripts through the RSS transcript tag, as VTT or SRT; speaker labels only with VTT.
- Apple Podcasts for Creators,《Audio requirements》：建议整体响度在 -16 LKFS 左右（±1 dB），真峰值不超过 -1 dBFS。[链接](https://podcasters.apple.com/support/audio-requirements)。/ Overall loudness around -16 LKFS (±1 dB) and a true peak no higher than -1 dBFS.
- Spotify for Creators,《Episode chapters》：在单集描述里每行写“时间 标题”，第一个从 00:00 开始，至少 3 个，按时间先后；章节名建议少于 40 个字符，短于 30 秒的章节建议合并；编号前缀会被去掉。[链接](https://support.spotify.com/us/creators/article/episode-chapters/)。/ One "timestamp title" per line in the description, the first at 00:00, at least three, in order; titles under 40 characters; merge chapters under 30 seconds; numbering is stripped.
- YouTube 帮助,《Video chapters》：描述里的第一个时间戳是 00:00，至少 3 个，按升序，每章至少 10 秒。[链接](https://support.google.com/youtube/answer/9884579)。/ The first timestamp is 00:00, at least three in ascending order, each chapter at least 10 seconds.
- 美国联邦贸易委员会（FTC）,《Guides Concerning the Use of Endorsements and Testimonials in Advertising》, 16 CFR Part 255（2023 年修订）：第 255.0 条，听得到的说明要用普通人容易听清的音量、语速和节奏；第 255.1(a) 条，背书要反映背书人真实的看法和体验；第 255.1(c) 条，说自己在用，就必须真的在用；第 255.5 条的播客示例：主持人念的明显是广告时不必另作说明，否则要说明。[eCFR](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255)；[联邦公报 2023-07-26](https://www.federalregister.gov/documents/2023/07/26/2023-14795/guides-concerning-the-use-of-endorsements-and-testimonials-in-advertising)。/ 255.0: an audible disclosure in a volume, speed and cadence ordinary consumers can easily hear and understand; 255.1(a): honest opinions and experience; 255.1(c): a stated user must be a bona fide user; the 255.5 podcast example.
- FTC,《FTC's Endorsement Guides: What People Are Asking》：听众不知道主持人收了钱、而这会影响他们怎么看这段推荐时，就要说明。[链接](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)。/ If the audience doesn't know the host is paid and that would affect how much weight they give the endorsement, disclose it.
- 《中华人民共和国广告法》（2021 年修正）第九条第（三）项（不得使用“国家级”“最高级”“最佳”等用语）、第十四条（广告应当具有可识别性；通过大众传播媒介发布的广告应当显著标明“广告”）、第三十八条（广告代言人应当依据事实，不得为其未使用过的商品或者未接受过的服务作推荐、证明）。[上海市市场监督管理局](https://scjgj.sh.gov.cn/903/20250924/7e43b9954ca24b349488e5b464e83ac8.html)。/ China's Advertising Law (2021): art. 9(3), art. 14 and art. 38.
- 《互联网广告管理办法》（国家市场监督管理总局令第 72 号，2023 年 5 月 1 日起施行）第九条：互联网广告应当具有可识别性；通过知识介绍、体验分享、消费测评等形式推销商品或者服务并附加购物链接等购买方式的，应当显著标明“广告”。[国务院公报](https://www.gov.cn/gongbao/2023/issue_10506/202306/content_6885261.html)。/ Internet Advertising Measures (SAMR Order 72, in force 1 May 2023), art. 9.
- 《中华人民共和国民法典》第一千零一十九条（未经肖像权人同意，不得制作、使用、公开其肖像）、第一千零二十三条第二款（对自然人声音的保护，参照适用肖像权保护的有关规定）；最高人民法院《法答网精选答问（第十九批）——人格权专题》。[最高人民法院](https://www.court.gov.cn/zixun/xiangqing/464401.html)。/ China's Civil Code arts. 1019 and 1023(2), and the Supreme People's Court Q&A on personality rights.
- Reporters Committee for Freedom of the Press,《Reporter's Recording Guide》：联邦法律是单方同意；约 11 个州主要要求各方同意，跨州通话按更严的州处理比较稳妥。[链接](https://www.rcfp.org/introduction-to-reporters-recording-guide/)。/ Federal law is one-party consent; about 11 states mainly require all-party consent; for calls across states, assume the stricter law applies.
- NPR Training,《Casting, coaching and cutting: A producer's guide to "unmoderated conversations"》：用不能只答“是”或“不是”的开放式问题，事实题和感受题搭配，不要把几个问题塞进一句。[链接](https://training.npr.org/2018/03/05/casting-coaching-and-cutting-a-producers-guide-to-unmoderated-conversations/)。/ Open questions that a yes or no can't answer, a mix of fact and feeling questions, never several questions packed into one.
- NPR Training,《Before the first question: How to prepare for an audio interview》：把问题打出来带着，但录音时很少摆在面前，让采访像聊天；选安静的房间，远离厨房和吵的电器。[链接](https://www.npr.org/sections/npr-training/2025/05/29/g-s1-67220/before-the-first-question-how-to-prepare-for-an-audio-interview)。/ Type the questions out but rarely keep them in front of you; a quiet room away from kitchens and noisy appliances.
- Rachel Martin,《'Don't Be Afraid Of Silence': Interview Tips From NPR Host Rachel Martin》, NPR Extra, 2013：最好的追问有时是什么都不说。[链接](https://www.npr.org/sections/npr-extra/2013/11/20/246336891/it-s-not-about-you-listening-tips-from-weekend-edition-sunday-host-rachel-martin)。/ Sometimes the best follow-up question is to say nothing.
- NPR Training,《Catch audio problems in radio interviews — before they happen》：关掉空调、窗户、冰箱一类的噪音，选软装多的房间；全程戴耳机，不用扬声器；远程录音每人单独录一份；关通知、开勿扰。[链接](https://training.npr.org/2021/10/24/audio-interview-sound-problems-checklist/)。/ Kill the noise (air conditioning, windows, fridge), soft surfaces, headphones and no speakerphone, a separate file per participant, notifications off.
- NPR Training,《The ear training guide for audio producers》：手持麦克风离嘴约 4 到 6 英寸（10 到 15 厘米）；远程嘉宾离得太远就请他靠近再试。[链接](https://www.npr.org/sections/npr-training/2025/05/28/g-s1-68215/the-ear-training-guide-for-audio-producers)。/ About 4 to 6 inches from the mouth; ask a remote guest who is too far to move closer and test again.
- NPR Training,《'Would you say it that way?' Tips on writing for your voice》：先说再写，不会这样说就不要这样写；用缩写和口语。[链接](https://training.npr.org/2015/02/25/would-you-say-it-that-way-tips-on-writing-for-your-voice/)。/ If you wouldn't say it that way, don't write it that way; contractions and conversational phrasing.
- NPR Training,《The journey from print to radio storytelling》：广播句子更简单、少从句；不要用倒金字塔把所有要点塞在开头；围绕一个主要问题组织。[链接](https://training.npr.org/2017/12/06/the-journey-from-print-to-radio-storytelling-a-guide-for-navigating-a-new-landscape/)。/ Simpler syntax with few dependent clauses; no inverted pyramid; one main question.
- NPR Training,《Marking scripts can help you sound more natural on the radio》：用斜线标换气、加粗标重音、难念的名字标读音。[链接](https://www.npr.org/sections/npr-training/2025/09/29/g-s1-90460/how-marking-scripts-can-help-you-sound-more-natural)。/ Slashes for breaths, bold for stress, phonetic spellings for hard names.
- Society of Professional Journalists,《SPJ Code of Ethics》：发布前对准确性负责、核实信息，尽量用原始来源。[链接](https://www.spj.org/spj-code-of-ethics/)。/ Take responsibility for accuracy before release, verify information, use original sources whenever possible.
- W3C,《Web Content Accessibility Guidelines (WCAG) 2.2》成功标准 1.2.1（A 级）：预录的纯音频要提供呈现同等信息的文字替代；技术 G158：文字稿要标出每段话是谁说的。[WCAG 2.2](https://www.w3.org/TR/WCAG22/)；[G158](https://www.w3.org/WAI/WCAG21/Techniques/general/G158)。/ SC 1.2.1 (Level A): a text alternative with equivalent information for prerecorded audio; G158: the transcript identifies who is speaking.
