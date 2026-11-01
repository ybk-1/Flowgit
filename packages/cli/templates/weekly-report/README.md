# 周报（入门示例）/ Weekly report (starter example)

最小的"人 + 模型 + 脚本"流程，也是 [动手做一个流程](https://github.com/cgold9820-dotcom/Flowgit/blob/main/docs/guide.md) 教程最后做出来的样子：

1. **随手记**（人）：把这周的事一行一件写进 `notes.md`。
2. **周报草稿**（模型）：整理成三段，本周完成、下周计划、需要帮助，写进 `report.md`。
3. **检查**（脚本）：检查三个小节都在、每节都有要点、没有占位符、长度合适，结果写进 `check.json`。

The smallest "person + model + script" flow, and what the [Build your own flow](https://github.com/cgold9820-dotcom/Flowgit/blob/main/docs/guide.md) tutorial ends up with:

1. **Notes** (person): one line per thing you did this week, in `notes.md`.
2. **Draft** (model): turns them into three sections (done this week, next week, need help) in `report.md`.
3. **Check** (script): checks the three sections are there, each has a bullet, nothing is left as a placeholder and the length is sane; writes `check.json`.

## 运行 / Run

macOS / Linux（`flowgit` 命令的设置见根目录 README 的"快速开始" / see "Quick start" in the root README to set up the `flowgit` command）：

```bash
flowgit init ~/my-report -t weekly-report
cd ~/my-report
flowgit inputs set name="小林"
flowgit run notes --from sample-notes.md          # 或者自己写 notes.md / or write notes.md yourself
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all  # 用示例回复试跑，不花钱 / try it with the demo reply, free
```

Windows PowerShell：

```powershell
flowgit init $HOME\my-report -t weekly-report
cd $HOME\my-report
flowgit inputs set name="小林"
flowgit run notes --from sample-notes.md
$env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all; Remove-Item Env:FLOWGIT_LLM_MOCK_DIR
```

用真的模型：去掉 `FLOWGIT_LLM_MOCK_DIR`，设好密钥再跑 `flowgit run draft --force`。比如 DeepSeek：

With a real model: drop `FLOWGIT_LLM_MOCK_DIR`, set a key and run `flowgit run draft --force`. For example, DeepSeek:

```bash
export DEEPSEEK_API_KEY=...                      # PowerShell: $env:DEEPSEEK_API_KEY="..."
flowgit run draft --force --model deepseek/deepseek-v4-pro
flowgit run all
```

## 输入 / Inputs

| 输入 / Input | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `name` | 必填 / required | 写在标题里的名字 | The name in the title |
| `team` | `团队同事` | 周报写给谁看 | Who reads the report |
| `language` | `zh` | `zh` 或 `en`，周报和检查结果的语言 | `zh` or `en`: language of the report and the check |

## 文件 / Files

- `flow.json`：三个阶段的定义。/ the three stages.
- `prompts/draft.md`：草稿阶段的提示词。/ the draft stage's prompt.
- `scripts/check-report.mjs`：检查脚本。/ the check script.
- `sample-notes.md`：一份示例随手记。/ sample notes.
- `demo-replies/draft.md`：试跑用的固定回复。/ the canned reply for a free trial run.
