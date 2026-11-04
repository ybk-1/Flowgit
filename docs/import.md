# 从 Dify 和 n8n 导入 / Import from Dify and n8n

`flowgit import <文件> [--from dify|n8n] [--out 目录] [--dry-run]` 读取一份 [Dify DSL](https://docs.dify.ai/en/learn/key-concepts)（YAML，含 `app` 和 `workflow.graph`）或一份 [n8n 工作流](https://docs.n8n.io/workflows/export-import/)（JSON，含 `nodes` 和 `connections`），写成一个 Flowgit 流程。

`flowgit import <file> [--from dify|n8n] [--out dir] [--dry-run]` reads a [Dify DSL](https://docs.dify.ai/en/learn/key-concepts) (YAML with `app` and `workflow.graph`) or an [n8n workflow](https://docs.n8n.io/workflows/export-import/) (JSON with `nodes` and `connections`) and writes a Flowgit flow.

不写 `--from` 时按内容识别。认不出就报错，不写文件。`--dry-run` 只打印导入报告和文件列表。目录里已经有 `flow.json`、`flow.md` 或将要写入的文件时，什么都不覆盖。

Without `--from`, the format is detected from the contents. An unknown file is an error and nothing is written. `--dry-run` only prints the import report and the file list. If the directory already has `flow.json`, `flow.md`, or a file that would be written, nothing is overwritten.

```bash
flowgit import topic.yml --out ~/topic
flowgit import workflow.json --from n8n --out ~/topic --dry-run
```

导入的流程会记下 `forkedFrom.source`，只有文件名：`dify:<文件名>` 或 `n8n:<文件名>`，不会写本机路径。里面若有 script 或 service，第一次运行前要 `flowgit trust`，和从 Git 地址复制来的流程一样。

An imported flow records `forkedFrom.source` as the file name only, `dify:<filename>` or `n8n:<filename>`, never a local path. If it has a script or a service, run `flowgit trust` before the first run, the same as a flow copied from a Git URL.

写入前会检查生成的文件。发现密钥就停下，什么都不写。请求头里的密钥不会照抄，而是改成 `{{env.名称}}`，名称来自原来的变量名或凭据名。

Generated files are checked before anything is written. A key stops the import and nothing is written. A key in a request header is not copied; it becomes `{{env.NAME}}`, named from the original variable or credential.

## 节点怎么对应 / How nodes map

| 原来 / Original | 变成 / Becomes |
| --- | --- |
| Dify `start`；n8n 手动触发、Webhook、Form 触发 / Dify `start`; n8n manual, webhook, and form triggers | 流程输入 / flow inputs |
| Dify `llm`；n8n 的 LangChain 链、Agent、OpenAI / Dify `llm`; n8n LangChain chain, Agent, OpenAI | `llm`，提示词在 `prompts/<id>.md` / `llm`, prompt in `prompts/<id>.md` |
| Dify `code`；n8n Code / Dify `code`; n8n Code | `script`（`scripts/<id>.py` 或 `.mjs`）。用了 `$items` 或 `this.helpers` 的改成人工阶段 / `script` (`scripts/<id>.py` or `.mjs`). Code that uses `$items` or `this.helpers` becomes a human stage |
| Dify `http-request`；n8n HTTP Request 的 GET 和 POST / Dify `http-request`; n8n HTTP Request GET and POST | `service` |
| 其他方法、上传文件、分支、循环、知识库、聚合、分类、认不出的节点 / other methods, file uploads, branches, loops, knowledge, aggregators, classifiers, unknown nodes | 人工阶段 / human stage |

Dify 的 `{{#节点.变量#}}`、n8n 的 `{{ $json.x }}` 和 `{{ $('节点').item.json.x }}`：对得上流程输入的写成 `{{inputs.名称}}`；指向上游节点的写成「见上游产物 &lt;阶段 id&gt; / see the upstream output &lt;stage id&gt;」；对不上的原样留下，并写进报告。

Dify's `{{#node.var#}}` and n8n's `{{ $json.x }}` and `{{ $('Node').item.json.x }}`: a match for a flow input becomes `{{inputs.name}}`; a reference to an upstream node becomes "见上游产物 &lt;stage id&gt; / see the upstream output &lt;stage id&gt;"; anything else is left as written and listed in the report.

原来的模型名只出现在报告里。能确定对应 Flowgit 预设时才写入 `model`，例如 `deepseek-chat` → `deepseek/deepseek-chat`（[DeepSeek 模型名](https://api-docs.deepseek.com/)）。

The original model name is only in the report. It is written to `model` only when it surely matches a Flowgit preset, for example `deepseek-chat` → `deepseek/deepseek-chat` ([DeepSeek model ids](https://api-docs.deepseek.com/)).

Flowgit 没有分支。条件的两路都按原来的顺序留下来，报告里会说明。

Flowgit has no branches. Both sides of a condition are kept in order, and the report says so.

阶段 id 来自节点标题，只用 `a-z`、`0-9` 和 `-`。重名的后面加数字。

Stage ids come from node titles and use only `a-z`, `0-9` and `-`. A duplicate gets a number.

## 例子 / Examples

下面两份都是按官方结构手写的，不是从别人的工作流复制的。Dify 的变量写法见[提示词里的 `{{#节点.变量#}}`](https://github.com/langgenius/dify/blob/main/web/app/components/base/prompt-editor/constants.tsx)，n8n 的表达式见[引用上游数据](https://docs.n8n.io/build/work-with-data/reference-data/reference-previous-nodes/)。

Both samples below are written by hand from the official shapes, not copied from someone else's workflow. Dify's variable syntax is in [`{{#node.var#}}` in prompts](https://github.com/langgenius/dify/blob/main/web/app/components/base/prompt-editor/constants.tsx), and n8n's expressions are in [referencing previous nodes](https://docs.n8n.io/build/work-with-data/reference-data/reference-previous-nodes/).

### Dify

```yaml
version: "0.1.5"
kind: app
app:
  name: Topic summary
  mode: workflow
  description: Summarize a topic
workflow:
  graph:
    nodes:
      - id: start
        type: custom
        data:
          type: start
          title: Start
          variables:
            - variable: topic
              label: Topic
              type: text-input
              required: true
      - id: llm
        type: custom
        data:
          type: llm
          title: Draft
          model:
            provider: langgenius/deepseek/deepseek
            name: deepseek-chat
            mode: chat
          prompt_template:
            - role: user
              text: "Write about {{#start.topic#}}"
    edges:
      - id: start-llm
        source: start
        target: llm
```

`flowgit import topic.yml --out ~/topic` 写入：

`flowgit import topic.yml --out ~/topic` writes:

```text
~/topic/
  flow.json          # forkedFrom.source = dify:topic.yml
  README.md          # 含「导入报告 / Import report」/ includes "导入报告 / Import report"
  prompts/draft.md
```

带代码节点时还有 `scripts/<id>.py`（`python3`）或 `scripts/<id>.mjs`（`node`）。包装从 `FLOWGIT_FLOW_INPUTS` 和上游产物读参数，把返回值写成 JSON。Windows 上常常只有 `python` 或 `py`，没有 `python3`：这时把那个阶段的 `run` 改成 `python scripts/<id>.py`（`requires` 也一起改）。

A code node also writes `scripts/<id>.py` (`python3`) or `scripts/<id>.mjs` (`node`). The wrapper reads `FLOWGIT_FLOW_INPUTS` and the upstream outputs, and writes the return value as JSON. Windows often has `python` or `py` but no `python3`: then change that stage's `run` to `python scripts/<id>.py` (and its `requires` too).

### n8n

```json
{
  "name": "Topic summary",
  "nodes": [
    {
      "name": "Intake",
      "type": "n8n-nodes-base.formTrigger",
      "parameters": {
        "formFields": { "values": [{ "fieldName": "topic", "fieldLabel": "Topic", "fieldType": "text", "requiredField": true }] }
      }
    },
    {
      "name": "Draft",
      "type": "@n8n/n8n-nodes-langchain.agent",
      "parameters": { "text": "={{ $json.topic }}", "model": "deepseek-chat" }
    }
  ],
  "connections": {
    "Intake": { "main": [[{ "node": "Draft", "type": "main", "index": 0 }]] }
  }
}
```

目录和上面一样，`forkedFrom.source` 是 `n8n:<文件名>`。Form 的 `topic` 变成流程输入，提示词里写成 `{{inputs.topic}}`。

The directory is the same, with `forkedFrom.source` of `n8n:<filename>`. The form's `topic` becomes a flow input, and the prompt uses `{{inputs.topic}}`.

## 不做 / Not done

不把流程导回 Dify 或 n8n，不导入 ComfyUI，也不运行 n8n 本身（`workflow` 的 `n8n` 引擎仍然只是预留）。

This does not export a flow back to Dify or n8n, does not import ComfyUI, and does not run n8n itself (the `n8n` engine of `workflow` stays reserved).
