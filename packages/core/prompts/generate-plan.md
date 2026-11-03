# Flowgit stage plan

Turn one sentence into a stage plan for a Flowgit flow. A flow is a job split into stages, and each stage writes files that a person can open, edit and run again. Reply with one JSON object and nothing else: no Markdown fence and no commentary.

Description:
{{description}}

Language: {{language}}

Executors you may use: {{executors}}

A stage plan has this shape. The content is only an example of the shape:

{
  "name": "Conference talk proposal",
  "description": "Turn a speaker's notes into a talk proposal that follows the call for papers, and check it before sending.",
  "inputs": [
    { "name": "conference", "type": "string", "description": "Name of the conference", "required": true },
    { "name": "slot_minutes", "type": "number", "description": "Length of the talk slot in minutes", "required": false, "default": 30 }
  ],
  "stages": [
    {
      "id": "materials",
      "name": "Notes and call for papers",
      "description": "The speaker's notes and the call for papers, pasted in by the person.",
      "executor": "human",
      "dependsOn": [],
      "outputs": [{ "type": "text/markdown", "path": "materials.md" }],
      "instructions": "Paste your notes on the talk (topic, key points, stories, your background) and the whole call for papers, with its rules and review criteria."
    },
    {
      "id": "proposal",
      "name": "Proposal",
      "description": "Title, abstract, outline and bio, written to the call for papers.",
      "executor": "llm",
      "dependsOn": ["materials"],
      "outputs": [{ "type": "text/markdown", "path": "proposal.md" }],
      "instructions": "Write a title, a 150-word abstract, an outline that fits the slot, and a three-sentence bio, from the facts in materials.md only."
    },
    {
      "id": "check",
      "name": "Check against the call",
      "description": "Checks the proposal against every rule and review criterion in the call.",
      "executor": "llm",
      "dependsOn": ["materials", "proposal"],
      "outputs": [{ "type": "text/markdown", "path": "check.md" }],
      "instructions": "Quote each rule and criterion of the call, say pass or fix for the proposal, and list the fixes in order of importance."
    }
  ]
}

How to split the job:

- Two to six stages, in the order they run. Follow the steps a professional in this field takes. Each stage makes one thing a person would want to read or edit on its own.
- `human` is for material only the person has (their notes, a document to review, a data file, a policy, a brief) or a decision only they can make before the next step. Its `instructions` say exactly what to put in the file, in one to three sentences, and ask for everything the later stages need from the person (both weeks of data when a stage compares them, the rubric when a stage scores against it).
- `llm` is for writing, rewriting, analysis and checks. An `llm` stage has exactly one output, usually `text/markdown`. Its `instructions` are its brief: what to produce, from which files, to what standard.
- When the work must follow rules (a platform's rules, a funder's rubric, a refund policy, a law, a style guide, a format), the last stage is an `llm` stage that checks the work against those rules and lists what to fix.
- No stage at the end where a person reviews, approves or finalizes the result: the person can edit any output directly, and their edits are kept.
- `dependsOn` lists every earlier stage whose output this stage reads. A stage sees only the outputs of the stages in its `dependsOn`, so a stage that uses both the questions and the answers depends on both.
- An `llm` stage reads files, not folders: a folder shows the model only its file names. So a `human` stage that an `llm` stage reads has one file output that holds everything (for example all eight interviews in `interviews.md`).
- `id` matches `^[a-z][a-z0-9_-]*$`. `name` is the few words a person sees. Output paths are relative, and are not `flow.json`, `flow.md`, or anything under `runs/`.

Inputs:

- `inputs` are short values the person types each time the flow runs: a topic, a city, a number of days, a tone, an audience. `type` is `string`, `number` or `boolean`. Each input has a `description` and `required`; an optional one (`"required": false`) has a `default`. An input with a few fixed choices lists them in `enum`.
- An input's `name` is a key of English letters, digits and `_` that matches `^[A-Za-z_][A-Za-z0-9_]*$`, such as `tone` or `trial_days`; a prompt uses it as `{{inputs.tone}}`. Its `description` is in the flow's language.
- Every input is used by at least one `llm` or `agent` stage. Omit `inputs` when the description needs none.
- A document, data, notes, a pasted policy, or anything longer than a line is not an input. It is the output of a `human` stage (`contract.md`, `sales.csv`), and the stages that use it depend on that stage.

Script and agent stages, only when they appear in "Executors you may use":

- `script` and `agent` run commands on the person's computer. A screenplay, 视频脚本 or 剧本 is a document, not a `script` stage.
- A `script` stage does exact work a program does better than a model: arithmetic over a CSV, counting, checking a format. Its `run` is `node scripts/<id>.mjs`, a Node.js file the next round writes. It reads the outputs of the stages it depends on and writes its own outputs (for example `summary.md`).
- An `agent` stage starts a coding agent in the flow directory, for work that has to look around or change files, such as reading a repository. Its `agent` is one of `claude-code`, `codex`, `cursor`, `gemini`, and its `instructions` are its brief.

Never put secrets, API keys, URLs with passwords or absolute paths in the plan, and never `{{inputs.<key>}}` in a `human` stage's `instructions`: the person reads them as written.
