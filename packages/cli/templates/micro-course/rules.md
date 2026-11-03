# 微课规则 / Lesson rules

`deck`、`precheck`、`voice`、`captions`、`render` 和 `check` 几个脚本读下面的数字和词表。平台和法规会变，上架之前用 README「依据 / Sources」里的链接再核对一次。检查只把问题写进报告，不会让阶段失败；文件的格式不对（比如 `script.json` 不是合法的 JSON）时，阶段才失败。

The `deck`, `precheck`, `voice`, `captions`, `render` and `check` scripts read the numbers and word lists below. Platforms and laws change; open the links in the README under "依据 / Sources" again before you publish. The checks write problems into their reports and do not fail the stage; a stage fails only when a file has the wrong shape (for example, `script.json` is not valid JSON).

JSON 块是脚本用的原文，改数字时改这里。 / The JSON block is what the scripts read; change the numbers here.

## 怎么数 / How to count

- **讲稿长度**：中文一个汉字算 1，一串连着的字母或数字也算 1，标点不算；英文数词。按中文每分钟 200 字、英文每分钟 140 词估时长，这是模板的估计，和「知识付费课程」模板一样；你说得快或慢，就改 `speakingRate`。有录音或 AI 配音时，字幕和视频都按真实时长来。 / **Narration length**: in Chinese, one Han character counts as 1, a run of letters or digits counts as 1, and punctuation doesn't count; in English, words. Length is estimated at 200 characters or 140 words a minute, the template's estimate, the same as the online-course template; change `speakingRate` if you speak faster or slower. With a recording or an AI voice, the captions and the video follow its real length.
- **幻灯片上的字**：中文一个汉字或全角标点算 1，字母、数字、空格和半角标点两个算 1，大致是占的宽度；英文数字符。 / **Words on slides**: in Chinese, a Han character or fullwidth punctuation mark counts as 1, and two letters, digits, spaces or ASCII marks count as 1, roughly the width they take; in English, characters.
- **字幕字数**：一个 Unicode 码位算 1，空格和标点也算。 / **Caption length**: one Unicode code point counts as 1, spaces and punctuation included.

## 分段和时长 / Segments and length

- **每段不超过 6 分钟**：Guo、Kim 和 Rubin 分析 edX 上 690 万次观看，6 分钟左右以内的视频，学员看得最完整；Brame 的综述也建议 6 分钟以内。每段做成一个单独的视频。 / **Six minutes or less a segment**: Guo, Kim and Rubin's study of 6.9 million edX sessions found engagement held best for videos up to about six minutes, and Brame's review recommends the same. Each segment becomes its own video.
- **2 到 4 段，加起来等于目标时长**，按讲稿估的时长和目标差 20% 以内。 / **2 to 4 segments that add up to the target**, with the length estimated from the narration within 20% of it.
- **每段后一道小问题**：Szpunar、Khan 和 Schacter 发现，在线课里每段后插一道小测验，走神少了一半，学得更好。 / **A question after each segment**: Szpunar, Khan and Schacter found that a short test after each segment of an online lecture halved mind-wandering and improved learning.

## 幻灯片和讲稿 / Slides and narration

- **标题是一句完整的话**（断言），正文用截图、图表或演示来证明它，不用一列要点：Garner 和 Alley 的实验里，这样做的学生理解得更好、负担更轻。标题中文不超过 28 个字、英文不超过 80 个字符，大约两行；太短（中文不到 6 个字，英文不到 3 个词）就像主题词，不像一句话。 / **Each headline is a full sentence** (an assertion) and the body proves it with a screenshot, chart or demo, not a list of bullets: in Garner and Alley's experiment, students taught this way understood more with less load. Headlines stay within 28 Chinese characters or 80 English characters, about two lines; one under 6 Chinese characters or 3 English words reads like a topic label, not a sentence.
- **屏幕上最多三个短词**，中文每个不超过 12 个字、英文不超过 32 个字符：讲的话不要再原样印在屏幕上（Mayer 的冗余原则），无关的装饰去掉（一致性原则），标题负责提示结构（提示原则）。 / **At most three short phrases on screen**, each within 12 Chinese characters or 32 English characters: don't print the narration on screen as well (Mayer's redundancy principle), drop decoration that doesn't teach (coherence), and let the headlines signal the structure (signaling).
- **对着学员说**：讲稿用「你」，像一对一地讲（Mayer 的个性化原则）；Guo 等人也发现，有个人感觉的视频更吸引人，讲师说得偏快、有热情时学员也看得更投入。 / **Speak to the learner**: use "you", as if one to one (Mayer's personalization principle); Guo et al. also found that videos with a personal feel engage more, as do instructors who speak fairly fast and with enthusiasm.
- **开头说清学完能做什么，最后一段收在小结和练习上。** / **Open with what the learner will be able to do, and end the last segment on the recap and the practice.**

## 学习目标和测验 / Objective and quiz

- **目标用可观察的动词**（修订版布鲁姆分类），不用「理解」「了解」「掌握」这类看不见的词。 / **An observable verb for the objective** (revised Bloom's taxonomy), not "understand", "know" or "master".
- **3 到 5 道选择题，每道 3 到 4 个选项**，错误选项来自资料里的「常见错误」，每道写解释；不用「以上都对」，「以上都不对」慎用（Haladyna、Downing 和 Rodriguez 的出题准则综述）。 / **3 to 5 multiple-choice questions with 3 or 4 options each**, wrong answers taken from the brief's common mistakes, each with feedback; no "all of the above", and "none of the above" only with care (Haladyna, Downing and Rodriguez's review of item-writing guidelines).

## 字幕 / Captions

- **每段都有字幕**：WCAG 2.2 成功标准 1.2.2（A 级）要求预录视频里的声音有字幕。字幕存成单独的文件，上传时另传，学员可以开关（暨南大学的微课字幕指南也要求另存 SRT）。 / **Captions for every segment**: WCAG 2.2 success criterion 1.2.2 (Level A) requires captions for the audio in prerecorded video. They are separate files you upload with the video, so learners can turn them on and off (Jinan University's micro-lecture caption guide also asks for a separate SRT).
- **中文一行，不超过 16 个字，每秒不超过 9 个字**（Netflix 简体中文字幕规范；暨南大学的指南是一屏一行、不超过 20 个字，16 个字两边都满足）。**英文最多两行，每行不超过 42 个字符，每秒不超过 20 个字符**（Netflix 英文字幕规范）。每条至少显示 5/6 秒（Netflix）。按讲稿切的字幕不够这个时间、或者按这个速度读不完的，从前后字幕匀一点时间过来。 / **Chinese: one line of up to 16 characters, at most 9 characters a second** (Netflix's Simplified Chinese guide; Jinan University's guide says one line of up to 20 a screen, and 16 meets both). **English: at most two lines of up to 42 characters, at most 20 characters a second** (Netflix's English guide). Each caption stays up at least 5/6 of a second (Netflix). A caption cut from the narration that would stay up less than that, or too briefly to read at that speed, borrows time from its neighbours.
- **英文怎么断行**：一行放得下就只用一行；要用两行时，在标点后面、连词或介词前面断，不把冠词和名词、名和姓拆开（Netflix 英文字幕规范）。模板按讲稿切字幕时，每句话另起一条，一句话要分几条时各条差不多长，行尾不留冠词、物主代词或介词。 / **Breaking English lines**: keep a caption to one line when it fits; when it needs two, break after punctuation or before a conjunction or preposition, and don't split an article from its noun or a first name from a last name (Netflix's English guide). When the template cuts captions from the narration, each sentence starts a new caption, a sentence that needs several captions gets ones of about equal length, and no line ends on an article, possessive or preposition.
- **中文怎么切**：按讲稿切字幕时，一句话分成几条差不多长的字幕，在标点处或词和词之间切（用 Node.js 自带的分词），不把一个词拆开；数字和后面的量词（「5 笔」）、列号和「列」（「F 列」）放在一起。行尾不留逗号和句号，行中的逗号和顿号换成空格。公式、网址这类一串字母和符号不拆开，里面的标点也不动；比 16 个字长的公式单独一条，检查会提醒，看过没问题就可以不改。 / **Cutting Chinese captions**: when the template cuts captions from the narration, each sentence becomes captions of about equal length, cut at punctuation or between words (with the word segmentation built into Node.js), never inside a word; a number stays with its measure word (「5 笔」) and a column letter with 「列」 (「F 列」). No comma or full stop ends a line, and a comma or list mark inside a line becomes a space. Formulas and web addresses are never split and keep their punctuation; a formula longer than 16 characters gets a caption of its own, which the check points out, and once you've looked at it you can leave it.
- **按讲稿估的字幕只是起点**：你自己录的话不会和讲稿一字不差，所以录完要用转写工具导出字幕放进 `recordings/`。 / **Captions cut from the narration are only a start**: what you record won't match the script word for word, so export captions from a transcription tool after recording and put them in `recordings/`.

## 视频和声音 / Video and sound

- **1920×1080、16:9、H.264，AAC 立体声 256 kb/s，MP4**，不低于 1280×720，单个文件小于 4 GB（Udemy 的视频规格）。帧率用 30。 / **1920×1080, 16:9, H.264, stereo AAC at 256 kb/s, MP4**, never below 1280×720, each file under 4 GB (Udemy's video standards). The frame rate is 30.
- **响度 -16 LUFS（±1），真峰值不超过 -1 dBTP**（AES TD1004.1.15-10 给流媒体的建议）。生成视频时把声音调到 -16 LUFS，真峰值压到 -1.5，给编码留一点余量。 / **Loudness of -16 LUFS (±1) with a true peak of -1 dBTP at most** (the AES TD1004.1.15-10 recommendation for streaming). The render stage sets the sound to -16 LUFS with the true peak at -1.5, leaving room for the encoder.

## AI 配音 / AI voice

- **说出来，也标出来**：《人工智能生成合成内容标识办法》要求合成的声音在开头、结尾或中间加语音提示，视频在起始画面和播放时加显著的标识；发布时还要主动声明，并用平台的标识功能（第四条、第十条）。所以每段 AI 配音开头先说 `aiNotice` 这句话，视频右上角一直显示 `aiLabel`。 / **Say it and show it**: China's Measures for Labeling AI-Generated and Synthetic Content require a spoken notice at the start, end or middle of synthetic audio, a prominent label at the start of a video and while it plays, and a declaration through the platform's labeling feature when you publish (arts. 4 and 10). So each AI-voiced segment opens with the `aiNotice` sentence, and the video shows `aiLabel` in the top right throughout.
- **在课程介绍里写明**：Udemy 要求课程内容用了 AI 工具或有 AI 辅助时（包括用 AI 写讲稿、出测验题）在课程描述里说明。这个流程用模型起草讲稿和测验，所以不管用不用 AI 配音，上架 Udemy 都要写；上架前检查会把它列进要确认的事。 / **Say so on the course page**: Udemy requires a disclosure in the course description when course content incorporates or is supported by AI tools, including AI that writes scripts or quiz questions. This flow drafts the script and the quiz with a model, so a Udemy course needs it with or without an AI voice; the pre-publish check lists it among the things to confirm.

## 用词 / Wording

- **不承诺效果**：教育、培训广告不能对升学、通过考试、获得学位学历或者合格证书，或者对教育、培训的效果作出明示或者暗示的保证性承诺（《广告法》第二十四条）。试听课常常就是广告。 / **No promised results**: ads for education and training may not guarantee, openly or by implication, admission, passing an exam, a degree or certificate, or the results of the training (China's Advertising Law art. 24). A free first lesson is often an ad.
- **统计数字要有出处**：讲稿里的百分比、倍数和人数，要能在资料里找到。例子里的金额不算。 / **Statistics need a source**: percentages, multiples and head counts in the narration must be in the brief. Amounts in worked examples don't count.
- **占位符**：`{{`、`TODO`、`TBD`、`待补充`、`待填`、`[...]`、`[…]` 表示还没写完。 / **Placeholders**: `{{`, `TODO`, `TBD`, `待补充`, `待填`, `[...]` and `[…]` mean the draft is unfinished.

## 机器可读 / Machine-readable

```json
{
  "segments": { "min": 2, "max": 4, "maxMinutes": 6, "tolerance": 0.2 },
  "speakingRate": { "zh": 200, "en": 140 },
  "slides": {
    "headlineMax": { "zh": 28, "en": 80 },
    "headlineMin": { "zh": 6, "en": 3 },
    "onScreenMax": 3,
    "onScreenItemMax": { "zh": 12, "en": 32 }
  },
  "quiz": {
    "min": 3,
    "max": 5,
    "optionsMin": 3,
    "optionsMax": 4,
    "avoid": ["以上都对", "以上都是", "以上皆是", "以上全对", "all of the above"],
    "careful": ["以上都不对", "以上都不是", "以上皆非", "none of the above"]
  },
  "captions": {
    "zh": { "lineMax": 16, "lines": 1, "cpsMax": 9 },
    "en": { "lineMax": 42, "lines": 2, "cpsMax": 20 },
    "minSeconds": 0.833
  },
  "video": { "width": 1920, "height": 1080, "fps": 30, "minWidth": 1280, "minHeight": 720, "audioBitrate": "256k", "sampleRate": 48000, "maxBytes": 4000000000 },
  "loudness": { "target": -16, "min": -17, "max": -15, "truePeakMax": -1, "renderTruePeak": -1.5 },
  "aiNotice": { "zh": "这段视频的配音由 AI 合成。", "en": "The voice in this video is AI-generated." },
  "aiLabel": { "zh": "AI 合成配音", "en": "AI-generated voice" },
  "vague": ["理解", "了解", "掌握", "熟悉", "知道", "体会", "认识到", "understand", "know", "master", "learn about", "be familiar", "be aware", "appreciate"],
  "promises": ["保过", "包过", "必过", "稳过", "一次通过", "保证", "包会", "包学会", "包就业", "保就业", "速成", "天学会", "月入", "年入", "躺赚", "稳赚", "暴富", "guaranteed", "guarantee", "pass for sure", "get rich", "earn $", "passive income", "six figures"],
  "placeholders": ["{{", "TODO", "TBD", "待补充", "待填", "[...]", "[…]"]
}
```
