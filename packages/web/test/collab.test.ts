import { afterEach, describe, expect, it, vi } from "vitest";

class MutationObserver {
    static all = new Set<MutationObserver>();
    constructor(private cb: () => void) {}
    observe(): void {
        MutationObserver.all.add(this);
    }
    disconnect(): void {
        MutationObserver.all.delete(this);
    }
    static fire(): void {
        for (const observer of [...MutationObserver.all]) observer.cb();
    }
}

class ClassList {
    constructor(private el: El) {}
    private names = new Set<string>();
    add(...values: string[]): void {
        for (const value of values) if (value) this.names.add(value);
    }
    remove(...values: string[]): void {
        for (const value of values) this.names.delete(value);
    }
    contains(value: string): boolean {
        return this.names.has(value);
    }
    toggle(value: string, force?: boolean): void {
        const on = force ?? !this.names.has(value);
        if (on) this.names.add(value);
        else this.names.delete(value);
    }
    toString(): string {
        return [...this.names].join(" ");
    }
    clear(): void {
        this.names.clear();
    }
}

class El {
    tagName: string;
    children: El[] = [];
    parentElement: El | null = null;
    classList = new ClassList(this);
    attrs = new Map<string, string>();
    dataset: Record<string, string>;
    _id = "";
    _text = "";
    _hidden = false;
    disabled = false;
    value = "";
    selectionStart = 0;
    selectionEnd = 0;
    type = "";
    src = "";
    alt = "";
    rows = 0;
    required = false;
    lang = "";
    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
        const el = this;
        this.dataset = new Proxy({} as Record<string, string>, {
            get: (target, key) => target[String(key)],
            set: (target, key, value) => {
                target[String(key)] = String(value);
                const attr = `data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
                el.attrs.set(attr, String(value));
                return true;
            },
        });
    }
    get id(): string {
        return this._id;
    }
    set id(value: string) {
        this._id = String(value);
        this.attrs.set("id", this._id);
    }
    get className(): string {
        return this.classList.toString();
    }
    set className(value: string) {
        this.classList.clear();
        this.classList.add(...String(value).split(/\s+/));
    }
    get hidden(): boolean {
        return this._hidden;
    }
    set hidden(value: boolean) {
        this._hidden = Boolean(value);
        MutationObserver.fire();
    }
    get textContent(): string {
        if (this.children.length) return this.children.map((child) => child.textContent).join("");
        return this._text;
    }
    set textContent(value: string) {
        this._text = String(value ?? "");
        this.children = [];
    }
    setAttribute(name: string, value: string): void {
        this.attrs.set(name, String(value));
        if (name === "id") this._id = String(value);
        if (name === "class") this.className = String(value);
    }
    getAttribute(name: string): string | null {
        if (name === "id") return this._id || null;
        if (name === "class") return this.className || null;
        return this.attrs.has(name) ? this.attrs.get(name)! : null;
    }
    removeAttribute(name: string): void {
        this.attrs.delete(name);
    }
    append(...nodes: El[]): void {
        for (const node of nodes) {
            node.parentElement = this;
            this.children.push(node);
        }
        MutationObserver.fire();
    }
    prepend(node: El): void {
        node.parentElement = this;
        this.children.unshift(node);
        MutationObserver.fire();
    }
    replaceChildren(...nodes: El[]): void {
        this.children = [];
        this.append(...nodes);
    }
    remove(): void {
        this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
        MutationObserver.fire();
    }
    addEventListener(type: string, fn: (event: EventLike) => void): void {
        const list = listeners.get(this) ?? new Map<string, ((event: EventLike) => void)[]>();
        const found = list.get(type) ?? [];
        found.push(fn);
        list.set(type, found);
        listeners.set(this, list);
    }
    dispatchEvent(event: EventLike): void {
        const ev = { ...event, target: this, currentTarget: this, preventDefault: () => {} };
        for (const fn of listeners.get(this)?.get(event.type) ?? []) fn(ev);
        if (event.type === "focusin" && this.parentElement) this.parentElement.dispatchEvent(event);
    }
    focus(): void {
        active = this;
        this.dispatchEvent({ type: "focusin" });
    }
    closest(selector: string): El | null {
        let node: El | null = this;
        while (node) {
            if (matches(node, selector)) return node;
            node = node.parentElement;
        }
        return null;
    }
    matches(selector: string): boolean {
        return matches(this, selector);
    }
    querySelector(selector: string): El | null {
        return queryAll(this, selector)[0] ?? null;
    }
    querySelectorAll(selector: string): El[] {
        return queryAll(this, selector);
    }
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
        return { left: 0, top: 0, width: 0, height: 0 };
    }
}

interface EventLike {
    type: string;
    target?: El;
    preventDefault?: () => void;
}

const listeners = new Map<El, Map<string, ((event: EventLike) => void)[]>>();
let active: El | null = null;
let doc: El;
let body: El;

function walk(root: El, into: El[] = []): El[] {
    for (const child of root.children) {
        into.push(child);
        walk(child, into);
    }
    return into;
}

function matches(el: El, selector: string): boolean {
    let rest = selector.trim();
    if (!rest) return false;
    if (/^[A-Za-z]/.test(rest)) {
        const tag = /^([A-Za-z0-9-]+)/.exec(rest);
        if (!tag || el.tagName !== tag[1]!.toUpperCase()) return false;
        rest = rest.slice(tag[0].length);
    }
    while (rest) {
        if (rest[0] === "#") {
            const id = /^#([A-Za-z0-9_-]+)/.exec(rest);
            if (!id || el.id !== id[1]) return false;
            rest = rest.slice(id[0].length);
        } else if (rest[0] === ".") {
            const name = /^\.([A-Za-z0-9_-]+)/.exec(rest);
            if (!name || !el.classList.contains(name[1]!)) return false;
            rest = rest.slice(name[0].length);
        } else if (rest[0] === "[") {
            const end = rest.indexOf("]");
            if (end < 0) return false;
            const inside = rest.slice(1, end);
            const eq = inside.indexOf("=");
            const attr = eq < 0 ? inside : inside.slice(0, eq);
            const have = el.getAttribute(attr);
            if (have == null) return false;
            if (eq >= 0) {
                let expected = inside.slice(eq + 1);
                if ((expected.startsWith("'") && expected.endsWith("'")) || (expected.startsWith('"') && expected.endsWith('"'))) expected = expected.slice(1, -1);
                if (have !== expected) return false;
            }
            rest = rest.slice(end + 1);
        } else return false;
    }
    return true;
}

function queryAll(root: El, selector: string): El[] {
    const found: El[] = [];
    for (const group of selector.split(",")) {
        const parts = group.trim().split(/\s+/).filter(Boolean);
        let seeds = [root];
        for (const part of parts) {
            const next: El[] = [];
            for (const seed of seeds) {
                for (const el of walk(seed)) {
                    if (matches(el, part)) next.push(el);
                }
            }
            seeds = next;
        }
        for (const el of seeds) if (!found.includes(el)) found.push(el);
    }
    return found;
}

function installDom(): void {
    const g = globalThis as typeof globalThis & {
        window: typeof globalThis;
        Element: typeof El;
        HTMLElement: typeof El;
        document: El & { body: El; documentElement: El; activeElement: El | null; createElement: (tag: string) => El };
        MutationObserver: typeof MutationObserver;
        navigator: { language: string; languages: string[] };
        localStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
        matchMedia: (query: string) => { matches: boolean };
        i18next: { createInstance: () => { language: string; init: (opts: { lng?: string; resources?: Record<string, { translation: Record<string, unknown> }> }) => void; t: (key: string, vars?: Record<string, unknown>) => string; changeLanguage: (next: string) => void } };
    };
    doc = new El("html");
    body = new El("body");
    body.parentElement = doc;
    doc.children.push(body);
    const ids = ["board", "banner", "inputs", "inputs-form", "inputs-status", "inputs-save", "notice", "refresh-hint", "panel", "panel-title", "panel-body", "log", "run-all", "preview", "usage-total", "stage-dialog", "stage-form", "stage-status", "stage-save", "remove-dialog", "remove-text", "remove-deps", "remove-status", "remove-confirm", "remove-force"];
    for (const id of ids) {
        const node = new El("div");
        node.id = id;
        if (id === "panel") node._hidden = true;
        body.append(node);
    }
    const panel = body.children.find((node) => node.id === "panel")!;
    const panelBody = body.children.find((node) => node.id === "panel-body")!;
    body.children = body.children.filter((node) => node.id !== "panel-body" && node.id !== "panel-title");
    const title = new El("h2");
    title.id = "panel-title";
    panel.append(title, panelBody);
    const store = new Map<string, string>([["flowgit.board.lang", "zh"]]);
    g.window = g;
    g.Element = El;
    g.HTMLElement = El;
    g.MutationObserver = MutationObserver;
    const nav = { language: "zh-CN", languages: ["zh-CN"] };
    try {
        Object.defineProperty(g, "navigator", { value: nav, configurable: true });
    } catch {
        // Node already exposes a read-only navigator; the board then follows that language.
    }
    g.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key)! : null),
        setItem: (key, value) => store.set(key, String(value)),
    };
    g.matchMedia = () => ({ matches: false });
    g.i18next = {
        createInstance: () => {
            const api = {
                language: "zh",
                resources: {} as Record<string, { translation: Record<string, unknown> }>,
                init(opts: { lng?: string; resources?: Record<string, { translation: Record<string, unknown> }> }) {
                    api.resources = opts.resources ?? {};
                    api.language = opts.lng || "zh";
                },
                t(key: string, vars?: Record<string, unknown>) {
                    let node: unknown = api.resources[api.language]?.translation ?? api.resources.zh?.translation;
                    for (const part of key.split(".")) node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
                    if (typeof node !== "string") return key;
                    return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => (vars && vars[name] != null ? String(vars[name]) : ""));
                },
                changeLanguage(next: string) {
                    api.language = next;
                },
            };
            return api;
        },
    };
    const listen = doc.addEventListener.bind(doc);
    const document = {
        body,
        documentElement: doc,
        get activeElement() {
            return active;
        },
        createElement: (tag: string) => new El(tag),
        getElementById: (id: string) => walk(doc, [doc]).find((node) => node.id === id) ?? null,
        addEventListener: (type: string, fn: (event: EventLike) => void) => listen(type, fn),
        querySelector: (selector: string) => queryAll(doc, selector)[0] ?? null,
        querySelectorAll: (selector: string) => queryAll(doc, selector),
    };
    g.document = document as unknown as typeof g.document;
}

installDom();

function cleanup(): void {
    MutationObserver.all.clear();
    for (const id of ["flowgit-presence", "flowgit-comments", "flowgit-activity", "flowgit-lock"]) {
        const node = walk(doc, [doc]).find((item) => item.id === id);
        node?.remove();
    }
    const panel = walk(doc, [doc]).find((item) => item.id === "panel");
    const panelBody = walk(doc, [doc]).find((item) => item.id === "panel-body");
    if (panel) panel._hidden = true;
    if (panelBody) panelBody.children = [];
}

interface Cloud {
    flowId: string;
    role: "owner" | "editor" | "viewer";
    share?: boolean;
    me: { id: string; name: string; avatar_url: string | null } | null;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function boot(cloud: Cloud | null, fetchImpl?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    vi.resetModules();
    cleanup();
    const sent: unknown[] = [];
    const fetches: { url: string; init?: RequestInit }[] = [];
    const handlers = new Map<string, ((data: unknown) => void)[]>();
    (globalThis as { flowgitTransport?: unknown }).flowgitTransport = cloud
        ? {
            cloud: {
                flowId: cloud.flowId,
                role: cloud.role,
                share: Boolean(cloud.share),
                me: cloud.me,
                send(message: unknown) {
                    sent.push(message);
                },
                on(event: string, handler: (data: unknown) => void) {
                    const list = handlers.get(event) ?? [];
                    list.push(handler);
                    handlers.set(event, list);
                    return () => {};
                },
            },
            fetch: async (url: string, init?: RequestInit) => {
                fetches.push({ url: String(url), init });
                return fetchImpl ? fetchImpl(String(url), init) : json({});
            },
            events: () => ({ addEventListener() {}, close() {} }),
        }
        : undefined;
    const presence = await import("../public/presence.js");
    const lock = await import("../public/lock.js");
    const comments = await import("../public/comments.js");
    const activity = await import("../public/activity.js");
    return {
        sent,
        fetches,
        emit(event: string, data: unknown) {
            for (const handler of handlers.get(event) ?? []) handler(data);
        },
        start() {
            presence.startPresence();
            lock.startLocks();
            comments.startComments();
            activity.startActivity();
        },
    };
}

const editor: Cloud = { flowId: "flow1", role: "editor", me: { id: "ada", name: "Ada", avatar_url: null } };

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("cloud collaboration on the board", () => {
    it("does nothing without a signed-in cloud transport", async () => {
        for (const cloud of [null, { ...editor, share: true }, { ...editor, me: null }] as (Cloud | null)[]) {
            const live = await boot(cloud, () => {
                throw new Error("fetch");
            });
            live.start();
            expect(walk(doc, [doc]).some((node) => node.id === "flowgit-presence")).toBe(false);
            expect(live.sent).toEqual([]);
            expect(live.fetches).toEqual([]);
        }
    });

    it("shows who is online", async () => {
        const live = await boot(editor);
        live.start();
        live.emit("presence:update", {
            people: [
                { id: "ada", name: "Ada", avatar_url: "https://cdn.example/a.png", stage: "notes" },
                { id: "bao", name: "Bao", avatar_url: null, stage: null },
            ],
        });
        const people = walk(doc, [doc]).filter((node) => node.classList.contains("collab-person"));
        expect(people).toHaveLength(2);
        expect(people[0]?.textContent).toContain("Ada");
        expect(people[0]?.textContent).toContain("notes");
        expect(people[1]?.textContent).toContain("Bao");
        const avatar = people[0]!.children.find((node) => node.tagName === "IMG");
        expect(avatar?.src).toBe("https://cdn.example/a.png");
    });

    it("disables save while someone else holds the stage, and heartbeats while editing", async () => {
        vi.useFakeTimers();
        const live = await boot(editor);
        live.start();
        const panel = walk(doc, [doc]).find((node) => node.id === "panel")!;
        const panelBody = walk(doc, [doc]).find((node) => node.id === "panel-body")!;
        const badge = new El("p");
        badge.className = "badge";
        badge.setAttribute("data-stage", "notes");
        const save = new El("button");
        save.className = "save";
        panel.hidden = false;
        panelBody.append(badge, save);
        expect(live.sent).toContainEqual({ type: "lock", stage: "notes" });
        live.emit("lock:update", { locks: [{ stage: "notes", expiresAt: Date.now() + 120_000, user: { id: "bao", name: "Bao", avatar_url: null } }] });
        const note = walk(doc, [doc]).find((node) => node.id === "flowgit-lock");
        expect(note?.textContent).toContain("Bao");
        expect(note?.textContent).toContain("正在编辑");
        expect(save.disabled).toBe(true);
        expect(save.getAttribute("data-flowgit-locked")).toBe("1");
        await vi.advanceTimersByTimeAsync(30_000);
        expect(live.sent).toContainEqual({ type: "heartbeat" });
    });

    it("opens the comment panel and posts through the cloud transport", async () => {
        const live = await boot(editor, (url, init) => {
            if (url.endsWith("/comments") && (!init || !init.method || init.method === "GET")) {
                return json({ comments: [{ id: "c1", path: "notes.md", body: "hello note", user: { id: "bao", name: "Bao", avatar_url: null } }] });
            }
            if (url.endsWith("/comments") && init?.method === "POST") return json({ comment: { id: "c2", path: "notes.md", body: "from me", user: { id: "ada", name: "Ada", avatar_url: null } } }, 201);
            if (url.includes("/notifications")) return json({ notifications: [], unread: 0 });
            return json({});
        });
        live.start();
        const button = walk(doc, [doc]).find((node) => node.getAttribute("data-collab") === "comments");
        button?.dispatchEvent({ type: "click" });
        await vi.waitFor(() => expect(walk(doc, [doc]).some((node) => node.textContent === "hello note")).toBe(true));
        const path = walk(doc, [doc]).find((node) => node.classList.contains("collab-path"))!;
        const body = walk(doc, [doc]).find((node) => node.classList.contains("collab-body"))!;
        path.value = "notes.md";
        body.value = "from me";
        walk(doc, [doc]).find((node) => node.classList.contains("collab-compose"))?.dispatchEvent({ type: "submit" });
        await vi.waitFor(() => expect(live.fetches.some((call) => call.init?.method === "POST")).toBe(true));
        const post = live.fetches.find((call) => call.init?.method === "POST")!;
        expect(post.url).toBe("/api/flows/flow1/comments");
        expect(JSON.parse(String(post.init?.body))).toEqual({ path: "notes.md", body: "from me" });
        await vi.waitFor(() => expect(walk(doc, [doc]).some((node) => node.textContent === "from me")).toBe(true));
    });

    it("hides the composer for a viewer and the activity entry for anyone but an owner", async () => {
        const viewer = await boot({ ...editor, role: "viewer" });
        viewer.start();
        walk(doc, [doc]).find((node) => node.getAttribute("data-collab") === "comments")?.dispatchEvent({ type: "click" });
        expect(walk(doc, [doc]).some((node) => node.classList.contains("collab-compose"))).toBe(false);
        expect(walk(doc, [doc]).some((node) => node.getAttribute("data-collab") === "activity")).toBe(false);
        const owner = await boot({ ...editor, role: "owner" }, (url) => {
            if (url === "/api/flows/flow1") return json({ flow: { id: "flow1", workspace_id: "ws1" }, role: "owner" });
            if (url.startsWith("/api/workspaces/ws1/audit")) {
                return json({
                    entries: [
                        { at: 2, user_name: "Ada", action: "comment.add", flow_id: "flow1", detail: { path: "notes.md" } },
                        { at: 1, user_name: "Ada", action: "file.write", flow_id: "other", detail: { path: "secret.md" } },
                    ],
                });
            }
            return json({});
        });
        owner.start();
        expect(walk(doc, [doc]).some((node) => node.getAttribute("data-collab") === "activity")).toBe(true);
        walk(doc, [doc]).find((node) => node.getAttribute("data-collab") === "activity")?.dispatchEvent({ type: "click" });
        await vi.waitFor(() => expect(walk(doc, [doc]).some((node) => node.classList.contains("collab-activity-item"))).toBe(true));
        const items = walk(doc, [doc]).filter((node) => node.classList.contains("collab-activity-item")).map((node) => node.textContent);
        expect(items).toEqual(["Ada · comment.add · notes.md"]);
        expect(items.join("\n")).not.toContain("secret.md");
    });
});
