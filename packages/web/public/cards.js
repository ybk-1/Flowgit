/** Board cards. */
import { deleteStage, postStage } from "./api.js";
import { loadAndPaintGraph, renderGraphView } from "./graph.js";
import { openHistory } from "./history.js";
import { I18N } from "./i18n.js";
import { closePanel, foldedInstructions, modelField, openStage, outputThumb, releaseThumbUrls, uploadControl } from "./panel.js";
import { modelForStage, refreshNow, startRun, syncRunButtons } from "./run.js";
import { S, bannerEl, boardEl, captureModelDrafts, el, elr, elt, followStage, isRunning, paintBadge, paintPlanChip, paintUsageTotal, paintVersion, removeConfirm, removeDeps, removeDialog, removeForce, removeStatus, removeText, stageDialog, stageForm, stageLabel, stageSave, stageStatus, stageUsageLine, storeView, t, withStatus } from "./state.js";

export function render(data) {
    S.lastFlow = data;
    const flowName = document.getElementById("flow-name");
    if (data.name)
        I18N.raw(flowName, data.name);
    else
        I18N.text(flowName, "board");
    document.title = t("docTitle", { name: data.name ? I18N.pick(data.name) : "Flowgit" });
    paintUsageTotal();
    const missing = Array.isArray(data.missingInputs) ? data.missingInputs : [];
    bannerEl.replaceChildren();
    if (missing.length) {
        bannerEl.hidden = false;
        bannerEl.append(elt("p", null, "inputs.missing", { names: missing.join(", ") }), elt("p", "banner-hint", "inputs.missingHint", { cmd: `flowgit inputs set ${missing[0]}=...` }));
    }
    else {
        bannerEl.hidden = true;
    }
    captureModelDrafts();
    S.boardStages = Array.isArray(data.stages) ? data.stages : [];
    if (S.selectedId && !S.boardStages.some((stage) => stage.id === S.selectedId)) {
        S.selectedId = "";
        if (S.panelMode === "stage")
            closePanel();
    }
    paintBoard();
    if (S.panelMode === "stage" && S.returnToStage) {
        const fresh = S.boardStages.find((stage) => stage.id === S.returnToStage.id);
        if (fresh)
            openStage(fresh);
        else
            closePanel();
    }
}

export function paintBoard() {
    S.thumbGen += 1;
    releaseThumbUrls();
    const scroller = boardEl.querySelector(".graph-scroll");
    const scroll = scroller ? scroller.scrollLeft : boardEl.scrollLeft;
    boardEl.replaceChildren();
    boardEl.classList.toggle("is-graph", S.view === "graph");
    if (S.view === "graph") {
        const viewEl = renderGraphView();
        boardEl.append(viewEl);
        const next = viewEl.querySelector(".graph-scroll");
        if (next)
            next.scrollLeft = scroll;
    }
    else {
        for (const stage of S.boardStages)
            boardEl.append(renderCard(stage));
        boardEl.scrollLeft = scroll;
    }
    syncViewToggle();
    syncRunButtons();
    // Restoring scrollLeft stops a smooth scroll, so a repaint right after a stage starts picks it up again.
    if (isRunning(S.followId) && performance.now() < S.followUntil)
        followStage(S.followId);
}

export function syncViewToggle() {
    const cards = document.getElementById("view-cards");
    const graph = document.getElementById("view-graph");
    if (cards)
        cards.setAttribute("aria-pressed", S.view === "cards" ? "true" : "false");
    if (graph)
        graph.setAttribute("aria-pressed", S.view === "graph" ? "true" : "false");
}

export function setView(next) {
    if (next !== "cards" && next !== "graph")
        return;
    if (next === S.view)
        return;
    S.view = next;
    storeView(S.view);
    syncViewToggle();
    if (S.view === "cards") {
        S.graphTicket += 1;
        paintBoard();
        return;
    }
    S.graphPayload = null;
    S.graphError = "";
    paintBoard();
    void loadAndPaintGraph();
}

export function humanDir(stage) {
    const dirs = (stage.outputs ?? []).filter((output) => output.directory);
    return dirs.length === 1 ? dirs[0] : null;
}

export function renderCard(stage) {
    const card = el("article", "card");
    card.dataset.id = stage.id || "";
    card.dataset.state = stage.state || "";
    if (isRunning(stage.id))
        card.setAttribute("data-running", "");
    const head = el("div", "card-head");
    head.append(elr("h2", null, stage.name || stage.id || ""), cardMenu(stage));
    const badge = el("p", "badge");
    paintBadge(badge, stage.id || "", "card", stageLabel(stage));
    card.append(head, el("p", "stage-id", stage.id || ""), elt("p", "executor", "stage.executor", { name: stage.executor || "" }), badge);
    paintPlanChip(card, false);
    if (stage.state === "edited")
        card.append(elt("p", "edit-note", "editNote"));
    const version = el("p", "version");
    paintVersion(version, stage);
    card.append(version, elt("p", "runs", "stage.runs", { count: stage.runs ?? 0 }), el("p", "usage", stageUsageLine(stage.id)));
    const history = document.createElement("button");
    history.type = "button";
    history.className = "history";
    I18N.text(history, "stage.history");
    history.addEventListener("click", () => {
        S.returnToStage = null;
        S.panelMode = "other";
        void openHistory(stage);
    });
    card.append(history);
    // A human stage whose upstream is ready is waiting on the person: show what to do, and the upload button.
    if (stage.executor === "human" && stage.state !== "waiting-upstream") {
        if (stage.instructions)
            card.append(foldedInstructions(stage.instructions));
        const dir = humanDir(stage);
        if (dir)
            card.append(uploadControl(stage, dir.path));
    }
    if (stage.executor === "llm")
        card.append(modelField(stage.id));
    const run = document.createElement("button");
    run.type = "button";
    run.className = "run";
    I18N.text(run, "stage.run");
    run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
    if (stage.state === "waiting-upstream")
        I18N.attr(run, "title", "stage.waiting");
    run.addEventListener("click", () => startRun(stage.id, modelForStage(stage.id)));
    card.append(run);
    const outputs = el("div", "outputs");
    outputs.append(elt("p", "outputs-label", "stage.outputs"));
    for (const [index, output] of (stage.outputs ?? []).entries()) {
        outputs.append(outputThumb(output, stage, index));
    }
    card.append(outputs);
    return card;
}

export function closeMenus() {
    let closed = false;
    for (const menu of document.querySelectorAll(".card-menu .menu")) {
        if (!menu.hidden) {
            menu.hidden = true;
            closed = true;
        }
    }
    return closed;
}

export function cardMenu(stage) {
    const wrap = el("div", "card-menu");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button";
    button.setAttribute("aria-haspopup", "menu");
    I18N.attr(button, "aria-label", "stage.menu", { id: stage.id || "" });
    button.textContent = "⋯";
    const menu = el("div", "menu");
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "menu-remove";
    remove.setAttribute("role", "menuitem");
    I18N.text(remove, "stage.remove");
    remove.addEventListener("click", () => {
        menu.hidden = true;
        openRemove(stage);
    });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = menu.hidden;
        closeMenus();
        if (!willOpen)
            return;
        const rect = button.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
        menu.hidden = false;
    });
    menu.append(remove);
    wrap.append(button, menu);
    return wrap;
}

export function outputFromPath(p) {
    const normalized = String(p).replaceAll("\\", "/");
    if (normalized.endsWith("/"))
        return { type: "dir", path: normalized };
    const dot = normalized.lastIndexOf(".");
    const slash = normalized.lastIndexOf("/");
    const ext = dot > slash ? normalized.slice(dot).toLowerCase() : "";
    if (ext === ".md" || ext === ".markdown")
        return { type: "text/markdown", path: normalized };
    if (ext === ".json")
        return { type: "application/json", path: normalized };
    if (ext === ".txt")
        return { type: "text/plain", path: normalized };
    if (ext === ".html" || ext === ".htm")
        return { type: "text/html", path: normalized };
    return { type: "application/octet-stream", path: normalized };
}

export function issueLines(data, fallback) {
    if (data && Array.isArray(data.issues) && data.issues.length) {
        return data.issues.map((issue) => `${issue.path || "/"}: ${I18N.pick(issue.message || "")}`).join("\n");
    }
    if (data && typeof data.error === "string" && data.error)
        return I18N.pick(data.error);
    return t(...fallback);
}

export function fillStageChoices() {
    const after = document.getElementById("stage-after");
    const inputs = document.getElementById("stage-inputs");
    const atEnd = new Option("", "");
    I18N.text(atEnd, "add.atEnd");
    after.replaceChildren(atEnd);
    inputs.replaceChildren();
    for (const stage of S.boardStages) {
        const name = I18N.pick(stage.name || "");
        const label = name && name !== stage.id ? `${name} (${stage.id})` : stage.id || "";
        after.append(new Option(label, stage.id || ""));
        inputs.append(new Option(label, stage.id || ""));
    }
}

export function syncStageFields() {
    const type = document.getElementById("stage-type").value;
    document.getElementById("stage-prompt-field").hidden = type !== "llm" && type !== "agent";
    document.getElementById("stage-run-field").hidden = type !== "script";
    document.getElementById("stage-agent-field").hidden = type !== "agent";
    document.getElementById("stage-run").required = type === "script";
    document.getElementById("stage-outputs").required = type === "script";
    I18N.text(document.getElementById("stage-outputs-hint"), type === "script" ? "add.outputsHelpScript" : "add.outputsHelp");
}

export function openAddStage() {
    closeMenus();
    stageForm.reset();
    fillStageChoices();
    syncStageFields();
    stageStatus.hidden = true;
    I18N.raw(stageStatus, "");
    stageDialog.showModal();
    document.getElementById("stage-id").focus();
}

export async function submitStage(event) {
    event.preventDefault();
    const type = document.getElementById("stage-type").value;
    const payload = { id: document.getElementById("stage-id").value.trim(), type };
    const name = document.getElementById("stage-name").value.trim();
    if (name)
        payload.name = name;
    const after = document.getElementById("stage-after").value;
    if (after)
        payload.after = after;
    const inputs = [...document.getElementById("stage-inputs").selectedOptions].map((option) => option.value).filter(Boolean);
    if (inputs.length)
        payload.inputs = inputs;
    const outputLines = document.getElementById("stage-outputs").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (outputLines.length)
        payload.outputs = outputLines.map(outputFromPath);
    if (type === "llm" || type === "agent") {
        const prompt = document.getElementById("stage-prompt").value.trim();
        if (prompt)
            payload.prompt = prompt;
    }
    if (type === "script")
        payload.run = document.getElementById("stage-run").value.trim();
    if (type === "agent")
        payload.agent = document.getElementById("stage-agent").value;
    stageSave.disabled = true;
    stageStatus.hidden = true;
    try {
        const res = await postStage(payload);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            stageStatus.hidden = false;
            I18N.raw(stageStatus, issueLines(data, withStatus("add.notAdded", res.status)));
            return;
        }
        stageDialog.close();
        await refreshNow();
    }
    catch {
        stageStatus.hidden = false;
        I18N.text(stageStatus, "add.notAdded");
    }
    finally {
        stageSave.disabled = false;
    }
}

export function openRemove(stage) {
    S.removeId = stage.id || "";
    const label = stage.name || stage.id || "";
    I18N.text(removeText, "remove.text", { label: { raw: label }, id: S.removeId });
    removeDeps.hidden = true;
    I18N.raw(removeDeps, "");
    removeStatus.hidden = true;
    I18N.raw(removeStatus, "");
    removeForce.hidden = true;
    removeConfirm.hidden = false;
    removeDialog.showModal();
}

export async function requestRemove(force) {
    if (!S.removeId)
        return;
    removeConfirm.disabled = true;
    removeForce.disabled = true;
    removeStatus.hidden = true;
    try {
        const query = `id=${encodeURIComponent(S.removeId)}${force ? "&force=1" : ""}`;
        const res = await deleteStage(query);
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && !force && Array.isArray(data.dependents) && data.dependents.length) {
            const names = data.dependents.join(", ");
            removeDeps.hidden = false;
            if (data.error)
                I18N.raw(removeDeps, data.error);
            else if (names)
                I18N.text(removeDeps, "remove.deps", { id: S.removeId, names });
            else
                I18N.text(removeDeps, "remove.depsUnknown");
            removeForce.hidden = false;
            removeConfirm.hidden = true;
            return;
        }
        if (!res.ok) {
            removeStatus.hidden = false;
            I18N.raw(removeStatus, issueLines(data, withStatus("remove.notRemoved", res.status)));
            return;
        }
        removeDialog.close();
        await refreshNow();
    }
    catch {
        removeStatus.hidden = false;
        I18N.text(removeStatus, "remove.notRemoved");
    }
    finally {
        removeConfirm.disabled = false;
        removeForce.disabled = false;
    }
}
