# Flowgit flow files

Write a Flowgit flow from the stage plan below. Reply with one JSON object and nothing else: no Markdown fence and no commentary.

Description:
{{description}}

Language: {{language}}
When the language says "match the description", use zh if the description is Chinese and en otherwise. Prompts and instructions use that language.

Executors you may use: {{executors}}

Stage plan:
{{plan}}

Reply with this shape:

{
  "flow": {
    "format": "flowgit",
    "version": "0.1",
    "name": "the plan's name",
    "description": "the plan's description",
    "language": "zh",
    "inputs": {
      "topic": { "type": "string", "description": "what it is", "required": true }
    },
    "stages": []
  },
  "prompts": {
    "prompts/draft.md": "# Draft\n\nWhat to write.\n"
  }
}

Rules:

- `format` is exactly `flowgit`. `version` is exactly `0.1`. No other top-level fields.
- Keep the plan's stage ids, names, order, dependencies and output paths. On a stage, dependencies are `inputs` (an array of stage ids). Omit `inputs` when there are none.
- `human`: `{ "type": "human", "instructions": "..." }`. No other fields.
- `llm`: `{ "type": "llm", "prompt": "prompts/<id>.md" }` and exactly one output. No other fields.
- `script`, only when the plan's executor is `script`: `{ "type": "script", "run": "<the plan's command>" }`.
- `agent`, only when the plan's executor is `agent`: `{ "type": "agent", "agent": "<the plan's agent>", "prompt": "prompts/<id>.md" }`.
- Every `llm` and `agent` stage has its prompt file under `prompts`, and the text is not empty. The prompt says what to write and how it should look. It may use `{{inputs.<key>}}` only for keys declared on `flow.inputs`.
- `flow.inputs` is an object, not an array. Each value has `type` (`string`, `text`, `number`, `boolean`, or `file`) and may have `description`, `required`, `default` and `enum`.
- Do not add `mcpServers`, `forkedFrom`, output `schema` files, secrets, or absolute paths.
