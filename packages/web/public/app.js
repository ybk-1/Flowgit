const token = document.querySelector('meta[name="flowgit-token"]')?.getAttribute("content") ?? "";

/** Stage states and their icons; the words come from I18N ("state.<id>"). */
const STATES = {
  ok: { icon: "✓", key: "state.ok" },
  stale: { icon: "↻", key: "state.stale" },
  edited: { icon: "✎", key: "state.edited" },
  error: { icon: "✗", key: "state.error" },
  "never-run": { icon: "○", key: "state.never-run" },
  "waiting-upstream": { icon: "…", key: "state.waiting-upstream" },
};

const t = I18N.t;

/** A new element whose text is a translated string that follows the language switch. */
function elt(tag, className, key, vars) {
  const node = el(tag, className);
  I18N.text(node, key, vars);
  return node;
}

/** A new element whose text may be bilingual ("中文 / English"); it shows the current language's half. */
function elr(tag, className, text) {
  const node = el(tag, className);
  I18N.raw(node, text);
  return node;
}

/** "message (404)" in the current language, following the switch. */
function withStatus(key, status) {
  return ["withStatus", { msg: { key }, status }];
}

/** A server message (often bilingual) or, when there is none, a translated fallback with the status. */
function setError(node, message, key, status) {
  if (message) I18N.raw(node, message);
  else if (status != null) I18N.text(node, ...withStatus(key, status));
  else I18N.text(node, key);
  return node;
}

function errorEl(className, message, key, status) {
  return setError(el("p", className), message, key, status);
}

const VIEW_KEY = "flowgit.board.view";
const GRAPH_STYLE_KEY = "flowgit.board.graphStyle";
const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 176;
const NODE_H = 72;
const GAP_X = 64;
const GAP_Y = 28;
const PAD = 20;
/** The 3D graph: taller blocks and wider gaps, so a block's front face never hides an edge behind it. */
const GRID_3D = { w: NODE_W, h: 84, gx: 72, gy: 48, pad: 40 };

/** "cards" or "graph". Storage can throw in private mode; the choice still works for this visit. */
function storedView() {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    if (value === "graph" || value === "cards") return value;
  } catch {
    // private mode or blocked storage
  }
  return "cards";
}

function storeView(value) {
  try {
    window.localStorage.setItem(VIEW_KEY, value);
  } catch {
    // quota or private mode; the toggle still applies until reload
  }
}

/** "depth" (blocks on a tilted floor) or "flat" (the plain diagram). */
function storedGraphStyle() {
  try {
    if (window.localStorage.getItem(GRAPH_STYLE_KEY) === "flat") return "flat";
  } catch {
    // private mode or blocked storage
  }
  return "depth";
}

function storeGraphStyle(value) {
  try {
    window.localStorage.setItem(GRAPH_STYLE_KEY, value);
  } catch {
    // quota or private mode; the switch still applies until reload
  }
}

const boardEl = document.getElementById("board");
const bannerEl = document.getElementById("banner");
const inputsEl = document.getElementById("inputs");
const inputsForm = document.getElementById("inputs-form");
const inputsStatus = document.getElementById("inputs-status");
const inputsSave = document.getElementById("inputs-save");
const noticeEl = document.getElementById("notice");
const hintEl = document.getElementById("refresh-hint");
const panelEl = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");
const logEl = document.getElementById("log");
const runAllButton = document.getElementById("run-all");
const previewButton = document.getElementById("preview");
const usageTotalEl = document.getElementById("usage-total");
const panelPortal = FX.portal(panelEl);

// Depth: the card under the mouse tilts; the 3D graph's floor turns a little. A card stays flat
// while it waits for upstream (it sits pressed into the page), while one of its fields has focus,
// or while its menu is open (the menu is position: fixed, so a transformed card would move it).
FX.tilt(boardEl, {
  selector: ".card",
  skip: (card) =>
    card.dataset.state === "waiting-upstream" ||
    Boolean(card.querySelector(".menu:not([hidden])")) ||
    (card.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")),
});
FX.orbit(boardEl, { area: ".graph-3d", plane: ".iso-plane" });

let lastJson = "";
/** The flow JSON the board last showed. Unlike lastJson, a forced refresh does not empty it. */
let shownJson = "";
let lastInputValues = "";
let refreshing = false;
let currentBlob = null;
let runBusy = false;
let runGen = 0;
let boardStages = [];
let removeId = "";
const modelDrafts = new Map();
let view = storedView();
let graphStyle = storedGraphStyle();
let graphPayload = null;
let graphError = "";
let graphTicket = 0;
let selectedId = "";
let panelMode = "";
let returnToStage = null;
let usageByStage = new Map();
let usageTotal = { input: 0, output: 0, calls: 0 };
let usageText = "";

function planLabel(action) {
  return ["skip", "keep-edit", "run", "wait", "cannot-run", "not-reached"].includes(action) ? t(`plan.${action}`) : action || "";
}

const PLAN_ICON = {
  skip: "·",
  "keep-edit": "✎",
  run: "▶",
  wait: "…",
  "cannot-run": "✗",
  "not-reached": "—",
};

/** Shown instead of the stage's state while the board's run is on that stage. */
const RUNNING = { icon: "▶", key: "state.running" };
/** Run all runs after a hold this long; a press shorter than TAP_MS still acts as a click. */
const HOLD_MS = 1000;
const TAP_MS = 250;

/** The stage the board's run is on, from the run log: set by stage:start, cleared when it ends. */
let runningId = "";
/** Until when the board keeps scrolling to the running stage, even across a repaint. */
let followUntil = 0;
/** Dry-run steps by stage id while a preview is shown on the cards; null otherwise. */
let planView = null;
/** The badge text each card and the stage panel showed last, so only a change decodes. */
const shownBadge = new Map();
/** Where the last click or key press happened, so the side panel can open from there. */
let lastPress = null;
/** Each press of Run all gets a ticket, so a preview that arrives after the release is dropped. */
let holdTicket = 0;
let holdPlan = null;
/** When the last press of Run all ended, so the click that follows it is not handled twice. */
let lastPressEnd = 0;

/** "connecting" until the first open or error, then "live" or "down". */
let eventsState = "connecting";
let pollTimer = 0;
let reconnectTimer = 0;
let eventSource = null;
/** Id of the last stream event handled. A reconnect replays the run log, so older ids are skipped. */
let lastEventId = 0;

function headers() {
  return { "X-Flowgit-Token": token };
}

function formatTime(iso) {
  if (!iso) return "";
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, " UTC");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function captureModelDrafts() {
  for (const input of document.querySelectorAll("input[data-model-for]")) {
    modelDrafts.set(input.getAttribute("data-model-for"), input.value);
  }
}

function stageUsageLine(stageId) {
  const row = usageByStage.get(stageId) || { input: 0, output: 0, calls: 0 };
  const input = Number(row.input) || 0;
  const output = Number(row.output) || 0;
  const calls = Number(row.calls) || 0;
  if (!calls) return t("usage.none");
  return t("usage.stage", { total: input + output, input, output, count: calls });
}

function paintUsageTotal() {
  if (!usageTotalEl) return;
  const input = Number(usageTotal.input) || 0;
  const output = Number(usageTotal.output) || 0;
  const calls = Number(usageTotal.calls) || 0;
  I18N.text(usageTotalEl, "usage.total", { input, output, count: calls });
}

function applyUsage(text) {
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  const stages = Array.isArray(data.stages) ? data.stages : [];
  usageByStage = new Map(stages.map((stage) => [stage.id, stage]));
  const total = data.total;
  usageTotal = total && typeof total === "object" ? total : { input: 0, output: 0, calls: 0 };
}

function stageLabel(stage) {
  if (stage.id && stage.id === runningId) return RUNNING;
  return stateLabel(stage.state);
}

function stateLabel(state) {
  return STATES[state] ?? { icon: "•", text: state || t("state.unknown") };
}

function labelText(label) {
  return label.key ? t(label.key) : label.text;
}

/**
 * Writes a stage badge. If this spot ("card" or "panel") showed other text for the stage last
 * time, the new text decodes in; a decode still settling carries on in the re-rendered element.
 */
function paintBadge(badge, stageId, scope, label) {
  const text = `${label.icon} ${labelText(label)}`;
  const key = `${scope}:${stageId}`;
  const before = shownBadge.get(key);
  shownBadge.set(key, text);
  badge.toggleAttribute("data-running", label === RUNNING);
  FX.decode(badge, text, { key, animate: before !== undefined && before !== text });
}

function planText(step) {
  const label = `${PLAN_ICON[step.action] || "•"} ${planLabel(step.action)}`;
  return step.callsModel ? `${label} · ${t("plan.callsModel")}` : label;
}

/** Adds, updates or removes a card's dry-run chip, just under its badge. */
function paintPlanChip(card, animate) {
  const id = card.dataset.id || "";
  const step = planView ? planView.get(id) : null;
  let chip = card.querySelector(".plan-chip");
  if (!step) {
    if (chip) chip.remove();
    return;
  }
  if (!chip) {
    chip = el("p", "plan-chip");
    const badge = card.querySelector(".badge");
    if (badge) badge.after(chip);
    else card.append(chip);
  }
  chip.dataset.action = step.action || "";
  chip.title = I18N.pick(step.detail || "");
  FX.decode(chip, planText(step), { key: `plan:${id}`, fast: true, animate });
}

/** In the graph, the dry-run action replaces a node's executor line while a preview is shown. */
function paintPlanNode(node) {
  const id = node.getAttribute("data-id") || "";
  const step = planView ? planView.get(id) : null;
  const type = node.querySelector(".flow-type");
  if (!type) return;
  if (step) {
    node.setAttribute("data-plan", step.action || "");
    type.textContent = clipLabel(`${PLAN_ICON[step.action] || "•"} ${planLabel(step.action)}`, NODE_W - 16);
    type.classList.add("is-plan");
  } else {
    node.removeAttribute("data-plan");
    type.textContent = type.getAttribute("data-type") || "";
    type.classList.remove("is-plan");
  }
}

function paintPlan(animate) {
  for (const card of boardEl.querySelectorAll(".card")) paintPlanChip(card, animate);
  for (const node of boardEl.querySelectorAll(".flow-node")) paintPlanNode(node);
}

/** Shows a dry run on the cards (and graph nodes) until the flow changes or a run starts. */
function showPlan(data) {
  const steps = data && Array.isArray(data.steps) ? data.steps : [];
  planView = new Map(steps.map((step) => [step.id, step]));
  paintPlan(true);
}

function clearPlan() {
  if (!planView) return;
  planView = null;
  paintPlan(false);
}

/** Marks the stage the run is on, decodes its badge to "running", and scrolls the board to it. */
function setRunning(id) {
  runningId = id || "";
  // Only the new stage's badge changes now. A stage that just finished keeps saying "running"
  // until the refresh brings its new state, so it never flashes its old state in between.
  const stage = boardStages.find((item) => item.id === runningId);
  for (const card of boardEl.querySelectorAll(".card")) {
    const on = runningId !== "" && card.dataset.id === runningId;
    card.toggleAttribute("data-running", on);
    const badge = on ? card.querySelector(".badge") : null;
    if (badge && stage) paintBadge(badge, runningId, "card", RUNNING);
  }
  for (const node of boardEl.querySelectorAll(".flow-node")) {
    node.toggleAttribute("data-running", runningId !== "" && node.getAttribute("data-id") === runningId);
  }
  for (const edge of boardEl.querySelectorAll(".flow-edge[data-to]")) {
    edge.toggleAttribute("data-running", runningId !== "" && edge.getAttribute("data-to") === runningId);
  }
  const panelBadge = panelMode === "stage" ? panelBody.querySelector(".badge[data-stage]") : null;
  if (panelBadge && stage && panelBadge.getAttribute("data-stage") === runningId) {
    paintBadge(panelBadge, runningId, "panel", RUNNING);
  }
  if (runningId) {
    followUntil = performance.now() + 1500;
    followStage(runningId);
  }
}

/** The stage finished: its next state comes with a forced refresh, decoding from "running". */
function clearRunning() {
  if (!runningId) return;
  runningId = "";
  void refreshNow();
}

function followStage(id) {
  // Where the side panel starts, the board is covered.
  const right = panelEl.hidden ? undefined : panelEl.getBoundingClientRect().left;
  if (view === "graph") {
    const node = [...boardEl.querySelectorAll(".flow-node")].find((item) => item.getAttribute("data-id") === id);
    FX.follow(boardEl.querySelector(".graph-scroll"), node, { right, margin: PAD });
    return;
  }
  const card = [...boardEl.querySelectorAll(".card")].find((item) => item.dataset.id === id);
  // Keep the board's side padding, so a lifted card's shadow is not cut at the edge.
  const margin = Number.parseFloat(getComputedStyle(boardEl).scrollPaddingLeft) || 0;
  FX.follow(boardEl, card, { right, margin });
}

/** Shows the side panel. When it was closed, it opens as a circle from the last click or key press. */
function revealPanel() {
  document.body.classList.add("panel-open");
  const origin = lastPress && performance.now() - lastPress.at < 1500 ? lastPress : null;
  panelPortal.open(origin);
}

function notePress(target) {
  if (!(target instanceof Element)) return;
  const hit = target.closest("button, .flow-node");
  if (!hit || panelEl.contains(hit)) return;
  const box = hit.getBoundingClientRect();
  lastPress = { x: box.left + box.width / 2, y: box.top + box.height / 2, at: performance.now() };
}

/** The flow the board last rendered, so a language switch can render it again. */
let lastFlow = null;

function render(data) {
  lastFlow = data;
  const flowName = document.getElementById("flow-name");
  if (data.name) I18N.raw(flowName, data.name);
  else I18N.text(flowName, "board");
  document.title = t("docTitle", { name: data.name ? I18N.pick(data.name) : "Flowgit" });
  paintUsageTotal();

  const missing = Array.isArray(data.missingInputs) ? data.missingInputs : [];
  bannerEl.replaceChildren();
  if (missing.length) {
    bannerEl.hidden = false;
    bannerEl.append(
      elt("p", null, "inputs.missing", { names: missing.join(", ") }),
      elt("p", "banner-hint", "inputs.missingHint", { cmd: `flowgit inputs set ${missing[0]}=...` }),
    );
  } else {
    bannerEl.hidden = true;
  }

  captureModelDrafts();
  boardStages = Array.isArray(data.stages) ? data.stages : [];
  if (selectedId && !boardStages.some((stage) => stage.id === selectedId)) {
    selectedId = "";
    if (panelMode === "stage") closePanel();
  }
  paintBoard();
  if (panelMode === "stage" && returnToStage) {
    const fresh = boardStages.find((stage) => stage.id === returnToStage.id);
    if (fresh) openStage(fresh);
    else closePanel();
  }
}

function paintBoard() {
  thumbGen += 1;
  releaseThumbUrls();
  const scroller = boardEl.querySelector(".graph-scroll");
  const scroll = scroller ? scroller.scrollLeft : boardEl.scrollLeft;
  boardEl.replaceChildren();
  boardEl.classList.toggle("is-graph", view === "graph");
  if (view === "graph") {
    const viewEl = renderGraphView();
    boardEl.append(viewEl);
    const next = viewEl.querySelector(".graph-scroll");
    if (next) next.scrollLeft = scroll;
  } else {
    for (const stage of boardStages) boardEl.append(renderCard(stage));
    boardEl.scrollLeft = scroll;
  }
  syncViewToggle();
  syncRunButtons();
  // Restoring scrollLeft stops a smooth scroll, so a repaint right after a stage starts picks it up again.
  if (runningId && performance.now() < followUntil) followStage(runningId);
}

function syncViewToggle() {
  const cards = document.getElementById("view-cards");
  const graph = document.getElementById("view-graph");
  if (cards) cards.setAttribute("aria-pressed", view === "cards" ? "true" : "false");
  if (graph) graph.setAttribute("aria-pressed", view === "graph" ? "true" : "false");
}

function setView(next) {
  if (next !== "cards" && next !== "graph") return;
  if (next === view) return;
  view = next;
  storeView(view);
  syncViewToggle();
  if (view === "cards") {
    graphTicket += 1;
    paintBoard();
    return;
  }
  graphPayload = null;
  graphError = "";
  paintBoard();
  void loadAndPaintGraph();
}

async function reloadGraph() {
  const ticket = ++graphTicket;
  try {
    const res = await fetch("/api/graph", { headers: headers(), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (ticket !== graphTicket) return;
    if (!res.ok) {
      graphPayload = null;
      graphError = data.error || withStatus("graph.error", res.status);
      return;
    }
    graphPayload = data;
    graphError = "";
  } catch {
    if (ticket !== graphTicket) return;
    graphPayload = null;
    graphError = ["graph.error"];
  }
}

async function loadAndPaintGraph() {
  await reloadGraph();
  if (view !== "graph") return;
  paintBoard();
}

function renderGraphView() {
  const wrap = el("div", "graph-view");
  if (graphError) {
    const node = el("p", "graph-empty");
    if (Array.isArray(graphError)) I18N.text(node, ...graphError);
    else I18N.raw(node, graphError);
    wrap.append(node);
    return wrap;
  }
  if (!graphPayload) {
    wrap.append(elt("p", "graph-empty", "graph.loading"));
    return wrap;
  }
  const bar = el("div", "graph-bar");
  bar.append(renderLegend(), renderGraphStyleSwitch());
  wrap.append(bar, graphStyle === "flat" ? drawGraph(graphPayload) : drawGraph3d(graphPayload));
  return wrap;
}

function renderGraphStyleSwitch() {
  const group = el("div", "view-switch graph-style");
  group.setAttribute("role", "group");
  I18N.attr(group, "aria-label", "graph.mode");
  for (const [value, key] of [["depth", "graph.depth"], ["flat", "graph.flat"]]) {
    const button = elt("button", null, key);
    button.type = "button";
    button.dataset.style = value;
    button.setAttribute("aria-pressed", graphStyle === value ? "true" : "false");
    button.addEventListener("click", () => {
      if (graphStyle === value) return;
      graphStyle = value;
      storeGraphStyle(value);
      paintBoard();
    });
    group.append(button);
  }
  return group;
}

function renderLegend() {
  const legend = el("div", "graph-legend");
  for (const [state, label] of Object.entries(STATES)) {
    const item = el("span", "legend-item");
    item.dataset.state = state;
    const swatch = el("span", "legend-swatch");
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(`${label.icon} ${labelText(label)}`));
    legend.append(item);
  }
  const running = el("span", "legend-item");
  running.dataset.state = "running";
  const swatch = el("span", "legend-swatch");
  swatch.setAttribute("aria-hidden", "true");
  running.append(swatch, document.createTextNode(`${RUNNING.icon} ${labelText(RUNNING)}`));
  legend.append(running);
  return legend;
}

function stageForNode(node) {
  const found = boardStages.find((stage) => stage.id === node.id);
  if (found) return found;
  return {
    id: node.id,
    name: node.name || node.id,
    executor: node.type || "",
    state: node.state || "",
    runs: 0,
    latest: null,
    outputs: [],
  };
}

function clipLabel(text, maxPx) {
  const chars = Array.from(String(text ?? ""));
  let width = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const next = width + (chars[i].charCodeAt(0) > 255 ? 16 : 8.5);
    if (next > maxPx) return chars.slice(0, Math.max(1, i - 1)).join("") + "…";
    width = next;
  }
  return chars.join("");
}

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value != null) node.setAttribute(key, String(value));
  }
  return node;
}

/**
 * Where each stage sits and how each edge runs, in px: one column per layer, rows inside it.
 * An edge that skips layers runs along its own lane under the stages.
 */
function graphLayout(nodes, edges, grid) {
  const { w, h, gx, gy, pad } = grid;
  let maxLayer = 0;
  let maxRow = 0;
  const pos = new Map();
  for (const node of nodes) {
    const layer = Number(node.layer) || 0;
    const row = Number(node.row) || 0;
    if (layer > maxLayer) maxLayer = layer;
    if (row > maxRow) maxRow = row;
    pos.set(node.id, { x: pad + layer * (w + gx), y: pad + row * (h + gy), layer });
  }

  const laneGap = 14;
  const bottom = pad + (maxRow + 1) * h + maxRow * gy + 12;
  const routes = [];
  let longLanes = 0;
  for (const edge of edges) {
    const from = pos.get(edge.from);
    const to = pos.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + w;
    const y1 = from.y + h / 2;
    const x2 = to.x;
    const y2 = to.y + h / 2;
    let d;
    if (to.layer - from.layer > 1) {
      const yb = bottom + longLanes++ * laneGap;
      d = `M ${x1} ${y1} H ${x1 + 18} V ${yb} H ${x2 - 18} V ${y2} H ${x2}`;
    } else if (Math.abs(y1 - y2) < 0.5) {
      d = `M ${x1} ${y1} H ${x2}`;
    } else {
      const mid = (x1 + x2) / 2;
      d = `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
    }
    routes.push({ from: edge.from, to: edge.to, d });
  }
  const width = pad * 2 + (maxLayer + 1) * w + maxLayer * gx;
  const height = bottom + (longLanes > 0 ? 8 + longLanes * laneGap : 8);
  return { pos, routes, width, height };
}

/** The edges as SVG paths with an arrowhead. data-to lets a run mark the edges into its stage. */
function graphEdges(layout, className) {
  const svg = svgEl("svg", {
    class: className,
    width: layout.width,
    height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`,
  });
  const marker = svgEl("marker", {
    id: `flow-arrow-${className}`,
    viewBox: "0 0 10 10",
    refX: "8",
    refY: "5",
    markerWidth: "8",
    markerHeight: "8",
    orient: "auto",
  });
  marker.append(svgEl("path", { d: "M0 0 L10 5 L0 10 Z", class: "flow-arrow" }));
  const defs = svgEl("defs");
  defs.append(marker);
  svg.append(defs);
  for (const route of layout.routes) {
    const path = svgEl("path", { class: "flow-edge", d: route.d, "marker-end": `url(#flow-arrow-${className})`, "data-to": route.to });
    if (runningId && route.to === runningId) path.setAttribute("data-running", "");
    svg.append(path);
  }
  return svg;
}

/** What a graph node says to a screen reader and in its tooltip. */
function nodeLabels(node) {
  const state = stateLabel(node.state);
  const nodeName = I18N.pick(node.name || node.id);
  const usage = stageUsageLine(node.id);
  return {
    nodeName,
    aria: `${nodeName} · ${node.type || ""} · ${labelText(state)} · ${usage}`,
    title: `${nodeName} · ${node.type || ""} · ${state.icon} ${labelText(state)} · ${usage}`,
  };
}

/** Click or Enter / Space on a graph node opens its stage in the side panel. */
function wireNode(target, node) {
  const stage = stageForNode(node);
  const open = () => openStage(stage);
  target.addEventListener("click", open);
  target.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });
}

function drawGraph(payload) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const scroll = el("div", "graph-scroll");
  if (!nodes.length) {
    scroll.append(elt("p", "graph-empty", "graph.empty"));
    return scroll;
  }

  const layout = graphLayout(nodes, edges, { w: NODE_W, h: NODE_H, gx: GAP_X, gy: GAP_Y, pad: PAD });
  const svg = graphEdges(layout, "flow-graph");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", t("graph.label"));

  for (const node of nodes) {
    const place = layout.pos.get(node.id);
    if (!place) continue;
    const labels = nodeLabels(node);
    const selected = node.id === selectedId;
    const g = svgEl("g", {
      class: selected ? "flow-node is-selected" : "flow-node",
      role: "button",
      tabindex: "0",
      "data-id": node.id,
      "data-state": node.state || "",
      "aria-pressed": selected ? "true" : "false",
      "aria-label": labels.aria,
    });
    if (runningId && node.id === runningId) g.setAttribute("data-running", "");
    g.append(svgEl("rect", {
      class: "flow-box",
      x: place.x,
      y: place.y,
      width: NODE_W,
      height: NODE_H,
    }));
    const title = svgEl("title");
    title.textContent = labels.title;
    const name = svgEl("text", {
      class: "flow-name",
      x: place.x + NODE_W / 2,
      y: place.y + 30,
      "text-anchor": "middle",
    });
    name.textContent = clipLabel(labels.nodeName, NODE_W - 28);
    const type = svgEl("text", {
      class: "flow-type",
      x: place.x + NODE_W / 2,
      y: place.y + 50,
      "text-anchor": "middle",
      "data-type": node.type || "",
    });
    type.textContent = node.type || "";
    g.append(title, name, type);
    paintPlanNode(g);
    wireNode(g, node);
    svg.append(g);
  }

  scroll.append(svg);
  return scroll;
}

/*
 * The 3D graph: each stage is a block (a top face and three side faces, CSS 3D) standing on a
 * tilted floor, the edges are drawn on the floor, and every block casts a soft shadow. A stage you
 * can run floats; the running one bobs. The blocks stay buttons, so keyboard and screen readers
 * work as in the flat graph, and the flat graph is one click away.
 */
function drawGraph3d(payload) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const scroll = el("div", "graph-scroll graph-3d");
  if (!nodes.length) {
    scroll.append(elt("p", "graph-empty", "graph.empty"));
    return scroll;
  }

  const layout = graphLayout(nodes, edges, GRID_3D);
  const stage = el("div", "iso-stage");
  const plane = el("div", "iso-plane");
  plane.setAttribute("role", "group");
  I18N.attr(plane, "aria-label", "graph.label");
  plane.style.width = `${layout.width}px`;
  plane.style.height = `${layout.height}px`;
  const floor = el("div", "iso-floor");
  floor.setAttribute("aria-hidden", "true");
  const svg = graphEdges(layout, "iso-edges");
  svg.setAttribute("aria-hidden", "true");
  const states = new Map(nodes.map((node) => [node.id, node.state || ""]));
  const paths = svg.querySelectorAll(".flow-edge");
  layout.routes.forEach((route, i) => {
    // Finished work flowing into a stage you can run now.
    const ready = states.get(route.to) === "never-run" && ["ok", "edited"].includes(states.get(route.from));
    if (ready && paths[i]) paths[i].setAttribute("data-ready", "");
  });
  plane.append(floor, svg);

  for (const node of nodes) {
    const place = layout.pos.get(node.id);
    if (!place) continue;
    const labels = nodeLabels(node);
    const selected = node.id === selectedId;
    const block = el("div", selected ? "flow-node iso-node is-selected" : "flow-node iso-node");
    block.setAttribute("role", "button");
    block.tabIndex = 0;
    block.dataset.id = node.id;
    block.dataset.state = node.state || "";
    block.setAttribute("aria-pressed", selected ? "true" : "false");
    block.setAttribute("aria-label", labels.aria);
    block.title = labels.title;
    if (runningId && node.id === runningId) block.setAttribute("data-running", "");
    block.style.left = `${place.x}px`;
    block.style.top = `${place.y}px`;
    block.style.width = `${GRID_3D.w}px`;
    block.style.height = `${GRID_3D.h}px`;
    const top = el("span", "iso-top");
    const name = el("span", "flow-name", labels.nodeName);
    const type = el("span", "flow-type", node.type || "");
    type.setAttribute("data-type", node.type || "");
    top.append(name, type);
    // The ring (focus, selection) is its own plane: an outline or box-shadow on the top face
    // ends up partly hidden under it in Chromium.
    const faces = ["iso-shadow", "iso-face iso-front", "iso-face iso-left", "iso-face iso-right", "iso-ring"].map((cls) => el("span", cls));
    for (const face of faces) face.setAttribute("aria-hidden", "true");
    block.append(...faces, top);
    paintPlanNode(block);
    wireNode(block, node);
    plane.append(block);
  }

  stage.append(plane);
  scroll.append(stage);
  fitGraph3d(scroll, stage, plane, layout);
  watchGraph3d(scroll, () => fitGraph3d(scroll, stage, plane, layout));
  return scroll;
}

/**
 * Scales the floor to the width the board has (never below half size: a big flow scrolls
 * sideways instead) and gives the stage the height the tilted floor needs.
 */
function fitGraph3d(scroll, stage, plane, layout) {
  const avail = scroll.clientWidth || boardEl.clientWidth || 960;
  const scale = Math.max(0.5, Math.min(1, (avail - 24) / (layout.width * 1.04)));
  plane.style.setProperty("--s", scale.toFixed(3));
  stage.style.width = `${Math.max(avail, Math.round(layout.width * scale * 1.04 + 24))}px`;
  stage.style.height = `${Math.round(layout.height * scale * 0.8 + 150 * scale)}px`;
}

/** One observer for the 3D graph on show, so it refits when the board's width changes. */
let graphResize = null;
function watchGraph3d(scroll, refit) {
  if (typeof ResizeObserver !== "function") return;
  if (graphResize) graphResize.disconnect();
  let width = 0;
  graphResize = new ResizeObserver(() => {
    if (!scroll.isConnected) {
      graphResize.disconnect();
      return;
    }
    if (scroll.clientWidth === width) return;
    width = scroll.clientWidth;
    refit();
  });
  graphResize.observe(scroll);
}

function markSelected() {
  for (const node of boardEl.querySelectorAll(".flow-node")) {
    const on = node.getAttribute("data-id") === selectedId;
    node.classList.toggle("is-selected", on);
    node.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function stageBack(stage) {
  return {
    onBack: () => {
      const fresh = boardStages.find((item) => item.id === stage.id) || stage;
      openStage(fresh);
    },
    backLabel: "stage.back",
  };
}

function openStage(stage) {
  // A live refresh of the stage already on show decodes a changed badge; opening a stage does not.
  const sameStage = panelMode === "stage" && !panelEl.hidden && selectedId === stage.id;
  selectedId = stage.id || "";
  returnToStage = stage;
  panelMode = "stage";
  markSelected();
  releaseBlob();
  revealPanel();
  I18N.raw(panelTitle, stage.name || stage.id || "");
  const badge = el("p", "badge");
  badge.dataset.state = stage.state || "";
  badge.dataset.stage = stage.id || "";
  if (!sameStage) shownBadge.delete(`panel:${stage.id || ""}`);
  paintBadge(badge, stage.id || "", "panel", stageLabel(stage));
  const version = el("p", "version");
  paintVersion(version, stage);

  const actions = el("div", "stage-actions");
  const history = document.createElement("button");
  history.type = "button";
  history.className = "history";
  I18N.text(history, "stage.history");
  history.addEventListener("click", () => {
    panelMode = "other";
    void openHistory(stage);
  });
  const run = document.createElement("button");
  run.type = "button";
  run.className = "run";
  I18N.text(run, "stage.run");
  run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
  if (stage.state === "waiting-upstream") I18N.attr(run, "title", "stage.waiting");
  run.addEventListener("click", () => startRun(stage.id, modelForStage(stage.id)));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  I18N.text(remove, "stage.remove");
  remove.addEventListener("click", () => openRemove(stage));
  actions.append(history, run, remove);

  const nodes = [
    badge,
    elt("p", "executor", "stage.executor", { name: stage.executor || "" }),
    version,
    elt("p", "runs", "stage.runs", { count: stage.runs ?? 0 }),
    el("p", "usage", stageUsageLine(stage.id)),
  ];
  if (stage.state === "edited") nodes.push(elt("p", "edit-note", "editNote"));
  nodes.push(actions);
  if (stage.executor === "human" && stage.state !== "waiting-upstream") {
    if (stage.instructions) nodes.push(foldedInstructions(stage.instructions));
    const dir = humanDir(stage);
    if (dir) nodes.push(uploadControl(stage, dir.path, stageBack(stage)));
  }
  if (stage.executor === "llm") nodes.push(modelField(stage.id));

  const outputs = el("div", "outputs");
  outputs.append(elt("p", "outputs-label", "stage.outputs"));
  for (const output of stage.outputs ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = output.directory ? `${output.path}/` : output.path;
    button.addEventListener("click", () => openOutput(output, stage, stageBack(stage)));
    outputs.append(button);
  }
  nodes.push(outputs);
  showPanel(nodes);
  syncRunButtons();
}

/**
 * The version line: the latest run, or, after a restore, the older run the files on disk are
 * (`current`, from the server), with the latest named so the restore is plain to see.
 */
function paintVersion(version, stage) {
  if (!stage.latest) {
    I18N.text(version, "stage.noRuns");
  } else if (typeof stage.current === "number" && stage.current !== stage.latest.n) {
    I18N.text(version, "stage.restored", { n: stage.current, latest: stage.latest.n });
  } else {
    version.textContent = `v${stage.latest.n} · ${formatTime(stage.latest.time)}`;
  }
}

function humanDir(stage) {
  const dirs = (stage.outputs ?? []).filter((output) => output.directory);
  return dirs.length === 1 ? dirs[0] : null;
}

function renderCard(stage) {
  const card = el("article", "card");
  card.dataset.id = stage.id || "";
  card.dataset.state = stage.state || "";
  if (runningId && stage.id === runningId) card.setAttribute("data-running", "");

  const head = el("div", "card-head");
  head.append(elr("h2", null, stage.name || stage.id || ""), cardMenu(stage));
  const badge = el("p", "badge");
  paintBadge(badge, stage.id || "", "card", stageLabel(stage));
  card.append(
    head,
    el("p", "stage-id", stage.id || ""),
    elt("p", "executor", "stage.executor", { name: stage.executor || "" }),
    badge,
  );
  paintPlanChip(card, false);
  if (stage.state === "edited") card.append(elt("p", "edit-note", "editNote"));

  const version = el("p", "version");
  paintVersion(version, stage);
  card.append(version, elt("p", "runs", "stage.runs", { count: stage.runs ?? 0 }), el("p", "usage", stageUsageLine(stage.id)));
  const history = document.createElement("button");
  history.type = "button";
  history.className = "history";
  I18N.text(history, "stage.history");
  history.addEventListener("click", () => {
    returnToStage = null;
    panelMode = "other";
    void openHistory(stage);
  });
  card.append(history);

  // A human stage whose upstream is ready is waiting on the person: show what to do, and the upload button.
  if (stage.executor === "human" && stage.state !== "waiting-upstream") {
    if (stage.instructions) card.append(foldedInstructions(stage.instructions));
    const dir = humanDir(stage);
    if (dir) card.append(uploadControl(stage, dir.path));
  }

  if (stage.executor === "llm") card.append(modelField(stage.id));

  const run = document.createElement("button");
  run.type = "button";
  run.className = "run";
  I18N.text(run, "stage.run");
  run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
  if (stage.state === "waiting-upstream") I18N.attr(run, "title", "stage.waiting");
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

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);
const thumbUrls = new Set();
const observedThumbs = new Set();
let thumbGen = 0;
const thumbObserver =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            thumbObserver.unobserve(entry.target);
            const load = entry.target._flowgitLoad;
            if (typeof load === "function") load();
          }
        },
        { rootMargin: "160px" },
      )
    : null;

function releaseThumbUrls() {
  if (thumbObserver) {
    for (const node of observedThumbs) thumbObserver.unobserve(node);
  }
  observedThumbs.clear();
  for (const url of thumbUrls) URL.revokeObjectURL(url);
  thumbUrls.clear();
}

function rememberThumbUrl(url) {
  thumbUrls.add(url);
}

function fileExt(filePath) {
  const base = String(filePath || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function outputKind(output) {
  if (output.directory) return "dir";
  const type = String(output.type || "").toLowerCase();
  const ext = fileExt(output.path);
  if (type.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (type.startsWith("audio/") || (AUDIO_EXT.has(ext) && !type.startsWith("video/"))) return "audio";
  if (type.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (type === "application/json" || type.endsWith("+json") || ext === ".json") return "json";
  return "text";
}

/** First three content lines, with Markdown markers taken off. */
function stripMarkdown(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let fence = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (!trimmed || /^([-*_])\1{2,}$/.test(trimmed)) continue;
    const plain = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/!\[[^\]]*]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();
    if (!plain) continue;
    out.push(plain);
    if (out.length === 3) break;
  }
  return out.join("\n");
}

function summarizeJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return stripMarkdown(text);
  }
  if (Array.isArray(value)) return t("thumb.items", { count: value.length });
  if (!value || typeof value !== "object") return String(value);
  const lines = [];
  for (const [key, val] of Object.entries(value)) {
    if (Array.isArray(val)) lines.push(`${key}: ${t("thumb.items", { count: val.length })}`);
    else if (val && typeof val === "object") lines.push(`${key}: ${t("thumb.items", { count: Object.keys(val).length })}`);
    else if (typeof val === "string") lines.push(`${key}: ${val.length > 48 ? `${val.slice(0, 48)}…` : val}`);
    else lines.push(`${key}: ${String(val)}`);
  }
  return lines.join("\n");
}

function formatDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return t("thumb.lengthUnknown");
  const rounded = seconds >= 10 ? String(Math.round(seconds)) : seconds.toFixed(1);
  return t("thumb.seconds", { n: rounded });
}

function waveform() {
  const box = el("div", "wave");
  for (const height of [35, 70, 48, 90, 55, 78, 40, 66, 52, 84, 44, 60]) {
    const bar = document.createElement("i");
    bar.style.height = `${height}%`;
    box.append(bar);
  }
  return box;
}

function videoMark() {
  const box = el("div", "video-mark");
  box.append(el("span", "video-icon", "▶"), elt("span", "video-label", "thumb.video"));
  return box;
}

function thumbNote(key) {
  return elt("p", "thumb-text", key);
}

function thumbText(text) {
  return text ? el("p", "thumb-text", text) : elt("p", "thumb-text", "thumb.empty");
}

function scheduleThumb(node, load) {
  node._flowgitLoad = load;
  if (!thumbObserver) {
    load();
    return;
  }
  // Observe after the card is in the document, or a detached node never intersects.
  requestAnimationFrame(() => {
    if (!node.isConnected || !thumbObserver) return;
    observedThumbs.add(node);
    thumbObserver.observe(node);
  });
}

function outputThumb(output, stage, index, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb";
  const label = output.directory ? `${output.path}/` : output.path;
  button.setAttribute("aria-label", `${label} · ${t("thumb.open")}`);
  button.addEventListener("click", () => openOutput(output, stage, options));
  button.append(el("span", "thumb-name", label));
  const body = el("div", "thumb-body");
  button.append(body);
  const gen = thumbGen;
  scheduleThumb(button, () => {
    void fillThumb(body, output, stage, index, gen);
  });
  return button;
}

async function fillThumb(body, output, stage, index, gen) {
  if (gen !== thumbGen || !body.isConnected) return;
  const kind = outputKind(output);
  try {
    if (kind === "image" || kind === "video" || kind === "audio") {
      await fillMediaThumb(body, stage, index, gen, kind);
      return;
    }
    if (kind === "dir") {
      await fillDirThumb(body, output, gen);
      return;
    }
    await fillTextThumb(body, output, gen, kind === "json");
  } catch {
    if (gen === thumbGen && body.isConnected) body.replaceChildren(thumbNote("thumb.noPreview"));
  }
}

async function fillMediaThumb(body, stage, index, gen, kind) {
  const res = await fetch(`/api/thumb?stage=${encodeURIComponent(stage.id)}&output=${index}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (gen !== thumbGen || !body.isConnected) return;
  if (kind === "audio") {
    let duration = null;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (typeof data.duration === "number") duration = data.duration;
    }
    if (gen !== thumbGen || !body.isConnected) return;
    body.replaceChildren(waveform());
    setThumbCaption(body, formatDuration(duration));
    return;
  }
  if (res.status === 204) {
    body.replaceChildren(videoMark());
    return;
  }
  if (!res.ok) {
    body.replaceChildren(thumbNote("thumb.notYet"));
    return;
  }
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) {
    body.replaceChildren(kind === "video" ? videoMark() : thumbNote("thumb.noPreview"));
    return;
  }
  const blob = await res.blob();
  if (gen !== thumbGen || !body.isConnected) return;
  const url = URL.createObjectURL(blob);
  rememberThumbUrl(url);
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = url;
  body.replaceChildren(img);
}

async function fillTextThumb(body, output, gen, json) {
  const res = await fetch(`/api/file?path=${encodeURIComponent(output.path)}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (gen !== thumbGen || !body.isConnected) return;
  if (!res.ok) {
    body.replaceChildren(thumbNote("thumb.notYet"));
    return;
  }
  const text = await res.text();
  if (gen !== thumbGen || !body.isConnected) return;
  body.replaceChildren(thumbText(json ? summarizeJson(text) : stripMarkdown(text)));
}

async function fillDirThumb(body, output, gen) {
  const rel = String(output.path || "").replace(/\/+$/, "");
  const res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (gen !== thumbGen || !body.isConnected) return;
  if (!res.ok) {
    body.replaceChildren(thumbNote("thumb.notYet"));
    return;
  }
  const data = await res.json().catch(() => ({}));
  const files = Array.isArray(data.files) ? data.files : [];
  const images = files.filter((name) => IMAGE_EXT.has(fileExt(name))).slice(0, 4);
  if (images.length) {
    const grid = el("div", "thumb-grid");
    body.replaceChildren(grid);
    for (const name of images) {
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      grid.append(img);
      const fileRes = await fetch(`/api/file?path=${encodeURIComponent(`${rel}/${name}`)}`, {
        headers: headers(),
        cache: "no-store",
      });
      if (gen !== thumbGen || !body.isConnected) return;
      if (!fileRes.ok) continue;
      const blob = await fileRes.blob();
      if (gen !== thumbGen || !body.isConnected) return;
      const url = URL.createObjectURL(blob);
      rememberThumbUrl(url);
      img.src = url;
    }
  } else if (gen === thumbGen && body.isConnected) {
    body.replaceChildren();
  }
  if (gen !== thumbGen || !body.isConnected) return;
  const n = files.length;
  setThumbCaption(body, t("thumb.files", { count: n }));
}

function setThumbCaption(body, text) {
  const parent = body.parentElement;
  if (!parent) return;
  let caption = parent.querySelector(":scope > .thumb-count");
  if (!caption) {
    caption = el("p", "thumb-count", "");
    parent.append(caption);
  }
  caption.textContent = text;
}

function foldedInstructions(text) {
  const wrap = el("div", "instructions-fold");
  const p = elr("p", "instructions is-clamped", text);
  const more = document.createElement("button");
  more.type = "button";
  more.className = "more";
  more.hidden = true;
  more.textContent = t("thumb.more");
  more.addEventListener("click", () => {
    const open = p.classList.toggle("is-open");
    p.classList.toggle("is-clamped", !open);
    more.textContent = open ? t("thumb.less") : t("thumb.more");
  });
  wrap.append(p, more);
  requestAnimationFrame(() => {
    if (!p.isConnected) return;
    more.hidden = !(p.scrollHeight > p.clientHeight + 1);
  });
  return wrap;
}

function modelField(stageId) {
  const label = el("label", "model-field");
  label.append(elt("span", null, "stage.model"));
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "provider/model";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("data-model-for", stageId);
  input.value = modelDrafts.get(stageId) || "";
  input.addEventListener("input", () => modelDrafts.set(stageId, input.value));
  label.append(input);
  return label;
}

function fieldValue(stageId, root) {
  if (!root) return undefined;
  for (const input of root.querySelectorAll("input[data-model-for]")) {
    if (input.getAttribute("data-model-for") !== stageId) continue;
    return input.value.trim() || undefined;
  }
  return undefined;
}

function panelHasModel(stageId) {
  for (const input of panelEl.querySelectorAll("input[data-model-for]")) {
    if (input.getAttribute("data-model-for") === stageId) return true;
  }
  return false;
}

function modelForStage(stageId) {
  // The open stage panel is what Run in that panel should use, even if a card also has a field.
  if (panelMode === "stage" && panelHasModel(stageId)) return fieldValue(stageId, panelEl);
  return fieldValue(stageId, boardEl);
}

function modelForAll() {
  const values = [];
  const root = view === "graph" ? panelEl : boardEl;
  for (const input of root.querySelectorAll("input[data-model-for]")) {
    const value = input.value.trim();
    if (value) values.push(value);
  }
  const unique = [...new Set(values)];
  if (unique.length > 1) {
    return {
      error: t("run.modelsDiffer"),
    };
  }
  return { model: unique[0] };
}

function syncRunButtons() {
  if (runAllButton) runAllButton.disabled = runBusy;
  if (previewButton) previewButton.disabled = runBusy;
  const addStageButton = document.getElementById("add-stage");
  if (addStageButton) addStageButton.disabled = runBusy;
  for (const button of document.querySelectorAll("button.run")) {
    button.disabled = runBusy || button.dataset.waiting === "1";
  }
  for (const button of document.querySelectorAll("button.menu-button, .stage-actions .danger")) {
    button.disabled = runBusy;
  }
}

function appendLog(line) {
  logEl.hidden = false;
  logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${line}` : line;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = "";
  logEl.hidden = false;
}

function modelCallCount(data) {
  if (data && typeof data.modelCalls === "number" && Number.isFinite(data.modelCalls)) return data.modelCalls;
  const steps = data && Array.isArray(data.steps) ? data.steps : [];
  return steps.filter((step) => step.callsModel).length;
}

async function fetchPlan(model) {
  const path = model ? `/api/plan?model=${encodeURIComponent(model)}` : "/api/plan";
  const res = await fetch(path, { headers: headers(), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ? I18N.pick(data.error) : t("withStatus", { msg: { key: "run.previewError" }, status: res.status }) };
  return { ok: true, data };
}

function planLines(data) {
  const lines = [t("plan.header")];
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (const step of steps) {
    const label = planLabel(step.action);
    const detail = step.detail ? ` · ${I18N.pick(step.detail)}` : "";
    lines.push(`${I18N.pick(step.name || step.id)} ${step.id} · ${label}${detail}`);
  }
  lines.push(t("plan.calls", { count: modelCallCount(data) }));
  return lines;
}

async function previewAll() {
  if (runBusy) {
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
  } catch {
    appendLog(t("run.previewError"));
  }
}

/** Run all was held down: show the dry run on the cards and in the log while the press lasts. */
function startHoldPreview() {
  const ticket = ++holdTicket;
  const picked = modelForAll();
  holdPlan = picked.error
    ? Promise.resolve({ ok: false, error: picked.error })
    : fetchPlan(picked.model).catch(() => ({ ok: false, error: t("run.previewError") }));
  void holdPlan.then((plan) => {
    if (ticket !== holdTicket || !runHold.holding()) return;
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
async function runHeld() {
  const pending = holdPlan;
  runHold.reset();
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

async function runAll() {
  if (runBusy) {
    appendLog(t("run.busy"));
    return;
  }
  const picked = modelForAll();
  if (picked.error) {
    appendLog(picked.error);
    return;
  }
  runBusy = true;
  syncRunButtons();
  let calls = 0;
  try {
    const plan = await fetchPlan(picked.model);
    if (!plan.ok) {
      appendLog(plan.error);
      return;
    }
    calls = modelCallCount(plan.data);
  } catch {
    appendLog(t("run.previewError"));
    return;
  } finally {
    if (runBusy) {
      runBusy = false;
      syncRunButtons();
    }
  }
  if (calls > 0) {
    const ok = window.confirm(t("run.confirm", { count: calls }));
    if (!ok) return;
  }
  await startRun("all", picked.model);
}

async function startRun(stage, model) {
  if (runBusy) {
    appendLog(t("run.busy"));
    return;
  }
  const gen = ++runGen;
  runBusy = true;
  syncRunButtons();
  clearPlan();
  clearLog();
  appendLog(stage === "all" ? t("run.all") : `${t("run.one", { stage })}${model ? ` · ${model}` : ""}`);
  let trust = null;
  try {
    const body = { stage };
    if (model) body.model = model;
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.trust) trust = data.trust;
    else if (res.status === 409) appendLog(data.error ? I18N.pick(data.error) : t("run.busy"));
    else if (!res.ok) appendLog(data.error ? I18N.pick(data.error) : t("withStatus", { msg: { key: "run.failed" }, status: res.status }));
  } catch {
    appendLog(t("run.failed"));
  } finally {
    if (gen === runGen) {
      runBusy = false;
      syncRunButtons();
    }
    if (!trust) await refresh();
  }
  // A flow copied from a Git URL: show what it does, confirm once, then run.
  if (trust && (await confirmTrust(trust))) await startRun(stage, model);
}

/** Lists what a copied flow does on this computer and asks once; true when confirmed and saved. */
async function confirmTrust(trust) {
  const lines = (Array.isArray(trust.actions) ? trust.actions : []).map((a) => `  ${a.kind}  ${a.stage}  ${I18N.pick(a.detail)}`);
  const head =
    trust.reason === "changed"
      ? t("trust.changed")
      : t("trust.copied", { source: trust.source || "?" });
  const ok = window.confirm(`${head}\n\n${lines.join("\n")}\n\n${t("trust.ask")}`);
  if (!ok) {
    appendLog(t("trust.declined"));
    return false;
  }
  try {
    const res = await fetch("/api/trust", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: trust.fingerprint }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return true;
    // the flow changed after the list was shown: show the new list
    if (res.status === 409 && data.trust) return confirmTrust(data.trust);
    appendLog(data.error ? I18N.pick(data.error) : t("withStatus", { msg: { key: "trust.failed" }, status: res.status }));
  } catch {
    appendLog(t("trust.failed"));
  }
  return false;
}

function closePanel() {
  panelMode = "";
  returnToStage = null;
  // The panel shrinks back into where it was opened from; the media URL is freed once it is gone.
  panelPortal.close(() => {
    document.body.classList.remove("panel-open");
    releaseBlob();
  });
}

function makeBack(options) {
  if (!options || typeof options.onBack !== "function") return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back";
  I18N.text(button, options.backLabel || "panel.back");
  button.addEventListener("click", () => options.onBack());
  return button;
}

function showPanel(nodes, options) {
  panelBody.replaceChildren();
  const back = makeBack(options);
  if (back) panelBody.append(back);
  for (const node of nodes) panelBody.append(node);
}

function historyOptions(stage) {
  return {
    readOnly: true,
    onBack: () => {
      void openHistory(stage);
    },
    backLabel: "panel.backToHistory",
  };
}

function executorLabel(run) {
  if (run.executor === "manual") return { key: "history.manual" };
  return run.executor || "";
}

function resultLabel(run) {
  if (run.status === "ok") return { key: "history.ok" };
  if (run.status === "error") return { key: "history.error" };
  return run.status || "";
}

/** model for llm, the command for script, the agent name for agent. */
function runDetail(run) {
  const params = run.params || {};
  if (run.executor === "llm") {
    const model = params.model == null ? "" : String(params.model);
    if (!model) return "";
    const provider = params.provider == null ? "" : String(params.provider);
    return provider && provider !== "anthropic" ? `${provider}/${model}` : model;
  }
  if (run.executor === "script") return params.run == null ? "" : String(params.run);
  if (run.executor === "agent") return params.agent == null ? "" : String(params.agent);
  return "";
}

function errorLine(run) {
  if (run.status !== "error" || run.error == null) return "";
  return String(run.error).split("\n")[0].trim();
}

function snapshotPath(stageId, n, outputPath) {
  return `runs/${stageId}/${n}/outputs/${String(outputPath).replace(/\/+$/, "")}`;
}

function releaseBlob() {
  if (!currentBlob) return;
  URL.revokeObjectURL(currentBlob);
  currentBlob = null;
}

async function openHistory(stage, note) {
  panelMode = "other";
  releaseBlob();
  revealPanel();
  I18N.text(panelTitle, "history.title", { name: { raw: stage.name || stage.id || "" } });
  panelBody.replaceChildren(elt("p", null, "panel.loading"));
  let res;
  try {
    res = await fetch(`/api/runs?stage=${encodeURIComponent(stage.id)}`, { headers: headers(), cache: "no-store" });
  } catch {
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

function renderHistory(stage, runs, note) {
  I18N.text(panelTitle, "history.title", { name: { raw: stage.name || stage.id || "" } });
  const back = returnToStage && returnToStage.id === stage.id ? stageBack(returnToStage) : undefined;
  const nodes = [];
  if (note) nodes.push(elt("p", "save-ok", ...note));
  if (!runs.length) {
    nodes.push(renderCompare(stage, runs));
    nodes.push(elt("p", null, "stage.noRuns"));
    showPanel(nodes, back);
    return;
  }
  const deck = renderDeck(stage, runs, currentRunOf(stage));
  nodes.push(
    elt("p", "history-hint", "history.hint"),
    deck.root,
    deck.front,
    elt("p", "history-hint", "history.compareHint"),
    renderCompare(stage, runs),
  );
  showPanel(nodes, back);
  deck.start();
}

/** The run the files on disk are, from the newest board data: a restore has just refreshed it. */
function currentRunOf(stage) {
  const fresh = boardStages.find((item) => item.id === stage.id) || stage;
  return typeof fresh.current === "number" ? fresh.current : null;
}

/** The version each stage's history showed in front last, so reopening it keeps that one there. */
const deckFront = new Map();

function clockTime(iso) {
  const match = /T(\d\d:\d\d)/.exec(String(iso || ""));
  return match ? match[1] : "";
}

/** [key, vars] for a version's one-line summary, so it can follow the language switch. */
function versionHead(run, current) {
  const key = run.n === current ? "history.headCurrent" : "history.head";
  return [key, { n: run.n, result: resultLabel(run), time: formatTime(run.finishedAt), who: executorLabel(run) }];
}

/**
 * Versions as discs, oldest on the left. Drag or flick to spin through them, or use the arrow
 * keys, Home and End; the one in front shows its details and actions below the deck.
 */
function renderDeck(stage, runs, current) {
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
    if (run.executor === "manual") disc.dataset.kind = "manual";
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
    if (first < 0) first = runs.length - 1;
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
      if (!disc || deck.wasDrag()) return;
      deck.go(Number(disc.dataset.i));
    });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const i = deck.front();
      if (i >= 0) void openVersion(stage, runs[i]);
    });
  };
  return { root, front, start };
}

function renderFront(stage, run, front, current) {
  const nodes = [elt("p", "version-head", ...versionHead(run, current))];
  const detail = runDetail(run);
  if (detail) nodes.push(el("p", "version-detail", detail));
  const failure = errorLine(run);
  if (failure) nodes.push(elt("p", "version-error", "history.errorLine", { msg: { raw: failure } }));
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
  } else if (run.status === "ok") {
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

function renderCompare(stage, runs) {
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
  } else if (ordered[0]) {
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

async function openVersion(stage, run) {
  const outputs = stage.outputs || [];
  if (outputs.length === 1) {
    await openSnapshot(stage, run, outputs[0]);
    return;
  }
  I18N.raw(panelTitle, `v${run.n} · ${stage.name || stage.id || ""}`);
  const nodes = [];
  if (!outputs.length) nodes.push(elt("p", null, "history.noOutputs"));
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

async function openSnapshot(stage, run, output) {
  const rel = snapshotPath(stage.id, run.n, output.path);
  await openOutput(
    { path: rel, directory: Boolean(output.directory), text: Boolean(output.text), type: output.type },
    stage,
    { ...historyOptions(stage), title: `v${run.n} · ${output.path}` },
  );
}

async function openDiff(stage, a, b) {
  releaseBlob();
  revealPanel();
  I18N.text(panelTitle, "diff.title", { name: { raw: stage.name || stage.id || "" } });
  panelBody.replaceChildren(elt("p", null, "panel.loading"));
  const params = new URLSearchParams({ stage: stage.id, a: String(a) });
  if (b) params.set("b", String(b));
  let res;
  try {
    res = await fetch(`/api/diff?${params}`, { headers: headers(), cache: "no-store" });
  } catch {
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

function renderDiff(stage, diff) {
  I18N.text(panelTitle, "diff.title", { name: { raw: stage.name || stage.id || "" } });
  const summary = el("p", "diff-summary", `v${diff.a} → `);
  if (diff.b == null) summary.append(elt("span", null, "compare.current"));
  else summary.append(`v${diff.b}`);
  const nodes = [summary];
  for (const output of diff.outputs || []) nodes.push(renderOutputDiff(output));
  if (!(diff.outputs || []).length) nodes.push(elt("p", null, "diff.noOutputs"));
  showPanel(nodes, historyOptions(stage));
}

function renderOutputDiff(output) {
  const box = el("section", "diff-file");
  box.append(el("h3", "diff-path", output.path || ""));
  if (output.kind === "text") {
    if (output.same || !output.diff) box.append(elt("p", "diff-same", "diff.same"));
    else box.append(renderUnified(output.diff));
    return box;
  }
  if (output.kind === "binary") {
    box.append(elt("p", output.same ? "diff-same" : "diff-changed", output.same ? "diff.binarySame" : "diff.binaryDiffers"));
    return box;
  }
  if (output.kind === "dir") {
    if (output.same) box.append(elt("p", "diff-same", "diff.dirSame"));
    else {
      if (output.added && output.added.length) box.append(fileLines("diff.added", output.added, "diff-add"));
      if (output.removed && output.removed.length) box.append(fileLines("diff.removed", output.removed, "diff-del"));
      if (output.changed && output.changed.length) box.append(fileLines("diff.changed", output.changed, "diff-changed"));
    }
    return box;
  }
  box.append(elt("p", null, "diff.cannotShow"));
  return box;
}

function fileLines(titleKey, files, className) {
  const block = el("div", "diff-block");
  block.append(elt("span", "diff-line", titleKey));
  for (const file of files) block.append(el("span", `diff-line ${className}`, file));
  return block;
}

function renderUnified(patch) {
  const block = el("div", "diff-block");
  let sawMinus = false;
  let sawPlus = false;
  for (const line of String(patch).split("\n")) {
    let className = "diff-line";
    if (!sawMinus && line.startsWith("--- ")) sawMinus = true;
    else if (!sawPlus && line.startsWith("+++ ")) sawPlus = true;
    else if (line.startsWith("+")) className += " diff-add";
    else if (line.startsWith("-")) className += " diff-del";
    block.append(el("span", className, line.length ? line : " "));
  }
  return block;
}

async function restoreVersion(stage, n, button) {
  const confirmed = window.confirm(t("restore.confirm", { n }));
  if (!confirmed) return;
  if (button) button.disabled = true;
  try {
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ stage: stage.id, n }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await openHistory(stage);
      panelBody.prepend(errorEl("panel-error", data.error, "restore.failed", res.status));
      return;
    }
    await refreshNow();
    const note = typeof data.kept === "number" ? ["restore.doneKept", { n, kept: data.kept }] : ["restore.done", { n }];
    await openHistory(stage, note);
  } catch {
    panelBody.prepend(errorEl("panel-error", "", "restore.failed"));
  } finally {
    if (button) button.disabled = false;
  }
}

async function openOutput(output, stage, options) {
  panelMode = "other";
  const rel = output.path;
  const readOnly = Boolean(options && options.readOnly);
  revealPanel();
  I18N.raw(panelTitle, (options && options.title) || rel);
  panelBody.replaceChildren(elt("p", null, "panel.loading"));
  if (currentBlob) {
    URL.revokeObjectURL(currentBlob);
    currentBlob = null;
  }
  let res;
  try {
    res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`, { headers: headers(), cache: "no-store" });
  } catch {
    showPanel([errorEl("panel-error", "", "file.openError")], options);
    return;
  }
  if (!res.ok) {
    if (res.status === 404 && output.directory && stage && stage.executor === "human" && !readOnly) {
      renderFileList(rel, [], stage, options);
      return;
    }
    const message = res.status === 404 ? errorEl("panel-error", "", "file.notFound") : errorEl("panel-error", "", "file.openError", res.status);
    showPanel([message], options);
    return;
  }
  if (res.headers.get("X-Flowgit-Kind") === "directory") {
    const data = await res.json();
    renderFileList(rel, Array.isArray(data.files) ? data.files : [], readOnly ? null : stage, options);
    return;
  }
  if (output.text && !readOnly) {
    renderEditor(rel, await res.text(), options);
    return;
  }
  const type = (res.headers.get("Content-Type") || "").toLowerCase();
  if (type.startsWith("image/") || type.startsWith("video/")) {
    const blob = await res.blob();
    currentBlob = URL.createObjectURL(blob);
    const media = document.createElement(type.startsWith("video/") ? "video" : "img");
    if (media.tagName === "VIDEO") media.controls = true;
    else media.alt = rel;
    media.src = currentBlob;
    showPanel([media], options);
    return;
  }
  const text = await res.text();
  const pre = document.createElement("pre");
  if (type.includes("json") || rel.toLowerCase().endsWith(".json")) {
    try {
      pre.textContent = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      pre.textContent = text;
    }
  } else {
    pre.textContent = text;
  }
  showPanel([pre], options);
}

function renderEditor(rel, text, options) {
  const wrap = el("div", "editor");
  const area = document.createElement("textarea");
  area.value = text;
  area.spellcheck = false;
  area.setAttribute("aria-label", rel);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save";
  I18N.text(save, "file.save");
  const status = el("p", "save-status");
  status.hidden = true;
  save.addEventListener("click", () => saveText(rel, area.value, save, status));
  wrap.append(elt("p", "edit-hint", "editNote"), area, save, status);
  panelBody.replaceChildren();
  const back = makeBack(options);
  if (back) panelBody.append(back);
  panelBody.append(wrap);
  area.focus();
}

async function saveText(rel, text, button, status) {
  button.disabled = true;
  status.hidden = true;
  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`, {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "text/plain; charset=utf-8" },
      body: text,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.hidden = false;
      status.className = "panel-error";
      setError(status, data.error, "file.notSaved", res.status);
      return;
    }
    status.hidden = false;
    status.className = "save-ok";
    I18N.text(status, "file.saved");
    await refresh();
  } catch {
    status.hidden = false;
    status.className = "panel-error";
    I18N.text(status, "file.notSaved");
  } finally {
    button.disabled = false;
  }
}

function renderFileList(dir, files, stage, options) {
  panelBody.replaceChildren();
  const back = makeBack(options);
  if (back) panelBody.append(back);
  if (stage && stage.executor === "human" && stage.instructions) {
    panelBody.append(elr("p", "instructions", stage.instructions));
  }
  // Keep the way back (e.g. to the stage panel opened from the graph) after an upload from this list.
  if (stage && stage.executor === "human") panelBody.append(uploadControl(stage, dir, options));
  if (!files.length) {
    panelBody.append(elt("p", null, "file.empty"));
    return;
  }
  const list = el("ul", "file-list");
  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = file;
    const child = `${dir.replace(/\/+$/, "")}/${file}`;
    const childOptions = options ? { ...options, title: undefined } : undefined;
    button.addEventListener("click", () => openOutput({ path: child, directory: false, text: false }, stage, childOptions));
    const item = document.createElement("li");
    item.append(button);
    list.append(item);
  }
  panelBody.append(list);
}

function uploadControl(stage, dir, options) {
  const form = el("div", "upload");
  const label = el("label", "upload-label");
  label.append(elt("span", null, "file.upload"));
  const input = document.createElement("input");
  input.type = "file";
  const status = el("p", "upload-status");
  status.hidden = true;
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) void uploadInto(stage, dir, file, status, options);
  });
  label.append(input);
  form.append(label, status);
  return form;
}

async function uploadInto(stage, dir, file, status, options) {
  if (status) {
    status.hidden = false;
    status.className = "upload-status";
    I18N.text(status, "file.uploading");
  }
  try {
    const res = await fetch(
      `/api/upload?stage=${encodeURIComponent(stage.id)}&name=${encodeURIComponent(file.name)}`,
      { method: "POST", headers: headers(), body: file, cache: "no-store" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) setError(status, data.error, "file.notUploaded", res.status);
      return;
    }
    await refresh();
    await openOutput({ path: dir, directory: true, text: false, type: "dir" }, stage, options);
  } catch {
    if (status) I18N.text(status, "file.notUploaded");
  }
}

function editingInputs() {
  const active = document.activeElement;
  return Boolean(active && inputsEl.contains(active) && active.matches("input, textarea, select"));
}

async function loadInputs() {
  if (editingInputs()) return false;
  let res;
  try {
    res = await fetch("/api/inputs", { headers: headers(), cache: "no-store" });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const data = await res.json();
  renderInputs(Array.isArray(data.inputs) ? data.inputs : []);
  return true;
}

function renderInputs(fields) {
  inputsEl.replaceChildren();
  if (!fields.length) {
    inputsEl.append(elt("p", "field-help", "inputs.none"));
    inputsSave.hidden = true;
    return;
  }
  inputsSave.hidden = false;
  inputsSave.disabled = false;
  for (const field of fields) inputsEl.append(renderInput(field));
}

function renderInput(field) {
  const wrap = el("label", "field");
  const name = el("span", "field-name", field.name || "");
  if (field.required) name.append(elt("span", "req", "inputs.required"));
  wrap.append(name, controlFor(field));
  if (field.description) wrap.append(elr("span", "field-help", field.description));
  return wrap;
}

function controlFor(field) {
  const value = field.value == null ? "" : field.value;
  if (Array.isArray(field.enum) && field.enum.length) {
    const select = document.createElement("select");
    select.dataset.input = field.name;
    select.dataset.type = field.type || "string";
    const options = field.enum.slice();
    if (value !== "" && !options.some((item) => String(item) === String(value))) options.unshift(value);
    for (const option of options) {
      const node = document.createElement("option");
      node.value = String(option);
      node.textContent = String(option);
      if (String(option) === String(value)) node.selected = true;
      select.append(node);
    }
    return select;
  }
  if (field.type === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.input = field.name;
    input.dataset.type = "boolean";
    input.checked = value === true || value === "true";
    return input;
  }
  if (field.type === "text") {
    const area = document.createElement("textarea");
    area.dataset.input = field.name;
    area.dataset.type = "text";
    area.value = value === "" ? "" : String(value);
    area.rows = 3;
    return area;
  }
  const input = document.createElement("input");
  input.dataset.input = field.name;
  input.dataset.type = field.type || "string";
  if (field.type === "number") {
    input.type = "number";
    input.step = "any";
    input.value = value === "" ? "" : String(value);
  } else {
    input.type = "text";
    input.value = value === "" ? "" : String(value);
  }
  if (field.required) input.required = true;
  input.autocomplete = "off";
  return input;
}

async function saveInputs(event) {
  event.preventDefault();
  const payload = {};
  for (const control of inputsEl.querySelectorAll("[data-input]")) {
    const name = control.getAttribute("data-input");
    const type = control.getAttribute("data-type");
    if (control.type === "checkbox") {
      payload[name] = control.checked;
      continue;
    }
    if (type === "number") {
      if (control.value === "") continue;
      const number = Number(control.value);
      if (!Number.isFinite(number)) {
        inputsStatus.hidden = false;
        inputsStatus.className = "inputs-status error";
        I18N.text(inputsStatus, "inputs.notNumber", { name });
        return;
      }
      payload[name] = number;
      continue;
    }
    payload[name] = control.value;
  }
  inputsSave.disabled = true;
  inputsStatus.hidden = true;
  try {
    const res = await fetch("/api/inputs", {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    inputsStatus.hidden = false;
    if (!res.ok) {
      inputsStatus.className = "inputs-status error";
      setError(inputsStatus, data.error, "file.notSaved", res.status);
      return;
    }
    inputsStatus.className = "inputs-status ok";
    I18N.text(inputsStatus, "file.saved");
    lastInputValues = "";
    await refresh();
  } catch {
    inputsStatus.hidden = false;
    inputsStatus.className = "inputs-status error";
    I18N.text(inputsStatus, "file.notSaved");
  } finally {
    inputsSave.disabled = false;
  }
}

function onStreamEvent(type, data) {
  if (type === "flow:changed") {
    void refreshNow();
    return;
  }
  if (type === "stage:start") {
    appendLog(`▶ ${I18N.pick(data.name || data.stage)} (${data.stage})`);
    setRunning(data.stage);
  } else if (type === "stage:log") appendLog(`    ${I18N.pick(data.line ?? "")}`);
  else if (type === "stage:done") {
    appendLog(`✓ ${I18N.pick(data.name || data.stage)} → v${data.n}`);
    if (data.stage === runningId) clearRunning();
  } else if (type === "stage:skip") {
    appendLog(`· ${t("run.skipped", { name: I18N.pick(data.name || data.stage), reason: I18N.pick(data.reason ?? "") })}`);
  }
  else if (type === "stage:error") {
    appendLog(`✗ ${I18N.pick(data.name || data.stage)}: ${I18N.pick(data.error ?? "")}`);
    if (data.stage === runningId) clearRunning();
  } else if (type === "run:end") {
    if (data.waiting) {
      const missing = Array.isArray(data.waiting.missing) ? data.waiting.missing.join(", ") : "";
      appendLog(t("run.waiting", { name: I18N.pick(data.waiting.name || data.waiting.stage), missing }));
      if (data.waiting.instructions) appendLog(I18N.pick(data.waiting.instructions));
    } else if (data.ok) appendLog(t("run.finished"));
    else appendLog(data.error ? I18N.pick(data.error) : t("run.failed"));
    if (runningId) clearRunning();
    else void refresh();
  }
}

function setLiveHint(live) {
  if (!hintEl) return;
  I18N.text(hintEl, live ? "live.on" : "live.poll");
}

function showLiveLost() {
  noticeEl.hidden = false;
  I18N.text(noticeEl, "live.lost");
}

function hideLiveLost() {
  if (noticeEl.dataset.i18n !== "live.lost") return;
  I18N.raw(noticeEl, "");
  noticeEl.hidden = true;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, 3000);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = 0;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = 0;
    connectEvents();
  }, 5000);
}

function connectEvents() {
  if (!token || typeof EventSource === "undefined") {
    eventsState = "down";
    showLiveLost();
    setLiveHint(false);
    startPolling();
    return;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  eventSource = source;
  let settled = false;
  source.addEventListener("open", () => {
    if (eventSource !== source) return;
    const wasDown = eventsState === "down";
    eventsState = "live";
    stopPolling();
    hideLiveLost();
    setLiveHint(true);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = 0;
    }
    // Catch up on anything that changed between the last poll and the reconnect.
    if (wasDown) void refreshNow();
  });
  source.addEventListener("error", () => {
    if (settled || eventSource !== source) return;
    settled = true;
    eventsState = "down";
    source.close();
    if (eventSource === source) eventSource = null;
    showLiveLost();
    setLiveHint(false);
    startPolling();
    scheduleReconnect();
  });
  for (const type of ["stage:start", "stage:log", "stage:done", "stage:error", "stage:skip", "run:end", "flow:changed"]) {
    source.addEventListener(type, (event) => {
      const id = Number(event.lastEventId);
      if (id) {
        if (id <= lastEventId) return;
        lastEventId = id;
      }
      let data = {};
      try {
        data = JSON.parse(event.data);
      } catch {
        data = {};
      }
      onStreamEvent(type, data);
    });
  }
}

async function refreshNow() {
  const start = Date.now();
  while (refreshing && Date.now() - start < 4000) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  lastJson = "";
  await refresh();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const res = await fetch("/api/flow", { headers: headers(), cache: "no-store" });
    if (!res.ok) {
      noticeEl.hidden = false;
      I18N.text(noticeEl, ...withStatus("refreshError", res.status));
      return;
    }
    const text = await res.text();
    let nextUsage = usageText;
    let usageOk = false;
    try {
      const usageRes = await fetch("/api/usage", { headers: headers(), cache: "no-store" });
      if (usageRes.ok) {
        nextUsage = await usageRes.text();
        usageOk = true;
      }
    } catch {
      // Keep the totals already on screen. The next refresh tries again.
    }
    if (eventsState === "down") showLiveLost();
    else noticeEl.hidden = true;
    if (text === lastJson && (!usageOk || nextUsage === usageText)) return;
    const flowChanged = text !== lastJson;
    lastJson = text;
    // A preview describes the flow as it was; once the stages change it may be wrong, so it goes.
    // (Compared with what is on screen: refreshNow() empties lastJson to force a repaint.
    // Not while Run all is held: that preview is the one the hold confirms.)
    if (text !== shownJson && planView && !runHold.holding()) planView = null;
    shownJson = text;
    if (usageOk) {
      usageText = nextUsage;
      applyUsage(nextUsage);
    }
    const data = JSON.parse(text);
    if (view === "graph" && flowChanged) await reloadGraph();
    render(data);
    const signature = JSON.stringify(data.inputs ?? {});
    if (signature !== lastInputValues) {
      const loaded = await loadInputs();
      if (loaded) lastInputValues = signature;
    }
  } catch {
    noticeEl.hidden = false;
    I18N.text(noticeEl, "refreshError");
  } finally {
    refreshing = false;
  }
}

function closeMenus() {
  let closed = false;
  for (const menu of document.querySelectorAll(".card-menu .menu")) {
    if (!menu.hidden) {
      menu.hidden = true;
      closed = true;
    }
  }
  return closed;
}

function cardMenu(stage) {
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
    if (!willOpen) return;
    const rect = button.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    menu.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
    menu.hidden = false;
  });
  menu.append(remove);
  wrap.append(button, menu);
  return wrap;
}

function outputFromPath(p) {
  const normalized = String(p).replaceAll("\\", "/");
  if (normalized.endsWith("/")) return { type: "dir", path: normalized };
  const dot = normalized.lastIndexOf(".");
  const slash = normalized.lastIndexOf("/");
  const ext = dot > slash ? normalized.slice(dot).toLowerCase() : "";
  if (ext === ".md" || ext === ".markdown") return { type: "text/markdown", path: normalized };
  if (ext === ".json") return { type: "application/json", path: normalized };
  if (ext === ".txt") return { type: "text/plain", path: normalized };
  if (ext === ".html" || ext === ".htm") return { type: "text/html", path: normalized };
  return { type: "application/octet-stream", path: normalized };
}

function issueLines(data, fallback) {
  if (data && Array.isArray(data.issues) && data.issues.length) {
    return data.issues.map((issue) => `${issue.path || "/"}: ${I18N.pick(issue.message || "")}`).join("\n");
  }
  if (data && typeof data.error === "string" && data.error) return I18N.pick(data.error);
  return t(...fallback);
}

function fillStageChoices() {
  const after = document.getElementById("stage-after");
  const inputs = document.getElementById("stage-inputs");
  const atEnd = new Option("", "");
  I18N.text(atEnd, "add.atEnd");
  after.replaceChildren(atEnd);
  inputs.replaceChildren();
  for (const stage of boardStages) {
    const name = I18N.pick(stage.name || "");
    const label = name && name !== stage.id ? `${name} (${stage.id})` : stage.id || "";
    after.append(new Option(label, stage.id || ""));
    inputs.append(new Option(label, stage.id || ""));
  }
}

function syncStageFields() {
  const type = document.getElementById("stage-type").value;
  document.getElementById("stage-prompt-field").hidden = type !== "llm" && type !== "agent";
  document.getElementById("stage-run-field").hidden = type !== "script";
  document.getElementById("stage-agent-field").hidden = type !== "agent";
  document.getElementById("stage-run").required = type === "script";
  document.getElementById("stage-outputs").required = type === "script";
  I18N.text(document.getElementById("stage-outputs-hint"), type === "script" ? "add.outputsHelpScript" : "add.outputsHelp");
}

function openAddStage() {
  closeMenus();
  stageForm.reset();
  fillStageChoices();
  syncStageFields();
  stageStatus.hidden = true;
  I18N.raw(stageStatus, "");
  stageDialog.showModal();
  document.getElementById("stage-id").focus();
}

async function submitStage(event) {
  event.preventDefault();
  const type = document.getElementById("stage-type").value;
  const payload = { id: document.getElementById("stage-id").value.trim(), type };
  const name = document.getElementById("stage-name").value.trim();
  if (name) payload.name = name;
  const after = document.getElementById("stage-after").value;
  if (after) payload.after = after;
  const inputs = [...document.getElementById("stage-inputs").selectedOptions].map((option) => option.value).filter(Boolean);
  if (inputs.length) payload.inputs = inputs;
  const outputLines = document.getElementById("stage-outputs").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (outputLines.length) payload.outputs = outputLines.map(outputFromPath);
  if (type === "llm" || type === "agent") {
    const prompt = document.getElementById("stage-prompt").value.trim();
    if (prompt) payload.prompt = prompt;
  }
  if (type === "script") payload.run = document.getElementById("stage-run").value.trim();
  if (type === "agent") payload.agent = document.getElementById("stage-agent").value;
  stageSave.disabled = true;
  stageStatus.hidden = true;
  try {
    const res = await fetch("/api/stage", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      stageStatus.hidden = false;
      I18N.raw(stageStatus, issueLines(data, withStatus("add.notAdded", res.status)));
      return;
    }
    stageDialog.close();
    await refreshNow();
  } catch {
    stageStatus.hidden = false;
    I18N.text(stageStatus, "add.notAdded");
  } finally {
    stageSave.disabled = false;
  }
}

function openRemove(stage) {
  removeId = stage.id || "";
  const label = stage.name || stage.id || "";
  I18N.text(removeText, "remove.text", { label: { raw: label }, id: removeId });
  removeDeps.hidden = true;
  I18N.raw(removeDeps, "");
  removeStatus.hidden = true;
  I18N.raw(removeStatus, "");
  removeForce.hidden = true;
  removeConfirm.hidden = false;
  removeDialog.showModal();
}

async function requestRemove(force) {
  if (!removeId) return;
  removeConfirm.disabled = true;
  removeForce.disabled = true;
  removeStatus.hidden = true;
  try {
    const query = `id=${encodeURIComponent(removeId)}${force ? "&force=1" : ""}`;
    const res = await fetch(`/api/stage?${query}`, { method: "DELETE", headers: headers(), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && !force && Array.isArray(data.dependents) && data.dependents.length) {
      const names = data.dependents.join(", ");
      removeDeps.hidden = false;
      if (data.error) I18N.raw(removeDeps, data.error);
      else if (names) I18N.text(removeDeps, "remove.deps", { id: removeId, names });
      else I18N.text(removeDeps, "remove.depsUnknown");
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
  } catch {
    removeStatus.hidden = false;
    I18N.text(removeStatus, "remove.notRemoved");
  } finally {
    removeConfirm.disabled = false;
    removeForce.disabled = false;
  }
}

const stageDialog = document.getElementById("stage-dialog");
const stageForm = document.getElementById("stage-form");
const stageStatus = document.getElementById("stage-status");
const stageSave = document.getElementById("stage-save");
const removeDialog = document.getElementById("remove-dialog");
const removeText = document.getElementById("remove-text");
const removeDeps = document.getElementById("remove-deps");
const removeStatus = document.getElementById("remove-status");
const removeConfirm = document.getElementById("remove-confirm");
const removeForce = document.getElementById("remove-force");

document.getElementById("panel-close").addEventListener("click", closePanel);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (event.target instanceof Element && event.target.closest("dialog")) return;
  if (closeMenus()) return;
  if (!panelEl.hidden && !panelPortal.closing()) {
    closePanel();
    return;
  }
  clearPlan();
});
// Remember where each press happened, so the side panel can open as a circle from there.
document.addEventListener("pointerdown", (event) => notePress(event.target), true);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter" || event.key === " ") notePress(event.target);
  },
  true,
);
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest(".card-menu")) return;
  closeMenus();
});
boardEl.addEventListener("scroll", closeMenus, { passive: true });
window.addEventListener("resize", closeMenus);
document.getElementById("add-stage").addEventListener("click", openAddStage);
document.getElementById("stage-type").addEventListener("change", syncStageFields);
document.getElementById("stage-cancel").addEventListener("click", () => stageDialog.close());
stageForm.addEventListener("submit", (event) => {
  void submitStage(event);
});
document.getElementById("remove-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void requestRemove(false);
});
document.getElementById("remove-cancel").addEventListener("click", () => removeDialog.close());
removeForce.addEventListener("click", () => {
  void requestRemove(true);
});
document.getElementById("view-cards").addEventListener("click", () => setView("cards"));
document.getElementById("view-graph").addEventListener("click", () => setView("graph"));
syncViewToggle();
if (previewButton) previewButton.addEventListener("click", () => {
  void previewAll();
});
// Run all: hold for a second to run, with the dry run on the cards while you hold. A tap still
// works the old way (preview, then a confirm before any model call).
const runHold = FX.hold(runAllButton, {
  ms: HOLD_MS,
  onStart: startHoldPreview,
  onCancel(progress, heldMs) {
    lastPressEnd = performance.now();
    holdTicket += 1;
    clearPlan();
    if (heldMs < TAP_MS) {
      void runAll();
      return;
    }
    const pct = Math.round(progress * 100);
    appendLog(t("run.released", { pct }));
  },
  onDone() {
    lastPressEnd = performance.now();
    void runHeld();
  },
});
runAllButton.addEventListener("click", () => {
  // Presses are handled by the hold. A click with no press before it (a screen reader's) still runs.
  if (runHold.holding() || performance.now() - lastPressEnd < 600) return;
  void runAll();
});
inputsForm.addEventListener("submit", (event) => {
  void saveInputs(event);
});

// A language switch: marked text has already changed in place; the board, the stage panel and
// the legend are drawn again. Badges decode into the new words.
I18N.onChange(() => {
  if (lastFlow) render(lastFlow);
  else paintBoard();
  paintUsageTotal();
  if (!stageDialog.open) return;
  syncStageFields();
});

connectEvents();
refresh();
