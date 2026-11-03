# 知识付费微课视频 / Micro-course video

把一节课做成能上架的教学视频。它是「知识付费课程」（`online-course`）模板的视频版：那个模板设计整门课，写试听课逐字稿和介绍页；这个模板把其中一节课做成几段 6 分钟以内的视频，带幻灯片、提词稿、课后测验和字幕，最后用 FFmpeg 每段生成一个 1080p 视频。可以自己录，也可以用 AI 配音。

Turn one lesson into videos ready to sell. It is the video version of the online-course template: that one designs a whole course and writes the trial lesson and the course page; this one turns a single lesson into a few videos of six minutes or less, with slides, a teleprompter script, an end-of-lesson quiz and captions, then renders one 1080p video per segment with FFmpeg. Record it yourself or use an AI voice.

示例是「知识付费课程」示例的第 1 节「10 分钟做出你的第一张记账表」：虚构的讲师林夏教刚工作的上班族用四列表格和 SUMIF 按分类自动合计。人和课程都是编的。

The sample is lesson 1 of the online-course sample, "Make your first budget spreadsheet in 10 minutes": Lin Xia, a fictional instructor, shows office workers a four-column sheet that totals spending by category with SUMIF. The person and the course are invented.

## 阶段 / Stages

1. **课程资料 brief**（你）：`materials/brief.md`。这节课教什么、学员是谁、学完能做成的一件事、要讲的内容和例子、练习、常见错误、讲师、素材和不要说的话。讲到的数字和例子都写在这里；常见错误会变成测验的错误选项。
2. **教学设计 plan**（模型）：`plan.json`。一个用可观察动词写的学习目标（带布鲁姆层级）、开头的问题、2 到 4 段（`s1` 到 `s4`，每段 6 分钟以内，加起来等于目标时长）、每段后一道小问题、3 到 5 道课后测验（错误选项来自常见错误，每道有解释和考的是哪一段）、练习和小结。
3. **讲稿和幻灯片 script**（模型）：`script.json`。每段几张幻灯片，分 `intro`（开场）、`teach`（讲解）、`question`（小问题）和 `recap`（小结）：标题是一句完整的话，屏幕上最多三个短词，`visual` 写要放的截图或演示；讲稿口语、对着“你”说，长度按中文每分钟 200 字、英文 140 词对准计划。
4. **幻灯片、提词稿和测验 deck**（脚本）：`deck/index.html` 是录屏用的 16:9 幻灯片（方向键或空格翻页，N 看讲稿，F 全屏，可以打印成 PDF；`images/` 里有截图就显示截图）；`teleprompter.md` 按段、按幻灯片排好讲稿，带预计时长；`quiz.md` 是课后测验和每段后的小问题，带答案和解释。
5. **录前检查 precheck**（脚本）：`precheck-report.md`。目标的动词能不能检验；段数，每段和全课按讲稿估的时长；每段后有没有小问题和“先暂停”的提示；开头和小结；标题是不是一句话、长短合不合适，屏幕上的字多不多；讲稿有没有对着学员说；测验的题数、选项数、答案是不是总在同一个位置、正确选项是不是明显更长、有没有“以上都对”；资料里找不到的统计数字；效果承诺；资料里说不要说的话；占位符。只提醒，不拦。
6. **AI 配音 voice**（脚本）：输入 `voice` 是 `ai` 并且设置了 `FLOWGIT_TTS_API_KEY` 时，按段调用 OpenAI 兼容的语音合成接口，写出 `voice/s1.mp3` 等，每段开头先说“这段视频的配音由 AI 合成。”；否则写一份说明就跳过。
7. **录制 record**（你）：打开幻灯片全屏，照提词稿一段一段录，文件放进 `recordings/`，按段命名：`s1.mp4` 是录屏加讲解，`s1.m4a` 只有声音，`s1.srt` 是转写工具导出的字幕。截图放进 `images/`，按幻灯片命名，例如 `s2-1.png`。什么都不放也能往下走：没有录音的段会是无声的幻灯片视频。
8. **字幕和时间线 captions**（脚本）：`captions/01-s1.srt` 和 `.vtt` 等，以及 `timeline.json`。每段的声音按“你的录音、录屏里的声音、AI 配音、没有”的顺序选，画面先选录屏，没有就用幻灯片；时长按声音的真实长度，没有声音就按讲稿估；每张幻灯片按上面讲的话分时间。字幕有你的就用你的，没有就按讲稿切（中文一行不超过 16 个字，在标点或词和词之间切，公式不拆开；英文最多两行，每行不超过 42 个字符，在标点、连词和介词处断行）。`timeline.json` 可以手改，再重跑后面两步。
9. **生成视频 render**（脚本，要装 FFmpeg）：`video/01-s1.mp4` 等，每段一个，1920×1080、30 帧、H.264，AAC 立体声 256 kb/s，可以边下边播。声音分两遍调到 -16 LUFS，真峰值压到 -1.5 dBTP。幻灯片画面每张只编码一次再重复，6 分钟的视频一般不到一分钟就生成好。AI 配音的视频右上角一直标着“AI 合成配音”。字幕不烧进画面，上传时另传。`video/manifest.json` 记下每段的规格。
10. **上架前检查 check**（脚本）：`check-report.md`。分辨率、比例、编码、声道和文件大小；每段时长；有没有讲解声音，响度和真峰值；字幕在不在、每行多长、几行、每秒几个字、显示多久，按讲稿估的字幕是不是配在了真实录音上；AI 配音有没有说出来、标出来；写了画面却没放截图的幻灯片。最后列出上架前要自己确认的事。只提醒，不拦。

1. **brief** (you): `materials/brief.md`. What the lesson teaches, who the learners are, the one thing they can do after, the content and examples, the practice, common mistakes, the instructor, the assets, and what not to say. Every number and example the lesson uses goes here; the common mistakes become the quiz's wrong answers.
2. **plan** (model): `plan.json`. One learning objective with an observable verb (and its Bloom level), the opening problem, 2 to 4 segments (`s1` to `s4`, six minutes or less each, adding up to the target), a question after each segment, 3 to 5 quiz questions (wrong answers from the common mistakes, each with feedback and the segment it tests), the practice and the recap.
3. **script** (model): `script.json`. A few slides per segment, each `intro`, `teach`, `question` or `recap`: the headline is a full sentence, at most three short phrases go on screen, and `visual` names the screenshot or demo to show; the narration is spoken and addressed to "you", sized to the plan at 200 Chinese characters or 140 English words a minute.
4. **deck** (script): `deck/index.html` is a 16:9 slide deck to screen-record (arrow keys or space to move, N for the narration, F for full screen, printable to PDF; screenshots in `images/` appear on their slides); `teleprompter.md` is the narration by segment and slide with estimated times; `quiz.md` holds the quiz and the question after each segment, with answers and feedback.
5. **precheck** (script): `precheck-report.md`. Whether the objective's verb is checkable; the number of segments and each segment's and the lesson's length estimated from the narration; a question after each segment with a cue to pause; the opening and the recap; sentence headlines of a sensible length, and how much text is on screen; narration addressed to the learner; the quiz's question and option counts, an answer always in the same place, a correct option much longer than the rest, and "all of the above"; statistics not in the brief; promised results; anything the brief says not to say; and placeholders. Warnings only.
6. **voice** (script): when the `voice` input is `ai` and `FLOWGIT_TTS_API_KEY` is set, it sends each segment to an OpenAI-compatible speech endpoint and writes `voice/s1.mp3` and so on, each opening with "The voice in this video is AI-generated."; otherwise it writes a note and skips.
7. **record** (you): open the deck full screen and record segment by segment from the teleprompter script into `recordings/`, named by segment: `s1.mp4` for a screen recording with your voice, `s1.m4a` for audio only, `s1.srt` for captions exported from a transcription tool. Put screenshots in `images/`, named by slide, such as `s2-1.png`. The flow continues with neither: a segment with no recording becomes a silent slide video.
8. **captions** (script): `captions/01-s1.srt`, `.vtt` and so on, plus `timeline.json`. Each segment's sound is your recording, else the sound of your screen recording, else the AI voice, else none; the picture is your screen recording, else the slides. A segment lasts as long as its sound, or as the narration would take when there is none, and each slide gets time in proportion to what is said over it. Your captions are used when you supply them; otherwise the narration is cut into captions (one Chinese line of up to 16 characters, cut at punctuation or between words, with formulas kept whole; up to two English lines of 42 characters, broken at punctuation, conjunctions and prepositions). Edit `timeline.json` by hand if you like, then run the last two stages again.
9. **render** (script, needs FFmpeg): `video/01-s1.mp4` and so on, one per segment, 1920×1080 at 30 fps in H.264 with stereo AAC at 256 kb/s, ready to stream while downloading. The sound is set to -16 LUFS in two passes with the true peak at -1.5 dBTP. Each slide is encoded once and repeated, so six minutes of video usually render in under a minute. A video with an AI voice carries an "AI-generated voice" label in the top right throughout. Captions are not burned in; upload them alongside. `video/manifest.json` records each video's format.
10. **check** (script): `check-report.md`. Resolution, aspect ratio, codecs, channels and file size; each segment's length; whether there is a voice, its loudness and true peak; whether captions exist, line length, line count, reading speed and how long each stays up, and captions estimated from the script over a real recording; whether an AI voice is said and shown; slides that describe a visual with no screenshot. It ends with the things to confirm yourself before publishing. Warnings only.

`demo-replies/` 里的固定回复按示例写好：3 段、每段 2 分钟、13 张幻灯片、4 道测验，录前检查没有问题。因为示例里没有录音和截图，直接跑完的话，上架前检查会提示三段都是无声视频、几张幻灯片缺截图，这是正常的：录好、截好放进去，再跑一次 `flowgit run all`，只会重跑字幕、视频和检查。

The canned replies in `demo-replies/` follow the sample: 3 segments of 2 minutes, 13 slides and 4 quiz questions, and the pre-record check finds nothing. The sample has no recordings or screenshots, so the pre-publish check reports three silent videos and slides with no screenshot. That is expected: add your recordings and screenshots and run `flowgit run all` again, and only the captions, the videos and the check run again.

## 怎么跑 / How to run

```bash
flowgit init ~/my-lesson -t micro-course
cd ~/my-lesson
# 把 materials/brief.md 换成这节课的资料，或先用示例 / replace the brief, or try the sample first
flowgit inputs set "topic=10 分钟做出你的第一张记账表" "audience=想入门的上班族" minutes=6
flowgit run all
```

没有 API key 时，用固定回复跑通。中文和英文各有一份：

Without an API key, the canned replies run the flow. Chinese and English each have a directory:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies/zh flowgit run all
# 英文示例 / English sample:
# flowgit inputs set "topic=Make your first budget spreadsheet in 10 minutes" "audience=office workers new to budgeting" language=en
# FLOWGIT_LLM_MOCK_DIR=demo-replies/en flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies/zh"; flowgit run all
```

生成视频要装 FFmpeg（[下载](https://ffmpeg.org/download.html)），`flowgit doctor` 会检查。中文字幕和画面上的中文要有中文字体：Windows 和 macOS 自带，Linux 装 Noto CJK；也可以用 `FLOWGIT_FONT` 指定一个字体文件。

Rendering needs FFmpeg ([download](https://ffmpeg.org/download.html)); `flowgit doctor` checks for it. Chinese on the slides needs a Chinese font: Windows and macOS have one, and on Linux install Noto CJK; or point `FLOWGIT_FONT` at a font file.

## 自己录 / Recording yourself

- 全屏打开 `deck/index.html`，用录屏工具（OBS、剪映、QuickTime 等）录屏幕加声音；按 N 可以在旁边看讲稿，录的时候关掉。 / Open `deck/index.html` full screen and record the screen with your voice (OBS, QuickTime, Camtasia and so on); N shows the narration beside the slide, so turn it off while recording.
- 每段单独录、单独存，录错了只重录那一段。 / Record and save each segment on its own, so a mistake costs one segment.
- 录完用转写工具导出字幕（剪映、飞书妙记、Whisper；Descript、Otter），存成 `recordings/s1.srt`。按讲稿切的字幕只是起点，你说的话不会和讲稿一字不差，上架前检查会提醒。 / Export captions from a transcription tool (Descript, Otter, Whisper) as `recordings/s1.srt`. Captions cut from the script are only a start, since you won't say it word for word, and the pre-publish check reminds you.

## AI 配音 / AI voice

```bash
flowgit inputs set voice=ai
export FLOWGIT_TTS_API_KEY=...   # PowerShell: $env:FLOWGIT_TTS_API_KEY = "..."
flowgit run all
```

默认用 OpenAI 的语音接口（`gpt-4o-mini-tts`，声音 `alloy`）。其他兼容 OpenAI `/audio/speech` 的服务，用 `FLOWGIT_TTS_BASE_URL`、`FLOWGIT_TTS_MODEL` 和 `FLOWGIT_TTS_VOICE` 指定。密钥只从环境变量读，不写进任何文件，只发给这个地址；服务要求跳转到别的网站时不会跟过去。

It uses OpenAI's speech endpoint by default (`gpt-4o-mini-tts` with the `alloy` voice). For another service compatible with OpenAI's `/audio/speech`, set `FLOWGIT_TTS_BASE_URL`, `FLOWGIT_TTS_MODEL` and `FLOWGIT_TTS_VOICE`. The key is read only from the environment, never written to a file and sent only to that address; a redirect to another site is not followed.

用 AI 配音时，每段开头先说一句这是 AI 配音，字幕里也有这句，画面右上角一直标着“AI 合成配音”；上架前检查会提醒你在课程介绍里写明，在国内平台发布时还要用平台的标识功能声明。要用克隆的真人声音，先取得本人的书面同意。

With an AI voice, each segment opens by saying so, the captions include that sentence, and the picture carries an "AI-generated voice" label in the top right throughout; the pre-publish check reminds you to say so in the course description and, on platforms in China, to declare it with the platform's labeling feature. To use a cloned human voice, get that person's written consent first.

## 隐私 / Privacy

截图和录屏里常常有真名、手机号、账号和余额。上架之前逐帧看一遍，打码或换成示例数据；上架前检查会把这条列进要确认的事。分享这个流程之前，先自己看一遍 `materials/`、`recordings/` 和 `images/`，再运行 `flowgit share`。

Screenshots and screen recordings often show real names, phone numbers, account numbers and balances. Go through them before publishing and blur them or swap in sample data; the pre-publish check lists this among the things to confirm. Before you share this flow, look through `materials/`, `recordings/` and `images/` yourself, then run `flowgit share`.

## 规则 / Rules

数字和词表在 `rules.md`，改那里就行。下面每条都对应文末的一条依据。

The numbers and word lists live in `rules.md`; change them there. Each rule below maps to an entry under Sources.

1. 一节课一个学习目标，用看得见、能检验的动词（做出、算出、找出），不用“理解”“了解”“掌握”。依据：修订版布鲁姆分类。
2. 每段 6 分钟以内，每段做成一个单独的视频；一节课 2 到 4 段，加起来等于目标时长，按讲稿估的时长和目标差 20% 以内。依据：Guo、Kim 和 Rubin（2014）；Brame（2016）。
3. 每段后一道小问题，并提示学员先暂停、自己试一试。依据：Szpunar、Khan 和 Schacter（2013）。
4. 幻灯片的标题写成一句完整的话，正文用截图、图表或演示证明它，不用一列要点。依据：Garner 和 Alley（2013）。
5. 讲的话不原样印在屏幕上，屏幕上最多三个短词；去掉不教东西的装饰；用标题提示结构。依据：Mayer《Multimedia Learning》的冗余、一致性和提示原则。
6. 讲稿对着“你”说，像一对一地讲。依据：Mayer 的个性化原则；Guo 等（2014）发现有个人感觉的视频更吸引人。
7. 课后测验 3 到 5 道，每道 3 到 4 个选项；错误选项来自学员常犯的错，选项长度差不多，正确答案的位置要打散；不用“以上都对”，“以上都不对”慎用；每道写解释。依据：Haladyna、Downing 和 Rodriguez（2002）。
8. 每段都有字幕，存成单独的文件，学员可以开关。依据：WCAG 2.2 成功标准 1.2.2；暨南大学《在线开放课程微视频字幕制作指南》。
9. 中文字幕一行，不超过 16 个字，每秒不超过 9 个字；英文最多两行，每行不超过 42 个字符，每秒不超过 20 个字符，在标点后面、连词和介词前面断行；每条至少显示 5/6 秒。依据：Netflix 简体中文和英文字幕规范、通用要求；暨南大学的指南（一屏一行，不超过 20 个字）。
10. 讲解里要说出画面上的关键内容，看不到画面的学员也跟得上。依据：WCAG 2.2 成功标准 1.2.5。
11. 视频 1920×1080、16:9、H.264，AAC 立体声 256 kb/s，MP4，不低于 1280×720，单个文件小于 4 GB；两个声道都要有声音。依据：Udemy 视频规格和音频规格。
12. 响度 -16 LUFS（±1），真峰值不超过 -1 dBTP。依据：AES TD1004.1.15-10。
13. AI 配音要说出来、标出来：每段开头一句语音提示，画面上一直有标识，发布时用平台的标识功能声明。依据：《人工智能生成合成内容标识办法》第四条、第十条。
14. 上 Udemy 时在课程描述里写明用了 AI；这个流程用模型起草讲稿和测验，所以不管用不用 AI 配音都要写。付费课程整门课至少 30 分钟视频、5 个讲座。依据：Udemy 的 AI 使用政策和课程质量清单。
15. 不承诺学习效果；讲稿里的统计数字要在资料里有出处（例子里的金额不算）。依据：《广告法》第二十四条、第十一条。
16. 用别人的声音（包括克隆的声音）要有本人同意。依据：《民法典》第一千零二十三条。
17. 检查只提醒，好让人自己通读和判断；只有文件的格式不对时阶段才失败。

1. One learning objective per lesson, with a verb you can see and check (build, calculate, find), not "understand", "know" or "master". Source: the revised Bloom's taxonomy.
2. Six minutes or less a segment, each its own video; 2 to 4 segments per lesson that add up to the target, with the length estimated from the narration within 20% of it. Sources: Guo, Kim and Rubin (2014); Brame (2016).
3. A question after each segment, with a cue to pause and try it first. Source: Szpunar, Khan and Schacter (2013).
4. Each slide headline is a full sentence, and the body proves it with a screenshot, chart or demo instead of a list of bullets. Source: Garner and Alley (2013).
5. Don't print the narration on screen as well, keep it to three short phrases, drop decoration that doesn't teach, and let the headlines signal the structure. Source: the redundancy, coherence and signaling principles in Mayer's Multimedia Learning.
6. The narration speaks to "you", one to one. Sources: Mayer's personalization principle; Guo et al. (2014) found videos with a personal feel more engaging.
7. 3 to 5 quiz questions with 3 or 4 options each; wrong answers from the mistakes learners really make, options of about equal length, the correct answer's position varied; no "all of the above", and "none of the above" only with care; feedback for each. Source: Haladyna, Downing and Rodriguez (2002).
8. Captions for every segment, as separate files learners can turn on and off. Sources: WCAG 2.2 SC 1.2.2; Jinan University's caption guide for open online course videos.
9. Chinese captions: one line of up to 16 characters, at most 9 characters a second. English: up to two lines of 42 characters, at most 20 characters a second, broken after punctuation or before a conjunction or preposition. Each stays up at least 5/6 of a second. Sources: Netflix's Simplified Chinese and English timed text guides and General Requirements; Jinan University's guide (one line of up to 20 characters a screen).
10. The narration says what matters on screen, so a learner who can't see it can follow. Source: WCAG 2.2 SC 1.2.5.
11. Video at 1920×1080, 16:9, H.264, with stereo AAC at 256 kb/s, in MP4, never below 1280×720, each file under 4 GB, with sound in both channels. Sources: Udemy's video and audio standards.
12. Loudness of -16 LUFS (±1) with a true peak of -1 dBTP at most. Source: AES TD1004.1.15-10.
13. Say an AI voice and show it: a spoken notice at the start of each segment, a label on screen throughout, and a declaration through the platform's labeling feature when you publish. Source: China's Measures for Labeling AI-Generated and Synthetic Content, arts. 4 and 10.
14. On Udemy, say in the course description that AI was used; this flow drafts the script and the quiz with a model, so that holds with or without an AI voice. A paid course needs at least 30 minutes of video and 5 lectures in all. Sources: Udemy's AI policy and Course Quality Checklist.
15. No promised results, and statistics in the narration must have a source in the brief (amounts in worked examples don't count). Source: China's Advertising Law arts. 24 and 11.
16. Using someone's voice, cloned or not, needs their consent. Source: China's Civil Code art. 1023.
17. The checks only warn, so a person still reads and decides; a stage fails only when a file has the wrong shape.

## 依据 / Sources

- Vanderbilt University Center for Teaching, Patricia Armstrong,《Bloom's Taxonomy》：2001 年的修订版（Anderson 和 Krathwohl 主编的《A Taxonomy for Learning, Teaching, and Assessing》）把认知过程分成记忆、理解、应用、分析、评价、创造，用动词描述。[链接](https://cft.vanderbilt.edu/guides-sub-pages/blooms-taxonomy/)。/ The 2001 revision names the cognitive processes with verbs: remember, understand, apply, analyze, evaluate, create.
- Philip J. Guo, Juho Kim, Rob Rubin,《How Video Production Affects Student Engagement: An Empirical Study of MOOC Videos》, ACM Learning at Scale 2014：分析 edX 上 4 门课约 690 万次视频观看；6 分钟左右以内的视频学员看得最完整，越长看得越少；有个人感觉的视频更吸引人，讲师说得偏快、有热情时学员看得更投入；建议把视频剪成 6 分钟以内的小段。[PDF](https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf)。/ About 6.9 million video sessions in four edX courses: engagement held best up to about six minutes and fell with length; videos with a personal feel engaged more, as did instructors who spoke fairly fast and with enthusiasm; split videos into chunks under six minutes.
- Cynthia J. Brame,《Effective Educational Videos: Principles and Guidelines for Maximizing Student Learning from Video Content》, CBE—Life Sciences Education 15(4), es6, 2016：控制认知负荷、减少无关内容、提高投入；视频保持在 6 分钟以内，用提示突出重点，配上问题让学生主动学。[链接](https://pmc.ncbi.nlm.nih.gov/articles/PMC5132380/)。/ Manage cognitive load, cut extraneous material and promote engagement: keep videos under six minutes, signal the key points, and pair videos with questions.
- Richard E. Mayer,《Multimedia Learning》第 3 版, Cambridge University Press, 2020：冗余原则（图像加讲解时不再加一样的屏幕文字）、一致性原则（去掉无关的文字、图片和声音）、提示原则（突出重点和结构）、分段原则、个性化原则（用对话的语气）、声音原则。[DOI](https://doi.org/10.1017/9781316941355)。/ The redundancy, coherence, signaling, segmenting, personalization and voice principles.
- Karl K. Szpunar, Novall Y. Khan, Daniel L. Schacter,《Interpolated memory tests reduce mind-wandering and improve learning of online lectures》, PNAS 110(16), 6313–6317, 2013：在线讲座每段后插一次小测验，走神少了一半左右，记笔记更多，最后的测验成绩更好。[链接](https://psychology.fas.harvard.edu/publications/interpolated-memory-tests-reduce-mind-wandering-and-improve-learning-online)。/ A short test after each segment of an online lecture cut mind-wandering by about half, increased note-taking and improved the final test.
- Joanna K. Garner, Michael P. Alley,《How the Design of Presentation Slides Affects Audience Comprehension: A Case for the Assertion-Evidence Approach》, International Journal of Engineering Education 29(6), 1564–1579, 2013：标题写成一句断言、正文用视觉证据的幻灯片，学生理解得更深，认知负荷更低。[PDF](https://www.ijee.ie/articles/Vol29-6/23_ijee2791ns.pdf)。/ Slides with a sentence headline and visual evidence led to deeper comprehension with lower cognitive load than topic-and-bullet slides.
- Thomas M. Haladyna, Steven M. Downing, Michael C. Rodriguez,《A Review of Multiple-Choice Item-Writing Guidelines for Classroom Assessment》, Applied Measurement in Education 15(3), 309–333, 2002：31 条出题准则，包括选项长度差不多、正确答案的位置要平衡、不用“以上都对”、“以上都不对”慎用、错误选项要来自学生常犯的错。[DOI](https://doi.org/10.1207/S15324818AME1503_5)。/ 31 item-writing guidelines, including options of about equal length, a balanced key, no "all of the above", "none of the above" with care, and distractors drawn from common errors.
- W3C,《Understanding Success Criterion 1.2.2: Captions (Prerecorded)》（A 级）：同步媒体里的预录声音都要有字幕。[链接](https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html)。/ Captions for all prerecorded audio in synchronized media, Level A.
- W3C,《Understanding Success Criterion 1.2.5: Audio Description (Prerecorded)》（AA 级）：只能看到的重要信息要用声音说出来；讲解里本来就说到了，就不需要另做口述影像。[链接](https://www.w3.org/WAI/WCAG22/Understanding/audio-description-prerecorded.html)。/ Important visual information has to be available as sound; when the narration already says it, no separate description is needed.
- 暨南大学,《在线开放课程微视频字幕制作指南》：字幕另存成 SRT 文件；一屏一行，不超过 20 个字。[PDF](https://netc.jnu.edu.cn/_upload/article/files/39/05/561ca6f741ceb84bd09a6c037147/7eb5b7ea-a442-484c-a5c2-44d948adfbcd.pdf)。/ Jinan University's caption guide for open online course videos: captions in a separate SRT file, one line of up to 20 characters a screen.
- Netflix,《Chinese (Simplified) Timed Text Style Guide》：成人节目每秒不超过 9 个字。[链接](https://backlothelp.netflix.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide)。/ At most 9 characters a second for adult programs.
- Netflix,《English (USA) Timed Text Style Guide》：每行不超过 42 个字符，最多两行，每秒不超过 20 个字符；在标点后面、连词和介词前面断行，不把冠词和名词、名和姓拆开。[链接](https://backlothelp.netflix.com/hc/en-us/articles/217350977)。/ 42 characters a line, two lines at most, 20 characters a second; break after punctuation and before conjunctions and prepositions, never between an article and its noun or a first and last name.
- Netflix,《Timed Text Style Guide: General Requirements》和《Subtitle Timing Guidelines》：每条字幕至少显示 5/6 秒。[通用要求](https://backlothelp.netflix.com/hc/en-us/articles/215758617)、[时间规范](https://backlothelp.netflix.com/hc/en-us/articles/360051554394-Timed-Text-Style-Guide-Subtitle-Timing-Guidelines)。/ Each subtitle event stays up at least five-sixths of a second.
- Udemy,《Video Standards》：至少 720p（1280×720），建议 1920×1080，16:9，H.264、HEVC 或 ProRes，AAC 不低于 256 kb/s 或 PCM，立体声，MP4 或 MOV，单个文件不超过 4 小时、小于 4 GB。[链接](https://support.udemy.com/hc/articles/229232767-Video-Standards)。/ 720p (1280×720) at least, 1920×1080 recommended, 16:9, H.264, HEVC or ProRes, AAC at 256 kb/s or more or PCM, stereo, MP4 or MOV, under 4 hours and 4 GB a file.
- Udemy,《Audio Standards》：两个声道都要有声音，声音和画面同步。[链接](https://support.udemy.com/hc/articles/229232367-Audio-Standards)。/ Sound in both channels, in sync with the picture.
- Udemy,《Course Quality Checklist》：付费课程至少 30 分钟视频、至少 5 个讲座。[链接](https://support.udemy.com/hc/en-us/articles/229604988)。/ A paid course has at least 30 minutes of video and at least 5 lectures.
- Udemy,《Udemy's Policy on the Use of AI》：课程内容用了 AI 工具或有 AI 辅助（包括写讲稿、出测验题）时，要在课程描述里说明。[链接](https://support.udemy.com/hc/en-us/articles/30999984483607)。/ Disclose in the course description when course content incorporates or is supported by AI tools, including scripts and quiz questions.
- 国家互联网信息办公室等,《人工智能生成合成内容标识办法》（2025 年 9 月 1 日起施行）：第四条第（二）项，合成的声音在开头、结尾或者中间适当位置加语音提示或者音频节奏提示；第四条第（四）项，合成的视频在起始画面和播放周边适当位置加显著的提示标识；第十条，发布时主动声明，并使用平台提供的标识功能。[链接](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。/ China's Measures for Labeling AI-Generated and Synthetic Content (in force 1 September 2025): art. 4(2), a spoken or rhythmic notice at the start, end or middle of synthetic audio; art. 4(4), a prominent label at the start of a synthetic video and around it while it plays; art. 10, declare it when publishing and use the platform's labeling feature.
- AES TD1004.1.15-10,《Recommendation for Loudness of Audio Streaming and Network File Playback》：流媒体建议 -16 LUFS 左右（±1），真峰值不超过 -1 dBTP；ITU-R BS.2434 报告引用了这份建议。[ITU-R BS.2434](https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BS.2434-2018-PDF-E.pdf)。/ About -16 LUFS (±1) with a true peak of -1 dBTP at most for streaming; quoted in ITU-R Report BS.2434.
- 《中华人民共和国广告法》（2021 年修正）第十一条第二款（广告使用数据、统计资料、调查结果等引证内容的，应当真实、准确，并表明出处）、第二十四条（教育、培训广告不得对升学、通过考试、获得学位学历或者合格证书，或者对教育、培训的效果作出明示或者暗示的保证性承诺）。[上海市市场监督管理局](https://scjgj.sh.gov.cn/903/20250924/7e43b9954ca24b349488e5b464e83ac8.html)。/ China's Advertising Law (2021): art. 11(2), cited data and statistics must be true and accurate with their source; art. 24, education and training ads may not guarantee results.
- 《中华人民共和国民法典》第一千零二十三条第二款（对自然人声音的保护，参照适用肖像权保护的有关规定）；最高人民法院《法答网精选答问（第十九批）——人格权专题》。[最高人民法院](https://www.court.gov.cn/zixun/xiangqing/464401.html)。/ China's Civil Code art. 1023(2): a person's voice is protected like their likeness; the Supreme People's Court Q&A on personality rights.
- OpenAI,《Create speech》API 参考：`POST /audio/speech`，`input` 最多 4096 个字符，所以长的段会分几次合成再拼起来。[链接](https://platform.openai.com/docs/api-reference/audio/createSpeech)。/ `POST /audio/speech` with `input` of up to 4,096 characters, so a long segment is synthesized in parts and joined.
