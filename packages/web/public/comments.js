/** Comment panel for a cloud flow. Viewers can read; writing follows the role table. */
import { cloudInfo, deleteComment, getComments, getNotifications, onLive, patchComment, postComment, readNotifications } from "./api.js";
import { I18N } from "./i18n.js";
import { panelEl } from "./state.js";

function host() {
    let bar = document.getElementById("flowgit-presence");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "flowgit-presence";
        bar.className = "collab-bar";
        document.body.append(bar);
    }
    return bar;
}

function guessPath() {
    if (!panelEl || panelEl.hidden) return "";
    const area = panelEl.querySelector("textarea[aria-label]");
    const label = area && area.getAttribute("aria-label");
    if (label && !/\s/.test(label) && (label.includes(".") || label.includes("/"))) return label;
    const badge = panelEl.querySelector(".badge[data-stage]");
    const stage = badge && badge.getAttribute("data-stage");
    return stage ? `${stage}.md` : "";
}

export function startComments() {
    const cloud = cloudInfo();
    if (!cloud) return;
    const canWrite = cloud.role === "editor" || cloud.role === "owner";
    let comments = [];
    let mentions = [];
    let panel = null;
    let list = null;
    let mentionList = null;
    let pathInput = null;

    function paint() {
        if (!list) return;
        list.replaceChildren();
        if (!comments.length) {
            const empty = document.createElement("li");
            empty.className = "collab-empty";
            I18N.text(empty, "collab.commentEmpty");
            list.append(empty);
            return;
        }
        for (const comment of comments) {
            const item = document.createElement("li");
            item.className = "collab-comment";
            item.dataset.id = comment.id || "";
            if (comment.resolved_at) item.dataset.resolved = "1";
            const who = document.createElement("p");
            who.className = "collab-comment-who";
            who.textContent = `${comment.user && comment.user.name ? comment.user.name : ""} · ${comment.path || ""}`;
            const body = document.createElement("p");
            body.className = "collab-comment-body";
            body.textContent = comment.body || "";
            item.append(who, body);
            if (comment.resolved_at) {
                const mark = document.createElement("p");
                mark.className = "collab-comment-resolved";
                I18N.text(mark, "collab.commentResolved");
                item.append(mark);
            }
            const actions = document.createElement("p");
            actions.className = "collab-comment-actions";
            if (canWrite && !comment.resolved_at) {
                const resolve = document.createElement("button");
                resolve.type = "button";
                I18N.text(resolve, "collab.commentResolve");
                resolve.addEventListener("click", () => {
                    void patchComment(comment.id, { resolved: true });
                });
                actions.append(resolve);
            }
            const mine = comment.user && comment.user.id === cloud.me.id;
            if (mine || cloud.role === "owner") {
                const remove = document.createElement("button");
                remove.type = "button";
                I18N.text(remove, "collab.commentDelete");
                remove.addEventListener("click", () => {
                    void deleteComment(comment.id);
                });
                actions.append(remove);
            }
            if (actions.children.length) item.append(actions);
            list.append(item);
        }
    }

    function paintMentions() {
        if (!mentionList) return;
        mentionList.replaceChildren();
        if (!mentions.length) return;
        const title = document.createElement("li");
        title.className = "collab-mention-title";
        I18N.text(title, "collab.mentions");
        mentionList.append(title);
        for (const note of mentions) {
            const item = document.createElement("li");
            item.className = "collab-mention";
            item.textContent = note.title || "";
            mentionList.append(item);
        }
        const read = document.createElement("button");
        read.type = "button";
        I18N.text(read, "collab.markRead");
        read.addEventListener("click", () => {
            const ids = mentions.map((note) => note.id).filter(Boolean);
            void readNotifications(ids).then(() => {
                mentions = [];
                paintMentions();
            });
        });
        const wrap = document.createElement("li");
        wrap.append(read);
        mentionList.append(wrap);
    }

    function upsert(comment) {
        if (!comment) return;
        if (comment.deleted) {
            comments = comments.filter((item) => item.id !== comment.id);
            paint();
            return;
        }
        const at = comments.findIndex((item) => item.id === comment.id);
        if (at >= 0) comments[at] = comment;
        else comments.push(comment);
        paint();
    }

    async function refresh() {
        const res = await getComments();
        if (!res.ok) return;
        const data = await res.json();
        comments = Array.isArray(data.comments) ? data.comments : [];
        paint();
    }

    async function refreshMentions() {
        const res = await getNotifications();
        if (!res.ok) return;
        const data = await res.json();
        const all = Array.isArray(data.notifications) ? data.notifications : [];
        mentions = all.filter((note) => note.kind === "comment.mention" && (!note.flow_id || note.flow_id === cloud.flowId) && !note.read_at);
        paintMentions();
    }

    function build() {
        panel = document.createElement("aside");
        panel.id = "flowgit-comments";
        panel.className = "collab-panel";
        const heading = document.createElement("h2");
        I18N.text(heading, "collab.comments");
        mentionList = document.createElement("ul");
        mentionList.className = "collab-mentions";
        list = document.createElement("ul");
        list.className = "collab-comment-list";
        panel.append(heading, mentionList, list);
        if (canWrite) {
            const form = document.createElement("form");
            form.className = "collab-compose";
            const path = document.createElement("input");
            path.className = "collab-path";
            path.type = "text";
            path.required = true;
            I18N.attr(path, "aria-label", "collab.commentPath");
            const body = document.createElement("textarea");
            body.className = "collab-body";
            body.rows = 3;
            body.required = true;
            I18N.attr(body, "placeholder", "collab.commentHint");
            const send = document.createElement("button");
            send.type = "submit";
            send.className = "save";
            I18N.text(send, "collab.commentSend");
            const status = document.createElement("p");
            status.className = "collab-status";
            status.hidden = true;
            form.append(path, body, send, status);
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                const anchor = path.value.trim();
                const text = body.value.trim();
                if (!anchor || !text) return;
                void postComment({ path: anchor, body: text }).then(async (res) => {
                    if (!res.ok) {
                        status.hidden = false;
                        status.textContent = await res.text();
                        return;
                    }
                    status.hidden = true;
                    body.value = "";
                    upsert((await res.json()).comment);
                });
            });
            panel.append(form);
            pathInput = path;
        }
        panel.hidden = true;
        document.body.append(panel);
    }

    function open() {
        if (!panel) build();
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        if (pathInput && !pathInput.value) pathInput.value = guessPath();
        void refresh();
        void refreshMentions();
    }

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.collab = "comments";
    I18N.text(button, "collab.comments");
    button.addEventListener("click", open);
    host().append(button);
    onLive("comment:added", (data) => upsert(data && data.comment));
    onLive("comment:updated", (data) => upsert(data && data.comment));
    onLive("mention", () => {
        void refreshMentions();
    });
}
