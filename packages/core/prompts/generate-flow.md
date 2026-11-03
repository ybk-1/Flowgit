# Flowgit flow files

Write the files of a Flowgit flow from the stage plan below: the flow, a prompt file for every `llm` and `agent` stage, and a script file for every `script` stage. Reply with one JSON object and nothing else: no Markdown fence and no commentary.

Description:
{{description}}

Language: {{language}}

Executors you may use: {{executors}}

Stage plan:
{{plan}}

Reply with this shape. The content is only an example of the shape:

{
  "flow": {
    "format": "flowgit",
    "version": "0.1",
    "name": "Conference talk proposal",
    "description": "Turn a speaker's notes into a talk proposal that follows the call for papers, and check it before sending.",
    "inputs": {
      "conference": { "type": "string", "description": "Name of the conference", "required": true }
    },
    "stages": [
      {
        "id": "materials",
        "name": "Notes and call for papers",
        "description": "The speaker's notes and the call for papers, pasted in by the person.",
        "executor": { "type": "human", "instructions": "Paste your notes on the talk and the whole call for papers, with its rules and review criteria." },
        "outputs": [{ "type": "text/markdown", "path": "materials.md" }]
      },
      {
        "id": "proposal",
        "name": "Proposal",
        "description": "Title, abstract, outline and bio, written to the call for papers.",
        "inputs": ["materials"],
        "executor": { "type": "llm", "prompt": "prompts/proposal.md" },
        "outputs": [{ "type": "text/markdown", "path": "proposal.md" }]
      }
    ]
  },
  "prompts": {
    "prompts/proposal.md": "# Talk proposal for {{inputs.conference}}\n\nWrite a talk proposal from the speaker's notes in materials.md, following the call for papers in the same file.\n\n..."
  },
  "scripts": {}
}

The flow:

- `format` is exactly `flowgit` and `version` is exactly `0.1`. Besides them, the flow has only `name`, `description`, `inputs` and `stages`.
- Keep the plan's stage ids, names, order, executors and output paths. A stage's dependencies are its `inputs`, an array of stage ids: the plan's `dependsOn`. Omit `inputs` when there are none.
- Every stage has `executor` as an object, one of:
  - `{ "type": "human", "instructions": "..." }`. The person reads the instructions as written, so no `{{inputs.<key>}}` in them.
  - `{ "type": "llm", "prompt": "prompts/<id>.md" }`, with exactly one output.
  - `{ "type": "script", "run": "node scripts/<id>.mjs" }`, only when the plan's executor is `script`.
  - `{ "type": "agent", "agent": "<the plan's agent>", "prompt": "prompts/<id>.md" }`, only when the plan's executor is `agent`.
- `flow.inputs` is an object keyed by input name. Each value has `type`, `description` and `required`, and may have `default` and `enum`.

Prompts, under `prompts`, one for every `llm` and `agent` stage:

- The model that runs a stage sees only its prompt, followed by the full text of the outputs of the stages in its `inputs`, each headed by its file name. Refer to those files by name, and to nothing else.
- Put each flow input the stage needs into its prompt as `{{inputs.<key>}}`. Every input in `flow.inputs` appears in at least one prompt, and a prompt uses only declared keys.
- Say what to produce and how it is laid out: the sections in order, what each holds, and lengths in words, sentences or items, never in characters.
- Say what good work looks like here: the method or standard a professional in the field uses (for example STAR for interview answers, the funder's rubric for a proposal, the platform's rules for a post).
- Use only facts from the input files and the flow inputs. Where something is missing, the output says so instead of inventing it.
- A check stage quotes each rule it checks, gives pass or fix for each, and ends with the fixes in order of importance.
- A prompt is usually 10 to 30 lines.

Scripts, under `scripts`, one for every `script` stage (`{}` when there are none):

- The key is the file its `run` names, such as `scripts/<id>.mjs`. The value is a Node.js ES module that uses only Node's standard library, such as `node:fs` and `node:path`.
- It runs in the flow directory. `process.env.FLOWGIT_INPUTS` is a JSON array of `{ "stage", "path", "type" }`, the outputs of the stages in its `inputs`. `process.env.FLOWGIT_OUTPUTS` is a JSON array of `{ "path", "type" }`, the files it must write. `process.env.FLOWGIT_FLOW_INPUTS` is a JSON object of the flow inputs. Paths are relative to the flow directory.
- It starts with a comment that says what it reads (the file, its columns and their formats) and what it computes, step by step. The `human` stage's instructions ask for exactly those columns.
- It reads only those files, and writes every one of its outputs and nothing else. It does not delete files, use the network, or start other programs.
- It accepts a UTF-8 byte order mark, Windows line endings, quoted CSV fields, and numbers with thousands separators, spaces or a currency sign. When an input is missing or malformed, it prints what is wrong and exits with code 1.
- When it compares periods, it first puts each row into its period (a calendar week runs Monday to Sunday) and writes which dates each period covers. The latest period is the current one.
- It prints one line saying what it read and found (rows, periods, groups), so the run log shows it.

Never add `mcpServers`, `forkedFrom`, output `schema` files, secrets or absolute paths.
