/** Workspace audit log for this flow. Owners only; everyone else gets no control. */
import { cloudInfo, getAudit, getCloudFlow } from "./api.js";
import { I18N } from "./i18n.js";

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

function line(entry) {
    const item = document.createElement("li");
    item.className = "collab-activity-item";
    const path = entry.detail && (entry.detail.path || entry.detail.stage || entry.detail.run);
    const bits = [entry.user_name || entry.user_id || "", entry.action || ""];
    if (path) bits.push(String(path));
    item.textContent = bits.filter(Boolean).join(" · ");
    return item;
}

export function startActivity() {
    const cloud = cloudInfo();
    if (!cloud || cloud.role !== "owner") return;
    let panel = null;
    let list = null;
    let workspaceId = "";
    let oldest = 0;

    function paint(entries, replace) {
        if (!list) return;
        if (replace) list.replaceChildren();
        if (replace && !entries.length) {
            const empty = document.createElement("li");
            empty.className = "collab-empty";
            I18N.text(empty, "collab.activityEmpty");
            list.append(empty);
            return;
        }
        for (const entry of entries) list.append(line(entry));
    }

    async function load(before, replace) {
        if (!workspaceId) {
            const flowRes = await getCloudFlow();
            if (!flowRes.ok) return;
            const flowBody = await flowRes.json();
            workspaceId = flowBody.flow && flowBody.flow.workspace_id;
            if (!workspaceId) return;
        }
        const res = await getAudit(workspaceId, before);
        if (!res.ok) return;
        const data = await res.json();
        const entries = (Array.isArray(data.entries) ? data.entries : []).filter((entry) => entry.flow_id === cloud.flowId);
        if (entries.length) oldest = entries[entries.length - 1].at;
        paint(entries, replace);
        const more = document.getElementById("flowgit-activity-more");
        if (more) more.hidden = !data.entries || data.entries.length < 100;
    }

    function open() {
        if (!panel) {
            panel = document.createElement("aside");
            panel.id = "flowgit-activity";
            panel.className = "collab-panel collab-activity";
            const heading = document.createElement("h2");
            I18N.text(heading, "collab.activity");
            list = document.createElement("ul");
            list.className = "collab-activity-list";
            const more = document.createElement("button");
            more.type = "button";
            more.id = "flowgit-activity-more";
            more.hidden = true;
            I18N.text(more, "collab.activityMore");
            more.addEventListener("click", () => {
                void load(oldest, false);
            });
            panel.append(heading, list, more);
            panel.hidden = true;
            document.body.append(panel);
        }
        panel.hidden = !panel.hidden;
        if (!panel.hidden) void load(undefined, true);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.collab = "activity";
    I18N.text(button, "collab.activity");
    button.addEventListener("click", open);
    host().append(button);
}
