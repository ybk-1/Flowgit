# 调研报告 / Research report

把一个问题拆开，收集资料，写成带引用的报告。脚本会检查每个结论有没有出处。

Break a question into parts, gather sources, and write a cited report. A script checks that every claim has a source.

## 阶段 / Stages

1. **子问题 questions**（模型）：`questions.json`，3 到 6 个子问题，每个有 `id`（q1、q2…）和一句说明。
2. **资料 sources**（你）：在 `sources/` 里一个来源一个 Markdown，开头写标题和链接。模板有 3 份自己写的示例（其中 `shelter.md` 故意没被报告引用）。
3. **提纲 outline**（模型）：`outline.md`，每节写它回答哪个子问题、用哪些来源。
4. **报告 report**（模型）：`report.md`，每个结论后面用 `[来源文件名]` 标出处。
5. **检查 check**（脚本）：`check-report.md`。引用了不存在的来源、没被引用的来源、没有被回答的子问题、没有出处的段落。

1. **questions** (model): `questions.json`, 3 to 6 sub-questions, each with an `id` (`q1`, `q2`, …) and one sentence.
2. **sources** (you): one Markdown file per source in `sources/`, starting with a title and a link. The template ships 3 original samples (`shelter.md` is left uncited on purpose).
3. **outline** (model): `outline.md`. Each section says which sub-question it answers and which sources it uses.
4. **report** (model): `report.md`, with `[source file name]` after each claim.
5. **check** (script): `check-report.md`. Citations of sources that do not exist, sources never cited, sub-questions no section answers, and paragraphs without a citation.

## 怎么跑 / How to run

```bash
flowgit init ~/my-research -t research-report
cd ~/my-research
# 换成你的题目，并把 sources/ 换成你自己的笔记 / set your topic and replace sources/ with your notes
flowgit inputs set topic=为什么猫喜欢纸箱
flowgit inputs set language=zh          # 或 en / or en
flowgit run all
```

没有 API key 时，用固定回复跑通。示例报告故意漏掉 `sources/shelter.md`，所以 `check-report.md` 里会有一条「没被引用的来源」。

Without an API key, the canned replies run the flow. The sample report leaves out `sources/shelter.md` on purpose, so `check-report.md` lists a source never cited.

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```
