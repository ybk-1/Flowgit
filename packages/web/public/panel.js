/** Board panel. */
import { getFile, getThumb, saveFile, uploadFile } from "./api.js";
import { humanDir, openRemove } from "./cards.js";
import { markSelected } from "./graph.js";
import { openHistory } from "./history.js";
import { I18N } from "./i18n.js";
import { modelForStage, refresh, startRun, syncRunButtons } from "./run.js";
import { S, el, elr, elt, errorEl, modelDrafts, paintBadge, paintVersion, panelBody, panelEl, panelPortal, panelTitle, setError, shownBadge, stageLabel, stageUsageLine, t } from "./state.js";
import { openTimeline } from "./viewers/timeline.js";
import { openStoryboard } from "./viewers/storyboard.js";

/** Shows the side panel. When it was closed, it opens as a circle from the last click or key press. */
export function revealPanel() {
    document.body.classList.add("panel-open");
    const origin = S.lastPress && performance.now() - S.lastPress.at < 1500 ? S.lastPress : null;
    panelPortal.open(origin);
}

export function notePress(target) {
    if (!(target instanceof Element))
        return;
    const hit = target.closest("button, .flow-node");
    if (!hit || panelEl.contains(hit))
        return;
    const box = hit.getBoundingClientRect();
    S.lastPress = { x: box.left + box.width / 2, y: box.top + box.height / 2, at: performance.now() };
}

export function stageBack(stage) {
    return {
        onBack: () => {
            const fresh = S.boardStages.find((item) => item.id === stage.id) || stage;
            openStage(fresh);
        },
        backLabel: "stage.back",
    };
}

export function openStage(stage) {
    // A live refresh of the stage already on show decodes a changed badge; opening a stage does not.
    const sameStage = S.panelMode === "stage" && !panelEl.hidden && S.selectedId === stage.id;
    S.selectedId = stage.id || "";
    S.returnToStage = stage;
    S.panelMode = "stage";
    markSelected();
    releaseBlob();
    revealPanel();
    I18N.raw(panelTitle, stage.name || stage.id || "");
    const badge = el("p", "badge");
    badge.dataset.state = stage.state || "";
    badge.dataset.stage = stage.id || "";
    if (!sameStage)
        shownBadge.delete(`panel:${stage.id || ""}`);
    paintBadge(badge, stage.id || "", "panel", stageLabel(stage));
    const version = el("p", "version");
    paintVersion(version, stage);
    const actions = el("div", "stage-actions");
    const history = document.createElement("button");
    history.type = "button";
    history.className = "history";
    I18N.text(history, "stage.history");
    history.addEventListener("click", () => {
        S.panelMode = "other";
        void openHistory(stage);
    });
    const run = document.createElement("button");
    run.type = "button";
    run.className = "run";
    I18N.text(run, "stage.run");
    run.dataset.waiting = stage.state === "waiting-upstream" ? "1" : "0";
    if (stage.state === "waiting-upstream")
        I18N.attr(run, "title", "stage.waiting");
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
    if (stage.state === "edited")
        nodes.push(elt("p", "edit-note", "editNote"));
    nodes.push(actions);
    if (stage.executor === "human" && stage.state !== "waiting-upstream") {
        if (stage.instructions)
            nodes.push(foldedInstructions(stage.instructions));
        const dir = humanDir(stage);
        if (dir)
            nodes.push(uploadControl(stage, dir.path, stageBack(stage)));
    }
    if (stage.executor === "llm")
        nodes.push(modelField(stage.id));
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

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

export const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

export const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);

export const thumbUrls = new Set();

export const observedThumbs = new Set();

export const thumbObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting)
                continue;
            thumbObserver.unobserve(entry.target);
            const load = entry.target._flowgitLoad;
            if (typeof load === "function")
                load();
        }
    }, { rootMargin: "160px" })
    : null;

export function releaseThumbUrls() {
    if (thumbObserver) {
        for (const node of observedThumbs)
            thumbObserver.unobserve(node);
    }
    observedThumbs.clear();
    for (const url of thumbUrls)
        URL.revokeObjectURL(url);
    thumbUrls.clear();
}

export function rememberThumbUrl(url) {
    thumbUrls.add(url);
}

export function fileExt(filePath) {
    const base = String(filePath || "").split(/[\\/]/).pop() || "";
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function outputKind(output) {
    if (output.directory)
        return "dir";
    const type = String(output.type || "").toLowerCase();
    const ext = fileExt(output.path);
    if (type.startsWith("image/") || IMAGE_EXT.has(ext))
        return "image";
    if (type.startsWith("audio/") || (AUDIO_EXT.has(ext) && !type.startsWith("video/")))
        return "audio";
    if (type.startsWith("video/") || VIDEO_EXT.has(ext))
        return "video";
    if (type === "application/json" || type.endsWith("+json") || ext === ".json")
        return "json";
    return "text";
}

/** First three content lines, with Markdown markers taken off. */
export function stripMarkdown(text) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let fence = false;
    for (const raw of lines) {
        const trimmed = raw.trim();
        if (/^```/.test(trimmed)) {
            fence = !fence;
            continue;
        }
        if (fence)
            continue;
        if (!trimmed || /^([-*_])\1{2,}$/.test(trimmed))
            continue;
        const plain = trimmed
            .replace(/^#{1,6}\s+/, "")
            .replace(/^>\s?/, "")
            .replace(/^[-*+]\s+/, "")
            .replace(/^\d+\.\s+/, "")
            .replace(/!\[[^\]]*]\([^)]*\)/g, "")
            .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
            .replace(/[*_~`]/g, "")
            .trim();
        if (!plain)
            continue;
        out.push(plain);
        if (out.length === 3)
            break;
    }
    return out.join("\n");
}

export function summarizeJson(text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return stripMarkdown(text);
    }
    if (Array.isArray(value))
        return t("thumb.items", { count: value.length });
    if (!value || typeof value !== "object")
        return String(value);
    const lines = [];
    for (const [key, val] of Object.entries(value)) {
        if (Array.isArray(val))
            lines.push(`${key}: ${t("thumb.items", { count: val.length })}`);
        else if (val && typeof val === "object")
            lines.push(`${key}: ${t("thumb.items", { count: Object.keys(val).length })}`);
        else if (typeof val === "string")
            lines.push(`${key}: ${val.length > 48 ? `${val.slice(0, 48)}…` : val}`);
        else
            lines.push(`${key}: ${String(val)}`);
    }
    return lines.join("\n");
}

export function formatDuration(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
        return t("thumb.lengthUnknown");
    const rounded = seconds >= 10 ? String(Math.round(seconds)) : seconds.toFixed(1);
    return t("thumb.seconds", { n: rounded });
}

export function waveform() {
    const box = el("div", "wave");
    for (const height of [35, 70, 48, 90, 55, 78, 40, 66, 52, 84, 44, 60]) {
        const bar = document.createElement("i");
        bar.style.height = `${height}%`;
        box.append(bar);
    }
    return box;
}

export function videoMark() {
    const box = el("div", "video-mark");
    box.append(el("span", "video-icon", "▶"), elt("span", "video-label", "thumb.video"));
    return box;
}

export function thumbNote(key) {
    return elt("p", "thumb-text", key);
}

export function thumbText(text) {
    return text ? el("p", "thumb-text", text) : elt("p", "thumb-text", "thumb.empty");
}

export function scheduleThumb(node, load) {
    node._flowgitLoad = load;
    if (!thumbObserver) {
        load();
        return;
    }
    // Observe after the card is in the document, or a detached node never intersects.
    requestAnimationFrame(() => {
        if (!node.isConnected || !thumbObserver)
            return;
        observedThumbs.add(node);
        thumbObserver.observe(node);
    });
}

export function outputThumb(output, stage, index, options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb";
    const label = output.directory ? `${output.path}/` : output.path;
    button.setAttribute("aria-label", `${label} · ${t("thumb.open")}`);
    button.addEventListener("click", () => openOutput(output, stage, options));
    button.append(el("span", "thumb-name", label));
    const body = el("div", "thumb-body");
    button.append(body);
    const gen = S.thumbGen;
    scheduleThumb(button, () => {
        void fillThumb(body, output, stage, index, gen);
    });
    return button;
}

export async function fillThumb(body, output, stage, index, gen) {
    if (gen !== S.thumbGen || !body.isConnected)
        return;
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
    }
    catch {
        if (gen === S.thumbGen && body.isConnected)
            body.replaceChildren(thumbNote("thumb.noPreview"));
    }
}

export async function fillMediaThumb(body, stage, index, gen, kind) {
    const res = await getThumb(stage.id, index);
    if (gen !== S.thumbGen || !body.isConnected)
        return;
    if (kind === "audio") {
        let duration = null;
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (typeof data.duration === "number")
                duration = data.duration;
        }
        if (gen !== S.thumbGen || !body.isConnected)
            return;
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
    if (gen !== S.thumbGen || !body.isConnected)
        return;
    const url = URL.createObjectURL(blob);
    rememberThumbUrl(url);
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = url;
    body.replaceChildren(img);
}

export async function fillTextThumb(body, output, gen, json) {
    const res = await getFile(output.path);
    if (gen !== S.thumbGen || !body.isConnected)
        return;
    if (!res.ok) {
        body.replaceChildren(thumbNote("thumb.notYet"));
        return;
    }
    const text = await res.text();
    if (gen !== S.thumbGen || !body.isConnected)
        return;
    body.replaceChildren(thumbText(json ? summarizeJson(text) : stripMarkdown(text)));
}

export async function fillDirThumb(body, output, gen) {
    const rel = String(output.path || "").replace(/\/+$/, "");
    const res = await getFile(rel);
    if (gen !== S.thumbGen || !body.isConnected)
        return;
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
            const fileRes = await getFile(`${rel}/${name}`);
            if (gen !== S.thumbGen || !body.isConnected)
                return;
            if (!fileRes.ok)
                continue;
            const blob = await fileRes.blob();
            if (gen !== S.thumbGen || !body.isConnected)
                return;
            const url = URL.createObjectURL(blob);
            rememberThumbUrl(url);
            img.src = url;
        }
    }
    else if (gen === S.thumbGen && body.isConnected) {
        body.replaceChildren();
    }
    if (gen !== S.thumbGen || !body.isConnected)
        return;
    const n = files.length;
    setThumbCaption(body, t("thumb.files", { count: n }));
}

export function setThumbCaption(body, text) {
    const parent = body.parentElement;
    if (!parent)
        return;
    let caption = parent.querySelector(":scope > .thumb-count");
    if (!caption) {
        caption = el("p", "thumb-count", "");
        parent.append(caption);
    }
    caption.textContent = text;
}

export function foldedInstructions(text) {
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
        if (!p.isConnected)
            return;
        more.hidden = !(p.scrollHeight > p.clientHeight + 1);
    });
    return wrap;
}

export function modelField(stageId) {
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

export function fieldValue(stageId, root) {
    if (!root)
        return undefined;
    for (const input of root.querySelectorAll("input[data-model-for]")) {
        if (input.getAttribute("data-model-for") !== stageId)
            continue;
        return input.value.trim() || undefined;
    }
    return undefined;
}

export function panelHasModel(stageId) {
    for (const input of panelEl.querySelectorAll("input[data-model-for]")) {
        if (input.getAttribute("data-model-for") === stageId)
            return true;
    }
    return false;
}

export function closePanel() {
    S.panelMode = "";
    S.returnToStage = null;
    // The panel shrinks back into where it was opened from; the media URL is freed once it is gone.
    panelPortal.close(() => {
        document.body.classList.remove("panel-open");
        releaseBlob();
    });
}

export function makeBack(options) {
    if (!options || typeof options.onBack !== "function")
        return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "back";
    I18N.text(button, options.backLabel || "panel.back");
    button.addEventListener("click", () => options.onBack());
    return button;
}

export function showPanel(nodes, options) {
    panelBody.replaceChildren();
    const back = makeBack(options);
    if (back)
        panelBody.append(back);
    for (const node of nodes)
        panelBody.append(node);
}

export function historyOptions(stage) {
    return {
        readOnly: true,
        onBack: () => {
            void openHistory(stage);
        },
        backLabel: "panel.backToHistory",
    };
}

const viewers = new Map();

/**
 * Show an output type with `viewer` instead of the built-in preview.
 * `viewer` receives `{ output, stage, options, response, rel, readOnly }`.
 * New viewers live in `viewers/` and are registered below, after `viewers` exists.
 */
export function registerViewer(outputType, viewer) {
    viewers.set(outputType, viewer);
}

registerViewer("flowgit/timeline+json", openTimeline);
registerViewer("flowgit/storyboard+json", openStoryboard);

export function releaseBlob() {
    if (!S.currentBlob)
        return;
    URL.revokeObjectURL(S.currentBlob);
    S.currentBlob = null;
}

export async function openOutput(output, stage, options) {
    S.panelMode = "other";
    const rel = output.path;
    const readOnly = Boolean(options && options.readOnly);
    revealPanel();
    I18N.raw(panelTitle, (options && options.title) || rel);
    panelBody.replaceChildren(elt("p", null, "panel.loading"));
    if (S.currentBlob) {
        URL.revokeObjectURL(S.currentBlob);
        S.currentBlob = null;
    }
    let res;
    try {
        res = await getFile(rel);
    }
    catch {
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
    if (output.type && viewers.has(output.type)) {
        await viewers.get(output.type)({ output, stage, options, response: res, rel, readOnly });
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
        S.currentBlob = URL.createObjectURL(blob);
        const media = document.createElement(type.startsWith("video/") ? "video" : "img");
        if (media.tagName === "VIDEO")
            media.controls = true;
        else
            media.alt = rel;
        media.src = S.currentBlob;
        showPanel([media], options);
        return;
    }
    const text = await res.text();
    const pre = document.createElement("pre");
    if (type.includes("json") || rel.toLowerCase().endsWith(".json")) {
        try {
            pre.textContent = JSON.stringify(JSON.parse(text), null, 2);
        }
        catch {
            pre.textContent = text;
        }
    }
    else {
        pre.textContent = text;
    }
    showPanel([pre], options);
}

export function renderEditor(rel, text, options) {
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
    if (back)
        panelBody.append(back);
    panelBody.append(wrap);
    area.focus();
}

export async function saveText(rel, text, button, status) {
    button.disabled = true;
    status.hidden = true;
    try {
        const res = await saveFile(rel, text);
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
    }
    catch {
        status.hidden = false;
        status.className = "panel-error";
        I18N.text(status, "file.notSaved");
    }
    finally {
        button.disabled = false;
    }
}

export function renderFileList(dir, files, stage, options) {
    panelBody.replaceChildren();
    const back = makeBack(options);
    if (back)
        panelBody.append(back);
    if (stage && stage.executor === "human" && stage.instructions) {
        panelBody.append(elr("p", "instructions", stage.instructions));
    }
    // Keep the way back (e.g. to the stage panel opened from the graph) after an upload from this list.
    if (stage && stage.executor === "human")
        panelBody.append(uploadControl(stage, dir, options));
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

export function uploadControl(stage, dir, options) {
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
        if (file)
            void uploadInto(stage, dir, file, status, options);
    });
    label.append(input);
    form.append(label, status);
    return form;
}

export async function uploadInto(stage, dir, file, status, options) {
    if (status) {
        status.hidden = false;
        status.className = "upload-status";
        I18N.text(status, "file.uploading");
    }
    try {
        const res = await uploadFile(stage.id, file.name, file);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (status)
                setError(status, data.error, "file.notUploaded", res.status);
            return;
        }
        await refresh();
        await openOutput({ path: dir, directory: true, text: false, type: "dir" }, stage, options);
    }
    catch {
        if (status)
            I18N.text(status, "file.notUploaded");
    }
}
