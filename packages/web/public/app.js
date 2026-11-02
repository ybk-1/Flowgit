const token = document.querySelector('meta[name="flowgit-token"]')?.getAttribute("content") ?? "";

const VIEW_KEY = "flowgit.board.view";
const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 176;
const NODE_H = 72;
const GAP_X = 64;
const GAP_Y = 28;
const PAD = 20;

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

let lastJson = "";
let lastInputValues = "";
let refreshing = false;
let currentBlob = null;
let runBusy = false;
let runGen = 0;
let boardStages = [];
let removeId = "";
const modelDrafts = new Map();
let view = storedView();
let graphPayload = null;
let graphError = "";
let graphTicket = 0;
let selectedId = "";
let panelMode = "";
let returnToStage = null;
let usageByStage = new Map();
let usageTotal = { input: 0, output: 0, calls: 0 };
let usageText = "";
let lastFlow = null;
let lastFields = null;
let viewState = null;
let noticeKey = "";
let noticeVars = null;
let removeLabel = "";
const boundNodes = new Set();

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

function textOf(spec) {
  if (!spec) return "";
  if (spec.issues) {
    const data = spec.issues;
    if (data && Array.isArray(data.issues) && data.issues.length) {
      return data.issues.map((issue) => `${issue.path || "/"}: ${apiText(issue.message || "")}`).join("\n");
    }
    if (data && typeof data.error === "string" && data.error) return apiText(data.error);
    return textOf(spec.fallback);
  }
  if (typeof spec.api === "string" && spec.api) return apiText(spec.api);
  if (spec.key) return t(spec.key, spec.vars);
  return "";
}

function setBound(node, spec) {
  node._i18nSpec = spec;
  boundNodes.add(node);
  node.textContent = textOf(spec);
}

function refreshBound() {
  for (const node of boundNodes) {
    if (!node.isConnected || !node._i18nSpec) {
      boundNodes.delete(node);
      continue;
    }
    node.textContent = textOf(node._i18nSpec);
  }
}

function tApi(key, message, vars, field) {
  const name = field || "error";
  const text = message == null ? "" : String(message);
  const splitAt = text.indexOf(" / ");
  const extra = vars || {};
  if (splitAt === -1) return t(key, { ...extra, [name]: text });
  const zh = text.slice(0, splitAt);
  const en = text.slice(splitAt + 3);
  const mode = currentLang();
  if (mode === "zh") return tLang(key, "zh", { ...extra, [name]: zh });
  if (mode === "en") return tLang(key, "en", { ...extra, [name]: en });
  return `${tLang(key, "zh", { ...extra, [name]: zh })} / ${tLang(key, "en", { ...extra, [name]: en })}`;
}

function stateText(state) {
  if (state === "ok") return `✓ ${t("state.ok")}`;
  if (state === "stale") return `↻ ${t("state.stale")}`;
  if (state === "edited") return `✎ ${t("state.edited")}`;
  if (state === "error") return `✗ ${t("state.error")}`;
  if (state === "never-run") return `○ ${t("state.neverRun")}`;
  if (state === "waiting-upstream") return `… ${t("state.waitingUpstream")}`;
  if (state) return `• ${state}`;
  return `• ${t("state.unknown")}`;
}

function titled(name, key) {
  const who = name || "";
  const label = t(key);
  return who ? `${who} · ${label}` : label;
}

function noteText(note) {
  if (typeof note === "function") return note();
  return note || "";
}

function showNotice(key, vars) {
  noticeKey = key;
  noticeVars = vars || null;
  noticeEl.hidden = false;
  noticeEl.textContent = t(key, vars);
}

function clearNotice() {
  noticeKey = "";
  noticeVars = null;
  noticeEl.textContent = "";
  noticeEl.hidden = true;
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
  return t("usage.line", { total: input + output, input, output, calls });
}

function paintUsageTotal() {
  if (!usageTotalEl) return;
  const input = Number(usageTotal.input) || 0;
  const output = Number(usageTotal.output) || 0;
  const calls = Number(usageTotal.calls) || 0;
  usageTotalEl.textContent = t("usage.total", { input, output, calls });
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

function render(data) {
  lastFlow = data;
  const flowName = data.name || t("doc.boardName");
  document.getElementById("flow-name").textContent = flowName;
  document.title = `${data.name || "Flowgit"} · ${t("doc.boardName")}`;
  paintUsageTotal();

  const missing = Array.isArray(data.missingInputs) ? data.missingInputs : [];
  bannerEl.replaceChildren();
  if (missing.length) {
    bannerEl.hidden = false;
    bannerEl.append(
      el("p", null, t("banner.missing", { names: missing.join(", ") })),
      el("p", "banner-hint", t("banner.hint", { name: missing[0] })),
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
  graphError = null;
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
      graphError = data.error ? { api: data.error } : { key: "graph.loadFailedStatus", vars: { status: res.status } };
      return;
    }
    graphPayload = data;
    graphError = null;
  } catch {
    if (ticket !== graphTicket) return;
    graphPayload = null;
    graphError = { key: "graph.loadFailed" };
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
    wrap.append(el("p", "graph-empty", textOf(graphError)));
    return wrap;
  }
  if (!graphPayload) {
    wrap.append(el("p", "graph-empty", t("graph.loading")));
    return wrap;
  }
  wrap.append(renderLegend(), drawGraph(graphPayload));
  return wrap;
}

function renderLegend() {
  const legend = el("div", "graph-legend");
  for (const state of ["ok", "stale", "edited", "error", "never-run", "waiting-upstream"]) {
    const item = el("span", "legend-item");
    item.dataset.state = state;
    const swatch = el("span", "legend-swatch");
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(stateText(state)));
    legend.append(item);
  }
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

function drawGraph(payload) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const scroll = el("div", "graph-scroll");
  if (!nodes.length) {
    scroll.append(el("p", "graph-empty", t("graph.empty")));
    return scroll;
  }

  let maxLayer = 0;
  let maxRow = 0;
  const pos = new Map();
  for (const node of nodes) {
    const layer = Number(node.layer) || 0;
    const row = Number(node.row) || 0;
    if (layer > maxLayer) maxLayer = layer;
    if (row > maxRow) maxRow = row;
    pos.set(node.id, { x: PAD + layer * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y), layer });
  }

  const routed = [];
  let longLanes = 0;
  for (const edge of edges) {
    const from = pos.get(edge.from);
    const to = pos.get(edge.to);
    if (!from || !to) continue;
    if (to.layer - from.layer > 1) routed.push({ from, to, lane: longLanes++ });
    else routed.push({ from, to, lane: -1 });
  }
  const laneGap = 14;
  const bottom = PAD + (maxRow + 1) * NODE_H + maxRow * GAP_Y + 12;
  const width = PAD * 2 + (maxLayer + 1) * NODE_W + maxLayer * GAP_X;
  const height = bottom + (longLanes > 0 ? 8 + longLanes * laneGap : 8);

  const svg = svgEl("svg", {
    class: "flow-graph",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "group",
    "aria-label": t("graph.aria"),
  });
  const marker = svgEl("marker", {
    id: "flow-arrow",
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

  for (const edge of routed) {
    const x1 = edge.from.x + NODE_W;
    const y1 = edge.from.y + NODE_H / 2;
    const x2 = edge.to.x;
    const y2 = edge.to.y + NODE_H / 2;
    let d;
    if (edge.lane >= 0) {
      const yb = bottom + edge.lane * laneGap;
      d = `M ${x1} ${y1} H ${x1 + 18} V ${yb} H ${x2 - 18} V ${y2} H ${x2}`;
    } else if (Math.abs(y1 - y2) < 0.5) {
      d = `M ${x1} ${y1} H ${x2}`;
    } else {
      const mid = (x1 + x2) / 2;
      d = `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
    }
    svg.append(svgEl("path", { class: "flow-edge", d, "marker-end": "url(#flow-arrow)" }));
  }

  for (const node of nodes) {
    const place = pos.get(node.id);
    if (!place) continue;
    const stage = stageForNode(node);
    const state = stateText(node.state);
    const selected = node.id === selectedId;
    const g = svgEl("g", {
      class: selected ? "flow-node is-selected" : "flow-node",
      role: "button",
      tabindex: "0",
      "data-id": node.id,
      "data-state": node.state || "",
      "aria-pressed": selected ? "true" : "false",
      "aria-label": `${node.name || node.id} · ${node.type || ""} · ${state} · ${stageUsageLine(node.id)}`,
    });
    g.append(svgEl("rect", {
      class: "flow-box",
      x: place.x,
      y: place.y,
      width: NODE_W,
      height: NODE_H,
    }));
    const title = svgEl("title");
    title.textContent = `${node.name || node.id} · ${node.type || ""} · ${state} · ${stageUsageLine(node.id)}`;
    const name = svgEl("text", {
      class: "flow-name",
      x: place.x + NODE_W / 2,
      y: place.y + 30,
      "text-anchor": "middle",
    });
    name.textContent = clipLabel(node.name || node.id, NODE_W - 28);
    const type = svgEl("text", {
      class: "flow-type",
      x: place.x + NODE_W / 2,
      y: place.y + 50,
      "text-anchor": "middle",
    });
    type.textContent = node.type || "";
    g.append(title, name, type);
    const open = () => openStage(stage);
    g.addEventListener("click", open);
    g.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
    svg.append(g);
  }

  scroll.append(svg);
  return scroll;
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
    backKey: "action.backStage",
  };
}

function openStage(stage) {
  selectedId = stage.id || "";
  returnToStage = stage;
  panelMode = "stage";
  viewState = null;
  markSelected();
  releaseBlob();
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  panelTitle.textContent = stage.name || stage.id || "";
  const badge = el("p", "badge", stateText(stage.state));
  badge.dataset.state = stage.state || "";
  const version = el("p", "version");
  version.textContent = stage.latest
    ? `v${stage.latest.n} · ${formatTime(stage.latest.time)}`
    : t("card.noRuns");

  const actions = el("div", "stage-actions");
  const history = document.createElement("button");
  history.type = "button";
  history.className = "history";
  history.textContent = t("action.history");
  history.addEventListener("click", () => {
    panelMode = "other";
    void openHistory(stage);
  });
  const run = document.createElement("button");
  run.type = "button";
  run.className = "run";
  run.textContent = t("action.run");
  run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
  if (stage.state === "waiting-upstream") run.title = t("run.waitingTitle");
  run.addEventListener("click", () => startRun(stage.id, modelForStage(stage.id)));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = t("action.removeStage");
  remove.addEventListener("click", () => openRemove(stage));
  actions.append(history, run, remove);

  const nodes = [
    badge,
    el("p", "executor", `${t("card.executor")} · ${stage.executor || ""}`),
    version,
    el("p", "runs", t("card.runs", { n: stage.runs ?? 0 })),
    el("p", "usage", stageUsageLine(stage.id)),
  ];
  if (stage.state === "edited") nodes.push(el("p", "edit-note", t("edit.note")));
  nodes.push(actions);
  if (stage.executor === "human" && stage.state !== "waiting-upstream") {
    if (stage.instructions) nodes.push(foldedInstructions(stage.instructions));
    const dir = humanDir(stage);
    if (dir) nodes.push(uploadControl(stage, dir.path, stageBack(stage)));
  }
  if (stage.executor === "llm") nodes.push(modelField(stage.id));

  const outputs = el("div", "outputs");
  outputs.append(el("p", "outputs-label", t("card.outputs")));
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

function humanDir(stage) {
  const dirs = (stage.outputs ?? []).filter((output) => output.directory);
  return dirs.length === 1 ? dirs[0] : null;
}

function renderCard(stage) {
  const card = el("article", "card");
  card.dataset.state = stage.state || "";
  const head = el("div", "card-head");
  head.append(el("h2", null, stage.name || stage.id || ""), cardMenu(stage));
  card.append(
    head,
    el("p", "stage-id", stage.id || ""),
    el("p", "executor", `${t("card.executor")} · ${stage.executor || ""}`),
    el("p", "badge", stateText(stage.state)),
  );
  if (stage.state === "edited") card.append(el("p", "edit-note", t("edit.note")));

  const version = el("p", "version");
  if (stage.latest) {
    version.textContent = `v${stage.latest.n} · ${formatTime(stage.latest.time)}`;
  } else {
    version.textContent = t("card.noRuns");
  }
  card.append(version, el("p", "runs", t("card.runs", { n: stage.runs ?? 0 })), el("p", "usage", stageUsageLine(stage.id)));
  const history = document.createElement("button");
  history.type = "button";
  history.className = "history";
  history.textContent = t("action.history");
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
  run.textContent = t("action.run");
  run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
  if (stage.state === "waiting-upstream") run.title = t("run.waitingTitle");
  run.addEventListener("click", () => startRun(stage.id, modelForStage(stage.id)));
  card.append(run);

  const outputs = el("div", "outputs");
  outputs.append(el("p", "outputs-label", t("card.outputs")));
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
  if (Array.isArray(value)) return t("count.items", { n: value.length });
  if (!value || typeof value !== "object") return String(value);
  const lines = [];
  for (const [key, val] of Object.entries(value)) {
    if (Array.isArray(val)) lines.push(`${key}: ${t("count.items", { n: val.length })}`);
    else if (val && typeof val === "object") lines.push(`${key}: ${t("count.items", { n: Object.keys(val).length })}`);
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
  box.append(el("span", "video-icon", "▶"), el("span", "video-label", t("thumb.video")));
  return box;
}

function thumbText(text) {
  return el("p", "thumb-text", text || t("thumb.empty"));
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
    if (gen === thumbGen && body.isConnected) body.replaceChildren(thumbText(t("thumb.noPreview")));
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
    body.replaceChildren(thumbText(t("thumb.notYet")));
    return;
  }
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) {
    body.replaceChildren(kind === "video" ? videoMark() : thumbText(t("thumb.noPreview")));
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
    body.replaceChildren(thumbText(t("thumb.notYet")));
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
    body.replaceChildren(thumbText(t("thumb.notYet")));
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
  setThumbCaption(body, n === 1 ? t("thumb.filesOne", { n }) : t("thumb.files", { n }));
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
  const p = el("p", "instructions is-clamped", text);
  const more = document.createElement("button");
  more.type = "button";
  more.className = "more";
  more.hidden = true;
  const paintMore = () => {
    more.textContent = p.classList.contains("is-open") ? t("fold.less") : t("fold.more");
  };
  paintMore();
  more.addEventListener("click", () => {
    const open = p.classList.toggle("is-open");
    p.classList.toggle("is-clamped", !open);
    paintMore();
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
  label.append(el("span", null, t("model.label")));
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t("model.placeholder");
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
      error: t("model.differ"),
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
  if (!res.ok) return { ok: false, error: data.error ? apiText(data.error) : t("plan.failedStatus", { status: res.status }) };
  return { ok: true, data };
}

function planLabel(action) {
  if (action === "skip") return t("plan.skip");
  if (action === "keep-edit") return t("plan.keepEdit");
  if (action === "run") return t("plan.run");
  if (action === "wait") return t("plan.wait");
  if (action === "cannot-run") return t("plan.cannotRun");
  if (action === "not-reached") return t("plan.notReached");
  return action || "";
}

function planLines(data) {
  const lines = [t("plan.header")];
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (const step of steps) {
    const label = planLabel(step.action);
    const detail = step.detail ? ` · ${step.detail}` : "";
    lines.push(`${step.name || step.id} ${step.id} · ${label}${detail}`);
  }
  lines.push(t("plan.atMost", { n: modelCallCount(data) }));
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
  } catch {
    appendLog(t("plan.failed"));
  }
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
    appendLog(t("plan.failed"));
    return;
  } finally {
    if (runBusy) {
      runBusy = false;
      syncRunButtons();
    }
  }
  if (calls > 0) {
    const ok = window.confirm(t("run.confirmCalls", { calls }));
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
  clearLog();
  appendLog(stage === "all" ? t("action.runAll") : `${t("log.run")} ${stage}${model ? ` · ${model}` : ""}`);
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
    if (res.status === 409) appendLog(data.error ? apiText(data.error) : t("run.busy"));
    else if (!res.ok) appendLog(data.error ? apiText(data.error) : t("log.runFailedStatus", { status: res.status }));
  } catch {
    appendLog(t("log.runFailed"));
  } finally {
    if (gen === runGen) {
      runBusy = false;
      syncRunButtons();
    }
    await refresh();
  }
}

function closePanel() {
  panelEl.hidden = true;
  document.body.classList.remove("panel-open");
  panelMode = "";
  returnToStage = null;
  viewState = null;
  releaseBlob();
}

function makeBack(options) {
  if (!options || typeof options.onBack !== "function") return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back";
  const backKey = options.backKey;
  button.textContent = backKey === "action.backHistory"
    ? t("action.backHistory")
    : backKey === "action.backStage"
      ? t("action.backStage")
      : t("action.back");
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
    backKey: "action.backHistory",
  };
}

function executorLabel(run) {
  if (run.executor === "manual") return t("runStatus.manual");
  return run.executor || "";
}

function resultLabel(run) {
  if (run.status === "ok") return t("runStatus.ok");
  if (run.status === "error") return t("runStatus.error");
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

function showMessage(className, spec, options, heading) {
  viewState = { kind: "message", className, spec, options, heading: heading || null };
  if (typeof heading === "function") panelTitle.textContent = heading();
  const node = el("p", className || null, textOf(spec));
  if (options) showPanel([node], options);
  else panelBody.replaceChildren(node);
}

function readCompare() {
  const form = panelBody.querySelector("form.compare");
  if (!form) return null;
  const from = form.querySelector('select[name="a"]');
  const to = form.querySelector('select[name="b"]');
  if (!from || !to) return null;
  return { a: from.value, b: to.value };
}

async function openHistory(stage, note) {
  panelMode = "other";
  releaseBlob();
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  const heading = () => titled(stage.name || stage.id || "", "action.history");
  panelTitle.textContent = heading();
  showMessage(null, { key: "common.loading" }, null, heading);
  let res;
  try {
    res = await fetch(`/api/runs?stage=${encodeURIComponent(stage.id)}`, { headers: headers(), cache: "no-store" });
  } catch {
    showMessage("panel-error", { key: "history.openFailed" }, null, heading);
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const spec = data.error ? { api: data.error } : { key: "history.openFailedStatus", vars: { status: res.status } };
    showMessage("panel-error", spec, null, heading);
    return;
  }
  renderHistory(stage, Array.isArray(data.runs) ? data.runs : [], note);
}

function renderHistory(stage, runs, note, selected, errorSpec) {
  viewState = { kind: "history", stage, runs, note, selected: selected || null, errorSpec: errorSpec || null };
  panelTitle.textContent = titled(stage.name || stage.id || "", "action.history");
  const back = returnToStage && returnToStage.id === stage.id ? stageBack(returnToStage) : undefined;
  const nodes = [];
  if (errorSpec) nodes.push(el("p", "panel-error", textOf(errorSpec)));
  const shown = noteText(note);
  if (shown) nodes.push(el("p", "save-ok", shown));
  nodes.push(el("p", "history-hint", t("history.hint")));
  nodes.push(renderCompare(stage, runs, selected));
  if (!runs.length) {
    nodes.push(el("p", null, t("card.noRuns")));
    showPanel(nodes, back);
    return;
  }
  const list = el("ul", "history-list");
  for (const run of runs.slice().reverse()) list.append(renderVersion(stage, run));
  nodes.push(list);
  showPanel(nodes, back);
}

function renderCompare(stage, runs, selected) {
  const form = el("form", "compare");
  const fromLabel = el("label");
  fromLabel.append(el("span", null, t("diff.versionA")));
  const from = document.createElement("select");
  from.name = "a";
  const toLabel = el("label");
  toLabel.append(el("span", null, t("diff.versionB")));
  const to = document.createElement("select");
  to.name = "b";
  const current = document.createElement("option");
  current.value = "";
  current.textContent = t("diff.current");
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
  if (selected) {
    if ([...from.options].some((option) => option.value === selected.a)) from.value = selected.a;
    if ([...to.options].some((option) => option.value === selected.b)) to.value = selected.b;
  } else if (ordered[1]) {
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
  go.textContent = t("action.compare");
  go.disabled = runs.length === 0;
  fromLabel.append(from);
  toLabel.append(to);
  form.append(fromLabel, toLabel, go, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!from.value) {
      status.hidden = false;
      status.textContent = t("history.pickFirst");
      return;
    }
    if (to.value && from.value === to.value) {
      status.hidden = false;
      status.textContent = t("history.pickDifferent");
      return;
    }
    void openDiff(stage, from.value, to.value);
  });
  return form;
}

function renderVersion(stage, run) {
  const item = document.createElement("li");
  item.className = "history-item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "version";
  button.append(el("span", "version-head", `v${run.n} · ${resultLabel(run)} · ${formatTime(run.finishedAt)} · ${executorLabel(run)}`));
  const detail = runDetail(run);
  if (detail) button.append(el("span", "version-detail", detail));
  const failure = errorLine(run);
  if (failure) button.append(el("span", "version-error", tApi("history.errorLine", failure)));
  button.addEventListener("click", () => {
    void openVersion(stage, run);
  });
  item.append(button);
  if (run.status === "ok") {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "restore";
    restore.textContent = t("action.restore");
    restore.addEventListener("click", () => {
      void restoreVersion(stage, run.n, restore);
    });
    item.append(restore);
  }
  return item;
}

function paintVersionList(stage, run) {
  const outputs = stage.outputs || [];
  panelTitle.textContent = `v${run.n} · ${stage.name || stage.id || ""}`;
  viewState = { kind: "version", stage, run };
  const nodes = [];
  if (!outputs.length) nodes.push(el("p", null, t("history.noOutputs")));
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

async function openVersion(stage, run) {
  const outputs = stage.outputs || [];
  if (outputs.length === 1) {
    await openSnapshot(stage, run, outputs[0]);
    return;
  }
  paintVersionList(stage, run);
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
  panelMode = "other";
  releaseBlob();
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  const heading = () => titled(stage.name || stage.id || "", "action.compare");
  panelTitle.textContent = heading();
  showMessage(null, { key: "common.loading" }, null, heading);
  const params = new URLSearchParams({ stage: stage.id, a: String(a) });
  if (b) params.set("b", String(b));
  let res;
  try {
    res = await fetch(`/api/diff?${params}`, { headers: headers(), cache: "no-store" });
  } catch {
    showMessage("panel-error", { key: "diff.failed" }, historyOptions(stage), heading);
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const spec = data.error ? { api: data.error } : { key: "diff.failedStatus", vars: { status: res.status } };
    showMessage("panel-error", spec, historyOptions(stage), heading);
    return;
  }
  renderDiff(stage, data);
}

function renderDiff(stage, diff) {
  viewState = { kind: "diff", stage, diff };
  panelTitle.textContent = titled(stage.name || stage.id || "", "action.compare");
  const right = diff.b == null ? t("diff.current") : `v${diff.b}`;
  const nodes = [el("p", "diff-summary", `v${diff.a} → ${right}`)];
  for (const output of diff.outputs || []) nodes.push(renderOutputDiff(output));
  if (!(diff.outputs || []).length) nodes.push(el("p", null, t("diff.none")));
  showPanel(nodes, historyOptions(stage));
}

function renderOutputDiff(output) {
  const box = el("section", "diff-file");
  box.append(el("h3", "diff-path", output.path || ""));
  if (output.kind === "text") {
    if (output.same || !output.diff) box.append(el("p", "diff-same", t("diff.same")));
    else box.append(renderUnified(output.diff));
    return box;
  }
  if (output.kind === "binary") {
    box.append(el("p", output.same ? "diff-same" : "diff-changed", output.same ? t("diff.binarySame") : t("diff.binaryDiffers")));
    return box;
  }
  if (output.kind === "dir") {
    if (output.same) box.append(el("p", "diff-same", t("diff.dirSame")));
    else {
      if (output.added && output.added.length) box.append(fileLines(t("diff.added"), output.added, "diff-add"));
      if (output.removed && output.removed.length) box.append(fileLines(t("diff.removed"), output.removed, "diff-del"));
      if (output.changed && output.changed.length) box.append(fileLines(t("diff.changed"), output.changed, "diff-changed"));
    }
    return box;
  }
  box.append(el("p", null, t("diff.cannotShow")));
  return box;
}

function fileLines(title, files, className) {
  const block = el("div", "diff-block");
  block.append(el("span", "diff-line", title));
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
      const spec = data.error ? { api: data.error } : { key: "restore.failedStatus", vars: { status: res.status } };
      if (viewState && viewState.kind === "history") viewState.errorSpec = spec;
      panelBody.prepend(el("p", "panel-error", textOf(spec)));
      return;
    }
    await refreshNow();
    const kept = data.kept;
    await openHistory(stage, () => {
      const done = t("restore.done", { n });
      if (typeof kept !== "number") return done;
      return `${done} · ${t("restore.kept", { n: kept })}`;
    });
  } catch {
    panelBody.prepend(el("p", "panel-error", t("restore.failed")));
  } finally {
    if (button) button.disabled = false;
  }
}

async function openOutput(output, stage, options) {
  panelMode = "other";
  const rel = output.path;
  const readOnly = Boolean(options && options.readOnly);
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  const heading = () => (options && options.title) || rel;
  panelTitle.textContent = heading();
  showMessage(null, { key: "common.loading" }, null, heading);
  if (currentBlob) {
    URL.revokeObjectURL(currentBlob);
    currentBlob = null;
  }
  let res;
  try {
    res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`, { headers: headers(), cache: "no-store" });
  } catch {
    showMessage("panel-error", { key: "output.openFailed" }, options, heading);
    return;
  }
  if (!res.ok) {
    if (res.status === 404 && output.directory && stage && stage.executor === "human" && !readOnly) {
      renderFileList(rel, [], stage, options);
      return;
    }
    const spec = res.status === 404 ? { key: "output.notFound" } : { key: "output.openFailedStatus", vars: { status: res.status } };
    showMessage("panel-error", spec, options, heading);
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
    viewState = { kind: "nodes", nodes: [media], options };
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
  viewState = { kind: "nodes", nodes: [pre], options };
}

function renderEditor(rel, text, options, focus) {
  viewState = { kind: "editor", rel, text, options };
  const wrap = el("div", "editor");
  const area = document.createElement("textarea");
  area.value = text;
  area.spellcheck = false;
  area.setAttribute("aria-label", rel);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save";
  save.textContent = t("action.save");
  const status = el("p", "save-status");
  status.hidden = true;
  save.addEventListener("click", () => saveText(rel, area.value, save, status));
  wrap.append(el("p", "edit-hint", t("edit.note")), area, save, status);
  panelBody.replaceChildren();
  const back = makeBack(options);
  if (back) panelBody.append(back);
  panelBody.append(wrap);
  if (focus !== false) area.focus();
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
      setBound(status, data.error ? { api: data.error } : { key: "save.failedStatus", vars: { status: res.status } });
      return;
    }
    status.hidden = false;
    status.className = "save-ok";
    setBound(status, { key: "save.saved" });
    await refresh();
  } catch {
    status.hidden = false;
    status.className = "panel-error";
    setBound(status, { key: "save.failed" });
  } finally {
    button.disabled = false;
  }
}

function renderFileList(dir, files, stage, options) {
  viewState = { kind: "files", dir, files, stage, options };
  panelBody.replaceChildren();
  const back = makeBack(options);
  if (back) panelBody.append(back);
  if (stage && stage.executor === "human" && stage.instructions) {
    panelBody.append(el("p", "instructions", stage.instructions));
  }
  // Keep the way back (e.g. to the stage panel opened from the graph) after an upload from this list.
  if (stage && stage.executor === "human") panelBody.append(uploadControl(stage, dir, options));
  if (!files.length) {
    panelBody.append(el("p", null, t("files.empty")));
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
  label.append(el("span", null, t("upload.label")));
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
    setBound(status, { key: "upload.uploading" });
  }
  try {
    const res = await fetch(
      `/api/upload?stage=${encodeURIComponent(stage.id)}&name=${encodeURIComponent(file.name)}`,
      { method: "POST", headers: headers(), body: file, cache: "no-store" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) setBound(status, data.error ? { api: data.error } : { key: "upload.failedStatus", vars: { status: res.status } });
      return;
    }
    await refresh();
    await openOutput({ path: dir, directory: true, text: false, type: "dir" }, stage, options);
  } catch {
    if (status) setBound(status, { key: "upload.failed" });
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
  lastFields = fields;
  inputsEl.replaceChildren();
  if (!fields.length) {
    inputsEl.append(el("p", "field-help", t("inputs.none")));
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
  if (field.required) name.append(el("span", "req", t("input.required")));
  wrap.append(name, controlFor(field));
  if (field.description) wrap.append(el("span", "field-help", field.description));
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
        setBound(inputsStatus, { key: "input.mustNumber", vars: { name } });
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
      setBound(inputsStatus, data.error ? { api: data.error } : { key: "save.failedStatus", vars: { status: res.status } });
      return;
    }
    inputsStatus.className = "inputs-status ok";
    setBound(inputsStatus, { key: "save.saved" });
    lastInputValues = "";
    await refresh();
  } catch {
    inputsStatus.hidden = false;
    inputsStatus.className = "inputs-status error";
    setBound(inputsStatus, { key: "save.failed" });
  } finally {
    inputsSave.disabled = false;
  }
}

function onStreamEvent(type, data) {
  if (type === "flow:changed") {
    void refreshNow();
    return;
  }
  if (type === "stage:start") appendLog(`▶ ${data.name || data.stage} (${data.stage})`);
  else if (type === "stage:log") appendLog(`    ${data.line ?? ""}`);
  else if (type === "stage:done") appendLog(`✓ ${data.name || data.stage} → v${data.n}`);
  else if (type === "stage:skip") appendLog(tApi("log.skip", data.reason ?? "", { name: data.name || data.stage }, "reason"));
  else if (type === "stage:error") appendLog(`✗ ${data.name || data.stage}: ${apiText(data.error ?? "")}`);
  else if (type === "run:end") {
    if (data.waiting) {
      const missing = Array.isArray(data.waiting.missing) ? data.waiting.missing.join(", ") : "";
      appendLog(t("log.waiting", { name: data.waiting.name || data.waiting.stage, missing }));
      if (data.waiting.instructions) appendLog(data.waiting.instructions);
    } else if (data.ok) appendLog(t("log.finished"));
    else appendLog(data.error ? apiText(data.error) : t("log.runFailed"));
    void refresh();
  }
}

function setLiveHint(live) {
  if (!hintEl) return;
  hintEl.textContent = live ? t("hint.live") : t("hint.poll");
}

function showLiveLost() {
  showNotice("hint.lost");
}

function hideLiveLost() {
  if (noticeKey !== "hint.lost") return;
  clearNotice();
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
      showNotice("refresh.failedStatus", { status: res.status });
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
    else clearNotice();
    if (text === lastJson && (!usageOk || nextUsage === usageText)) return;
    const flowChanged = text !== lastJson;
    lastJson = text;
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
    showNotice("refresh.failed");
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
  button.setAttribute("aria-label", `${t("card.menu")} · ${stage.id || ""}`);
  button.textContent = "⋯";
  const menu = el("div", "menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "menu-remove";
  remove.setAttribute("role", "menuitem");
  remove.textContent = t("action.removeStage");
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

function fillStageChoices() {
  const after = document.getElementById("stage-after");
  const inputs = document.getElementById("stage-inputs");
  const afterValue = after.value;
  const selected = new Set([...inputs.selectedOptions].map((option) => option.value));
  after.replaceChildren(new Option(t("stage.atEnd"), ""));
  inputs.replaceChildren();
  for (const stage of boardStages) {
    const label = stage.name && stage.name !== stage.id ? `${stage.name} (${stage.id})` : stage.id || "";
    after.append(new Option(label, stage.id || ""));
    inputs.append(new Option(label, stage.id || ""));
  }
  if ([...after.options].some((option) => option.value === afterValue)) after.value = afterValue;
  for (const option of inputs.options) option.selected = selected.has(option.value);
}

function syncStageFields() {
  const type = document.getElementById("stage-type").value;
  document.getElementById("stage-prompt-field").hidden = type !== "llm" && type !== "agent";
  document.getElementById("stage-run-field").hidden = type !== "script";
  document.getElementById("stage-agent-field").hidden = type !== "agent";
  document.getElementById("stage-run").required = type === "script";
  document.getElementById("stage-outputs").required = type === "script";
  const hint = document.getElementById("stage-outputs-hint");
  if (type === "script") {
    hint.setAttribute("data-i18n", "stage.outputsHintScript");
    hint.textContent = t("stage.outputsHintScript");
  } else {
    hint.setAttribute("data-i18n", "stage.outputsHint");
    hint.textContent = t("stage.outputsHint");
  }
}

function openAddStage() {
  closeMenus();
  stageForm.reset();
  fillStageChoices();
  syncStageFields();
  stageStatus.hidden = true;
  stageStatus.textContent = "";
  stageStatus._i18nSpec = null;
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
      setBound(stageStatus, { issues: data, fallback: { key: "stage.notAddedStatus", vars: { status: res.status } } });
      return;
    }
    stageDialog.close();
    await refreshNow();
  } catch {
    stageStatus.hidden = false;
    setBound(stageStatus, { key: "stage.notAdded" });
  } finally {
    stageSave.disabled = false;
  }
}

function openRemove(stage) {
  removeId = stage.id || "";
  removeLabel = stage.name || stage.id || "";
  setBound(removeText, { key: "stage.removeAsk", vars: { label: removeLabel, id: removeId } });
  removeDeps.hidden = true;
  removeDeps.textContent = "";
  removeDeps._i18nSpec = null;
  removeStatus.hidden = true;
  removeStatus.textContent = "";
  removeStatus._i18nSpec = null;
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
      const spec = data.error
        ? { api: data.error }
        : names
          ? { key: "stage.removeDeps", vars: { id: removeId, names } }
          : { key: "stage.removeDepsShort" };
      setBound(removeDeps, spec);
      removeForce.hidden = false;
      removeConfirm.hidden = true;
      return;
    }
    if (!res.ok) {
      removeStatus.hidden = false;
      setBound(removeStatus, { issues: data, fallback: { key: "stage.notRemovedStatus", vars: { status: res.status } } });
      return;
    }
    removeDialog.close();
    await refreshNow();
  } catch {
    removeStatus.hidden = false;
    setBound(removeStatus, { key: "stage.notRemoved" });
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
  closePanel();
});
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
runAllButton.addEventListener("click", () => {
  void runAll();
});
inputsForm.addEventListener("submit", (event) => {
  void saveInputs(event);
});

function replayEditor(state) {
  const area = panelBody.querySelector(".editor textarea");
  const value = area ? area.value : state.text;
  const start = area ? area.selectionStart : 0;
  const end = area ? area.selectionEnd : 0;
  renderEditor(state.rel, value, state.options, false);
  const next = panelBody.querySelector(".editor textarea");
  if (!next) return;
  try {
    next.setSelectionRange(start, end);
  } catch {
    // The text is still there.
  }
}

function replayView() {
  const state = viewState;
  if (!state || panelMode !== "other" || panelEl.hidden) return;
  if (state.kind === "history") renderHistory(state.stage, state.runs, state.note, readCompare() || state.selected, state.errorSpec);
  else if (state.kind === "diff") renderDiff(state.stage, state.diff);
  else if (state.kind === "version") paintVersionList(state.stage, state.run);
  else if (state.kind === "files") renderFileList(state.dir, state.files, state.stage, state.options);
  else if (state.kind === "editor") replayEditor(state);
  else if (state.kind === "nodes") showPanel(state.nodes, state.options);
  else if (state.kind === "message") showMessage(state.className, state.spec, state.options, state.heading);
}

function retouchInputs() {
  if (!lastFields) return;
  for (const req of inputsEl.querySelectorAll(".req")) req.textContent = t("input.required");
  if (!lastFields.length) {
    const empty = inputsEl.querySelector(":scope > p.field-help");
    if (empty) empty.textContent = t("inputs.none");
  }
}

function repaintLanguage() {
  paintUsageTotal();
  if (eventsState === "live") setLiveHint(true);
  else if (eventsState === "down") setLiveHint(false);
  if (noticeKey) {
    noticeEl.hidden = false;
    noticeEl.textContent = t(noticeKey, noticeVars);
  }
  refreshBound();
  retouchInputs();
  if (stageDialog.open) {
    fillStageChoices();
    syncStageFields();
  }
  if (lastFlow) render(lastFlow);
  else paintBoard();
  if (panelMode === "other") replayView();
}

onLangChange(repaintLanguage);
connectEvents();
refresh();
