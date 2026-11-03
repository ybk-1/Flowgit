# flowgit

**万物皆可流程化。** Flowgit 的命令行工具：把任何事情拆成一步一张卡片的流程，每一步有产物、有版本，由模型、脚本、agent 或人来完成。

**Turn anything into a flow.** The Flowgit CLI: break any piece of work into stages, each with its own artifacts and versions, done by a model, a script, an agent or a person.

```bash
npm install -g flowgit            # 需要 Node.js 22+ / needs Node.js 22+

flowgit init my-video             # 用自带的短视频模板建流程 / new flow from the short-video template
cd my-video
flowgit status                    # 终端看板 / the board in the terminal
flowgit board                     # 在浏览器打开看板，可以直接改产物 / the board in your browser, outputs editable
flowgit inputs set topic="为什么猫喜欢纸箱"
flowgit providers                 # 内置的模型供应商和密钥状态 / built-in providers and key status
flowgit doctor                    # 跑之前检查密钥、FFmpeg、agent / check keys, FFmpeg and agents before a run
flowgit run all --dry-run         # 预演：会跑哪些阶段、调用几次模型 / preview: which stages run, how many model calls
flowgit run all --model deepseek/deepseek-v4-pro   # 任何模型 / any model
flowgit log                       # 整个流程的历史和 token 合计 / the whole history and token total
```

自带的模板 / Bundled templates：

| `-t` | 做什么 | What it makes |
| --- | --- | --- |
| `short-video`（默认 / default） | 竖屏短视频：脚本 → 配音 → 分镜 → 素材 → 剪辑 → 导出 | A vertical short video: script → voiceover → storyboard → assets → edit → export |
| `weekly-report` | 周报入门示例：随手记（人）→ 草稿（模型）→ 检查（脚本） | Starter: a weekly report from rough notes (person → model → script) |
| `article` | 图文帖子（小红书、公众号、博客）：大纲 → 正文 → 配图方案 → 照片 → 导出 | An illustrated post (Xiaohongshu, WeChat, blog): outline → draft → image plan → photos → export |
| `support-sop` | 客服 SOP：资料 → 汇总 → 规程 → 用例 → 检查 → 打包成 Skill | Customer-support SOP: knowledge → collect → SOP → cases → review → packaged as a Skill |
| `job-application` | 求职材料：材料 → 分析 → 简历和求职信并行 → 检查 | Job application: materials → analysis → resume and letter in parallel → check |
| `research-report` | 调研报告：子问题 → 资料 → 提纲 → 带引用的报告 → 检查出处 | Research report: questions → sources → outline → cited report → citation check |
| `ecommerce-listing` | 电商商品上架：商品资料 → 卖点 → 标题 → 主图和详情页、客服问答并行 → 检查 | E-commerce listing: product facts → selling points → titles → detail page and Q&A in parallel → check |
| `slides` | PPT 演示稿：大纲 → 每页内容 → 网页幻灯片（可打印成 PDF）→ 检查 | Slide deck: outline → slide content → HTML deck (prints to PDF) → check |
| `live-selling` | 直播带货脚本：商品资料 → 流程表 → 话术和弹幕问答并行 → 检查 | Live-selling script: product facts → rundown → script and chat Q&A in parallel → check |
| `short-drama` | 竖屏微短剧：设定和人物 → 分集节拍 → 逐集剧本 → 审读 → 检查 | Vertical micro-drama: bible → episode beats → scripts → review → check |
| `lesson-plan` | 老师备课（逆向设计）：教学目标 → 评价任务 → 教案和分层练习并行 → 练习单和答案 | Lesson prep (backward design): objectives → assessment → plan and tiered exercises in parallel → worksheet and answer key |
| `novel-serial` | 网文连载：设定和卖点 → 分章细纲 → 黄金三章 → 检查 | Web novel serial: setting and hook → chapter outlines → first three chapters → check |
| `business-plan` | 商业计划书（红杉结构）：公司资料 → 市场和竞争 → 单位经济和财务 → BP 正文 → 检查 | Business plan (Sequoia's outline): company facts → market and competition → unit economics and financials → the plan → check |
| `event-plan` | 活动策划方案：活动简报 → 流程表、预算和风险预案并行 → 策划方案 → 检查 | Event proposal: brief → run of show, budget and risks in parallel → proposal → check |
| `hiring` | 招聘流程（结构化面试）：岗位需求 → 岗位分析 → 招聘启事和面试题并行 → 评分表 | Structured hiring: the role → job analysis → job ad and interview questions in parallel → scorecard |
| `travel-guide` | 旅行攻略：备选地点 → 按天行程 → 攻略笔记 → 检查 | Travel guide: candidate places → day-by-day itinerary → guide → check |
| `online-course` | 知识付费课程（ADDIE）：学员和成果 → 课程大纲 → 试听课逐字稿和介绍页并行 → 检查 | Online course (ADDIE): learners and outcomes → syllabus → trial lesson and course page in parallel → check |
| `landing-page` | 落地页：简报 → 结构 → 文案 → 照片（可空）→ 生成网页 → 检查 | Landing page: brief → structure → copy → photos (optional) → build → check |
| `social-posts` | 多平台帖子：角度 → 挑选 → 按平台写帖 → 检查 → 导出 | Social posts: angles → pick → one post per platform → check → export |
| `data-report` | 数据报告：表格 → 列画像 → 图表规格 → 手写 SVG → 结论在前的分析 → 报告和数字核对 | Data report: table → column profile → chart spec → hand-drawn SVG → answer-first analysis → report and number check |
| `meeting-notes` | 会议纪要：转录 → 整理 → 纪要 → 待办 → 检查 → 会后邮件 | Meeting notes: transcript → clean → minutes → actions → check → follow-up |
| `podcast` | 播客单集：资料 → 策划 → 台本 → 录前准备 → 录前检查 → 录音和转录 → 整理文字稿 → 节目简介 → 发布检查 | Podcast episode: notes → plan → script → guest brief → pre-record check → recording and transcript → transcript cleanup → show notes → publish check |
| `picture-book` | 绘本 / 漫画：创作说明 → 版式 → 故事 → 分页 → 文稿和插画说明 → 画前检查 → 插图 → 成书预览 → 印刷检查 | Picture book or comic: brief → layout → story → pagination → manuscript and art brief → pre-art check → art → book preview → print check |
| `product-launch` | 新品发布物料包：产品资料 → 定位和信息 → 发布计划和媒体资料 → 新闻稿 → 发布邮件 → Product Hunt 和帖子 → 常见问题 → 落地页简报 → 落地页 → 汇总 → 检查 | Product launch kit: facts → messaging → launch plan and fact sheet → press release → email → Product Hunt and posts → FAQ → landing brief → landing page → kit → check |
| `micro-course` | 知识付费微课视频（`online-course` 的视频版）：课程资料 → 教学设计 → 讲稿和幻灯片 → 幻灯片、提词稿和测验 → 录前检查 → AI 配音 → 录制 → 字幕和时间线 → 生成视频 → 上架前检查 | Micro-course video (the video version of `online-course`): brief → teaching design → script and slides → deck, teleprompter and quiz → pre-record check → AI voice → recording → captions and timeline → video → pre-publish check |

```bash
flowgit templates                 # 列出模板和它们的阶段 / list templates and their stages
flowgit init my-report -t weekly-report
flowgit -C my-report graph --md   # 画成 Mermaid 流程图贴进 README / a Mermaid diagram for your README
```

密钥只从环境变量读（例如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`、`FLOWGIT_TTS_API_KEY`，或短视频配音预设的 `OPENAI_API_KEY`、`DASHSCOPE_API_KEY`），不会写进任何文件。导出视频需要 [FFmpeg](https://ffmpeg.org/download.html)。

Keys are read only from environment variables (such as `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `FLOWGIT_TTS_API_KEY`, or a short-video speech preset's `OPENAI_API_KEY` or `DASHSCOPE_API_KEY`) and never written to a file. Exporting video needs [FFmpeg](https://ffmpeg.org/download.html).

完整说明、流程格式和模板见 / Full guide, flow format and templates: https://github.com/cgold9820-dotcom/Flowgit

Apache-2.0
