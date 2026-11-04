import { I18N } from "./i18n.js";
import { el, type I18nApi } from "./dom.js";
import { defaultStore } from "./storage.js";
import { templateFiles, templateIndex } from "./templates.js";
import { canOpenFolders } from "./folder.js";
import { addFolder, forgetFolder, listFolders, type FolderEntry } from "./folders.js";
import { fetchGitHub, type Files, parseGitHubUrl, prepareFlow, unzipFlow } from "./import.js";
import type { ForkedFrom } from "@flowgit/core";
import { addPutButtons, bindI18n, cloudError, downloadCloudZip, i18n as cloudI18n, listCloudFlows, loadMe, loadProviders, readJson, type CloudRole, type Dict, type Providers, type WorkspaceCard } from "./cloud.js";
import { cloudFlowAddress, validFlowId } from "./workspace.js";
import { bindAccount } from "./account.js";
import { openMembers } from "./members.js";
import { openShares } from "./share.js";

const i18n = I18N as I18nApi;
bindI18n(I18N as Dict);
const decoder = new TextDecoder();

function boardUrl(id: string): string {
  return `./board.html?flow=${encodeURIComponent(id)}`;
}

function note(text: string): void {
  const node = document.getElementById("home-note");
  if (!node) return;
  node.hidden = false;
  i18n.raw(node, text);
}

async function flowName(store: Awaited<ReturnType<typeof defaultStore>>["store"], id: string): Promise<string> {
  const data = await store.read(id, "flow.json");
  if (!data) return id;
  try {
    const flow = JSON.parse(decoder.decode(data)) as { name?: unknown };
    return typeof flow.name === "string" && flow.name ? flow.name : id;
  } catch {
    return id;
  }
}

interface TileSpec {
  attrs: Record<string, string>;
  kicker: string;
  title: string;
  body?: string;
  actions: HTMLElement[];
  accent?: boolean;
}

/** One card in a grid: a mono kicker, a heavy title, a short body and the actions at the bottom. */
function tile(spec: TileSpec): HTMLLIElement {
  const item = el(i18n, "li", undefined, { ...spec.attrs, class: spec.accent ? "tile accent" : "tile" });
  item.append(el(i18n, "p", spec.kicker, { class: "tile-kicker" }), el(i18n, "h3", spec.title, { class: "tile-title" }));
  if (spec.body) item.append(el(i18n, "p", spec.body, { class: "tile-body" }));
  const actions = el(i18n, "div", undefined, { class: "tile-actions" });
  actions.append(...spec.actions);
  item.append(actions);
  return item;
}

function syncEmpty(): void {
  const mine = document.getElementById("mine")!;
  document.getElementById("mine-empty")!.hidden = mine.children.length > 0;
}

/** A new id from the template's: weekly-report, weekly-report-2, ... */
function freeId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const share = query.get("share");
  if (share) {
    location.replace(`./board.html?share=${encodeURIComponent(share)}`);
    return;
  }
  const flowQuery = query.get("flow");
  if (flowQuery && validFlowId(cloudFlowAddress(flowQuery))) {
    location.replace(`./board.html?flow=${encodeURIComponent(cloudFlowAddress(flowQuery))}`);
    return;
  }
  if (location.hash === "#missing") note("没有找到这个流程 / That flow was not found");
  const { store, persistent } = await defaultStore();
  if (!persistent) note("这个浏览器不能保存文件，关掉页面就没了 / This browser can't keep files; they are gone when the page closes");

  const mine = document.getElementById("mine")!;
  for (const id of await store.list()) {
    const openLink = el(i18n, "a", "打开 / Open", { href: boardUrl(id), class: "btn primary" });
    const remove = el(i18n, "button", "删除 / Delete", { type: "button", class: "btn quiet" });
    const item = tile({
      attrs: { "data-flow": id },
      kicker: `存在浏览器里 · ${id} / In this browser · ${id}`,
      title: await flowName(store, id),
      actions: [openLink, remove],
      accent: true,
    });
    remove.addEventListener("click", async () => {
      if (!window.confirm(i18n.pick(`删除「${id}」和它的所有版本？/ Delete "${id}" and all its versions?`))) return;
      await store.remove(id);
      item.remove();
      syncEmpty();
    });
    mine.append(item);
  }
  syncEmpty();

  await showFolders();
  setUpImport(store);
  void showCommunity(store);

  void startCloud(store, query.get("invite"));

  const list = document.getElementById("templates")!;
  for (const template of await templateIndex()) {
    const button = el(i18n, "button", "用这个模板 / Use this template", { type: "button", class: "btn" });
    const kicker = `${template.stages} 步${template.demo ? " · 可免费试跑" : ""} / ${template.stages} stages${template.demo ? " · free demo run" : ""}`;
    const item = tile({ attrs: { "data-template": template.id }, kicker, title: template.name, body: template.description, actions: [button] });
    button.addEventListener("click", async () => {
      button.setAttribute("disabled", "");
      try {
        const id = freeId(template.id, await store.list());
        const files = await templateFiles(template.id);
        for (const [rel, data] of Object.entries(files)) await store.apply(id, { type: "write", path: rel, data });
        // A first look costs nothing: templates with demo replies start with them on.
        if (template.demo) localStorage.setItem(`flowgit.app.demo.${id}`, "1");
        location.href = boardUrl(id);
      } catch (err) {
        note(err instanceof Error ? err.message : String(err));
        button.removeAttribute("disabled");
      }
    });
    list.append(item);
  }
}

type Store = Awaited<ReturnType<typeof defaultStore>>["store"];

/** A folder name from the flow's id or name: lowercase letters, digits and "-". */
function slug(text: string | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Check the files are a flow, keep them as a new flow in the browser, and open it. */
async function saveAndOpen(store: Store, files: Files, fallback: string, forked?: ForkedFrom): Promise<void> {
  const prepared = prepareFlow(files, forked ? { forked } : {});
  const base = slug(prepared.flow.id) || slug(fallback) || "flow";
  const id = freeId(base, await store.list());
  for (const [rel, data] of Object.entries(prepared.files)) await store.apply(id, { type: "write", path: rel, data });
  location.href = boardUrl(id);
}

async function copyFromGitHub(store: Store, url: string, button: Element): Promise<void> {
  const source = parseGitHubUrl(url);
  if (!source) {
    note("只支持 https://github.com/<owner>/<repo> 这样的公开仓库地址 / Only public repository URLs like https://github.com/<owner>/<repo> are supported");
    return;
  }
  button.setAttribute("disabled", "");
  note("正在从 GitHub 下载… / Downloading from GitHub…");
  try {
    const { files, forked } = await fetchGitHub(source);
    await saveAndOpen(store, files, source.path?.split("/").pop() ?? source.repo, forked);
  } catch (err) {
    note(err instanceof Error ? err.message : String(err));
    button.removeAttribute("disabled");
  }
}

function setUpImport(store: Store): void {
  const form = document.getElementById("github-form") as HTMLFormElement;
  const input = document.getElementById("github-url") as HTMLInputElement;
  const button = document.getElementById("github-copy")!;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void copyFromGitHub(store, input.value, button);
  });
  const zip = document.getElementById("zip-input") as HTMLInputElement;
  zip.addEventListener("change", async () => {
    const file = zip.files?.[0];
    zip.value = "";
    if (!file) return;
    try {
      const files = unzipFlow(new Uint8Array(await file.arrayBuffer()));
      await saveAndOpen(store, files, file.name.replace(/\.zip$/i, ""));
    } catch (err) {
      note(err instanceof Error ? `${file.name}: ${err.message}` : String(err));
    }
  });
}

interface CommunityEntry {
  id: string;
  name: { zh?: string; en?: string } | string;
  description?: { zh?: string; en?: string } | string;
  git: string;
  ref?: string;
}

// The site build writes the merged community list at the site root, next to /app/ (https://flowgit.dev/registry.json).
// Same origin, so the page's connect-src 'self' covers it.
const REGISTRY = "/registry.json";

function both(text: CommunityEntry["name"] | undefined): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text.zh && text.en ? `${text.zh} / ${text.en}` : (text.zh ?? text.en ?? "");
}

async function showCommunity(store: Store): Promise<void> {
  const list = document.getElementById("community")!;
  const info = document.getElementById("community-note")!;
  let entries: CommunityEntry[];
  try {
    const res = await fetch(REGISTRY);
    if (!res.ok) throw new Error(String(res.status));
    entries = (await res.json()) as CommunityEntry[];
  } catch {
    info.hidden = false;
    i18n.raw(info, "现在读不到社区模板列表 / The community template list can't be read right now");
    return;
  }
  for (const entry of entries) {
    const source = parseGitHubUrl(entry.git.replace(/\.git(#|$)/, "$1"));
    if (!source) continue;
    if (entry.ref) source.ref = entry.ref;
    const button = el(i18n, "button", "复制成我的流程 / Copy as my flow", { type: "button", class: "btn" });
    const item = tile({
      attrs: { "data-community": entry.id },
      kicker: `社区 · ${source.owner}/${source.repo} / Community · ${source.owner}/${source.repo}`,
      title: both(entry.name),
      body: both(entry.description),
      actions: [button],
    });
    button.addEventListener("click", async () => {
      button.setAttribute("disabled", "");
      note("正在从 GitHub 下载… / Downloading from GitHub…");
      try {
        const { files, forked } = await fetchGitHub(source);
        await saveAndOpen(store, files, entry.id, forked);
      } catch (err) {
        note(err instanceof Error ? err.message : String(err));
        button.removeAttribute("disabled");
      }
    });
    list.append(item);
  }
}

function folderItem(entry: FolderEntry): HTMLElement {
  const openLink = el(i18n, "a", "打开 / Open", { href: boardUrl(entry.id), class: "btn primary" });
  const forget = el(i18n, "button", "从列表移除 / Remove from list", { type: "button", class: "btn quiet", title: i18n.pick("文件夹里的文件不会被删除 / The folder's files are not deleted") });
  const item = tile({
    attrs: { "data-folder": entry.id },
    kicker: "电脑上的文件夹 / Folder on this computer",
    title: entry.name,
    actions: [openLink, forget],
    accent: true,
  });
  forget.addEventListener("click", async () => {
    await forgetFolder(entry.id);
    item.remove();
    syncEmpty();
  });
  return item;
}

async function showFolders(): Promise<void> {
  const button = document.getElementById("open-folder")!;
  const list = document.getElementById("mine")!;
  if (!canOpenFolders()) {
    document.getElementById("folders-unsupported")!.hidden = false;
    return;
  }
  button.hidden = false;
  for (const entry of await listFolders()) list.append(folderItem(entry));
  syncEmpty();
  button.addEventListener("click", async () => {
    let handle: FileSystemDirectoryHandle;
    try {
      const pick = (globalThis as unknown as { showDirectoryPicker(o: { mode: string }): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      handle = await pick.call(globalThis, { mode: "readwrite" });
    } catch {
      return; // cancelled
    }
    let hasFlow = false;
    for (const name of ["flow.json", "flow.md"]) {
      try {
        await handle.getFileHandle(name);
        hasFlow = true;
      } catch {
        // not this one
      }
    }
    if (!hasFlow) {
      note("这个文件夹里没有 flow.json 或 flow.md。先用 flowgit init 建一个流程。 / This folder has no flow.json or flow.md. Create a flow with flowgit init first.");
      return;
    }
    const entry = await addFolder(handle);
    location.href = boardUrl(entry.id);
  });
}

function signInHref(provider: "github" | "google", invite: string | null): string {
  const next = "/app/";
  const inviteQuery = invite ? `&invite=${encodeURIComponent(invite)}` : "";
  return `/api/auth/${provider}?next=${encodeURIComponent(next)}${inviteQuery}`;
}

/** Sign-in and cloud workspaces. If the cloud API is absent, the page stays as it is. */
async function startCloud(store: Store, invite: string | null): Promise<void> {
  const providers = await loadProviders();
  if (!providers) return;
  const root = document.getElementById("cloud-root");
  const section = document.getElementById("cloud-section");
  if (!root) return;
  root.hidden = false;
  bindAccount();
  document.getElementById("cloud-logout")?.addEventListener("click", () => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).then(() => location.reload());
  });
  document.getElementById("cloud-new-workspace")?.addEventListener("click", () => {
    (document.getElementById("workspace-dialog") as HTMLDialogElement | null)?.showModal();
  });
  const workspaceForm = document.getElementById("workspace-form") as HTMLFormElement | null;
  workspaceForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = (document.getElementById("workspace-name") as HTMLInputElement | null)?.value.trim();
    if (!name) return;
    void (async () => {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await readJson<{ error?: string }>(res);
      if (!res.ok) {
        note(cloudError(body, res.status));
        return;
      }
      location.reload();
    })();
  });
  document.getElementById("workspace-cancel")?.addEventListener("click", () => {
    (document.getElementById("workspace-dialog") as HTMLDialogElement | null)?.close();
  });

  let me: Awaited<ReturnType<typeof loadMe>>;
  try {
    me = await loadMe();
  } catch (err) {
    note(err instanceof Error ? err.message : String(err));
    return;
  }
  if (!me) {
    showSignedOut(providers, invite);
    return;
  }
  if (invite) {
    const accepted = await fetch("/api/invites/accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: invite }),
    });
    const body = await readJson<{ error?: string }>(accepted);
    if (!accepted.ok) note(cloudError(body, accepted.status));
    else {
      const url = new URL(location.href);
      url.searchParams.delete("invite");
      location.replace(url.pathname + url.search);
      return;
    }
  }
  try {
    const next = sessionStorage.getItem("flowgit.cloud.next");
    if (next) {
      sessionStorage.removeItem("flowgit.cloud.next");
      location.href = next;
      return;
    }
  } catch {
    // private window
  }
  showSignedIn(me.user.name);
  if (section) section.hidden = false;
  await paintWorkspaces(me.workspaces);
  addPutButtons(store, me.workspaces, (message) => note(message));
}

function showSignedOut(providers: Providers, invite: string | null): void {
  const box = document.getElementById("cloud-signed-out");
  if (!box) return;
  box.hidden = false;
  if (providers.github) {
    const link = document.createElement("a");
    link.className = "btn primary";
    link.href = signInHref("github", invite);
    cloudI18n.text(link, "cloud.signInGitHub");
    box.append(link);
  }
  if (providers.google) {
    const link = document.createElement("a");
    link.className = "btn";
    link.href = signInHref("google", invite);
    cloudI18n.text(link, "cloud.signInGoogle");
    box.append(link);
  }
  if (providers.test) {
    const form = document.createElement("form");
    form.id = "cloud-test-form";
    form.className = "cloud-test";
    const subject = document.createElement("input");
    subject.id = "cloud-test-subject";
    subject.required = true;
    subject.autocomplete = "off";
    cloudI18n.attr(subject, "placeholder", "cloud.testSubject");
    const name = document.createElement("input");
    name.id = "cloud-test-name";
    name.autocomplete = "off";
    cloudI18n.attr(name, "placeholder", "cloud.testName");
    const inviteInput = document.createElement("input");
    inviteInput.id = "cloud-test-invite";
    inviteInput.autocomplete = "off";
    inviteInput.value = invite ?? "";
    cloudI18n.attr(inviteInput, "placeholder", "cloud.testInvite");
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "btn";
    cloudI18n.text(button, "cloud.testSignIn");
    form.append(subject, name, inviteInput, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        const res = await fetch("/api/auth/test", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: subject.value.trim(),
            name: name.value.trim() || subject.value.trim(),
            invite: inviteInput.value.trim() || undefined,
            kind: "web",
          }),
        });
        const body = await readJson<{ error?: string }>(res);
        if (!res.ok) {
          note(cloudError(body, res.status));
          return;
        }
        const url = new URL(location.href);
        if (url.searchParams.has("invite")) {
          url.searchParams.delete("invite");
          location.href = `${url.pathname}${url.search}`;
        } else location.reload();
      })();
    });
    box.append(form);
  }
}

function showSignedIn(name: string): void {
  const box = document.getElementById("cloud-signed-in");
  const who = document.getElementById("cloud-me");
  if (!box || !who) return;
  box.hidden = false;
  cloudI18n.text(who, "cloud.signedInAs", { name });
}

async function paintWorkspaces(workspaces: WorkspaceCard[]): Promise<void> {
  const list = document.getElementById("cloud-workspaces");
  if (!list) return;
  list.replaceChildren();
  if (!workspaces.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    cloudI18n.text(empty, "cloud.noWorkspace");
    list.append(empty);
    return;
  }
  for (const ws of workspaces) {
    const item = document.createElement("li");
    item.className = "tile accent";
    item.dataset.workspace = ws.id;
    const kicker = document.createElement("p");
    kicker.className = "tile-kicker";
    cloudI18n.text(kicker, "cloud.roleLine", { role: cloudI18n.t(`cloud.role.${ws.role}`), members: ws.members });
    const title = document.createElement("h3");
    title.className = "tile-title";
    title.textContent = ws.name;
    const flows = document.createElement("ul");
    flows.className = "cloud-flows";
    const actions = document.createElement("div");
    actions.className = "tile-actions";
    const members = document.createElement("button");
    members.type = "button";
    members.className = "btn";
    members.dataset.members = ws.id;
    cloudI18n.text(members, "cloud.members");
    members.addEventListener("click", () => {
      void openMembers(ws.id, ws.role as CloudRole);
    });
    actions.append(members);
    item.append(kicker, title, flows, actions);
    list.append(item);
    try {
      for (const flow of await listCloudFlows(ws.id)) {
        const row = document.createElement("li");
        row.dataset.cloudFlow = flow.id;
        const open = document.createElement("a");
        open.className = "btn primary";
        open.href = `./board.html?flow=${encodeURIComponent(cloudFlowAddress(flow.id))}`;
        cloudI18n.text(open, "cloud.open");
        const label = document.createElement("span");
        label.textContent = flow.name;
        row.append(label, open);
        if (ws.role !== "viewer") {
          const share = document.createElement("button");
          share.type = "button";
          share.className = "btn";
          share.dataset.shareFlow = flow.id;
          cloudI18n.text(share, "cloud.share");
          share.addEventListener("click", () => {
            void openShares(flow.id, ws.role);
          });
          row.append(share);
        }
        const download = document.createElement("button");
        download.type = "button";
        download.className = "btn quiet";
        cloudI18n.text(download, "cloud.download");
        download.addEventListener("click", () => {
          void downloadCloudZip(flow.id, `${flow.name || flow.id}.zip`).catch((err) => note(err instanceof Error ? err.message : String(err)));
        });
        row.append(download);
        flows.append(row);
      }
    } catch (err) {
      note(err instanceof Error ? err.message : String(err));
    }
  }
}

void main().catch((err) => note(err instanceof Error ? err.message : String(err)));
