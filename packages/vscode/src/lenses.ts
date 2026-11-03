import path from "node:path";
import * as vscode from "vscode";
import { stageCodeLensAnchors } from "./logic/codelens.js";
import { MESSAGES, stateText } from "./logic/messages.js";
import type { FlowStore } from "./store.js";

export class FlowCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly store: FlowStore) {}

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (path.basename(document.fileName) !== "flow.json") return [];
    const dir = path.dirname(document.uri.fsPath);
    const view = this.store.views.find((flow) => flow.dir === dir && path.basename(flow.file) === "flow.json");
    const lenses: vscode.CodeLens[] = [];
    for (const anchor of stageCodeLensAnchors(document.getText())) {
      if (anchor.line < 0 || anchor.line >= document.lineCount) continue;
      const stage = view?.stages.find((item) => item.id === anchor.stageId);
      const label = stage?.state ? vscode.l10n.t(stateText(stage.state)) : "";
      const title = label ? `${label} · ${vscode.l10n.t(MESSAGES.run)}` : vscode.l10n.t(MESSAGES.run);
      const line = document.lineAt(anchor.line);
      lenses.push(
        new vscode.CodeLens(new vscode.Range(anchor.line, 0, anchor.line, line.text.length), {
          title,
          command: "flowgit.runStage",
          arguments: [dir, anchor.stageId],
        }),
      );
    }
    return lenses;
  }
}
