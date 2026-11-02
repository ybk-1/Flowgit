# PPT 演示稿 / Slide deck

从一个主题做出一份演示稿。做法来自咨询和科研演讲里验证过的方法：先用金字塔原理定下一句话的核心结论和 SCQA 开场，每页标题都写成一句结论、正文放证据（assertion-evidence），屏幕上的字尽量少、细节放进讲稿。最后排成网页幻灯片，浏览器里打印就是一页一张的 PDF，不用装 PowerPoint，也不用联网。

Make a slide deck from a topic, using methods proven in consulting and research talks: settle a one-sentence governing thought and an SCQA opening with the Pyramid Principle, title every slide with a claim and fill it with evidence (assertion-evidence), keep on-screen text minimal and put detail in the notes. The result is an HTML deck that prints to a one-slide-per-page PDF, with no PowerPoint and no downloads needed.

## 阶段 / Stages

1. **大纲 outline**（模型）：`outline.md`。先写核心结论（一个判断，不是一个话题），再写 SCQA 开场（情境 → 冲突 → 问题 → 回答），然后 3 到 4 个彼此不重叠的论点，每个论点下 1 到 3 页证据，最后一页是“谁、做什么、什么时候”。先在这里改，后面的页都跟着变。
2. **每页内容 content**（模型）：`slides.json`。版式有 `cover` 封面、`statement` 一句话大字、`evidence` 证据页（`chart` 图表数据、`image` 画面描述、`quote` 引用、`steps` 步骤）、`bullets` 要点、`section` 章节、`close` 下一步。用 `schemas/slides.schema.json` 检查格式，不合格会自动让模型修一次。没有真实数据就不画图表，不编数字。
3. **排版 build**（脚本）：`slides.html` 和 `notes.md`（讲稿）。图表画成条形图，画面描述留成虚线占位框，换成你的截图或照片即可。方向键或点击翻页，F 全屏，Ctrl+P 打印成 PDF（选“横向”，边距“无”）。`theme` 选浅色或深色。
4. **检查 check**（脚本）：`check-report.md`，只提醒不拦：页数、有没有核心结论、标题是不是一句结论（中文 8 到 30 个字，英文 4 到 15 个词）、屏幕上的字（中文超过 60 个字或 4 条要点就算太多）、要点页是否超过三分之一、证据页有没有证据、讲稿有没有写或只是在念屏幕、最后一页是不是下一步。

1. **outline** (model): `outline.md`. First the governing thought (a claim, not a topic), then the SCQA opening (situation → complication → question → answer), then 3 to 4 non-overlapping arguments with 1 to 3 evidence slides each, and a last slide saying who does what by when. Edit here first; every slide follows.
2. **content** (model): `slides.json`. Layouts: `cover`, `statement` (one big line), `evidence` (`chart` data, `image` description, `quote` or `steps`), `bullets`, `section` and `close` (next step). Checked against `schemas/slides.schema.json`, with one automatic repair. No chart without real data; no invented numbers.
3. **build** (script): `slides.html` and `notes.md` (speaker notes). Charts become bar charts; visual descriptions become dashed placeholder boxes for your screenshots or photos. Arrow keys or clicks turn pages, F for full screen, Ctrl+P to print to PDF (landscape, no margins). `theme` picks light or dark.
4. **check** (script): `check-report.md`. It warns and never blocks: slide count; a governing thought; claim titles (4 to 15 words in English, 8 to 30 characters in Chinese); on-screen text (over 35 words or 4 bullets is too much); bullet slides over a third of the deck; evidence slides without evidence; notes missing or just reading the slide; a next step at the end.

想要 .pptx：把 `slides.json` 交给任何能读 JSON 的转换工具，或者在 PowerPoint、Keynote、WPS 里导入打印好的 PDF。

Need a .pptx? Feed `slides.json` to any converter that reads JSON, or import the printed PDF into PowerPoint, Keynote or WPS.

## 怎么跑 / How to run

```bash
flowgit init ~/my-deck -t slides
cd ~/my-deck
flowgit inputs set topic=把周报做成流程
flowgit inputs set slides=8
flowgit run all
# 打开 slides.html / open slides.html
```

没有 API key 时，用固定回复跑通：

Without an API key, the canned replies run the flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

## 参考资料 / References

- Barbara Minto《金字塔原理》（*The Pyramid Principle*）：结论先行、以上统下、论点不重叠不遗漏（MECE），以及 SCQA 开场。概述：[Think Insights](https://thinkinsights.net/strategy/pyramid-principle)、[Hacking the Case Interview](https://www.hackingthecaseinterview.com/pages/pyramid-principle)；中文解读：[数英：金字塔原理](https://www.digitaling.com/articles/72211.html)。/ Minto's Pyramid Principle: answer first, each level summarizing the one below, MECE groups, and the SCQA opening.
- Michael Alley 的 assertion-evidence 幻灯片：标题是一句结论，正文用视觉证据代替要点列表；宾州州立大学的研究发现这样做的学生对内容理解更好。[Penn State 研究页](https://writing.engr.psu.edu/research.html)、[Northeastern：Guidelines for Better Slides](https://course.ccs.neu.edu/cs7976f19/Materials/Slide-guidelines.html)、Alley《The Craft of Scientific Presentations》（[Springer](https://www.springer.com/978-1-4419-8279-7)）。/ Alley's assertion-evidence slides: a sentence headline backed by visual evidence instead of bullets.
- Richard Mayer 的多媒体学习原则：去掉无关的字和图（coherence）、用颜色或粗体标出重点（signaling）、不要让讲稿和屏幕上的字重复（redundancy）。[Ohio State 概述](https://u.osu.edu/multimedialearning/?p=11)、[多伦多大学 Media Design](https://ocw.utoronto.ca/video-strategies/media-design)、Mayer《Multimedia Learning》（剑桥大学出版社，2009）。/ Mayer's multimedia learning principles: coherence, signaling and redundancy.
