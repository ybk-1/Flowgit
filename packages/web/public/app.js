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
const noticeEl = document.getElementById("notice");
const panelEl = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");

let lastJson = "";
let refreshing = false;
let currentBlob = null;

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

function render(data) {
  document.getElementById("flow-name").textContent = data.name || "看板 / Board";
  document.title = `${data.name || "Flowgit"} · 看板 / Board`;

  const missing = Array.isArray(data.missingInputs) ? data.missingInputs : [];
  bannerEl.replaceChildren();
  if (missing.length) {
    bannerEl.hidden = false;
    bannerEl.append(
      el("p", null, `还没填流程输入 / flow inputs not set: ${missing.join(", ")}`),
      el("p", "banner-hint", `flowgit inputs set ${missing[0]}=...`),
    );
  } else {
    bannerEl.hidden = true;
  }

  inputsEl.replaceChildren();
  const inputs = data.inputs && typeof data.inputs === "object" ? data.inputs : {};
  for (const [key, value] of Object.entries(inputs)) {
    const unset = value === undefined || value === "";
    const chip = el("span", missing.includes(key) ? "chip missing" : "chip");
    chip.textContent = unset ? `${key}=（未填 unset）` : `${key}=${String(value)}`;
    inputsEl.append(chip);
  }

  const scroll = boardEl.scrollLeft;
  boardEl.replaceChildren();
  for (const stage of data.stages ?? []) boardEl.append(renderCard(stage));
  boardEl.scrollLeft = scroll;
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

function closePanel() {
  panelEl.hidden = true;
  document.body.classList.remove("panel-open");
  if (currentBlob) {
    URL.revokeObjectURL(currentBlob);
    currentBlob = null;
  }
}

async function openOutput(output, stage) {
  const rel = output.path;
  panelEl.hidden = false;
  document.body.classList.add("panel-open");
  panelTitle.textContent = rel;
  panelBody.replaceChildren(el("p", null, "加载中 / loading…"));
  if (currentBlob) {
    URL.revokeObjectURL(currentBlob);
    currentBlob = null;
  }
  let res;
  try {
    res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`, { headers: headers(), cache: "no-store" });
  } catch {
    panelBody.replaceChildren(el("p", "panel-error", "无法打开 / could not open"));
    return;
  }
  if (!res.ok) {
    if (res.status === 404 && output.directory && stage && stage.executor === "human") {
      renderFileList(rel, [], stage);
      return;
    }
    const message = res.status === 404 ? "找不到这个产物 / output not found" : `无法打开 / could not open (${res.status})`;
    panelBody.replaceChildren(el("p", "panel-error", message));
    return;
  }
  if (res.headers.get("X-Flowgit-Kind") === "directory") {
    const data = await res.json();
    renderFileList(rel, Array.isArray(data.files) ? data.files : [], stage);
    return;
  }
  if (output.text) {
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
    panelBody.replaceChildren(media);
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
  panelBody.replaceChildren(pre);
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

function renderFileList(dir, files, stage) {
  panelBody.replaceChildren();
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
    button.addEventListener("click", () => openOutput({ path: child, directory: false, text: false }, stage));
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
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) void uploadInto(stage, dir, file);
  });
  label.append(input);
  const status = el("p", "upload-status");
  status.hidden = true;
  form.append(label, status);
  return form;
}

async function uploadInto(stage, dir, file) {
  const status = panelBody.querySelector(".upload-status");
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
    render(JSON.parse(text));
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

refresh();
setInterval(refresh, 3000);
