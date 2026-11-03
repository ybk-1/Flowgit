/** Board history. */
import { getDiff, getRuns, restoreRun } from "./api.js";
import { FX } from "./fx.js";
import { I18N } from "./i18n.js";
import { historyOptions, openOutput, releaseBlob, revealPanel, showPanel, stageBack } from "./panel.js";
import { refreshNow } from "./run.js";
import { S, el, elt, errorEl, formatTime, panelBody, panelTitle, t } from "./state.js";

export function executorLabel(run) {
    if (run.executor === "manual")
        return { key: "history.manual" };
    return run.executor || "";
}

export function resultLabel(run) {
    if (run.status === "ok")
        return { key: "history.ok" };
    if (run.status === "error")
        return { key: "history.error" };
    return run.status || "";
}

/** model for llm, the command for script, the agent name for agent. */
export function runDetail(run) {
    const params = run.params || {};
    if (run.executor === "llm") {
        const model = params.model == null ? "" : String(params.model);
        if (!model)
            return "";
        const provider = params.provider == null ? "" : String(params.provider);
        return provider && provider !== "anthropic" ? `${provider}/${model}` : model;
    }
    if (run.executor === "script")
        return params.run == null ? "" : String(params.run);
    if (run.executor === "agent")
        return params.agent == null ? "" : String(params.agent);
    return "";
}

export function errorLine(run) {
    if (run.status !== "error" || run.error == null)
        return "";
    return String(run.error).split("\n")[0].trim();
}

export function snapshotPath(stageId, n, outputPath) {
    return `runs/${stageId}/${n}/outputs/${String(outputPath).replace(/\/+$/, "")}`;
}

export async function openHistory(stage, note) {
    S.panelMode = "other";
    releaseBlob();
    revealPanel();
    I18N.text(panelTitle, "history.title", { name: { raw: stage.name || stage.id || "" } });
    panelBody.replaceChildren(elt("p", null, "panel.loading"));
    let res;
    try {
        res = await getRuns(stage.id);
    }
    catch {
        panelBody.replaceChildren(errorEl("panel-error", "", "history.openError"));
        return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        panelBody.replaceChildren(errorEl("panel-error", data.error, "history.openError", res.status));
        return;
    }
    renderHistory(stage, Array.isArray(data.runs) ? data.runs : [], note);
}

export function renderHistory(stage, runs, note) {
    I18N.text(panelTitle, "history.title", { name: { raw: stage.name || stage.id || "" } });
    const back = S.returnToStage && S.returnToStage.id === stage.id ? stageBack(S.returnToStage) : undefined;
    const nodes = [];
    if (note)
        nodes.push(elt("p", "save-ok", ...note));
    if (!runs.length) {
        nodes.push(renderCompare(stage, runs));
        nodes.push(elt("p", null, "stage.noRuns"));
        showPanel(nodes, back);
        return;
    }
    const deck = renderDeck(stage, runs, currentRunOf(stage));
    nodes.push(elt("p", "history-hint", "history.hint"), deck.root, deck.front, elt("p", "history-hint", "history.compareHint"), renderCompare(stage, runs));
    showPanel(nodes, back);
    deck.start();
}

/** The run the files on disk are, from the newest board data: a restore has just refreshed it. */
export function currentRunOf(stage) {
    const fresh = S.boardStages.find((item) => item.id === stage.id) || stage;
    return typeof fresh.current === "number" ? fresh.current : null;
}

/** The version each stage's history showed in front last, so reopening it keeps that one there. */
export const deckFront = new Map();

export function clockTime(iso) {
    const match = /T(\d\d:\d\d)/.exec(String(iso || ""));
    return match ? match[1] : "";
}

/** [key, vars] for a version's one-line summary, so it can follow the language switch. */
export function versionHead(run, current) {
    const key = run.n === current ? "history.headCurrent" : "history.head";
    return [key, { n: run.n, result: resultLabel(run), time: formatTime(run.finishedAt), who: executorLabel(run) }];
}

/**
 * Versions as discs, oldest on the left. Drag or flick to spin through them, or use the arrow
 * keys, Home and End; the one in front shows its details and actions below the deck.
 */
export function renderDeck(stage, runs, current) {
    const root = el("div", "deck");
    root.tabIndex = 0;
    root.setAttribute("role", "listbox");
    I18N.attr(root, "aria-label", "history.versions");
    const discs = runs.map((run, i) => {
        const disc = el("div", "disc");
        disc.id = `disc-${stage.id}-${run.n}`;
        disc.setAttribute("role", "option");
        disc.setAttribute("aria-selected", "false");
        I18N.attr(disc, "aria-label", ...versionHead(run, current));
        disc.dataset.i = String(i);
        disc.dataset.status = run.status || "";
        if (run.executor === "manual")
            disc.dataset.kind = "manual";
        const who = run.executor === "manual" ? elt("span", "who", "history.byHand") : el("span", "who", runDetail(run) || run.executor || "");
        disc.append(el("span", "when", clockTime(run.finishedAt)), el("span", "v", `v${run.n}`), who);
        if (run.n === current) {
            disc.dataset.current = "";
            const now = elt("span", "now", "history.now");
            now.setAttribute("aria-hidden", "true");
            disc.append(now);
        }
        root.append(disc);
        return disc;
    });
    const front = el("section", "deck-front");
    front.setAttribute("aria-live", "polite");
    const start = () => {
        let first = runs.findIndex((run) => run.n === deckFront.get(stage.id));
        if (first < 0)
            first = runs.length - 1;
        const size = () => discs[0].offsetWidth || 132;
        const place = (pos) => {
            const s = size();
            discs.forEach((disc, i) => {
                const o = i - pos;
                const a = Math.abs(o);
                const turn = Math.max(-62, Math.min(62, -o * 34));
                disc.style.transform = `translateX(${(o * s * 0.62).toFixed(1)}px) translateZ(${(-a * s * 0.7).toFixed(1)}px) rotateY(${turn.toFixed(1)}deg)`;
                disc.style.zIndex = String(100 - Math.round(a * 10));
                disc.style.opacity = String(Math.max(0, 1 - Math.max(0, a - 2.2) * 0.8));
                const isFront = a < 0.5;
                disc.classList.toggle("front", isFront);
                disc.setAttribute("aria-selected", isFront ? "true" : "false");
            });
        };
        const deck = FX.deck(root, runs.length, {
            start: first,
            unit: () => size() * 0.75,
            place,
            onSettle: (i) => {
                deckFront.set(stage.id, runs[i].n);
                root.setAttribute("aria-activedescendant", discs[i].id);
                renderFront(stage, runs[i], front, current);
            },
        });
        root.addEventListener("click", (event) => {
            const disc = event.target instanceof Element ? event.target.closest(".disc") : null;
            if (!disc || deck.wasDrag())
                return;
            deck.go(Number(disc.dataset.i));
        });
        root.addEventListener("keydown", (event) => {
            if (event.key !== "Enter")
                return;
            event.preventDefault();
            const i = deck.front();
            if (i >= 0)
                void openVersion(stage, runs[i]);
        });
    };
    return { root, front, start };
}

export function renderFront(stage, run, front, current) {
    const nodes = [elt("p", "version-head", ...versionHead(run, current))];
    const detail = runDetail(run);
    if (detail)
        nodes.push(el("p", "version-detail", detail));
    const failure = errorLine(run);
    if (failure)
        nodes.push(elt("p", "version-error", "history.errorLine", { msg: { raw: failure } }));
    const actions = el("div", "deck-actions");
    const open = elt("button", "deck-open", "history.open");
    open.type = "button";
    open.addEventListener("click", () => {
        void openVersion(stage, run);
    });
    const compare = elt("button", "deck-compare", "history.compare");
    compare.type = "button";
    compare.addEventListener("click", () => {
        void openDiff(stage, run.n, "");
    });
    actions.append(open, compare);
    if (run.n === current) {
        nodes.push(elt("p", "version-current", "history.isCurrent"));
    }
    else if (run.status === "ok") {
        const restore = elt("button", "restore", "history.restore");
        restore.type = "button";
        restore.addEventListener("click", () => {
            void restoreVersion(stage, run.n, restore);
        });
        actions.append(restore);
    }
    nodes.push(actions);
    front.replaceChildren(...nodes);
}

export function renderCompare(stage, runs) {
    const form = el("form", "compare");
    const fromLabel = el("label");
    fromLabel.append(elt("span", null, "compare.a"));
    const from = document.createElement("select");
    from.name = "a";
    const toLabel = el("label");
    toLabel.append(elt("span", null, "compare.b"));
    const to = document.createElement("select");
    to.name = "b";
    const current = document.createElement("option");
    current.value = "";
    I18N.text(current, "compare.current");
    to.append(current);
    const ordered = runs.slice().reverse();
    for (const run of ordered) {
        const label = `v${run.n}`;
        const left = document.createElement("option");
        left.value = String(run.n);
        left.textContent = label;
        from.append(left);
        const right = document.createElement("option");
        right.value = String(run.n);
        right.textContent = label;
        to.append(right);
    }
    if (ordered[1]) {
        from.value = String(ordered[1].n);
        to.value = String(ordered[0].n);
    }
    else if (ordered[0]) {
        from.value = String(ordered[0].n);
        to.value = "";
    }
    const status = el("p", "compare-status");
    status.hidden = true;
    const go = document.createElement("button");
    go.type = "submit";
    I18N.text(go, "compare.go");
    go.disabled = runs.length === 0;
    fromLabel.append(from);
    toLabel.append(to);
    form.append(fromLabel, toLabel, go, status);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!from.value) {
            status.hidden = false;
            I18N.text(status, "compare.pickFirst");
            return;
        }
        if (to.value && from.value === to.value) {
            status.hidden = false;
            I18N.text(status, "compare.pickDifferent");
            return;
        }
        void openDiff(stage, from.value, to.value);
    });
    return form;
}

export async function openVersion(stage, run) {
    const outputs = stage.outputs || [];
    if (outputs.length === 1) {
        await openSnapshot(stage, run, outputs[0]);
        return;
    }
    I18N.raw(panelTitle, `v${run.n} · ${stage.name || stage.id || ""}`);
    const nodes = [];
    if (!outputs.length)
        nodes.push(elt("p", null, "history.noOutputs"));
    else {
        const list = el("ul", "file-list");
        for (const output of outputs) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = output.directory ? `${output.path}/` : output.path;
            button.addEventListener("click", () => {
                void openSnapshot(stage, run, output);
            });
            const li = document.createElement("li");
            li.append(button);
            list.append(li);
        }
        nodes.push(list);
    }
    showPanel(nodes, historyOptions(stage));
}

export async function openSnapshot(stage, run, output) {
    const rel = snapshotPath(stage.id, run.n, output.path);
    await openOutput({ path: rel, directory: Boolean(output.directory), text: Boolean(output.text), type: output.type }, stage, { ...historyOptions(stage), title: `v${run.n} · ${output.path}` });
}

export async function openDiff(stage, a, b) {
    releaseBlob();
    revealPanel();
    I18N.text(panelTitle, "diff.title", { name: { raw: stage.name || stage.id || "" } });
    panelBody.replaceChildren(elt("p", null, "panel.loading"));
    const params = new URLSearchParams({ stage: stage.id, a: String(a) });
    if (b)
        params.set("b", String(b));
    let res;
    try {
        res = await getDiff(params);
    }
    catch {
        showPanel([errorEl("panel-error", "", "diff.error")], historyOptions(stage));
        return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        showPanel([errorEl("panel-error", data.error, "diff.error", res.status)], historyOptions(stage));
        return;
    }
    renderDiff(stage, data);
}

export function renderDiff(stage, diff) {
    I18N.text(panelTitle, "diff.title", { name: { raw: stage.name || stage.id || "" } });
    const summary = el("p", "diff-summary", `v${diff.a} → `);
    if (diff.b == null)
        summary.append(elt("span", null, "compare.current"));
    else
        summary.append(`v${diff.b}`);
    const nodes = [summary];
    for (const output of diff.outputs || [])
        nodes.push(renderOutputDiff(output));
    if (!(diff.outputs || []).length)
        nodes.push(elt("p", null, "diff.noOutputs"));
    showPanel(nodes, historyOptions(stage));
}

export function renderOutputDiff(output) {
    const box = el("section", "diff-file");
    box.append(el("h3", "diff-path", output.path || ""));
    if (output.kind === "text") {
        if (output.same || !output.diff)
            box.append(elt("p", "diff-same", "diff.same"));
        else
            box.append(renderUnified(output.diff));
        return box;
    }
    if (output.kind === "binary") {
        box.append(elt("p", output.same ? "diff-same" : "diff-changed", output.same ? "diff.binarySame" : "diff.binaryDiffers"));
        return box;
    }
    if (output.kind === "dir") {
        if (output.same)
            box.append(elt("p", "diff-same", "diff.dirSame"));
        else {
            if (output.added && output.added.length)
                box.append(fileLines("diff.added", output.added, "diff-add"));
            if (output.removed && output.removed.length)
                box.append(fileLines("diff.removed", output.removed, "diff-del"));
            if (output.changed && output.changed.length)
                box.append(fileLines("diff.changed", output.changed, "diff-changed"));
        }
        return box;
    }
    box.append(elt("p", null, "diff.cannotShow"));
    return box;
}

export function fileLines(titleKey, files, className) {
    const block = el("div", "diff-block");
    block.append(elt("span", "diff-line", titleKey));
    for (const file of files)
        block.append(el("span", `diff-line ${className}`, file));
    return block;
}

export function renderUnified(patch) {
    const block = el("div", "diff-block");
    let sawMinus = false;
    let sawPlus = false;
    for (const line of String(patch).split("\n")) {
        let className = "diff-line";
        if (!sawMinus && line.startsWith("--- "))
            sawMinus = true;
        else if (!sawPlus && line.startsWith("+++ "))
            sawPlus = true;
        else if (line.startsWith("+"))
            className += " diff-add";
        else if (line.startsWith("-"))
            className += " diff-del";
        block.append(el("span", className, line.length ? line : " "));
    }
    return block;
}

export async function restoreVersion(stage, n, button) {
    const confirmed = window.confirm(t("restore.confirm", { n }));
    if (!confirmed)
        return;
    if (button)
        button.disabled = true;
    try {
        const res = await restoreRun({ stage: stage.id, n });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            await openHistory(stage);
            panelBody.prepend(errorEl("panel-error", data.error, "restore.failed", res.status));
            return;
        }
        await refreshNow();
        const note = typeof data.kept === "number" ? ["restore.doneKept", { n, kept: data.kept }] : ["restore.done", { n }];
        await openHistory(stage, note);
    }
    catch {
        panelBody.prepend(errorEl("panel-error", "", "restore.failed"));
    }
    finally {
        if (button)
            button.disabled = false;
    }
}
