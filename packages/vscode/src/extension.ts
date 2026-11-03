import * as vscode from "vscode";
import { registerCommands } from "./commands.js";
import { CLI_INSTALL_HINT, resolveConfiguredCli, type CliSearch } from "./logic/cli.js";
import { MESSAGES } from "./logic/messages.js";
import { affectsFlow } from "./logic/watch.js";
import { FlowCodeLensProvider } from "./lenses.js";
import { FlowTree } from "./sidebar.js";
import { FlowStore, type FlowEnv } from "./store.js";

/**
 * The extension reads `flowgit.cliPath` and `PATH` to find the CLI. It does
 * not read or store model keys; a run inherits the environment the editor
 * already has. `flowgit.cliPath` is listed in `restrictedConfigurations`, so
 * Restricted Mode ignores a value that came from the workspace:
 * https://code.visualstudio.com/api/extension-guides/workspace-trust
 */
export function activate(context: vscode.ExtensionContext): void {
  let tree: FlowTree | undefined;
  let lenses: FlowCodeLensProvider | undefined;
  let view: vscode.TreeView<vscode.TreeItem> | undefined;
  const store = new FlowStore({
    env: flowEnv,
    onChange: () => {
      tree?.refresh();
      lenses?.refresh();
      if (view) view.message = banner(store);
    },
  });
  tree = new FlowTree(store);
  lenses = new FlowCodeLensProvider(store);
  view = vscode.window.createTreeView("flowgit.flows", { treeDataProvider: tree, showCollapseAll: true });
  view.message = banner(store);

  context.subscriptions.push(
    view,
    { dispose: () => store.dispose() },
    vscode.languages.registerCodeLensProvider({ pattern: "**/flow.json" }, lenses),
    vscode.workspace.onDidChangeWorkspaceFolders(() => store.schedule()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => store.schedule()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("flowgit.cliPath")) store.schedule();
    }),
  );
  registerCommands(context, store, () => flowEnv().search);

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const onEdit = (uri: vscode.Uri) => {
    if (affectsFlow(uri.fsPath)) store.schedule();
  };
  context.subscriptions.push(watcher, watcher.onDidCreate(onEdit), watcher.onDidChange(onEdit), watcher.onDidDelete(onEdit));
  void store.refresh();
}

export function deactivate(): void {}

function workspaceRoots(): string[] {
  return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
}

function flowEnv(): FlowEnv {
  const folders = workspaceRoots();
  const configured = vscode.workspace.getConfiguration("flowgit").get<string>("cliPath") ?? "";
  const search: CliSearch = {
    configured: resolveConfiguredCli(configured, folders[0], process.platform),
    workspaceFolders: folders,
    pathEnv: process.env.PATH,
    platform: process.platform,
    allowWorkspaceBin: vscode.workspace.isTrusted,
  };
  return { roots: folders, search };
}

function banner(store: FlowStore): string | undefined {
  if (!vscode.workspace.isTrusted) return vscode.l10n.t(MESSAGES.restricted);
  const problem = store.views.find((flow) => flow.problem === "cli-missing" || flow.problem === "cli-setting");
  if (problem?.problem === "cli-setting") return vscode.l10n.t(MESSAGES.cliSettingMissing, problem.problemDetail ?? "", CLI_INSTALL_HINT);
  if (problem?.problem === "cli-missing") return vscode.l10n.t(MESSAGES.cliMissing, CLI_INSTALL_HINT);
  return undefined;
}
