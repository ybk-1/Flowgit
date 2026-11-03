/** Board state. */
import { FX } from "./fx.js";
import { I18N } from "./i18n.js";

/** Stage states and their icons; the words come from I18N ("state.<id>"). */
export const STATES = {
    ok: { icon: "✓", key: "state.ok" },
    stale: { icon: "↻", key: "state.stale" },
    edited: { icon: "✎", key: "state.edited" },
    error: { icon: "✗", key: "state.error" },
    "never-run": { icon: "○", key: "state.never-run" },
    "waiting-upstream": { icon: "…", key: "state.waiting-upstream" },
};

export const t = I18N.t;

/** A new element whose text is a translated string that follows the language switch. */
export function elt(tag, className, key, vars) {
    const node = el(tag, className);
    I18N.text(node, key, vars);
    return node;
}

/** A new element whose text may be bilingual ("中文 / English"); it shows the current language's half. */
export function elr(tag, className, text) {
    const node = el(tag, className);
    I18N.raw(node, text);
    return node;
}

/** "message (404)" in the current language, following the switch. */
export function withStatus(key, status) {
    return ["withStatus", { msg: { key }, status }];
}

/** A server message (often bilingual) or, when there is none, a translated fallback with the status. */
export function setError(node, message, key, status) {
    if (message)
        I18N.raw(node, message);
    else if (status != null)
        I18N.text(node, ...withStatus(key, status));
    else
        I18N.text(node, key);
    return node;
}

export function errorEl(className, message, key, status) {
    return setError(el("p", className), message, key, status);
}

export const VIEW_KEY = "flowgit.board.view";

export const GRAPH_STYLE_KEY = "flowgit.board.graphStyle";

export const SVG_NS = "http://www.w3.org/2000/svg";

export const NODE_W = 176;

export const NODE_H = 72;

export const GAP_X = 64;

export const GAP_Y = 28;

export const PAD = 20;

/** The 3D graph: taller blocks and wider gaps, so a block's front face never hides an edge behind it. */
export const GRID_3D = { w: NODE_W, h: 84, gx: 72, gy: 48, pad: 40 };

/** "cards" or "graph". Storage can throw in private mode; the choice still works for this visit. */
export function storedView() {
    try {
        const value = window.localStorage.getItem(VIEW_KEY);
        if (value === "graph" || value === "cards")
            return value;
    }
    catch {
        // private mode or blocked storage
    }
    return "cards";
}

export function storeView(value) {
    try {
        window.localStorage.setItem(VIEW_KEY, value);
    }
    catch {
        // quota or private mode; the toggle still applies until reload
    }
}

/** "depth" (blocks on a tilted floor) or "flat" (the plain diagram). */
export function storedGraphStyle() {
    try {
        if (window.localStorage.getItem(GRAPH_STYLE_KEY) === "flat")
            return "flat";
    }
    catch {
        // private mode or blocked storage
    }
    return "depth";
}

export function storeGraphStyle(value) {
    try {
        window.localStorage.setItem(GRAPH_STYLE_KEY, value);
    }
    catch {
        // quota or private mode; the switch still applies until reload
    }
}

export const boardEl = document.getElementById("board");

export const bannerEl = document.getElementById("banner");

export const inputsEl = document.getElementById("inputs");

export const inputsForm = document.getElementById("inputs-form");

export const inputsStatus = document.getElementById("inputs-status");

export const inputsSave = document.getElementById("inputs-save");

export const noticeEl = document.getElementById("notice");

export const hintEl = document.getElementById("refresh-hint");

export const panelEl = document.getElementById("panel");

export const panelTitle = document.getElementById("panel-title");

export const panelBody = document.getElementById("panel-body");

export const logEl = document.getElementById("log");

export const runAllButton = document.getElementById("run-all");

export const previewButton = document.getElementById("preview");

export const usageTotalEl = document.getElementById("usage-total");

export const panelPortal = FX.portal(panelEl);

export const modelDrafts = new Map();

export function planLabel(action) {
    return ["skip", "keep-edit", "run", "wait", "cannot-run", "not-reached"].includes(action) ? t(`plan.${action}`) : action || "";
}

export const PLAN_ICON = {
    skip: "·",
    "keep-edit": "✎",
    run: "▶",
    wait: "…",
    "cannot-run": "✗",
    "not-reached": "—",
};

export function runningMarker() {
  return { icon: "▶", key: "state.running" };
}
export const RUNNING = runningMarker();

/** Run all runs after a hold this long; a press shorter than TAP_MS still acts as a click. */
export const HOLD_MS = 1000;

export const TAP_MS = 250;

/** The badge text each card and the stage panel showed last, so only a change decodes. */
export const shownBadge = new Map();

export function formatTime(iso) {
    if (!iso)
        return "";
    return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, " UTC");
}

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}

export function captureModelDrafts() {
    for (const input of document.querySelectorAll("input[data-model-for]")) {
        modelDrafts.set(input.getAttribute("data-model-for"), input.value);
    }
}

export function stageUsageLine(stageId) {
    const row = S.usageByStage.get(stageId) || { input: 0, output: 0, calls: 0 };
    const input = Number(row.input) || 0;
    const output = Number(row.output) || 0;
    const calls = Number(row.calls) || 0;
    if (!calls)
        return t("usage.none");
    return t("usage.stage", { total: input + output, input, output, count: calls });
}

export function paintUsageTotal() {
    if (!usageTotalEl)
        return;
    const input = Number(S.usageTotal.input) || 0;
    const output = Number(S.usageTotal.output) || 0;
    const calls = Number(S.usageTotal.calls) || 0;
    I18N.text(usageTotalEl, "usage.total", { input, output, count: calls });
}

export function applyUsage(text) {
    let data = {};
    try {
        data = JSON.parse(text);
    }
    catch {
        data = {};
    }
    const stages = Array.isArray(data.stages) ? data.stages : [];
    S.usageByStage = new Map(stages.map((stage) => [stage.id, stage]));
    const total = data.total;
    S.usageTotal = total && typeof total === "object" ? total : { input: 0, output: 0, calls: 0 };
}

/** True while the board's run is on this stage. Parallel stages run together. */
export function isRunning(id) {
    return typeof id === "string" && id !== "" && S.runningIds.has(id);
}

export function stageLabel(stage) {
    if (isRunning(stage.id))
        return RUNNING;
    return stateLabel(stage.state);
}

export function stateLabel(state) {
    return STATES[state] ?? { icon: "•", text: state || t("state.unknown") };
}

export function labelText(label) {
    return label.key ? t(label.key) : label.text;
}

/**
 * Writes a stage badge. If this spot ("card" or "panel") showed other text for the stage last
 * time, the new text decodes in; a decode still settling carries on in the re-rendered element.
 */
export function paintBadge(badge, stageId, scope, label) {
    const text = `${label.icon} ${labelText(label)}`;
    const key = `${scope}:${stageId}`;
    const before = shownBadge.get(key);
    shownBadge.set(key, text);
    badge.toggleAttribute("data-running", label === RUNNING);
    FX.decode(badge, text, { key, animate: before !== undefined && before !== text });
}

/** The other stages a dry run starts at the same time as this one, or "". */
export function togetherNames(step, steps) {
    const all = steps || (S.planView ? [...S.planView.values()] : []);
    if (step.action !== "run" || !step.together)
        return "";
    const names = [];
    for (const other of all) {
        if (other !== step && other.action === "run" && other.together === step.together)
            names.push(other.id);
    }
    return names.join(", ");
}

export function planText(step) {
    const label = `${PLAN_ICON[step.action] || "•"} ${planLabel(step.action)}`;
    const model = step.callsModel ? ` · ${t("plan.callsModel")}` : "";
    const names = togetherNames(step);
    const side = names ? ` · ${t("plan.together", { names })}` : "";
    return `${label}${model}${side}`;
}

/** Adds, updates or removes a card's dry-run chip, just under its badge. */
export function paintPlanChip(card, animate) {
    const id = card.dataset.id || "";
    const step = S.planView ? S.planView.get(id) : null;
    let chip = card.querySelector(".plan-chip");
    if (!step) {
        if (chip)
            chip.remove();
        return;
    }
    if (!chip) {
        chip = el("p", "plan-chip");
        const badge = card.querySelector(".badge");
        if (badge)
            badge.after(chip);
        else
            card.append(chip);
    }
    chip.dataset.action = step.action || "";
    chip.title = I18N.pick(step.detail || "");
    FX.decode(chip, planText(step), { key: `plan:${id}`, fast: true, animate });
}

/** In the graph, the dry-run action replaces a node's executor line while a preview is shown. */
export function paintPlanNode(node) {
    const id = node.getAttribute("data-id") || "";
    const step = S.planView ? S.planView.get(id) : null;
    const type = node.querySelector(".flow-type");
    if (!type)
        return;
    if (step) {
        node.setAttribute("data-plan", step.action || "");
        const side = togetherNames(step) ? " ∥" : "";
        type.textContent = clipLabel(`${PLAN_ICON[step.action] || "•"} ${planLabel(step.action)}${side}`, NODE_W - 16);
        type.classList.add("is-plan");
    }
    else {
        node.removeAttribute("data-plan");
        type.textContent = type.getAttribute("data-type") || "";
        type.classList.remove("is-plan");
    }
}

export function paintPlan(animate) {
    for (const card of boardEl.querySelectorAll(".card"))
        paintPlanChip(card, animate);
    for (const node of boardEl.querySelectorAll(".flow-node"))
        paintPlanNode(node);
}

/** Shows a dry run on the cards (and graph nodes) until the flow changes or a run starts. */
export function showPlan(data) {
    const steps = data && Array.isArray(data.steps) ? data.steps : [];
    S.planView = new Map(steps.map((step) => [step.id, step]));
    paintPlan(true);
}

export function clearPlan() {
    if (!S.planView)
        return;
    S.planView = null;
    paintPlan(false);
}

/** Marks every stage that is running: cards, graph nodes, edges into them, and the panel badge. */
export function paintRunning() {
    for (const card of boardEl.querySelectorAll(".card")) {
        const id = card.dataset.id || "";
        const on = isRunning(id);
        card.toggleAttribute("data-running", on);
        // A stage that just finished keeps saying "running" until the refresh brings its new state.
        const badge = on ? card.querySelector(".badge") : null;
        if (badge)
            paintBadge(badge, id, "card", RUNNING);
    }
    for (const node of boardEl.querySelectorAll(".flow-node")) {
        node.toggleAttribute("data-running", isRunning(node.getAttribute("data-id") || ""));
    }
    for (const edge of boardEl.querySelectorAll(".flow-edge[data-to]")) {
        edge.toggleAttribute("data-running", isRunning(edge.getAttribute("data-to") || ""));
    }
    const panelBadge = S.panelMode === "stage" ? panelBody.querySelector(".badge[data-stage]") : null;
    if (panelBadge) {
        const id = panelBadge.getAttribute("data-stage") || "";
        if (isRunning(id))
            paintBadge(panelBadge, id, "panel", RUNNING);
    }
}

/** A stage started: mark it, decode its badge to "running", and scroll the board to it. */
export function setRunning(id) {
    if (!id)
        return;
    S.runningIds.add(id);
    S.followId = id;
    paintRunning();
    S.followUntil = performance.now() + 1500;
    followStage(id);
}

export function followStage(id) {
    // Where the side panel starts, the board is covered.
    const right = panelEl.hidden ? undefined : panelEl.getBoundingClientRect().left;
    if (S.view === "graph") {
        const node = [...boardEl.querySelectorAll(".flow-node")].find((item) => item.getAttribute("data-id") === id);
        FX.follow(boardEl.querySelector(".graph-scroll"), node, { right, margin: PAD });
        return;
    }
    const card = [...boardEl.querySelectorAll(".card")].find((item) => item.dataset.id === id);
    // Keep the board's side padding, so a lifted card's shadow is not cut at the edge.
    const margin = Number.parseFloat(getComputedStyle(boardEl).scrollPaddingLeft) || 0;
    FX.follow(boardEl, card, { right, margin });
}

export function clipLabel(text, maxPx) {
    const chars = Array.from(String(text ?? ""));
    let width = 0;
    for (let i = 0; i < chars.length; i += 1) {
        const next = width + (chars[i].charCodeAt(0) > 255 ? 16 : 8.5);
        if (next > maxPx)
            return chars.slice(0, Math.max(1, i - 1)).join("") + "…";
        width = next;
    }
    return chars.join("");
}

/**
 * The version line: the latest run, or, after a restore, the older run the files on disk are
 * (`current`, from the server), with the latest named so the restore is plain to see.
 */
export function paintVersion(version, stage) {
    if (!stage.latest) {
        I18N.text(version, "stage.noRuns");
    }
    else if (typeof stage.current === "number" && stage.current !== stage.latest.n) {
        I18N.text(version, "stage.restored", { n: stage.current, latest: stage.latest.n });
    }
    else {
        version.textContent = `v${stage.latest.n} · ${formatTime(stage.latest.time)}`;
    }
}

export const stageDialog = document.getElementById("stage-dialog");

export const stageForm = document.getElementById("stage-form");

export const stageStatus = document.getElementById("stage-status");

export const stageSave = document.getElementById("stage-save");

export const removeDialog = document.getElementById("remove-dialog");

export const removeText = document.getElementById("remove-text");

export const removeDeps = document.getElementById("remove-deps");

export const removeStatus = document.getElementById("remove-status");

export const removeConfirm = document.getElementById("remove-confirm");

export const removeForce = document.getElementById("remove-force");

export const S = {
  lastJson: "",
  shownJson: "",
  lastInputValues: "",
  refreshing: false,
  currentBlob: null,
  runBusy: false,
  runGen: 0,
  boardStages: [],
  removeId: "",
  view: storedView(),
  graphStyle: storedGraphStyle(),
  graphPayload: null,
  graphError: "",
  graphTicket: 0,
  selectedId: "",
  panelMode: "",
  returnToStage: null,
  usageByStage: new Map(),
  usageTotal: { input: 0, output: 0, calls: 0 },
  usageText: "",
  runningIds: new Set(),
  followId: "",
  followUntil: 0,
  planView: null,
  lastPress: null,
  holdTicket: 0,
  holdPlan: null,
  lastPressEnd: 0,
  eventsState: "connecting",
  pollTimer: 0,
  reconnectTimer: 0,
  eventSource: null,
  lastEventId: 0,
  lastFlow: null,
  graphResize: null,
  thumbGen: 0,
  runHold: null,
};
