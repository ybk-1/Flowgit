# 子流程示例 / Sub-flow example

人先把题目写进 `topic.md`。下一步是一个 `workflow` 阶段（`engine` 为 `flowgit`），运行 `subflows/brief`：模型按题目写 `brief.md`，脚本检查它有标题。父流程只把 `brief.md` 复制回来，再摘成 `summary.md`。

A person writes the topic in `topic.md`. The next stage is `workflow` with `engine` `flowgit`. It runs `subflows/brief`: the model writes `brief.md` for that topic, and a script checks that it has a heading. The parent copies only `brief.md` back, then turns it into `summary.md`.

子流程用自己的 `runs/`，在 `subflows/brief/runs/` 下面。父流程的 `runs/` 里只有题目、简报和摘要三个阶段。

The sub-flow keeps its own `runs/`, under `subflows/brief/runs/`. The parent's `runs/` only has the topic, brief and summary stages.

`params.inputs.topic` 写成 `{{inputs.topic}}`，运行时换成父流程的题目。`language` 这里固定是 `zh`。

`params.inputs.topic` is `{{inputs.topic}}`, filled from the parent topic when the stage runs. `language` is fixed to `zh` here.

没有模型密钥时，用子流程自带的示例回复：

Without a model key, use the canned reply that ships with the sub-flow:

```bash
flowgit inputs set topic=为什么猫喜欢纸箱
# 把题目写进 topic.md 之后 / after writing the topic into topic.md:
FLOWGIT_LLM_MOCK_DIR=subflows/brief/demo-replies flowgit run all
```

`flowgit doctor` 会检查子流程里的模型和 `node`。`flowgit run all --dry-run` 把简报这一步标成会运行。`flowgit graph` 把这一步画成 `sub-flow`。

`flowgit doctor` checks the model inside the sub-flow, and `node`. `flowgit run all --dry-run` lists the brief stage as one that would run. `flowgit graph` draws that stage as `sub-flow`.
