/** Who else has this cloud flow open. Does nothing without a signed-in cloud transport. */
import { cloudInfo, onLive, sendLive } from "./api.js";
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

function face(person) {
    const url = typeof person.avatar_url === "string" && person.avatar_url.startsWith("https://") ? person.avatar_url : "";
    const node = document.createElement(url ? "img" : "span");
    node.className = "collab-avatar";
    if (url) {
        node.src = url;
        node.alt = "";
    }
    else {
        node.textContent = String(person.name || "?").slice(0, 1);
    }
    return node;
}

function render(list, data) {
    const people = data && Array.isArray(data.people) ? data.people : [];
    list.replaceChildren();
    for (const person of people) {
        if (!person || !person.id) continue;
        const item = document.createElement("li");
        item.className = "collab-person";
        item.dataset.user = person.id;
        const name = document.createElement("span");
        name.className = "collab-name";
        name.textContent = person.name || "";
        item.append(face(person), name);
        if (person.stage) {
            const stage = document.createElement("span");
            stage.className = "collab-stage";
            stage.textContent = person.stage;
            item.append(stage);
        }
        list.append(item);
    }
}

export function startPresence() {
    if (!cloudInfo()) return;
    const list = document.createElement("ul");
    list.className = "collab-people";
    I18N.attr(list, "aria-label", "collab.presence");
    host().append(list);
    onLive("presence:update", (data) => render(list, data));
    sendLive({ type: "presence", stage: null });
}
