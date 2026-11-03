# Repair the flow

The flow JSON failed validation. Return the whole JSON object again, in the same shape `{ "flow", "prompts" }`, with every error below fixed. Change only what the errors require. Reply with one JSON object and nothing else: no Markdown fence and no commentary.

`format` stays `flowgit` and `version` stays `0.1`. Every llm or agent stage still has its prompt text under `prompts`.

Errors:
{{errors}}
