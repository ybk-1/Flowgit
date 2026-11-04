// The web app's cloud lane (#172). The board's modules stay the same: this file sets
// globalThis.flowgitTransport so /api/* goes to the Worker and the live log is the flow room's
// WebSocket (https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
// i18n is bound by the entry files (home.ts, board-shell.ts). Importing ./i18n.js from here
// would land in a shared chunk, whose relative import would miss the page's i18n.js.
import { cloudBoardRequest } from "./router.js";
import { type Files, zipFlow } from "./import.js";
import type { FlowStore } from "./storage.js";

export interface Dict {
  t(key: string, vars?: Record<string, string | number>): string;
  text(node: Element, key: string, vars?: Record<string, string | number>): Element;
  raw(node: Element, source: string): Element;
  attr(node: Element, name: string, key: string, vars?: Record<string, string | number>): Element;
  pick(text: string): string;
  lang(): "zh" | "en";
  onChange(listener: (lang: string) => void): void;
}

const I18N_SLOT = Symbol.for("flowgit.i18n");

/** Called once from each page entry, which imports the board's ./i18n.js itself. */
export function bindI18n(value: Dict): void {
  (globalThis as Record<symbol, Dict>)[I18N_SLOT] = value;
}

function boundI18n(): Dict {
  const value = (globalThis as Record<symbol, Dict>)[I18N_SLOT];
  if (!value) throw new Error("i18n 还没接上 / i18n is not bound");
  return value;
}

export const i18n: Dict = new Proxy({} as Dict, {
  get(_target, prop) {
    const value = boundI18n() as unknown as Record<PropertyKey, unknown>;
    const found = value[prop];
    return typeof found === "function" ? (found as (...args: unknown[]) => unknown).bind(value) : found;
  },
});

export interface CloudMe {
  id: string;
  name: string;
  avatar_url: string | null;
}

export type CloudRole = "owner" | "editor" | "viewer";

/** What `globalThis.flowgitTransport.cloud` is for a cloud flow. Browser and folder flows omit it. */
export interface CloudSession {
  flowId: string | null;
  role: CloudRole;
  share: boolean;
  me: CloudMe | null;
  send(message: unknown): void;
  on(event: string, handler: (data: unknown) => void): () => void;
}

export interface FlowgitTransport {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  events(url: string): EventSourceLike;
  cloud?: CloudSession;
}

/** The slice of EventSource the board uses (packages/web/public/run.js). */
export interface EventSourceLike extends EventTarget {
  readyState: number;
  url: string;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export interface CloudReady {
  role: CloudRole;
  share: boolean;
  me: CloudMe | null;
  workspaceId: string | null;
  name: string;
  readonly: boolean;
}

export interface Providers {
  github: boolean;
  google: boolean;
  test: boolean;
}

export interface WorkspaceCard {
  id: string;
  name: string;
  role: CloudRole;
  members: number;
  flows: number;
}

export interface CloudFlowCard {
  id: string;
  name: string;
  workspace_id: string;
}

const UPLOAD_LIMIT = 50 * 1024 * 1024;

export interface UploadPlan {
  batch: Record<string, Uint8Array>;
  rest: { path: string; data: Uint8Array }[];
  skipped: string[];
}

function isLocalSecrets(path: string): boolean {
  return path === "flowgit.local.json" || path.endsWith("/flowgit.local.json");
}

/** What to send when a browser flow is put in the cloud. One file over 50 MB is skipped. */
export function planCloudUpload(files: Record<string, Uint8Array>): UploadPlan {
  const skipped: string[] = [];
  const kept: { path: string; data: Uint8Array }[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (isLocalSecrets(path)) continue;
    if (data.byteLength > UPLOAD_LIMIT) {
      skipped.push(path);
      continue;
    }
    kept.push({ path, data });
  }
  const total = kept.reduce((sum, file) => sum + file.data.byteLength, 0);
  if (total <= UPLOAD_LIMIT) {
    const batch: Record<string, Uint8Array> = {};
    for (const file of kept) batch[file.path] = file.data;
    return { batch, rest: [], skipped };
  }
  const root = kept.find((file) => file.path === "flow.json") ?? kept.find((file) => file.path === "flow.md");
  if (!root) throw new Error("根目录要有 flow.json 或 flow.md / the root needs a flow.json or flow.md");
  return { batch: { [root.path]: root.data }, rest: kept.filter((file) => file !== root), skipped };
}

export function bytesToBase64(data: Uint8Array): string {
  let bin = "";
  const size = 0x8000;
  for (let i = 0; i < data.length; i += size) bin += String.fromCharCode(...data.subarray(i, Math.min(i + size, data.length)));
  return btoa(bin);
}

export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function cloudError(body: { error?: string }, status: number): string {
  return body.error || `请求失败 / request failed (${status})`;
}

/** A socket the board treats as SSE. Share links never open one. */
class CloudSocket {
  private ws: WebSocket | undefined;
  private readonly views = new Set<CloudEventSource>();
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  private readonly queue: string[] = [];
  private closed = false;
  private attempts = 0;
  private delay = 500;
  private ping: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly flowId: string | null,
    private readonly share: boolean,
  ) {}

  open(url: string): EventSourceLike {
    const view = new CloudEventSource(url, this);
    this.views.add(view);
    if (!this.share && !this.ws && !this.closed) this.connect();
    return view;
  }

  drop(view: CloudEventSource): void {
    this.views.delete(view);
  }

  send(message: unknown): void {
    if (this.share) return;
    const text = typeof message === "string" ? message : JSON.stringify(message);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(text);
      if (!this.ws) this.connect();
      return;
    }
    this.ws.send(text);
  }

  on(event: string, handler: (data: unknown) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  stop(): void {
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }

  private connect(): void {
    if (this.share || !this.flowId || this.closed) return;
    // Same host as the page, so the page's connect-src 'self' covers wss as well as ws.
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/flows/${encodeURIComponent(this.flowId)}/events`);
    this.ws = ws;
    ws.addEventListener("open", () => {
      const again = this.attempts > 0;
      this.attempts += 1;
      this.delay = 500;
      for (const view of this.views) view.markOpen();
      if (again) this.emit("flow:changed", {}, String(Date.now()));
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, 25_000);
      for (const text of this.queue.splice(0)) ws.send(text);
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      let frame: { id?: unknown; event?: unknown; data?: unknown };
      try {
        frame = JSON.parse(event.data) as { id?: unknown; event?: unknown; data?: unknown };
      } catch {
        return;
      }
      if (!frame || typeof frame.event !== "string") return;
      this.emit(frame.event, frame.data ?? {}, frame.id == null ? "" : String(frame.id));
    });
    ws.addEventListener("close", () => {
      if (this.ping) clearInterval(this.ping);
      this.ws = undefined;
      if (this.closed || this.share) return;
      const wait = this.delay;
      this.delay = Math.min(this.delay * 2, 10_000);
      setTimeout(() => {
        if (!this.closed) this.connect();
      }, wait);
    });
  }

  private emit(event: string, data: unknown, id: string): void {
    const text = JSON.stringify(data ?? {});
    for (const view of this.views) view.deliver(event, text, id);
    for (const handler of this.handlers.get(event) ?? []) handler(data);
  }
}

class CloudEventSource extends EventTarget implements EventSourceLike {
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    private readonly socket: CloudSocket,
  ) {
    super();
  }

  markOpen(): void {
    if (this.readyState === 2) return;
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  deliver(event: string, data: string, id: string): void {
    if (this.readyState !== 1) return;
    this.dispatchEvent(new MessageEvent(event, { data, lastEventId: id }));
  }

  close(): void {
    this.readyState = 2;
    this.socket.drop(this);
  }
}

/** Share links: events() never opens a socket and never fires. */
class SilentEventSource extends EventTarget implements EventSourceLike {
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {
    super();
  }
  close(): void {
    this.readyState = 2;
  }
}

export interface CloudBoard {
  transport: FlowgitTransport;
  ready: Promise<CloudReady>;
  /** Latest run, so a computer step can be named in the page note. */
  run: Promise<{ waiting?: { kind?: string; name?: string; stage?: string } } | null>;
}

export function startCloudBoard(options: { flowId: string | null; share: string | null }): CloudBoard {
  const socket = new CloudSocket(options.flowId, Boolean(options.share));
  const session: CloudSession = {
    flowId: options.flowId,
    role: "viewer",
    share: Boolean(options.share),
    me: null,
    send: (message) => socket.send(message),
    on: (event, handler) => socket.on(event, handler),
  };
  const transport: FlowgitTransport = {
    fetch(url, init) {
      const headers = new Headers(init?.headers);
      return fetch(cloudBoardRequest(url, { flowId: options.flowId, share: options.share }), { ...init, headers, credentials: "same-origin" });
    },
    events(url) {
      return options.share ? new SilentEventSource(url) : socket.open(url);
    },
    cloud: session,
  };
  if (options.share) document.documentElement.setAttribute("data-flowgit-readonly", "");
  const ready = loadCloud(options, session);
  const run = options.flowId
    ? fetch(`/api/flows/${encodeURIComponent(options.flowId)}/run`, { credentials: "same-origin" })
        .then((res) => (res.ok ? readJson<{ run: { waiting?: { kind?: string; name?: string; stage?: string } } | null }>(res) : { run: null }))
        .then((body) => body.run)
        .catch(() => null)
    : Promise.resolve(null);
  return { transport, ready, run };
}

async function loadCloud(options: { flowId: string | null; share: string | null }, session: CloudSession): Promise<CloudReady> {
  const me = await fetch("/api/me", { credentials: "same-origin" })
    .then(async (res) => (res.ok ? ((await readJson<{ user: CloudMe }>(res)).user ?? null) : null))
    .catch(() => null);
  session.me = me;
  if (options.share) {
    const res = await fetch(`/api/share/${encodeURIComponent(options.share)}`, { credentials: "same-origin" });
    if (!res.ok) {
      location.replace("./index.html#missing");
      return new Promise(() => {});
    }
    const body = await readJson<{ name?: string }>(res);
    return { role: "viewer", share: true, me, workspaceId: null, name: body.name ?? "", readonly: true };
  }
  const res = await fetch(`/api/flows/${encodeURIComponent(options.flowId!)}`, { credentials: "same-origin" });
  if (res.status === 401) {
    location.replace(`./index.html?next=${encodeURIComponent(location.pathname + location.search)}`);
    return new Promise(() => {});
  }
  if (!res.ok) {
    location.replace("./index.html#missing");
    return new Promise(() => {});
  }
  const body = await readJson<{ flow: { workspace_id: string; name: string }; role: CloudRole }>(res);
  session.role = body.role;
  const readonly = body.role === "viewer";
  if (readonly) document.documentElement.setAttribute("data-flowgit-readonly", "");
  else document.documentElement.removeAttribute("data-flowgit-readonly");
  return { role: body.role, share: false, me, workspaceId: body.flow.workspace_id, name: body.flow.name, readonly };
}

export async function putFlowInCloud(workspaceId: string, name: string, files: Record<string, Uint8Array>): Promise<{ id: string; skipped: string[] }> {
  const plan = planCloudUpload(files);
  const encoded: Record<string, string> = {};
  for (const [path, data] of Object.entries(plan.batch)) encoded[path] = bytesToBase64(data);
  const created = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/flows`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, files: encoded }),
  });
  const createdBody = await readJson<{ flow?: { id: string }; error?: string }>(created);
  if (!created.ok || !createdBody.flow) throw new Error(cloudError(createdBody, created.status));
  for (const file of plan.rest) {
    const put = await fetch(`/api/flows/${encodeURIComponent(createdBody.flow.id)}/raw?path=${encodeURIComponent(file.path)}`, {
      method: "PUT",
      credentials: "same-origin",
      body: file.data as unknown as BodyInit,
    });
    if (!put.ok) throw new Error(cloudError(await readJson<{ error?: string }>(put), put.status));
  }
  return { id: createdBody.flow.id, skipped: plan.skipped };
}

export async function downloadCloudZip(flowId: string, filename: string): Promise<void> {
  const listed = await fetch(`/api/flows/${encodeURIComponent(flowId)}/files`, { credentials: "same-origin" });
  const body = await readJson<{ files?: { path: string }[]; error?: string }>(listed);
  if (!listed.ok || !body.files) throw new Error(cloudError(body, listed.status));
  const files: Files = {};
  for (const file of body.files) {
    const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}/raw?path=${encodeURIComponent(file.path)}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(cloudError(await readJson<{ error?: string }>(res), res.status));
    files[file.path] = new Uint8Array(await res.arrayBuffer());
  }
  const zip = zipFlow(files);
  const url = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function loadProviders(): Promise<Providers | undefined> {
  try {
    const res = await fetch("/api/auth/providers", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Partial<Providers>;
    if (typeof body.github !== "boolean" || typeof body.google !== "boolean" || typeof body.test !== "boolean") return undefined;
    return { github: body.github, google: body.google, test: body.test };
  } catch {
    return undefined;
  }
}

export interface Me {
  user: CloudMe;
  workspaces: WorkspaceCard[];
}

export async function loadMe(): Promise<Me | undefined> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) return undefined;
  if (!res.ok) throw new Error(cloudError(await readJson<{ error?: string }>(res), res.status));
  const body = await readJson<{ user: CloudMe; workspaces: WorkspaceCard[] }>(res);
  return { user: body.user, workspaces: body.workspaces ?? [] };
}

export async function listCloudFlows(workspaceId: string): Promise<CloudFlowCard[]> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/flows`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(cloudError(await readJson<{ error?: string }>(res), res.status));
  const body = await readJson<{ flows: CloudFlowCard[] }>(res);
  return body.flows ?? [];
}

/** Add "放到云端" on browser flows once the person is signed in. */
export function addPutButtons(store: FlowStore, workspaces: WorkspaceCard[], onDone: (message: string) => void): void {
  const targets = workspaces.filter((ws) => ws.role === "owner" || ws.role === "editor");
  if (!targets.length) return;
  for (const item of document.querySelectorAll<HTMLElement>("#mine [data-flow]")) {
    if (item.querySelector("[data-put-cloud]")) continue;
    const id = item.dataset.flow;
    if (!id) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.dataset.putCloud = id;
    i18n.text(button, "cloud.put");
    button.addEventListener("click", () => {
      void (async () => {
        const workspace = targets.length === 1 ? targets[0]! : await chooseWorkspace(targets);
        if (!workspace) return;
        button.setAttribute("disabled", "");
        try {
          const files = await store.load(id);
          const name = item.querySelector(".tile-title")?.textContent || id;
          const result = await putFlowInCloud(workspace.id, name, files);
          const skipped = result.skipped.length ? ` ${i18n.t("cloud.skipped", { names: result.skipped.join(", ") })}` : "";
          onDone(`${i18n.t("cloud.copied")}${skipped}`);
          location.href = `./board.html?flow=${encodeURIComponent(`cloud-${result.id}`)}`;
        } catch (err) {
          onDone(err instanceof Error ? err.message : String(err));
          button.removeAttribute("disabled");
        }
      })();
    });
    item.querySelector(".tile-actions")?.append(button);
  }
}

function chooseWorkspace(workspaces: WorkspaceCard[]): Promise<WorkspaceCard | undefined> {
  const dialog = document.getElementById("put-dialog") as HTMLDialogElement | null;
  const select = document.getElementById("put-workspace") as HTMLSelectElement | null;
  const form = document.getElementById("put-form") as HTMLFormElement | null;
  if (!dialog || !select || !form) return Promise.resolve(workspaces[0]);
  select.replaceChildren();
  for (const ws of workspaces) {
    const option = document.createElement("option");
    option.value = ws.id;
    option.textContent = ws.name;
    select.append(option);
  }
  return new Promise((resolve) => {
    const finish = (ws: WorkspaceCard | undefined) => {
      dialog.close();
      resolve(ws);
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      finish(workspaces.find((ws) => ws.id === select.value));
    };
    document.getElementById("put-cancel")!.onclick = () => finish(undefined);
    dialog.showModal();
  });
}
