/**
 * Lock the open stage while this person edits it, and disable save controls
 * when someone else already holds that lock (or the whole-flow lock).
 * The open stage comes from the panel and the board, not from a new hook.
 */
import { cloudInfo, onLive, sendLive } from "./api.js";
import { I18N } from "./i18n.js";
import { boardEl, panelEl, S } from "./state.js";

const HEARTBEAT_MS = 30_000;

function currentTarget() {
    const active = document.activeElement;
    if (active && active.closest && active.closest("#inputs-form, #edit-flow-form")) return "*";
    if (!panelEl || panelEl.hidden) return null;
    if (panelEl.querySelector("#edit-flow-form")) return "*";
    const badge = panelEl.querySelector(".badge[data-stage]");
    const fromBadge = badge && badge.getAttribute("data-stage");
    if (fromBadge) return fromBadge;
    if (panelEl.querySelector("#edit-stage-form")) {
        const node = boardEl && boardEl.querySelector(".flow-node.is-selected[data-id], .flow-node[aria-pressed='true']");
        const id = node && node.getAttribute("data-id");
        if (id) return id;
        if (S.selectedId) return S.selectedId;
    }
    const area = panelEl.querySelector("textarea[aria-label]");
    const label = area && area.getAttribute("aria-label");
    if (label && S.selectedId) return S.selectedId;
    return null;
}

function controlNodes(target) {
    if (!target) return [];
    const selectors = [
        "#panel button.save",
        "#panel textarea",
        "#edit-stage-form input",
        "#edit-stage-form textarea",
        "#edit-stage-form select",
        "#edit-save",
    ];
    if (target === "*") {
        selectors.push(
            "#inputs-form input",
            "#inputs-form textarea",
            "#inputs-form select",
            "#inputs-save",
            "#edit-flow-form input",
            "#edit-flow-form textarea",
            "#edit-flow-form select",
            "#edit-flow-save",
        );
    }
    return [...document.querySelectorAll(selectors.join(", "))];
}

export function startLocks() {
    const cloud = cloudInfo();
    if (!cloud) return;
    let locks = [];
    let lastKey = null;
    let held = "";
    let timer = 0;

    function banner(blocked) {
        let note = document.getElementById("flowgit-lock");
        if (!blocked) {
            if (note) note.remove();
            return;
        }
        const name = blocked.user && blocked.user.name ? blocked.user.name : "…";
        if (!note) {
            note = document.createElement("p");
            note.id = "flowgit-lock";
            note.className = "collab-lock";
            const parent = (panelEl && panelEl.querySelector("#panel-body")) || panelEl || document.body;
            parent.prepend(note);
        }
        // Setting the text replaces a child, which the panel observer would see again.
        if (note.dataset.who === name) return;
        note.dataset.who = name;
        I18N.text(note, "collab.editing", { name });
    }

    function apply() {
        const target = currentTarget();
        const others = locks.filter((lock) => lock.user && lock.user.id !== cloud.me.id);
        const blocked = !target ? null : target === "*" ? others[0] || null : others.find((lock) => lock.stage === target || lock.stage === "*") || null;
        const mine = Boolean(target && locks.some((lock) => lock.user && lock.user.id === cloud.me.id && lock.stage === target));
        banner(blocked && !mine ? blocked : null);
        const nodes = new Set(controlNodes(target));
        for (const el of document.querySelectorAll("[data-flowgit-locked]")) {
            if (mine || !blocked || !nodes.has(el)) {
                el.disabled = false;
                el.removeAttribute("data-flowgit-locked");
            }
        }
        if (blocked && !mine) {
            for (const el of nodes) {
                if (el.disabled) continue;
                el.disabled = true;
                el.setAttribute("data-flowgit-locked", "1");
            }
        }
    }

    function heartbeat(on) {
        if (on && !timer) {
            timer = setInterval(() => sendLive({ type: "heartbeat" }), HEARTBEAT_MS);
            if (timer && typeof timer.unref === "function") timer.unref();
        }
        else if (!on && timer) {
            clearInterval(timer);
            timer = 0;
        }
    }

    function follow() {
        const target = currentTarget();
        const key = target || "";
        if (key !== lastKey) {
            if (held && held !== key) sendLive({ type: "unlock", stage: held });
            held = "";
            if (target && cloud.role !== "viewer") {
                sendLive({ type: "lock", stage: target });
                held = target;
            }
            sendLive({ type: "presence", stage: target && target !== "*" ? target : null });
            lastKey = key;
        }
        apply();
        heartbeat(Boolean(held));
    }

    onLive("lock:update", (data) => {
        locks = data && Array.isArray(data.locks) ? data.locks : [];
        apply();
    });
    onLive("error", (data) => {
        if (!data || data.code !== "locked" || !data.lock) return;
        const lock = data.lock;
        if (!locks.some((item) => item.stage === lock.stage && item.user && lock.user && item.user.id === lock.user.id)) {
            locks.push({ stage: lock.stage, expiresAt: Date.now() + 120_000, user: lock.user });
        }
        if (held && lock.stage === held && lock.user && lock.user.id !== cloud.me.id) held = "";
        apply();
        heartbeat(Boolean(held));
    });
    const watch = new MutationObserver(() => follow());
    if (panelEl) watch.observe(panelEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "data-stage", "class"] });
    if (boardEl) watch.observe(boardEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-pressed", "data-id"] });
    document.addEventListener("focusin", follow);
    follow();
}
