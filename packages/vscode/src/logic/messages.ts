/** English UI strings. `vscode.l10n.t` looks these up in l10n/bundle.l10n.zh-cn.json. */
export const MESSAGES = {
  run: "Run",
  fresh: "Fresh",
  stale: "Stale",
  neverRun: "Never run",
  missingUpstream: "Missing upstream",
  edited: "Edited",
  failed: "Failed",
  missingInputs: "Missing flow inputs: {0}",
  cliMissing: "Flowgit CLI not found. Install it with {0}.",
  cliSettingMissing: "flowgit.cliPath was not found ({0}). Install it with {1}.",
  restricted:
    "This workspace is in Restricted Mode, so Flowgit will not run commands. Trust the workspace to run a stage, run all stages, open the board, compare versions, or confirm a copied flow.",
  manageTrust: "Manage Workspace Trust",
  notRun: "This stage has not run yet.",
  noFlows: "No flow found in this workspace.",
  openFolder: "Open a folder to see flows.",
  conflict: "This folder has both flow.json and flow.md. Keep one.",
  chooseFlow: "Choose a flow",
  chooseStage: "Choose a stage",
  open: "Open",
  statusFailed: "Could not read status.",
  unreadable: "Could not read the flow file.",
  runStageTitle: "Run {0}",
  runAllTitle: "Run all",
  boardTitle: "Open board",
  diffTitle: "Compare {0}",
  trustTitle: "Confirm copied flow",
} as const;

/** English label for a `flowgit status --json` state. Unknown states pass through. */
export function stateText(state: string | undefined): string {
  switch (state) {
    case "ok":
      return MESSAGES.fresh;
    case "stale":
      return MESSAGES.stale;
    case "never-run":
      return MESSAGES.neverRun;
    case "waiting-upstream":
      return MESSAGES.missingUpstream;
    case "edited":
      return MESSAGES.edited;
    case "error":
      return MESSAGES.failed;
    default:
      return state ?? "";
  }
}
