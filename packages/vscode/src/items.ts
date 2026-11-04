import * as vscode from "vscode";
import fs from "node:fs";
import { CLI_INSTALL_HINT } from "./logic/cli.js";
import { MESSAGES, stateText } from "./logic/messages.js";
import { stageOpenCandidates, type FlowView, type StageView } from "./logic/model.js";
import { pathInside } from "./logic/paths.js";

export class FlowItem extends vscode.TreeItem {
  constructor(readonly flow: FlowView) {
    super(flow.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "flow";
    this.id = `flow:${flow.dir}`;
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = flow.dir;
    this.description = flowDescription(flow);
  }
}

export class StageItem extends vscode.TreeItem {
  constructor(readonly flow: FlowView, readonly stage: StageView) {
    super(stage.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "stage";
    this.id = `stage:${flow.dir}:${stage.id}`;
    this.iconPath = stateIcon(stage.state);
    this.description = stage.state ? vscode.l10n.t(stateText(stage.state)) : undefined;
    const bits = [stage.id, stage.executor, stage.state].filter(Boolean);
    this.tooltip = bits.join(" · ");
    this.command = {
      command: "flowgit.openStage",
      title: vscode.l10n.t(MESSAGES.open),
      arguments: [this],
    };
  }
}

export class NoteItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "note";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

function flowDescription(flow: FlowView): string | undefined {
  if (flow.conflict) return vscode.l10n.t(MESSAGES.conflict);
  if (flow.problem === "cli-missing") return vscode.l10n.t(MESSAGES.cliMissing, CLI_INSTALL_HINT);
  if (flow.problem === "cli-setting") return vscode.l10n.t(MESSAGES.cliSettingMissing, flow.problemDetail ?? "", CLI_INSTALL_HINT);
  if (flow.problem === "status-failed") return vscode.l10n.t(MESSAGES.statusFailed);
  if (flow.problem === "unreadable") return vscode.l10n.t(MESSAGES.unreadable);
  if (flow.missingInputs.length) return vscode.l10n.t(MESSAGES.missingInputs, flow.missingInputs.join(", "));
  return undefined;
}

function stateIcon(state: string | undefined): vscode.ThemeIcon {
  switch (state) {
    case "ok":
      return new vscode.ThemeIcon("pass");
    case "stale":
      return new vscode.ThemeIcon("warning");
    case "edited":
      return new vscode.ThemeIcon("edit");
    case "error":
      return new vscode.ThemeIcon("error");
    case "waiting-upstream":
      return new vscode.ThemeIcon("clock");
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

export function isFlowItem(value: unknown): value is FlowItem {
  return value instanceof FlowItem;
}

export function isStageItem(value: unknown): value is StageItem {
  return value instanceof StageItem;
}

/** First existing output inside the flow, else the prompt, else the flow file. */
export function openUri(flow: FlowView, stage: StageView): vscode.Uri {
  for (const candidate of stageOpenCandidates(stage, flow.file)) {
    const abs = pathInside(flow.dir, candidate.relative);
    if (!abs) continue;
    if (candidate.kind === "flow" || fs.existsSync(abs)) return vscode.Uri.file(abs);
  }
  return vscode.Uri.file(flow.file);
}
