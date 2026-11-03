import path from "node:path";
import * as vscode from "vscode";
import { isFlowItem, isStageItem, openUri, type StageItem } from "./items.js";
import { CLI_INSTALL_HINT, resolveCli, type CliSearch } from "./logic/cli.js";
import { MESSAGES } from "./logic/messages.js";
import type { FlowView, StageView } from "./logic/model.js";
import { taskLaunch, useShellExecution, type FlowgitAction, type TaskLaunch } from "./logic/tasks.js";
import type { FlowStore } from "./store.js";
import fs from "node:fs";

/**
 * Run commands call the CLI through a VS Code Task. Arguments stay an array
 * (`ProcessExecution` / `ShellExecution`); this file never joins them into a
 * command line. https://code.visualstudio.com/api/references/vscode-api#ProcessExecution
 *
 * Workspace trust: https://code.visualstudio.com/api/extension-guides/workspace-trust
 * `enablement` is not tied to `isWorkspaceTrusted`. A disabled command cannot
 * show a reason, and CodeLens invokes the command directly. The handler
 * refuses and explains. The sidebar banner says the same thing.
 */
export function registerCommands(context: vscode.ExtensionContext, store: FlowStore, search: () => CliSearch): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("flowgit.refresh", () => store.refresh()),
    vscode.commands.registerCommand("flowgit.openStage", async (arg?: unknown) => {
      if (!isStageItem(arg)) return;
      await openStage(arg);
    }),
    vscode.commands.registerCommand("flowgit.runStage", async (arg?: unknown, stageId?: unknown) => {
      const picked = await resolveStage(store, arg, stageId);
      if (!picked) return;
      await runAction(store, search, picked.flow.dir, { kind: "run", stageId: picked.stage.id }, vscode.l10n.t(MESSAGES.runStageTitle, picked.stage.name));
    }),
    vscode.commands.registerCommand("flowgit.runAll", async (arg?: unknown) => {
      const flow = await resolveFlow(store, arg);
      if (!flow) return;
      await runAction(store, search, flow.dir, { kind: "run-all" }, vscode.l10n.t(MESSAGES.runAllTitle));
    }),
    vscode.commands.registerCommand("flowgit.board", async (arg?: unknown) => {
      const flow = await resolveFlow(store, arg);
      if (!flow) return;
      await runAction(store, search, flow.dir, { kind: "board" }, vscode.l10n.t(MESSAGES.boardTitle));
    }),
    vscode.commands.registerCommand("flowgit.trust", async (arg?: unknown) => {
      const flow = await resolveFlow(store, arg);
      if (!flow) return;
      await runAction(store, search, flow.dir, { kind: "trust" }, vscode.l10n.t(MESSAGES.trustTitle));
    }),
    vscode.commands.registerCommand("flowgit.diff", async (arg?: unknown, stageId?: unknown) => {
      const picked = await resolveStage(store, arg, stageId);
      if (!picked) return;
      if (picked.stage.latest === undefined) {
        void vscode.window.showInformationMessage(vscode.l10n.t(MESSAGES.notRun));
        return;
      }
      await runAction(
        store,
        search,
        picked.flow.dir,
        { kind: "diff", stageId: picked.stage.id, version: picked.stage.latest },
        vscode.l10n.t(MESSAGES.diffTitle, picked.stage.name),
      );
    }),
  );
}

async function allowedToRun(): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  const manage = vscode.l10n.t(MESSAGES.manageTrust);
  const choice = await vscode.window.showWarningMessage(vscode.l10n.t(MESSAGES.restricted), manage);
  if (choice === manage) await vscode.commands.executeCommand("workbench.trust.manage");
  return false;
}

async function runAction(store: FlowStore, search: () => CliSearch, flowDir: string, action: FlowgitAction, title: string): Promise<void> {
  if (!(await allowedToRun())) return;
  const cli = resolveCli(search(), fs.existsSync);
  if (!cli.ok) {
    const message =
      cli.reason === "setting-missing"
        ? vscode.l10n.t(MESSAGES.cliSettingMissing, cli.configured ?? "", CLI_INSTALL_HINT)
        : vscode.l10n.t(MESSAGES.cliMissing, CLI_INSTALL_HINT);
    void vscode.window.showErrorMessage(message);
    return;
  }
  await executeTask(taskLaunch(cli.path, flowDir, action), title, flowDir);
  // Status changes when the task finishes; the file watcher refreshes too.
  store.schedule();
}

async function executeTask(spec: TaskLaunch, title: string, flowDir: string): Promise<void> {
  const options = { cwd: spec.cwd };
  const execution = useShellExecution(spec.command, process.platform)
    ? new vscode.ShellExecution(spec.command, spec.args, options)
    : new vscode.ProcessExecution(spec.command, spec.args, options);
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(flowDir));
  const task = new vscode.Task({ type: "flowgit", args: spec.args }, folder ?? vscode.TaskScope.Workspace, title, "Flowgit", execution);
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    showReuseMessage: false,
    clear: false,
    echo: true,
    focus: false,
  };
  await vscode.tasks.executeTask(task);
}

async function openStage(item: StageItem): Promise<void> {
  const uri = openUri(item.flow, item.stage);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand("revealInExplorer", uri);
      return;
    }
  } catch {
    // The flow file itself is the last candidate and is already on disk.
  }
  await vscode.window.showTextDocument(uri, { preview: true });
}

async function resolveFlow(store: FlowStore, arg: unknown): Promise<FlowView | undefined> {
  if (isFlowItem(arg)) return arg.flow;
  if (isStageItem(arg)) return arg.flow;
  return pickFlow(store);
}

async function resolveStage(store: FlowStore, arg: unknown, stageId: unknown): Promise<{ flow: FlowView; stage: StageView } | undefined> {
  if (isStageItem(arg)) return { flow: arg.flow, stage: arg.stage };
  if (typeof arg === "string" && typeof stageId === "string") {
    const flow = store.views.find((item) => item.dir === arg) ?? placeholderFlow(arg);
    const stage = flow.stages.find((item) => item.id === stageId) ?? placeholderStage(stageId);
    return { flow, stage };
  }
  const flow = isFlowItem(arg) ? arg.flow : await pickFlow(store);
  if (!flow) return undefined;
  const stage = await pickStage(flow);
  if (!stage) return undefined;
  return { flow, stage };
}

function placeholderFlow(dir: string): FlowView {
  return { dir, file: path.join(dir, "flow.json"), name: path.basename(dir), missingInputs: [], conflict: false, stages: [] };
}

function placeholderStage(id: string): StageView {
  return { id, name: id, outputs: [], inputs: [], missingUpstream: [] };
}

async function pickFlow(store: FlowStore): Promise<FlowView | undefined> {
  const views = store.views.filter((flow) => !flow.conflict);
  if (!views.length) {
    void vscode.window.showWarningMessage(vscode.l10n.t(MESSAGES.noFlows));
    return undefined;
  }
  if (views.length === 1) return views[0];
  const picked = await vscode.window.showQuickPick(
    views.map((flow) => ({ label: flow.name, description: flow.dir, flow })),
    { placeHolder: vscode.l10n.t(MESSAGES.chooseFlow) },
  );
  return picked?.flow;
}

async function pickStage(flow: FlowView): Promise<StageView | undefined> {
  if (!flow.stages.length) {
    void vscode.window.showWarningMessage(vscode.l10n.t(MESSAGES.notRun));
    return undefined;
  }
  if (flow.stages.length === 1) return flow.stages[0];
  const picked = await vscode.window.showQuickPick(
    flow.stages.map((stage) => ({ label: stage.name, description: stage.id, stage })),
    { placeHolder: vscode.l10n.t(MESSAGES.chooseStage) },
  );
  return picked?.stage;
}
