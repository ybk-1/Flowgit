# 客服 SOP / Customer-support SOP

资料 → 汇总 → 规程 → 用例 → 检查 → 技能。

Knowledge → collect → SOP → cases → check → skill.

| 阶段 / Stage | 谁来做 / Who | 产物 / Output |
| --- | --- | --- |
| 资料 knowledge | 你 / you | `knowledge/` |
| 汇总 collect | `scripts/collect-knowledge.mjs` | `knowledge.md` |
| 规程 sop | 模型（`prompts/sop.md`） | `sop.md` |
| 用例 cases | 模型（`prompts/cases.md`） | `cases.json` |
| 检查 check | 模型（`prompts/check.md`） | `report.md` |
| 技能 skill | `scripts/build-skill.mjs` | `skill/SKILL.md`、`skill/cases.json` |

模型阶段只能看到文件夹的文件列表，看不到正文，所以汇总这一步会按文件名把 `knowledge/` 里的 `.md` / `.txt` 合并成 `knowledge.md`，每份文件单独一节。

An llm stage only sees a file list for a directory, so collect merges the `.md` and `.txt` files in `knowledge/` into `knowledge.md`, one section per file name.

## 输入 / Inputs

| 输入 / Input | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `product` | （必填 / required） | 产品名称 | Product name |
| `tone` | `亲切、简洁` | 客服语气 | Tone of the replies |
| `language` | `zh` | 规程、用例、检查报告和脚本日志的语言：`zh` 或 `en` | Language of the SOP, cases, review and script logs: `zh` or `en` |

## 运行 / Run

```bash
flowgit init -t support-sop ~/support
cd ~/support
flowgit inputs set product="澄光台灯"
flowgit inputs set language=en     # 可选，想要英文规程时 / optional, for an English SOP
export ANTHROPIC_API_KEY=...       # 规程、用例和检查会调模型 / the SOP, cases and review call a model
flowgit run all                    # 跑到资料阶段会停下等你 / stops at the knowledge stage and waits for you
mkdir -p knowledge && cp -R example-knowledge/. knowledge/
flowgit run all                    # 汇总 → 规程 → 用例 → 检查 → 技能 / collect → SOP → cases → check → skill
```

`example-knowledge/` 是一份虚构产品「澄光台灯」的示例资料（FAQ、产品说明、退换货政策）。它不会自动成为资料阶段的产物；把里面的文件复制到 `knowledge/` 之后，流程才会继续。也可以 `flowgit run knowledge --from example-knowledge`，效果一样。

`example-knowledge/` is sample material for a fictional product, the Chenguang desk lamp (FAQ, product notes, return policy). It is not the knowledge stage's output. Copy those files into `knowledge/` and the flow continues. `flowgit run knowledge --from example-knowledge` does the same copy.

Windows（PowerShell）：

```powershell
New-Item -ItemType Directory -Force knowledge | Out-Null
Copy-Item -Recurse example-knowledge\* knowledge\
```

想用别的模型写规程、用例和检查，加上 `--model`，比如 `flowgit run all --model glm/glm-5.3`（需要 `GLM_API_KEY`）。`flowgit providers` 列出所有能接的模型供应商。

To use another model for the SOP, cases and review, add `--model`, e.g. `flowgit run all --model glm/glm-5.3` (needs `GLM_API_KEY`). `flowgit providers` lists every provider you can use.

没有 API key 想先看效果，用自带的示例回复（示例内容是中文，产品是澄光台灯）：

No API key yet? Use the bundled demo replies (the demo content is in Chinese, for the Chenguang desk lamp):

```bash
mkdir -p knowledge && cp -R example-knowledge/. knowledge/
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all --input product=澄光台灯
```

## 用例 / Cases

`cases.json` 是 JSON 数组。每一项有顾客原话 `customer`、意图 `intent`、期望处理 `expected`。技能阶段把同一份数组写到 `skill/cases.json`，当作评测集。

`cases.json` is a JSON array. Each item has the customer's words (`customer`), the intent (`intent`) and the expected handling (`expected`). The skill stage writes that same array to `skill/cases.json` as the eval set.

`skill/SKILL.md` 是一份 Skill：frontmatter 里第一行是 `name:`，接着是 `description:`，正文就是 `sop.md`。

`skill/SKILL.md` is a skill: the first field in the frontmatter is `name:`, then `description:`, and the body is `sop.md`.

## 读报告，改规程，重跑后面 / Read the report, edit the SOP, re-run what follows

示例回复里的 `report.md` 会指出发票步骤偏薄。直接改 `sop.md`（或改 `prompts/sop.md` 后 `flowgit run sop`）。`flowgit status` 会把下游的用例、检查、技能标成「需重跑」，`flowgit run all` 只重跑这些；你手改过的 `sop.md` 会先存成一个版本，不会被覆盖。

The sample `report.md` points out that the invoice steps are thin. Edit `sop.md` directly, or change `prompts/sop.md` and run `flowgit run sop`. `flowgit status` marks the downstream cases, check and skill stages as needing a re-run, and `flowgit run all` re-runs only those. A hand edit of `sop.md` is saved as a version first and never overwritten.

把这条客服流程暴露成 MCP 服务，是以后的方向。

Exposing this support flow as an MCP service is a later direction.
