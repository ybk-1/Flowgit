import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from "electron";
import { startBoard } from "@flowgit/web";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
// electron-updater is CommonJS. A named ESM import fails at runtime in Electron.
// https://www.electron.build/auto-update
const { autoUpdater } = createRequire(import.meta.url)("electron-updater") as typeof import("electron-updater");
import { runFlowgit } from "./cli-launch.js";
import { machineDoctor } from "./doctor-machine.js";
import { readLanguage, writeLanguage } from "./language.js";
import {
  HOME_CSP,
  HOME_HOST,
  HOME_SCHEME,
  HOME_URL,
  isAllowedExternal,
  isAllowedNavigation,
  isTemplateId,
  isTrustedIpcSender,
  languageArgument,
} from "./policy.js";
import { readRecent, rememberRecent } from "./recent.js";
import { appendShimDir, writeShim } from "./shim.js";
import { DESKTOP_PUBLISH, checkForDesktopUpdate } from "./updates.js";

/**
 * Desktop main process.
 *
 * Security checklist (https://www.electronjs.org/docs/latest/tutorial/security):
 * 7. CSP is HOME_CSP, sent with every home response.
 * 17. Every ipcMain handler checks event.senderFrame.url.
 * 18. The home page is served with protocol.handle, never file://.
 *
 * Fuses (https://www.electronjs.org/docs/latest/tutorial/fuses): RunAsNode stays
 * on so the shim can run this binary as Node. Node inspect stays on so
 * Playwright can attach to the packaged app with --inspect=0
 * (https://playwright.dev/docs/api/class-electron). The app is unpacked because
 * ELECTRON_RUN_AS_NODE does not read app.asar, so the asar-only fuses stay off.
 * https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node
 */

interface OpenResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

const boards = new Map<string, { win: BrowserWindow; close: () => Promise<void> }>();

function userFile(name: string): string {
  return path.join(app.getPath("userData"), name);
}

function hasFlow(dir: string): boolean {
  return fs.existsSync(path.join(dir, "flow.json")) || fs.existsSync(path.join(dir, "flow.md"));
}

function securePrefs(preload: string): Electron.WebPreferences {
  return {
    preload,
    additionalArguments: languageArgument(readLanguage(userFile("language.json"))),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
  };
}

function attachGuards(win: BrowserWindow, boardOrigin: string | null): void {
  const block = (event: Electron.Event, url: string) => {
    if (isAllowedNavigation(url, boardOrigin)) return;
    event.preventDefault();
    if (isAllowedExternal(url)) void shell.openExternal(url);
  };
  win.webContents.on("will-navigate", block);
  win.webContents.on("will-redirect", block);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function assertSender(event: Electron.IpcMainInvokeEvent): void {
  // https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
  if (!isTrustedIpcSender(event.senderFrame?.url)) throw new Error("rejected sender");
}

async function rememberLang(event: Electron.IpcMainInvokeEvent): Promise<void> {
  try {
    const value: unknown = await event.sender.executeJavaScript("localStorage.getItem('flowgit.board.lang')");
    if (value === "zh" || value === "en") writeLanguage(userFile("language.json"), value);
  } catch {
    // The page can close mid-call. The saved language stays as it was.
  }
}

async function openFlow(dir: string): Promise<void> {
  const abs = path.resolve(dir);
  const existing = boards.get(abs);
  if (existing && !existing.win.isDestroyed()) {
    existing.win.focus();
    rememberRecent(userFile("recent.json"), abs);
    return;
  }
  const server = await startBoard({ dir: abs, port: 0, allowOrigins: [] });
  const origin = new URL(server.url).origin;
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    autoHideMenuBar: true,
    webPreferences: securePrefs(path.join(app.getAppPath(), "preload", "board.cjs")),
  });
  attachGuards(win, origin);
  boards.set(abs, { win, close: () => server.close() });
  win.on("closed", () => {
    boards.delete(abs);
    void server.close().catch(() => undefined);
  });
  rememberRecent(userFile("recent.json"), abs);
  await win.loadURL(server.url);
}

async function chooseFolder(title: string): Promise<string | null> {
  const picked = await dialog.showOpenDialog({
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  return picked.filePaths[0];
}

function needFlowMessage(): string {
  return "这个文件夹里没有 flow.json 或 flow.md。 / This folder has no flow.json or flow.md.";
}

function registerIpc(): void {
  ipcMain.handle("flowgit:recent", (event) => {
    assertSender(event);
    return readRecent(userFile("recent.json")).filter((dir) => hasFlow(dir));
  });

  ipcMain.handle("flowgit:open-recent", async (event, folder: unknown) => {
    assertSender(event);
    await rememberLang(event);
    if (typeof folder !== "string" || !folder || folder.includes("\0")) return { ok: false, error: needFlowMessage() } satisfies OpenResult;
    if (!hasFlow(folder)) return { ok: false, error: needFlowMessage() } satisfies OpenResult;
    await openFlow(folder);
    return { ok: true } satisfies OpenResult;
  });

  ipcMain.handle("flowgit:open-folder", async (event) => {
    assertSender(event);
    await rememberLang(event);
    const lang = readLanguage(userFile("language.json")) ?? "zh";
    const dir = await chooseFolder(lang === "zh" ? "打开流程文件夹" : "Open a flow folder");
    if (!dir) return { ok: false, canceled: true } satisfies OpenResult;
    if (!hasFlow(dir)) return { ok: false, error: needFlowMessage() } satisfies OpenResult;
    await openFlow(dir);
    return { ok: true } satisfies OpenResult;
  });

  ipcMain.handle("flowgit:templates", async (event) => {
    assertSender(event);
    const result = await runFlowgit(["templates", "--json"], process.env);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim());
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; name?: unknown; description?: unknown };
      if (!isTemplateId(row.id)) return [];
      return [{ id: row.id, name: typeof row.name === "string" ? row.name : row.id, description: typeof row.description === "string" ? row.description : "" }];
    });
  });

  ipcMain.handle("flowgit:create", async (event, templateId: unknown) => {
    assertSender(event);
    await rememberLang(event);
    if (!isTemplateId(templateId)) return { ok: false, error: "未知模板 / unknown template" } satisfies OpenResult;
    const lang = readLanguage(userFile("language.json")) ?? "zh";
    const parent = await chooseFolder(lang === "zh" ? "选择放流程的文件夹" : "Choose a folder for the flow");
    if (!parent) return { ok: false, canceled: true } satisfies OpenResult;
    let target = path.join(parent, templateId);
    for (let n = 2; fs.existsSync(target); n += 1) target = path.join(parent, `${templateId}-${n}`);
    const result = await runFlowgit(["init", target, "--template", templateId], process.env);
    if (result.code !== 0) return { ok: false, error: (result.stderr || result.stdout).trim() } satisfies OpenResult;
    await openFlow(target);
    return { ok: true } satisfies OpenResult;
  });

  ipcMain.handle("flowgit:doctor", async (event) => {
    assertSender(event);
    return machineDoctor(userFile("doctor-probe"), process.env);
  });
}

function serveHome(): void {
  const root = path.join(app.getAppPath(), "renderer");
  // https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler
  protocol.handle(HOME_SCHEME, (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("bad request", { status: 400, headers: { "Content-Security-Policy": HOME_CSP } });
    }
    if (url.hostname !== HOME_HOST) return new Response("not found", { status: 404, headers: { "Content-Security-Policy": HOME_CSP } });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    if (rel.includes("\0") || rel.includes("\\") || rel.split("/").includes("..")) {
      return new Response("bad request", { status: 400, headers: { "Content-Security-Policy": HOME_CSP } });
    }
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return new Response("bad request", { status: 400, headers: { "Content-Security-Policy": HOME_CSP } });
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return new Response("not found", { status: 404, headers: { "Content-Security-Policy": HOME_CSP } });
    }
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    return new Response(fs.readFileSync(abs), {
      headers: {
        "Content-Type": types[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
        "Content-Security-Policy": HOME_CSP,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

function configureUpdater(): void {
  // https://www.electron.build/auto-update
  // The feed is the GitHub provider with tagNamePrefix desktop-v
  // (https://www.electron.build/publish). electron-updater 6.8 does not apply
  // that prefix when it reads /releases/latest, so this process never calls
  // checkForUpdates or quitAndInstall. A newer desktop-v* tag opens its page.
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({ ...DESKTOP_PUBLISH });
  } catch {
    // Dev builds have no app-update.yml. The page-open check below still runs.
  }
}

async function offerUpdate(): Promise<void> {
  let update: Awaited<ReturnType<typeof checkForDesktopUpdate>>;
  try {
    const version = (JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
    update = await checkForDesktopUpdate(version);
  } catch {
    return;
  }
  if (!update || !isAllowedExternal(update.url)) return;
  const lang = readLanguage(userFile("language.json")) ?? "zh";
  const choice = await dialog.showMessageBox({
    type: "info",
    message: lang === "zh" ? "有新的桌面版" : "A new desktop version is available",
    detail: update.tag,
    buttons: lang === "zh" ? ["打开下载页", "以后"] : ["Open the download page", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response === 0) void shell.openExternal(update.url);
}

async function start(): Promise<void> {
  writeShim(userFile("shim"), process.execPath);
  appendShimDir(process.env, userFile("shim"));
  serveHome();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  registerIpc();
  configureUpdater();
  const home = new BrowserWindow({
    width: 1120,
    height: 840,
    autoHideMenuBar: true,
    webPreferences: securePrefs(path.join(app.getAppPath(), "preload", "home.cjs")),
  });
  attachGuards(home, null);
  await home.loadURL(HOME_URL);
  void offerUpdate();
}

// https://www.electronjs.org/docs/latest/api/protocol#protocolregisterschemesasprivilegedcustomschemes
protocol.registerSchemesAsPrivileged([
  {
    scheme: HOME_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => {
    for (const board of boards.values()) void board.close().catch(() => undefined);
    app.quit();
  });
  void app.whenReady().then(start);
}
