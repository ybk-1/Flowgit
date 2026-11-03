/** Board run. */
import { getFlow, getPlan, getUsage, postTrust, runStage, subscribe, token } from "./api.js";
import { render } from "./cards.js";
import { reloadGraph } from "./graph.js";
import { I18N } from "./i18n.js";
import { loadInputs } from "./inputs.js";
import { fieldValue, panelHasModel } from "./panel.js";
import { S, applyUsage, boardEl, clearPlan, hintEl, logEl, noticeEl, panelEl, planLabel, previewButton, runAllButton, setRunning, showPlan, t, togetherNames, withStatus } from "./state.js";

/** One stage finished, or the whole run ended when `id` is omitted. Its next state comes with a forced refresh. */
export function clearRunning(id) {
    if (id)
        S.runningIds.delete(id);
    else
        S.runningIds.clear();
    if (!S.runningIds.has(S.followId))
        S.followId = [...S.runningIds][0] || "";
    void refreshNow();
}

export function modelForStage(stageId) {
    // The open stage panel is what Run in that panel should use, even if a card also has a field.
    if (S.panelMode === "stage" && panelHasModel(stageId))
        return fieldValue(stageId, panelEl);
    return fieldValue(stageId, boardEl);
}

export function modelForAll() {
    const values = [];
    const root = S.view === "graph" ? panelEl : boardEl;
    for (const input of root.querySelectorAll("input[data-model-for]")) {
        const value = input.value.trim();
        if (value)
            values.push(value);
    }
    const unique = [...new Set(values)];
    if (unique.length > 1) {
        return {
            error: t("run.modelsDiffer"),
        };
    }
    return { model: unique[0] };
}

export function syncRunButtons() {
    if (runAllButton)
        runAllButton.disabled = S.runBusy;
    if (previewButton)
        previewButton.disabled = S.runBusy;
    const addStageButton = document.getElementById("add-stage");
    if (addStageButton)
        addStageButton.disabled = S.runBusy;
    for (const button of document.querySelectorAll("button.run")) {
        button.disabled = S.runBusy || button.dataset.waiting === "1";
    }
    for (const button of document.querySelectorAll("button.menu-button, .stage-actions .danger")) {
        button.disabled = S.runBusy;
    }
}

export function appendLog(line) {
    logEl.hidden = false;
    logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${line}` : line;
    logEl.scrollTop = logEl.scrollHeight;
}

export function clearLog() {
    logEl.textContent = "";
    logEl.hidden = false;
}

export function modelCallCount(data) {
    if (data && typeof data.modelCalls === "number" && Number.isFinite(data.modelCalls))
        return data.modelCalls;
    const steps = data && Array.isArray(data.steps) ? data.steps : [];
    return steps.filter((step) => step.callsModel).length;
}

export async function fetchPlan(model) {
    const res = await getPlan(model);
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        return { ok: false, error: data.error ? I18N.pick(data.error) : t("withStatus", { msg: { key: "run.previewError" }, status: res.status }) };
    return { ok: true, data };
}

export function planLines(data) {
    const lines = [t("plan.header")];
    const steps = Array.isArray(data.steps) ? data.steps : [];
    for (const step of steps) {
        const label = planLabel(step.action);
        const detail = step.detail ? ` · ${I18N.pick(step.detail)}` : "";
        const names = togetherNames(step, steps);
        const side = names ? ` · ${t("plan.together", { names })}` : "";
        lines.push(`${I18N.pick(step.name || step.id)} ${step.id} · ${label}${detail}${side}`);
    }
    lines.push(t("plan.calls", { count: modelCallCount(data) }));
    return lines;
}

export async function previewAll() {
    if (S.runBusy) {
        appendLog(t("run.busy"));
        return;
    }
    const picked = modelForAll();
    if (picked.error) {
        appendLog(picked.error);
        return;
    }
    clearLog();
    try {
        const plan = await fetchPlan(picked.model);
        if (!plan.ok) {
            appendLog(plan.error);
            return;
        }
        logEl.textContent = planLines(plan.data).join("\n");
        logEl.scrollTop = logEl.scrollHeight;
        showPlan(plan.data);
    }
    catch {
        appendLog(t("run.previewError"));
    }
}

/** Run all was held down: show the dry run on the cards and in the log while the press lasts. */
export function startHoldPreview() {
    const ticket = ++S.holdTicket;
    const picked = modelForAll();
    S.holdPlan = picked.error
        ? Promise.resolve({ ok: false, error: picked.error })
        : fetchPlan(picked.model).catch(() => ({ ok: false, error: t("run.previewError") }));
    void S.holdPlan.then((plan) => {
        if (ticket !== S.holdTicket || !S.runHold.holding())
            return;
        clearLog();
        if (!plan.ok) {
            appendLog(plan.error);
            return;
        }
        logEl.textContent = planLines(plan.data).join("\n");
        logEl.scrollTop = logEl.scrollHeight;
        showPlan(plan.data);
    });
}

/** The hold is the confirmation, so a held Run all starts without the model-call dialog. */
export async function runHeld() {
    const pending = S.holdPlan;
    S.runHold.reset();
    const plan = pending ? await pending : null;
    if (!plan || !plan.ok) {
        clearPlan();
        appendLog(plan ? plan.error : t("run.previewError"));
        return;
    }
    const picked = modelForAll();
    if (picked.error) {
        clearPlan();
        appendLog(picked.error);
        return;
    }
    await startRun("all", picked.model);
}

export async function runAll() {
    if (S.runBusy) {
        appendLog(t("run.busy"));
        return;
    }
    const picked = modelForAll();
    if (picked.error) {
        appendLog(picked.error);
        return;
    }
    S.runBusy = true;
    syncRunButtons();
    let calls = 0;
    try {
        const plan = await fetchPlan(picked.model);
        if (!plan.ok) {
            appendLog(plan.error);
            return;
        }
        calls = modelCallCount(plan.data);
    }
    catch {
        appendLog(t("run.previewError"));
        return;
    }
    finally {
        if (S.runBusy) {
            S.runBusy = false;
            syncRunButtons();
        }
    }
    if (calls > 0) {
        const ok = window.confirm(t("run.confirm", { count: calls }));
        if (!ok)
            return;
    }
    await startRun("all", picked.model);
}

export async function startRun(stage, model) {
    if (S.runBusy) {
        appendLog(t("run.busy"));
        return;
    }
    const gen = ++S.runGen;
    S.runBusy = true;
    syncRunButtons();
    clearPlan();
    clearLog();
    appendLog(stage === "all" ? t("run.all") : `${t("run.one", { stage })}${model ? ` · ${model}` : ""}`);
    let trust = null;
    try {
        const body = { stage };
        if (model)
            body.model = model;
        const res = await runStage(body);
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.trust)
            trust = data.trust;
        else if (res.status === 409)
            appendLog(data.error ? I18N.pick(data.error) : t("run.busy"));
        else if (!res.ok)
            appendLog(data.error ? I18N.pick(data.error) : t("withStatus", { msg: { key: "run.failed" }, status: res.status }));
    }
    catch {
        appendLog(t("run.failed"));
    }
    finally {
        if (gen === S.runGen) {
            S.runBusy = false;
            syncRunButtons();
        }
        if (!trust)
            await refresh();
    }
    // A flow copied from a Git URL: show what it does, confirm once, then run.
    if (trust && (await confirmTrust(trust)))
        await startRun(stage, model);
}

/** Lists what a copied flow does on this computer and asks once; true when confirmed and saved. */
export async function confirmTrust(trust) {
    const lines = (Array.isArray(trust.actions) ? trust.actions : []).map((a) => `  ${a.kind}  ${a.stage}  ${I18N.pick(a.detail)}`);
    const head = trust.reason === "changed"
        ? t("trust.changed")
        : t("trust.copied", { source: trust.source || "?" });
    const ok = window.confirm(`${head}\n\n${lines.join("\n")}\n\n${t("trust.ask")}`);
    if (!ok) {
        appendLog(t("trust.declined"));
        return false;
    }
    try {
        const res = await postTrust({ fingerprint: trust.fingerprint });
        const data = await res.json().catch(() => ({}));
        if (res.ok)
            return true;
        // the flow changed after the list was shown: show the new list
        if (res.status === 409 && data.trust)
            return confirmTrust(data.trust);
        appendLog(data.error ? I18N.pick(data.error) : t("withStatus", { msg: { key: "trust.failed" }, status: res.status }));
    }
    catch {
        appendLog(t("trust.failed"));
    }
    return false;
}

export function onStreamEvent(type, data) {
    if (type === "flow:changed") {
        void refreshNow();
        return;
    }
    if (type === "stage:start") {
        appendLog(`▶ ${I18N.pick(data.name || data.stage)} (${data.stage})`);
        setRunning(data.stage);
    }
    else if (type === "stage:log")
        appendLog(`    [${data.stage}] ${I18N.pick(data.line ?? "")}`);
    else if (type === "stage:done") {
        appendLog(`✓ ${I18N.pick(data.name || data.stage)} → v${data.n}`);
        clearRunning(data.stage);
    }
    else if (type === "stage:skip") {
        appendLog(`· ${t("run.skipped", { name: I18N.pick(data.name || data.stage), reason: I18N.pick(data.reason ?? "") })}`);
    }
    else if (type === "stage:error") {
        appendLog(`✗ ${I18N.pick(data.name || data.stage)}: ${I18N.pick(data.error ?? "")}`);
        clearRunning(data.stage);
    }
    else if (type === "run:end") {
        if (data.waiting) {
            const missing = Array.isArray(data.waiting.missing) ? data.waiting.missing.join(", ") : "";
            appendLog(t("run.waiting", { name: I18N.pick(data.waiting.name || data.waiting.stage), missing }));
            if (data.waiting.instructions)
                appendLog(I18N.pick(data.waiting.instructions));
        }
        else if (data.budget)
            appendLog(I18N.pick(data.budget));
        else if (data.ok)
            appendLog(t("run.finished"));
        else
            appendLog(data.error ? I18N.pick(data.error) : t("run.failed"));
        if (S.runningIds.size)
            clearRunning();
        else
            void refresh();
    }
}

export function setLiveHint(live) {
    if (!hintEl)
        return;
    I18N.text(hintEl, live ? "live.on" : "live.poll");
}

export function showLiveLost() {
    noticeEl.hidden = false;
    I18N.text(noticeEl, "live.lost");
}

export function hideLiveLost() {
    if (noticeEl.dataset.i18n !== "live.lost")
        return;
    I18N.raw(noticeEl, "");
    noticeEl.hidden = true;
}

export function startPolling() {
    if (S.pollTimer)
        return;
    S.pollTimer = setInterval(refresh, 3000);
}

export function stopPolling() {
    if (!S.pollTimer)
        return;
    clearInterval(S.pollTimer);
    S.pollTimer = 0;
}

export function scheduleReconnect() {
    if (S.reconnectTimer)
        return;
    S.reconnectTimer = setTimeout(() => {
        S.reconnectTimer = 0;
        connectEvents();
    }, 5000);
}

export function connectEvents() {
    if (!token || typeof EventSource === "undefined") {
        S.eventsState = "down";
        showLiveLost();
        setLiveHint(false);
        startPolling();
        return;
    }
    if (S.eventSource) {
        S.eventSource.close();
        S.eventSource = null;
    }
    const source = subscribe(`/api/events?token=${encodeURIComponent(token)}`);
    S.eventSource = source;
    let settled = false;
    source.addEventListener("open", () => {
        if (S.eventSource !== source)
            return;
        const wasDown = S.eventsState === "down";
        S.eventsState = "live";
        stopPolling();
        hideLiveLost();
        setLiveHint(true);
        if (S.reconnectTimer) {
            clearTimeout(S.reconnectTimer);
            S.reconnectTimer = 0;
        }
        // Catch up on anything that changed between the last poll and the reconnect.
        if (wasDown)
            void refreshNow();
    });
    source.addEventListener("error", () => {
        if (settled || S.eventSource !== source)
            return;
        settled = true;
        S.eventsState = "down";
        source.close();
        if (S.eventSource === source)
            S.eventSource = null;
        showLiveLost();
        setLiveHint(false);
        startPolling();
        scheduleReconnect();
    });
    for (const type of ["stage:start", "stage:log", "stage:done", "stage:error", "stage:skip", "run:end", "flow:changed"]) {
        source.addEventListener(type, (event) => {
            const id = Number(event.lastEventId);
            if (id) {
                if (id <= S.lastEventId)
                    return;
                S.lastEventId = id;
            }
            let data = {};
            try {
                data = JSON.parse(event.data);
            }
            catch {
                data = {};
            }
            onStreamEvent(type, data);
        });
    }
}

export async function refreshNow() {
    const start = Date.now();
    while (S.refreshing && Date.now() - start < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    S.lastJson = "";
    await refresh();
}

export async function refresh() {
    if (S.refreshing)
        return;
    S.refreshing = true;
    try {
        const res = await getFlow();
        if (!res.ok) {
            noticeEl.hidden = false;
            I18N.text(noticeEl, ...withStatus("refreshError", res.status));
            return;
        }
        const text = await res.text();
        let nextUsage = S.usageText;
        let usageOk = false;
        try {
            const usageRes = await getUsage();
            if (usageRes.ok) {
                nextUsage = await usageRes.text();
                usageOk = true;
            }
        }
        catch {
            // Keep the totals already on screen. The next refresh tries again.
        }
        if (S.eventsState === "down")
            showLiveLost();
        else
            noticeEl.hidden = true;
        if (text === S.lastJson && (!usageOk || nextUsage === S.usageText))
            return;
        const flowChanged = text !== S.lastJson;
        S.lastJson = text;
        // A preview describes the flow as it was; once the stages change it may be wrong, so it goes.
        // (Compared with what is on screen: refreshNow() empties lastJson to force a repaint.
        // Not while Run all is held: that preview is the one the hold confirms.)
        if (text !== S.shownJson && S.planView && !S.runHold.holding())
            S.planView = null;
        S.shownJson = text;
        if (usageOk) {
            S.usageText = nextUsage;
            applyUsage(nextUsage);
        }
        const data = JSON.parse(text);
        if (S.view === "graph" && flowChanged)
            await reloadGraph();
        render(data);
        const signature = JSON.stringify(data.inputs ?? {});
        if (signature !== S.lastInputValues) {
            const loaded = await loadInputs();
            if (loaded)
                S.lastInputValues = signature;
        }
    }
    catch {
        noticeEl.hidden = false;
        I18N.text(noticeEl, "refreshError");
    }
    finally {
        S.refreshing = false;
    }
}
