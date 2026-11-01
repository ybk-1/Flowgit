const token = document.querySelector('meta[name="flowgit-token"]')?.getAttribute("content") ?? "";

const STATES = {
  ok: { icon: "✓", zh: "已完成", en: "ok" },
  stale: { icon: "↻", zh: "需重跑（上游或配置变了）", en: "stale" },
  edited: { icon: "✎", zh: "已手动修改", en: "edited" },
  error: { icon: "✗", zh: "上次运行失败", en: "error" },
  "never-run": { icon: "○", zh: "可以运行", en: "never-run" },
  "waiting-upstream": { icon: "…", zh: "等上游", en: "waiting-upstream" },
};

const EDIT_NOTE =
  "下次运行这个阶段前，这次修改会存成单独的版本，不会丢失。 / Before this stage next runs, the edit is saved as its own version and is not lost.";

const boardEl = document.getElementById("board");
const bannerEl = document.getElementById("banner");
const inputsEl = document.getElementById("inputs");
const inputsForm = document.getElementById("inputs-form");
const inputsStatus = document.getElementById("inputs-status");
const inputsSave = document.getElementById("inputs-save");
const noticeEl = document.getElementById("notice");
const panelEl = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");
const logEl = document.getElementById("log");
const runAllButton = document.getElementById("run-all");

let lastJson = "";
let lastInputValues = "";
let refreshing = false;
let currentBlob = null;
let runBusy = false;
let runGen = 0;
const modelDrafts = new Map();

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

function render(data) {
  document.getElementById("flow-name").textContent = data.name || "看板 / Board";
  document.title = `${data.name || "Flowgit"} · 看板 / Board`;

  const missing = Array.isArray(data.missingInputs) ? data.missingInputs : [];
  bannerEl.replaceChildren();
  if (missing.length) {
    bannerEl.hidden = false;
    bannerEl.append(
      el("p", null, `还没填流程输入 / flow inputs not set: ${missing.join(", ")}`),
      el("p", "banner-hint", "在下面的表单里填写，或 / or: flowgit inputs set " + missing[0] + "=..."),
    );
  } else {
    bannerEl.hidden = true;
  }

  captureModelDrafts();
  const scroll = boardEl.scrollLeft;
  boardEl.replaceChildren();
  for (const stage of data.stages ?? []) boardEl.append(renderCard(stage));
  boardEl.scrollLeft = scroll;
  syncRunButtons();
}

function humanDir(stage) {
  const dirs = (stage.outputs ?? []).filter((output) => output.directory);
  return dirs.length === 1 ? dirs[0] : null;
}

function renderCard(stage) {
  const card = el("article", "card");
  card.dataset.state = stage.state || "";
  const label = STATES[stage.state] ?? { icon: "•", zh: stage.state || "未知", en: stage.state || "unknown" };

  card.append(
    el("h2", null, stage.name || stage.id || ""),
    el("p", "stage-id", stage.id || ""),
    el("p", "executor", `执行 / executor · ${stage.executor || ""}`),
    el("p", "badge", `${label.icon} ${label.zh} ${label.en}`),
  );
  if (stage.state === "edited") card.append(el("p", "edit-note", EDIT_NOTE));

  const version = el("p", "version");
  if (stage.latest) {
    version.textContent = `v${stage.latest.n} · ${formatTime(stage.latest.time)}`;
  } else {
    version.textContent = "还没有版本 / no runs yet";
  }
  card.append(version, el("p", "runs", `${stage.runs ?? 0} 个版本 / ${stage.runs ?? 0} run(s)`));
  const history = document.createElement("button");
  history.type = "button";
  history.className = "history";
  history.textContent = "历史 History";
  history.addEventListener("click", () => {
    void openHistory(stage);
  });
  card.append(history);

  // A human stage whose upstream is ready is waiting on the person: show what to do, and the upload button.
  if (stage.executor === "human" && stage.state !== "waiting-upstream") {
    if (stage.instructions) card.append(el("p", "instructions", stage.instructions));
    const dir = humanDir(stage);
    if (dir) card.append(uploadControl(stage, dir.path));
  }

  if (stage.executor === "llm") card.append(modelField(stage.id));

  const run = document.createElement("button");
  run.type = "button";
  run.className = "run";
  run.textContent = "运行这一步 Run";
  run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
  if (stage.state === "waiting-upstream") run.title = "等上游完成 / waiting for upstream";
  run.addEventListener("click", () => startRun(stage.id, modelForStage(stage.id)));
  card.append(run);

  const outputs = el("div", "outputs");
  outputs.append(el("p", "outputs-label", "产物 / outputs"));
  for (const output of stage.outputs ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = output.directory ? `${output.path}/` : output.path;
    button.addEventListener("click", () => openOutput(output, stage));
    outputs.append(button);
  }
  card.append(outputs);
  return card;
}

function modelField(stageId) {
  const label = el("label", "model-field");
  label.append(el("span", null, "模型 model（可选 optional）"));
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

function modelForStage(stageId) {
  for (const input of document.querySelectorAll("input[data-model-for]")) {
    if (input.getAttribute("data-model-for") === stageId) {
      const value = input.value.trim();
      return value || undefined;
    }
  }
  return undefined;
}

function modelForAll() {
  const values = [];
  for (const input of document.querySelectorAll("input[data-model-for]")) {
    const value = input.value.trim();
    if (value) values.push(value);
  }
  const unique = [...new Set(values)];
  if (unique.length > 1) {
    return {
      error: "各阶段填的模型不一样。全部运行请留空，或填成同一个。 / Model fields differ. For run all, leave them blank or use the same one.",
    };
  }
  return { model: unique[0] };
}

function syncRunButtons() {
  if (runAllButton) runAllButton.disabled = runBusy;
  for (const button of document.querySelectorAll("button.run")) {
    button.disabled = runBusy || button.dataset.waiting === "1";
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

async function startRun(stage, model) {
  if (runBusy) {
    appendLog("已有运行在进行 / a run is already in progress");
    return;
  }
  const gen = ++runGen;
  runBusy = true;
  syncRunButtons();
  clearLog();
  appendLog(stage === "all" ? "全部运行 Run all" : `运行 / run ${stage}${model ? ` · ${model}` : ""}`);
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
    if (res.status === 409) appendLog(data.error || "已有运行在进行 / a run is already in progress");
    else if (!res.ok) appendLog(data.error || `运行失败 / run failed (${res.status})`);
  } catch {
    appendLog("运行失败 / run failed");
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
  releaseBlob();
}

function makeBack(options) {
  if (!options || typeof options.onBack !== "function") return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back";
  button.textContent = options.backLabel || "返回 Back";
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
    backLabel: "返回历史 Back to history",
  };
}

function executorLabel(run) {
  if (run.executor === "manual") return "手动修改 manual edit";
  return run.executor || "";
}

function resultLabel(run) {
  if (run.status === "ok") return "成功 ok";
  if (run.status === "error") return "失败 error";
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
  releaseBlob();
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  panelTitle.textContent = `${stage.name || stage.id || ""} · 历史 History`;
  panelBody.replaceChildren(el("p", null, "加载中 / loading…"));
  let res;
  try {
    res = await fetch(`/api/runs?stage=${encodeURIComponent(stage.id)}`, { headers: headers(), cache: "no-store" });
  } catch {
    panelBody.replaceChildren(el("p", "panel-error", "无法打开历史 / could not open history"));
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    panelBody.replaceChildren(el("p", "panel-error", data.error || `无法打开历史 / could not open history (${res.status})`));
    return;
  }
  renderHistory(stage, Array.isArray(data.runs) ? data.runs : [], note);
}

function renderHistory(stage, runs, note) {
  panelTitle.textContent = `${stage.name || stage.id || ""} · 历史 History`;
  const nodes = [];
  if (note) nodes.push(el("p", "save-ok", note));
  nodes.push(el("p", "history-hint", "点一个版本看当时的产物。 / Click a version to see what it produced."));
  nodes.push(renderCompare(stage, runs));
  if (!runs.length) {
    nodes.push(el("p", null, "还没有版本 / no runs yet"));
    showPanel(nodes);
    return;
  }
  const list = el("ul", "history-list");
  for (const run of runs.slice().reverse()) list.append(renderVersion(stage, run));
  nodes.push(list);
  showPanel(nodes);
}

function renderCompare(stage, runs) {
  const form = el("form", "compare");
  const fromLabel = el("label");
  fromLabel.append(el("span", null, "版本 A / version A"));
  const from = document.createElement("select");
  from.name = "a";
  const toLabel = el("label");
  toLabel.append(el("span", null, "版本 B / version B"));
  const to = document.createElement("select");
  to.name = "b";
  const current = document.createElement("option");
  current.value = "";
  current.textContent = "当前文件 current";
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
  go.textContent = "对比 Compare";
  go.disabled = runs.length === 0;
  fromLabel.append(from);
  toLabel.append(to);
  form.append(fromLabel, toLabel, go, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!from.value) {
      status.hidden = false;
      status.textContent = "先选一个版本 / pick a version first";
      return;
    }
    if (to.value && from.value === to.value) {
      status.hidden = false;
      status.textContent = "选两个不同的版本，或一个版本和当前文件。 / Pick two different versions, or one version and the current files.";
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
  if (failure) button.append(el("span", "version-error", `错误 / error: ${failure}`));
  button.addEventListener("click", () => {
    void openVersion(stage, run);
  });
  item.append(button);
  if (run.status === "ok") {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "restore";
    restore.textContent = "回退到这个版本 Restore";
    restore.addEventListener("click", () => {
      void restoreVersion(stage, run.n, restore);
    });
    item.append(restore);
  }
  return item;
}

async function openVersion(stage, run) {
  const outputs = stage.outputs || [];
  if (outputs.length === 1) {
    await openSnapshot(stage, run, outputs[0]);
    return;
  }
  panelTitle.textContent = `v${run.n} · ${stage.name || stage.id || ""}`;
  const nodes = [];
  if (!outputs.length) nodes.push(el("p", null, "这个阶段没有产物 / this stage has no outputs"));
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
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  panelTitle.textContent = `${stage.name || stage.id || ""} · 对比 Compare`;
  panelBody.replaceChildren(el("p", null, "加载中 / loading…"));
  const params = new URLSearchParams({ stage: stage.id, a: String(a) });
  if (b) params.set("b", String(b));
  let res;
  try {
    res = await fetch(`/api/diff?${params}`, { headers: headers(), cache: "no-store" });
  } catch {
    showPanel([el("p", "panel-error", "无法对比 / could not compare")], historyOptions(stage));
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showPanel([el("p", "panel-error", data.error || `无法对比 / could not compare (${res.status})`)], historyOptions(stage));
    return;
  }
  renderDiff(stage, data);
}

function renderDiff(stage, diff) {
  panelTitle.textContent = `${stage.name || stage.id || ""} · 对比 Compare`;
  const right = diff.b == null ? "当前文件 current" : `v${diff.b}`;
  const nodes = [el("p", "diff-summary", `v${diff.a} → ${right}`)];
  for (const output of diff.outputs || []) nodes.push(renderOutputDiff(output));
  if (!(diff.outputs || []).length) nodes.push(el("p", null, "没有产物 / no outputs"));
  showPanel(nodes, historyOptions(stage));
}

function renderOutputDiff(output) {
  const box = el("section", "diff-file");
  box.append(el("h3", "diff-path", output.path || ""));
  if (output.kind === "text") {
    if (output.same || !output.diff) box.append(el("p", "diff-same", "相同 / same"));
    else box.append(renderUnified(output.diff));
    return box;
  }
  if (output.kind === "binary") {
    box.append(el("p", output.same ? "diff-same" : "diff-changed", output.same ? "二进制相同 / binary same" : "二进制不同 / binary differs"));
    return box;
  }
  if (output.kind === "dir") {
    if (output.same) box.append(el("p", "diff-same", "文件夹相同 / directory same"));
    else {
      if (output.added && output.added.length) box.append(fileLines("新增 / added", output.added, "diff-add"));
      if (output.removed && output.removed.length) box.append(fileLines("删除 / removed", output.removed, "diff-del"));
      if (output.changed && output.changed.length) box.append(fileLines("改动 / changed", output.changed, "diff-changed"));
    }
    return box;
  }
  box.append(el("p", null, "无法显示这个差异 / could not show this diff"));
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
  const confirmed = window.confirm(
    `确定回退到 v${n}？当前产物会被这个版本替换，下游阶段会变成需重跑。\nRestore v${n}? Current outputs will be replaced by this version, and downstream stages will show as stale.`,
  );
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
      panelBody.prepend(el("p", "panel-error", data.error || `没有回退 / not restored (${res.status})`));
      return;
    }
    await refreshNow();
    await openHistory(stage, `已回退到 v${n} / restored v${n}`);
  } catch {
    panelBody.prepend(el("p", "panel-error", "没有回退 / not restored"));
  } finally {
    if (button) button.disabled = false;
  }
}

async function openOutput(output, stage, options) {
  const rel = output.path;
  const readOnly = Boolean(options && options.readOnly);
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  panelTitle.textContent = (options && options.title) || rel;
  panelBody.replaceChildren(el("p", null, "加载中 / loading…"));
  if (currentBlob) {
    URL.revokeObjectURL(currentBlob);
    currentBlob = null;
  }
  let res;
  try {
    res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`, { headers: headers(), cache: "no-store" });
  } catch {
    showPanel([el("p", "panel-error", "无法打开 / could not open")], options);
    return;
  }
  if (!res.ok) {
    if (res.status === 404 && output.directory && stage && stage.executor === "human" && !readOnly) {
      renderFileList(rel, [], stage, options);
      return;
    }
    const message = res.status === 404 ? "找不到这个产物 / output not found" : `无法打开 / could not open (${res.status})`;
    showPanel([el("p", "panel-error", message)], options);
    return;
  }
  if (res.headers.get("X-Flowgit-Kind") === "directory") {
    const data = await res.json();
    renderFileList(rel, Array.isArray(data.files) ? data.files : [], readOnly ? null : stage, options);
    return;
  }
  if (output.text && !readOnly) {
    renderEditor(rel, await res.text());
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

function renderEditor(rel, text) {
  const wrap = el("div", "editor");
  const area = document.createElement("textarea");
  area.value = text;
  area.spellcheck = false;
  area.setAttribute("aria-label", rel);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save";
  save.textContent = "保存 Save";
  const status = el("p", "save-status");
  status.hidden = true;
  save.addEventListener("click", () => saveText(rel, area.value, save, status));
  wrap.append(el("p", "edit-hint", EDIT_NOTE), area, save, status);
  panelBody.replaceChildren(wrap);
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
      status.textContent = data.error || `没有保存 / not saved (${res.status})`;
      return;
    }
    status.hidden = false;
    status.className = "save-ok";
    status.textContent = "已保存 / saved";
    await refresh();
  } catch {
    status.hidden = false;
    status.className = "panel-error";
    status.textContent = "没有保存 / not saved";
  } finally {
    button.disabled = false;
  }
}

function renderFileList(dir, files, stage, options) {
  panelBody.replaceChildren();
  const back = makeBack(options);
  if (back) panelBody.append(back);
  if (stage && stage.executor === "human" && stage.instructions) {
    panelBody.append(el("p", "instructions", stage.instructions));
  }
  if (stage && stage.executor === "human") panelBody.append(uploadControl(stage, dir));
  if (!files.length) {
    panelBody.append(el("p", null, "空文件夹 / empty folder"));
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

function uploadControl(stage, dir) {
  const form = el("div", "upload");
  const label = el("label", "upload-label");
  label.append(el("span", null, "上传文件 / Upload a file"));
  const input = document.createElement("input");
  input.type = "file";
  const status = el("p", "upload-status");
  status.hidden = true;
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) void uploadInto(stage, dir, file, status);
  });
  label.append(input);
  form.append(label, status);
  return form;
}

async function uploadInto(stage, dir, file, status) {
  if (status) {
    status.hidden = false;
    status.className = "upload-status";
    status.textContent = "上传中 / uploading…";
  }
  try {
    const res = await fetch(
      `/api/upload?stage=${encodeURIComponent(stage.id)}&name=${encodeURIComponent(file.name)}`,
      { method: "POST", headers: headers(), body: file, cache: "no-store" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) status.textContent = data.error || `没有上传 / not uploaded (${res.status})`;
      return;
    }
    await refresh();
    await openOutput({ path: dir, directory: true, text: false, type: "dir" }, stage);
  } catch {
    if (status) status.textContent = "没有上传 / not uploaded";
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
    inputsEl.append(el("p", "field-help", "这个流程没有输入 / This flow has no inputs."));
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
  if (field.required) name.append(el("span", "req", "必填 required"));
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
        inputsStatus.textContent = `输入 ${name} 必须是数字 / input "${name}" must be a number`;
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
      inputsStatus.textContent = data.error || `没有保存 / not saved (${res.status})`;
      return;
    }
    inputsStatus.className = "inputs-status ok";
    inputsStatus.textContent = "已保存 / saved";
    lastInputValues = "";
    await refresh();
  } catch {
    inputsStatus.hidden = false;
    inputsStatus.className = "inputs-status error";
    inputsStatus.textContent = "没有保存 / not saved";
  } finally {
    inputsSave.disabled = false;
  }
}

function onStreamEvent(type, data) {
  if (type === "stage:start") appendLog(`▶ ${data.name || data.stage} (${data.stage})`);
  else if (type === "stage:log") appendLog(`    ${data.line ?? ""}`);
  else if (type === "stage:done") appendLog(`✓ ${data.name || data.stage} → v${data.n}`);
  else if (type === "stage:skip") appendLog(`· ${data.name || data.stage} 跳过 / skipped: ${data.reason ?? ""}`);
  else if (type === "stage:error") appendLog(`✗ ${data.name || data.stage}: ${data.error ?? ""}`);
  else if (type === "run:end") {
    if (data.waiting) {
      const missing = Array.isArray(data.waiting.missing) ? data.waiting.missing.join(", ") : "";
      appendLog(`「${data.waiting.name || data.waiting.stage}」在等你 / waiting for you: ${missing}`);
      if (data.waiting.instructions) appendLog(data.waiting.instructions);
    } else if (data.ok) appendLog("运行结束 / run finished");
    else appendLog(data.error || "运行失败 / run failed");
    void refresh();
  }
}

function connectEvents() {
  if (!token || typeof EventSource === "undefined") return;
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  for (const type of ["stage:start", "stage:log", "stage:done", "stage:error", "stage:skip", "run:end"]) {
    source.addEventListener(type, (event) => {
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
      noticeEl.textContent = `无法刷新看板 / could not refresh the board (${res.status})`;
      return;
    }
    const text = await res.text();
    noticeEl.hidden = true;
    if (text === lastJson) return;
    lastJson = text;
    const data = JSON.parse(text);
    render(data);
    const signature = JSON.stringify(data.inputs ?? {});
    if (signature !== lastInputValues) {
      const loaded = await loadInputs();
      if (loaded) lastInputValues = signature;
    }
  } catch {
    noticeEl.hidden = false;
    noticeEl.textContent = "无法刷新看板 / could not refresh the board";
  } finally {
    refreshing = false;
  }
}

document.getElementById("panel-close").addEventListener("click", closePanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanel();
});
runAllButton.addEventListener("click", () => {
  const picked = modelForAll();
  if (picked.error) {
    appendLog(picked.error);
    return;
  }
  void startRun("all", picked.model);
});
inputsForm.addEventListener("submit", (event) => {
  void saveInputs(event);
});

connectEvents();
refresh();
setInterval(refresh, 3000);
