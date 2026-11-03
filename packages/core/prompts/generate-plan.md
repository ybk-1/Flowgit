# Flowgit stage plan

Turn one sentence into a stage plan for a Flowgit flow. Reply with one JSON object and nothing else: no Markdown fence and no commentary.

Description:
{{description}}

Language for names, descriptions and instructions: {{language}}
When the language says "match the description", use zh if the description is Chinese and en otherwise.

Executors you may use: {{executors}}

A stage plan has this shape:

{
  "name": "short flow name",
  "description": "one or two sentences",
  "language": "zh or en",
  "inputs": [
    { "name": "topic", "type": "string", "description": "what this input is", "required": true }
  ],
  "stages": [
    {
      "id": "notes",
      "name": "Notes",
      "description": "what this stage does",
      "executor": "human",
      "dependsOn": [],
      "outputs": [{ "type": "text/markdown", "path": "notes.md" }],
      "instructions": "what the person should put in the file"
    },
    {
      "id": "draft",
      "name": "Draft",
      "description": "what the model writes",
      "executor": "llm",
      "dependsOn": ["notes"],
      "outputs": [{ "type": "text/markdown", "path": "report.md" }]
    }
  ]
}

Rules:

- Two to six stages. `dependsOn` lists earlier stage ids. No cycles, and a stage does not depend on itself.
- `id` matches `^[a-z][a-z0-9_-]*$`. `name` is the words a person sees.
- Prefer `human` for material only a person has, and `llm` for writing or rewriting. An `llm` stage has exactly one output.
- `script` and `agent` run commands on the computer. Use them only when they appear in "Executors you may use". A screenplay, 视频脚本, or 剧本 is a document, not a `script` stage.
- A `script` stage includes `run`: one shell command, relative to the flow directory. An `agent` stage includes `agent`: one of `claude-code`, `codex`, `cursor`, `gemini`.
- Output paths are relative. They are not `flow.json`, `flow.md`, or anything under `runs/`.
- `inputs` are the flow's parameters (topic, name, language), not stage ids. `type` is `string`, `text`, `number`, `boolean`, or `file`. Omit `inputs` when the description needs none.
- Do not invent secrets, API keys, URLs with passwords, or absolute paths.
