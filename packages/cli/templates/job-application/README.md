# 求职材料 / Job application

对照一份职位描述改简历，并同时写一封求职信。简历和求职信都只依赖「材料」和「匹配分析」，所以它们是并行的，不是一条直线。

Tailor a resume to a job description and write a cover letter at the same time. Both the resume and the letter depend only on the materials and the match analysis, so they run in parallel instead of in a straight line.

## 阶段 / Stages

1. **材料 materials**（你）：`materials/job.md` 是职位描述，`materials/resume.md` 是现在的简历。仓库里的是虚构的林可和青禾电商，用之前换成你自己的。
2. **匹配分析 analysis**（模型）：`analysis.json`，里面有 `matches`（已经符合的）、`gaps`（缺的）、`keywords`（简历里应该出现的词）。
3. **简历 resume**（模型）：改写后的 `resume.md`。不能编造经历，每处改动都要能在原简历里找到依据。
4. **求职信 letter**（模型）：`cover-letter.md`。和简历并行，不读改写后的简历。
5. **检查 check**（脚本）：`check-report.md`。看关键词覆盖了多少、两份文字的长度、有没有留下 `[...]` 这类占位符。

1. **materials** (you): `materials/job.md` is the job description and `materials/resume.md` is your current resume. The copies in the repo are a fictional person and company; replace them before you use them.
2. **analysis** (model): `analysis.json` with `matches` (already met), `gaps` (missing) and `keywords` (words the resume should contain).
3. **resume** (model): the rewritten `resume.md`. It must not invent experience; every change has to trace back to the original resume.
4. **letter** (model): `cover-letter.md`, in parallel with the resume. It does not read the rewritten resume.
5. **check** (script): `check-report.md`. Keyword coverage, whether the two texts are a reasonable length, and whether placeholders like `[...]` remain.

## 怎么跑 / How to run

```bash
flowgit init ~/my-job -t job-application
cd ~/my-job
# 换成你的材料和职位 / swap in your materials and the role
flowgit inputs set role=后端工程师
flowgit inputs set language=zh          # 或 en / or en
flowgit run all
```

没有 API key 时，可以用模板自带的固定回复把流程跑通：

Without an API key, the bundled canned replies run the whole flow:

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

`flowgit graph` 能看到「匹配分析」同时连到「简历」和「求职信」。

`flowgit graph` shows the analysis linked to both the resume and the letter.
