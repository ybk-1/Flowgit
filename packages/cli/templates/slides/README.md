# PPT 演示稿 / Slide deck

从一个主题做出一份演示稿。先定大纲，再写每页内容，最后排成网页幻灯片，浏览器里打印就是一页一张的 PDF。不用装 PowerPoint，也不用联网下载任何东西。

Make a slide deck from a topic. Settle the outline first, then write each slide, then lay it out as an HTML deck; printing it from the browser gives a PDF with one slide per page. No PowerPoint and no downloads needed.

## 阶段 / Stages

1. **大纲 outline**（模型）：`outline.md`，每页一句核心观点。先在这里改，后面的页都跟着变。
2. **每页内容 content**（模型）：`slides.json`，每页的版式（`cover` 封面、`bullets` 要点、`statement` 一句话大字、`section` 章节页）、标题、要点和讲稿。用 `schemas/slides.schema.json` 检查格式，不合格会自动让模型修一次。
3. **排版 build**（脚本）：`slides.html` 和 `notes.md`（讲稿）。方向键或点击翻页，F 全屏，Ctrl+P 打印成 PDF（选“横向”，边距“无”）。`theme` 选浅色或深色。
4. **检查 check**（脚本）：`check-report.md`。页数和目标差多少、哪页要点太多太长、哪页没讲稿。只提醒，不拦。

1. **outline** (model): `outline.md`, one key message per slide. Edit here first; every slide follows.
2. **content** (model): `slides.json` with each slide's layout (`cover`, `bullets`, `statement` for one big line, `section`), title, bullets and speaker notes. Checked against `schemas/slides.schema.json`; a reply that does not fit gets one automatic repair.
3. **build** (script): `slides.html` and `notes.md` (speaker notes). Arrow keys or clicks turn pages, F goes full screen, Ctrl+P prints to PDF (landscape, no margins). `theme` picks light or dark.
4. **check** (script): `check-report.md`. How far the slide count is from the target, which slides are too dense, which have no notes. It warns; it does not block.

想要 .pptx：把 `slides.json` 交给任何能读 JSON 的转换工具，或者在 PowerPoint、Keynote、WPS 里导入打印好的 PDF。

Need a .pptx? Feed `slides.json` to any converter that reads JSON, or import the printed PDF into PowerPoint, Keynote or WPS.

## 怎么跑 / How to run

```bash
flowgit init ~/my-deck -t slides
cd ~/my-deck
flowgit inputs set topic=我们团队为什么要用流程化工作
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
