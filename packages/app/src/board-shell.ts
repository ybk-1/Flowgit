// Runs before the board's own modules (see scripts/build.mjs): it answers the board's API inside the
// page, loads the flow named by ?flow= from the browser's storage, and adds the key settings.
import { I18N } from "./i18n.js";
import { loadFlow } from "@flowgit/core";
import type { I18nApi } from "./dom.js";
import { applyKeys, rememberedKeys, storeKeys, VENDORS, type KeySettings } from "./keys.js";
import { BrowserBoard } from "./router.js";
import { flowDir, openWorkspace, validFlowId, type Workspace } from "./workspace.js";
import { folderAccess, folderStore, watchFolder } from "./folder.js";
import { getFolder, isFolderId } from "./folders.js";
import { type Files, zipFlow } from "./import.js";

const i18n = I18N as I18nApi;
const params = new URLSearchParams(location.search);
const flowId = params.get("flow");
if (!validFlowId(flowId)) location.replace("./index.html");
const dir = flowDir(validFlowId(flowId) ? flowId : "missing");
// `ready` is declared below; settled only runs after the first request has awaited it.
const board = new BrowserBoard({ dir, settled: () => ready.then((ws) => ws.saved()) });
let keys: KeySettings | undefined = rememberedKeys();
const demoKey = `flowgit.app.demo.${flowId}`;

function demoOn(): boolean {
  try {
    return localStorage.getItem(demoKey) === "1";
  } catch {
    return false;
  }
}

function setDemo(on: boolean): void {
  try {
    if (on) localStorage.setItem(demoKey, "1");
    else localStorage.removeItem(demoKey);
  } catch {
    // private window
  }
}

function applyEnv(ws: Workspace): void {
  applyKeys(ws.env, keys);
  const mockDir = `${dir}/demo-replies`;
  if (demoOn() && ws.host.exists(mockDir)) ws.env.FLOWGIT_LLM_MOCK_DIR = mockDir;
  else delete ws.env.FLOWGIT_LLM_MOCK_DIR;
}

/** The folder's name, when this flow is a folder on the computer. */
let folderName: string | undefined;

function whenLoaded(): Promise<void> {
  return document.readyState === "loading" ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })) : Promise.resolve();
}

/** A folder flow: get read and write access (a click is needed after a reload), then load and watch it. */
async function openFolderWorkspace(id: string): Promise<Workspace> {
  const entry = await getFolder(id);
  if (!entry) {
    location.replace("./index.html#missing");
    return new Promise(() => {});
  }
  folderName = entry.name;
  if (!(await folderAccess(entry.handle, false))) {
    await whenLoaded();
    const button = document.getElementById("app-access")!;
    button.hidden = false;
    await new Promise<void>((resolve) => {
      button.addEventListener("click", async function ask() {
        if (await folderAccess(entry.handle, true)) {
          button.removeEventListener("click", ask);
          button.hidden = true;
          resolve();
        }
      });
    });
  }
  const store = folderStore(entry.handle);
  const ws = await openWorkspace(id, { store, persistent: true });
  watchFolder(ws, store, dir, () => board.changed());
  return ws;
}

const opened: Promise<Workspace> =
  validFlowId(flowId) && isFolderId(flowId) ? openFolderWorkspace(flowId) : openWorkspace(validFlowId(flowId) ? flowId : undefined);
const ready: Promise<Workspace> = opened.then((ws) => {
  if (!ws.host.exists(`${dir}/flow.json`) && !ws.host.exists(`${dir}/flow.md`)) {
    location.replace("./index.html#missing");
  }
  applyEnv(ws);
  return ws;
});

// The board's api.js reads this when it loads (packages/web/public/api.js).
(globalThis as { flowgitTransport?: unknown }).flowgitTransport = {
  fetch: async (url: string, init?: RequestInit) => {
    await ready;
    return board.fetch(url, init);
  },
  events: (url: string) => board.events(url),
};

/** Say which stages a browser can't run, with what to run instead, and whether files are kept. */
function paintNote(ws: Workspace): void {
  const note = document.getElementById("app-note");
  if (!note) return;
  // [Chinese, English] pairs, chosen whole: stage and folder names may be in either language,
  // which would confuse picking one half out of a joined "中文 / English" line.
  const parts: [string, string][] = [];
  if (folderName) {
    parts.push([`文件在电脑上的文件夹「${folderName}」里，命令行的改动会自动显示`, `Files are in the folder "${folderName}" on this computer; changes from the CLI show up here`]);
  }
  if (!ws.persistent) parts.push(["这个浏览器不能保存文件，关掉页面就没了", "This browser can't keep files; they are gone when the page closes"]);
  try {
    const computer = loadFlow(dir).flow.stages.filter((stage) => ["script", "agent", "mcp", "plugin"].includes(stage.executor.type));
    if (computer.length) {
      parts.push([
        `要在电脑上运行：${computer.map((stage) => i18n.pick(stage.name)).join("、")}`,
        `Needs a computer: ${computer.map((stage) => stage.id).join(", ")}`,
      ]);
    }
  } catch {
    // the board shows flow errors itself
  }
  if (demoOn()) parts.push(["正在用示例回复，不调用模型", "Using demo replies, no model calls"]);
  else if (!keys?.key) parts.push(["还没有填模型 key", "No model key yet"]);
  note.hidden = parts.length === 0;
  note.classList.toggle("warn", !ws.persistent);
  const en = i18n.lang() === "en";
  note.textContent = parts.map(([zh, english]) => (en ? english : zh)).join(" · ");
}

function setUpKeys(ws: Workspace): void {
  const dialog = document.getElementById("keys-dialog") as HTMLDialogElement | null;
  const open = document.getElementById("app-keys");
  const vendor = document.getElementById("keys-vendor") as HTMLSelectElement | null;
  const key = document.getElementById("keys-key") as HTMLInputElement | null;
  const remember = document.getElementById("keys-remember") as HTMLInputElement | null;
  const demo = document.getElementById("keys-demo") as HTMLInputElement | null;
  const demoRow = document.getElementById("keys-demo-row");
  const getKey = document.getElementById("keys-get") as HTMLAnchorElement | null;
  if (!dialog || !open || !vendor || !key || !remember || !demo || !demoRow || !getKey) return;
  for (const item of VENDORS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    vendor.append(option);
  }
  const syncLink = () => {
    getKey.href = VENDORS.find((item) => item.id === vendor.value)?.keyUrl ?? "#";
  };
  vendor.addEventListener("change", syncLink);
  open.addEventListener("click", () => {
    vendor.value = keys?.vendor ?? VENDORS[0]!.id;
    key.value = keys?.key ?? "";
    remember.checked = keys?.remember ?? false;
    demoRow.hidden = !ws.host.exists(`${dir}/demo-replies`);
    demo.checked = demoOn();
    syncLink();
    dialog.showModal();
  });
  document.getElementById("keys-cancel")?.addEventListener("click", () => dialog.close());
  document.getElementById("keys-forget")?.addEventListener("click", () => {
    keys = undefined;
    storeKeys(undefined);
    key.value = "";
    remember.checked = false;
    applyEnv(ws);
    paintNote(ws);
  });
  document.getElementById("keys-form")?.addEventListener("submit", () => {
    const value = key.value.trim();
    keys = value ? { vendor: vendor.value, key: value, remember: remember.checked } : undefined;
    storeKeys(keys);
    setDemo(demo.checked);
    applyEnv(ws);
    paintNote(ws);
    board.changed();
  });
}

/** Every file of the flow on the page's host, by path relative to the flow directory. */
function flowFilesOnHost(ws: Workspace): Files {
  const out: Files = {};
  const walk = (abs: string, rel: string) => {
    for (const entry of ws.host.readdir(abs, { withFileTypes: true })) {
      const childAbs = `${abs}/${entry.name}`;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else out[childRel] = ws.host.readFile(childAbs);
    }
  };
  walk(dir, "");
  return out;
}

/** Download the flow (with its runs/ history) as a zip; keys are never in flow files. */
function setUpExport(ws: Workspace): void {
  document.getElementById("app-export")?.addEventListener("click", () => {
    const zip = zipFlow(flowFilesOnHost(ws));
    const url = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${flowId}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

void ready.then((ws) => {
  const start = () => {
    setUpExport(ws);
    paintNote(ws);
    setUpKeys(ws);
    i18n.onChange(() => paintNote(ws));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
});
