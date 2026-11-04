import * as vscode from "vscode";
import { MESSAGES } from "./logic/messages.js";
import { FlowItem, NoteItem, StageItem } from "./items.js";
import type { FlowStore } from "./store.js";

export class FlowTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: FlowStore) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) return [new NoteItem(vscode.l10n.t(MESSAGES.openFolder))];
      if (!this.store.views.length) return [new NoteItem(vscode.l10n.t(MESSAGES.noFlows))];
      return this.store.views.map((flow) => new FlowItem(flow));
    }
    if (element instanceof FlowItem) {
      if (element.flow.conflict || !element.flow.stages.length) return [];
      return element.flow.stages.map((stage) => new StageItem(element.flow, stage));
    }
    return [];
  }
}
