"use strict";

/**
 * Home preload. contextIsolation is on; this is the only bridge.
 *
 * Exposes recent flows, open folder, new from template, and doctor() —
 * nothing else. In particular it does not expose ipcRenderer, shell, or fs.
 * https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
 * https://www.electronjs.org/docs/latest/tutorial/context-isolation
 *
 * The language key is the board's (`flowgit.board.lang`). Writing it here is
 * not an exposed API: page scripts cannot call this preload.
 */

const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((item) => String(item).startsWith("--flowgit-lang="));
const lang = arg ? String(arg).slice("--flowgit-lang=".length) : "";
if (lang === "zh" || lang === "en") {
  try {
    localStorage.setItem("flowgit.board.lang", lang);
  } catch {
    // Storage can throw. The page then follows the browser language.
  }
}

contextBridge.exposeInMainWorld("flowgit", {
  recent: () => ipcRenderer.invoke("flowgit:recent"),
  openRecent: (folder) => ipcRenderer.invoke("flowgit:open-recent", folder),
  openFolder: () => ipcRenderer.invoke("flowgit:open-folder"),
  templates: () => ipcRenderer.invoke("flowgit:templates"),
  createFromTemplate: (id) => ipcRenderer.invoke("flowgit:create", id),
  doctor: () => ipcRenderer.invoke("flowgit:doctor"),
});
