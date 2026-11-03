/**
 * Timeline viewer for flowgit/timeline+json.
 * Caption metrics come from scripts/caption-style.json: the edit stage copies
 * that file onto the timeline, and this preview draws from that copy (or from
 * the file itself when the file route can read it). render.mjs reads the file
 * when it exports, so the position, size and box match.
 */
import { getFile, saveFile } from "../api.js";
import { showPanel } from "../panel.js";
import { refreshNow, startRun } from "../run.js";
import { I18N } from "../i18n.js";
import { S, el, elt, t } from "../state.js";

const MAX_UNDO = 50;
const LABEL = 76;
const MIN_DURATION = 0.5;
const FONT = '"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);

/** Same numbers as the short-video template's scripts/caption-style.json. */
const FALLBACK_STYLE = {
    caption: {
        fontSizeRatio: 18,
        color: "#ffffff",
        box: { color: "#000000", alpha: 0.45, borderRatio: 45 },
        lineSpacing: 12,
        y: 0.76,
        wrap: { perLine: 12, maxLines: 3, englishFactor: 2 },
    },
    title: {
        fontSizeRatio: 13,
        color: "#ffffff",
        box: { color: "#000000", alpha: 0.5, borderRatio: 36 },
        lineSpacingRatio: 60,
        y: 0.12,
        wrap: { perLine: 10, maxLines: 2, englishFactor: 2 },
        hold: 2.2,
        fade: 0.6,
    },
    card: {
        fontSizeRatio: 16,
        color: "#ffffff",
        shadow: { color: "#000000", alpha: 0.35, x: 3, y: 3 },
        lineSpacingRatio: 40,
        y: "middle",
        wrap: { perLine: 11, maxLines: 7, englishFactor: 2 },
    },
};

const blobUrls = new Map();

function clearBlobs() {
    for (const url of blobUrls.values())
        URL.revokeObjectURL(url);
    blobUrls.clear();
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}

function extOf(name) {
    const base = String(name || "").split("/").pop() || "";
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function kindOf(name) {
    const ext = extOf(name);
    if (IMAGE.has(ext))
        return "image";
    if (VIDEO.has(ext))
        return "video";
    return "";
}

function baseName(filePath) {
    return String(filePath || "").split("/").pop() || "";
}

function cssEscape(value) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : String(value).replace(/"/g, "");
}

/** Same wrap as scripts/render.mjs so a caption breaks in the same places. */
function wrapCaption(text, perLine = 12, maxLines = 3, englishFactor = 2) {
    const clean = String(text || "").trim();
    if (!clean)
        return "";
    if (/\s/.test(clean) && !/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(clean)) {
        const max = perLine * englishFactor;
        const lines = [];
        let line = "";
        for (const word of clean.split(/\s+/)) {
            if (line && (line + " " + word).length > max) {
                lines.push(line);
                line = word;
            }
            else {
                line = line ? `${line} ${word}` : word;
            }
        }
        if (line)
            lines.push(line);
        return lines.slice(0, maxLines).join("\n");
    }
    const chars = [...clean];
    if (chars.length <= perLine)
        return chars.join("");
    const count = Math.min(maxLines, Math.ceil(chars.length / perLine));
    const size = Math.ceil(chars.length / count);
    const out = [];
    for (let i = 0; i < chars.length && out.length < maxLines; i += size)
        out.push(chars.slice(i, i + size).join(""));
    return out.join("\n");
}

function rgba(hex, alpha) {
    const raw = String(hex || "#000000").replace("#", "");
    const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw.padEnd(6, "0").slice(0, 6);
    const n = Number.parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const a = Math.min(1, Math.max(0, Number(alpha) || 0));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function formatClock(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safe / 60);
    const rest = (safe - mins * 60).toFixed(1).padStart(4, "0");
    return `${mins}:${rest}`;
}

function isField(target) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select"));
}

function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function openTimeline({ output, stage, options, response, rel, readOnly }) {
    clearBlobs();
    let doc;
    try {
        doc = JSON.parse(await response.text());
    }
    catch {
        showPanel([elt("p", "panel-error", "timeline.bad")], options);
        return;
    }
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.clips)) {
        showPanel([elt("p", "panel-error", "timeline.bad")], options);
        return;
    }
    let style = doc.captionStyle && typeof doc.captionStyle === "object" ? doc.captionStyle : FALLBACK_STYLE;
    try {
        const styleRes = await getFile("scripts/caption-style.json");
        if (styleRes.ok) {
            const parsed = await styleRes.json();
            if (parsed && typeof parsed === "object")
                style = parsed;
        }
    }
    catch {
        // The file route only serves stage outputs. The edit stage's copy on the timeline is the preview's source.
    }

    const root = el("div", "timeline");
    root.tabIndex = 0;
    let past = [];
    let future = [];
    let saved = JSON.stringify(doc);
    let playhead = 0;
    let playing = false;
    let playToken = 0;
    let frameToken = 0;
    let pxPerSec = 48;
    let selectedId = doc.clips[0]?.id || "";
    let voiceDuration = null;
    let interacting = false;
    let shownKey = "";

    const reexport = document.createElement("button");
    reexport.type = "button";
    reexport.className = "tl-reexport";
    I18N.text(reexport, "timeline.reexport");
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "tl-undo";
    I18N.text(undoBtn, "timeline.undo");
    const redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.className = "tl-redo";
    I18N.text(redoBtn, "timeline.redo");
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "tl-play";
    I18N.text(playBtn, "timeline.play");
    const snapBtn = document.createElement("button");
    snapBtn.type = "button";
    snapBtn.className = "tl-snap";
    I18N.text(snapBtn, "timeline.snap");
    const zoomLabel = elt("label", "tl-zoom-label", "timeline.zoom");
    const zoom = document.createElement("input");
    zoom.type = "range";
    zoom.className = "tl-zoom";
    zoom.min = "20";
    zoom.max = "220";
    zoom.step = "1";
    I18N.attr(zoom, "aria-label", "timeline.zoom");
    zoomLabel.append(zoom);
    const timeEl = el("span", "tl-time", formatClock(0));
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save";
    I18N.text(saveBtn, "file.save");
    const status = el("p", "save-status");
    status.hidden = true;
    const exportNote = elt("p", "tl-export-note", "timeline.exportStale");
    exportNote.hidden = true;
    const toolbar = el("div", "tl-top");
    toolbar.append(reexport, undoBtn, redoBtn, playBtn, snapBtn, zoomLabel, timeEl, saveBtn);

    const stageBox = el("div", "tl-stage");
    const frame = el("div", "tl-frame");
    const fill = el("div", "tl-fill");
    const still = document.createElement("img");
    still.className = "tl-still";
    still.alt = "";
    const motion = document.createElement("video");
    motion.className = "tl-motion";
    motion.muted = true;
    motion.playsInline = true;
    motion.preload = "auto";
    const canvas = document.createElement("canvas");
    canvas.className = "tl-canvas";
    frame.append(fill, still, motion, canvas);
    stageBox.append(frame);

    const scroll = el("div", "tl-scroll");
    const sheet = el("div", "tl-sheet");
    const rulerRow = el("div", "tl-row tl-ruler-row");
    const rulerName = el("div", "tl-name", "");
    const ruler = el("div", "tl-ruler");
    rulerRow.append(rulerName, ruler);
    const playheadEl = el("div", "tl-playhead");
    const knob = document.createElement("button");
    knob.type = "button";
    knob.className = "tl-knob";
    I18N.attr(knob, "aria-label", "timeline.playhead");
    playheadEl.append(knob);
    sheet.append(rulerRow, playheadEl);
    scroll.append(sheet);

    const hint = elt("p", "tl-hint", "timeline.hint");
    const picker = el("div", "tl-picker");
    picker.hidden = true;
    const voiceEl = document.createElement("audio");
    const musicEl = document.createElement("audio");
    voiceEl.preload = "auto";
    musicEl.preload = "auto";
    root.append(toolbar, exportNote, status, stageBox, scroll, hint, picker, voiceEl, musicEl);
    showPanel([root], options);

    function snap() {
        return JSON.stringify(doc);
    }

    function reflow() {
        let cursor = 0;
        for (const clip of doc.clips) {
            clip.duration = round3(Math.max(MIN_DURATION, Number(clip.duration) || MIN_DURATION));
            clip.start = round3(cursor);
            cursor += clip.duration;
        }
        doc.duration = round3(cursor);
    }

    function change(fn) {
        const before = snap();
        fn();
        if (snap() === before)
            return;
        past.push(before);
        if (past.length > MAX_UNDO)
            past.shift();
        future = [];
        layout();
        void renderFrame();
        syncChrome();
    }

    function undo() {
        if (readOnly || !past.length)
            return;
        future.push(snap());
        doc = JSON.parse(past.pop());
        layout();
        void renderFrame();
        syncChrome();
    }

    function redo() {
        if (readOnly || !future.length)
            return;
        past.push(snap());
        doc = JSON.parse(future.pop());
        layout();
        void renderFrame();
        syncChrome();
    }

    function exportId() {
        const stages = S.boardStages || [];
        const index = stages.findIndex((item) => item.id === stage?.id);
        const rest = index >= 0 ? stages.slice(index + 1) : [];
        const video = rest.find((item) => (item.outputs || []).some((itemOut) => String(itemOut.type || "").startsWith("video/")));
        return video?.id || "";
    }

    function syncChrome() {
        undoBtn.disabled = Boolean(readOnly) || past.length === 0;
        redoBtn.disabled = Boolean(readOnly) || future.length === 0;
        saveBtn.disabled = Boolean(readOnly) || snap() === saved;
        snapBtn.disabled = Boolean(readOnly) || !voiceDuration;
        I18N.attr(snapBtn, "title", voiceDuration ? "timeline.snap" : "timeline.noVoice");
        I18N.text(playBtn, playing ? "timeline.pause" : "timeline.play");
        playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
        reexport.hidden = Boolean(readOnly) || !exportId();
        const exp = (S.boardStages || []).find((item) => item.id === exportId());
        exportNote.hidden = !exp || exp.state !== "stale";
        zoom.value = String(Math.round(pxPerSec));
    }

    function ruleOf(name) {
        const rule = style[name];
        return rule && typeof rule === "object" ? rule : FALLBACK_STYLE[name];
    }

    function drawBlock(ctx, text, rule, frameW, frameH, videoW, alpha) {
        const wrap = rule.wrap || {};
        const lines = wrapCaption(text, Number(wrap.perLine) || 12, Number(wrap.maxLines) || 3, Number(wrap.englishFactor) || 2)
            .split("\n")
            .filter(Boolean);
        if (!lines.length)
            return;
        const fontSize = Math.max(8, Math.round(frameW / (Number(rule.fontSizeRatio) || 18)));
        const scale = videoW > 0 ? frameW / videoW : 1;
        const gap = rule.lineSpacing != null && Number.isFinite(Number(rule.lineSpacing))
            ? Number(rule.lineSpacing) * scale
            : frameW / (Number(rule.lineSpacingRatio) || 40);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `600 ${fontSize}px ${FONT}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        const textW = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
        const textH = lines.length * fontSize + Math.max(0, lines.length - 1) * gap;
        const y = rule.y === "middle" ? (frameH - textH) / 2 : frameH * (Number(rule.y) || 0.76);
        const x = frameW / 2;
        if (rule.box) {
            const border = frameW / (Number(rule.box.borderRatio) || 45);
            ctx.fillStyle = rgba(rule.box.color || "#000000", Number(rule.box.alpha ?? 1));
            ctx.fillRect(x - textW / 2 - border, y - border, textW + border * 2, textH + border * 2);
        }
        if (rule.shadow) {
            ctx.shadowColor = rgba(rule.shadow.color || "#000000", Number(rule.shadow.alpha ?? 0.35));
            ctx.shadowOffsetX = (Number(rule.shadow.x) || 0) * scale;
            ctx.shadowOffsetY = (Number(rule.shadow.y) || 0) * scale;
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = rule.color || "#ffffff";
        lines.forEach((line, index) => {
            ctx.fillText(line, x, y + index * (fontSize + gap));
        });
        ctx.restore();
    }

    function drawCanvas(clip, local) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx || rect.width < 2)
            return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        const videoW = Number(doc.width) || rect.width;
        const source = clip.source || {};
        if ((source.kind === "card" || !source.path) && clip.narration)
            drawBlock(ctx, clip.narration, ruleOf("card"), rect.width, rect.height, videoW, 1);
        if (clip === doc.clips[0] && doc.title) {
            const title = ruleOf("title");
            const hold = Number(title.hold ?? 2.2);
            const fade = Number(title.fade ?? 0.6);
            const until = hold + fade;
            const alpha = local >= until ? 0 : local < hold ? 1 : Math.max(0, (until - local) / fade);
            if (alpha > 0)
                drawBlock(ctx, doc.title, title, rect.width, rect.height, videoW, alpha);
        }
        if (clip.caption)
            drawBlock(ctx, clip.caption, ruleOf("caption"), rect.width, rect.height, videoW, 1);
    }

    async function mediaUrl(filePath) {
        if (blobUrls.has(filePath))
            return blobUrls.get(filePath);
        const res = await getFile(filePath);
        if (!res.ok)
            return "";
        const url = URL.createObjectURL(await res.blob());
        blobUrls.set(filePath, url);
        return url;
    }

    function clipAt(time) {
        return doc.clips.find((clip) => time >= clip.start && time < clip.start + clip.duration) || doc.clips[doc.clips.length - 1];
    }

    function syncVideo(clip, force) {
        if (motion.hidden || !motion.getAttribute("src"))
            return;
        const local = Math.max(0, playhead - clip.start);
        if (force || !Number.isFinite(motion.currentTime) || Math.abs(motion.currentTime - local) > 0.3) {
            try {
                motion.currentTime = local;
            }
            catch {
                // metadata not in yet
            }
        }
        if (playing) {
            if (motion.paused)
                void motion.play().catch(() => { });
        }
        else {
            motion.pause();
        }
    }

    function syncTrack(audio, offset, loop, volume) {
        if (!audio.getAttribute("src"))
            return;
        audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
        const dur = audio.duration;
        let next = offset;
        if (loop && Number.isFinite(dur) && dur > 0)
            next = offset % dur;
        else if (Number.isFinite(dur) && dur > 0)
            next = Math.min(offset, Math.max(0, dur - 0.05));
        if (playing) {
            if (audio.paused)
                void audio.play().catch(() => { });
            if (Number.isFinite(audio.currentTime) && Math.abs(audio.currentTime - next) > 0.35)
                audio.currentTime = next;
        }
        else {
            audio.pause();
            if (Number.isFinite(audio.currentTime) && Math.abs(audio.currentTime - next) > 0.05) {
                try {
                    audio.currentTime = next;
                }
                catch {
                    // not seekable yet
                }
            }
        }
    }

    async function showClip(clip) {
        const source = clip.source || { kind: "card" };
        const key = `${source.kind}:${source.path || ""}`;
        const local = Math.max(0, playhead - clip.start);
        let changed = false;
        if (key !== shownKey) {
            changed = true;
            shownKey = key;
            const image = source.kind === "image" && source.path;
            const video = source.kind === "video" && source.path;
            still.hidden = !image;
            motion.hidden = !video;
            fill.hidden = false;
            frame.classList.toggle("is-card", !image && !video);
            still.classList.remove("is-zoom-in", "is-zoom-out");
            if (image) {
                const url = await mediaUrl(source.path);
                if (shownKey !== key)
                    return;
                still.src = url;
                fill.style.backgroundImage = url ? `url("${url}")` : "";
                if (!reducedMotion() && (clip.motion || "zoom") !== "none") {
                    const motionName = clip.motion || (doc.clips.indexOf(clip) % 2 === 0 ? "zoom-in" : "zoom-out");
                    if (motionName === "zoom-in" || motionName === "zoom-out")
                        still.classList.add(motionName === "zoom-in" ? "is-zoom-in" : "is-zoom-out");
                }
            }
            else if (video) {
                const url = await mediaUrl(source.path);
                if (shownKey !== key)
                    return;
                fill.style.backgroundImage = "";
                if (motion.dataset.src !== url) {
                    motion.dataset.src = url;
                    motion.src = url;
                    await new Promise((resolve) => {
                        motion.addEventListener("loadeddata", resolve, { once: true });
                        motion.addEventListener("error", resolve, { once: true });
                    });
                }
                if (shownKey !== key)
                    return;
            }
            else {
                fill.style.backgroundImage = "";
                still.removeAttribute("src");
                motion.removeAttribute("src");
                motion.dataset.src = "";
            }
        }
        syncVideo(clip, changed);
        drawCanvas(clip, local);
    }

    async function renderFrame() {
        const token = ++frameToken;
        const clip = clipAt(playhead);
        if (!clip)
            return;
        await showClip(clip);
        if (token !== frameToken || !root.isConnected)
            return;
        syncTrack(voiceEl, playhead, false, Number(doc.voice?.volume ?? 1));
        syncTrack(musicEl, playhead, true, Number(doc.music?.volume ?? 0.6));
        placePlayhead();
    }

    function placePlayhead() {
        playheadEl.style.left = `${LABEL + playhead * pxPerSec}px`;
        timeEl.textContent = `${formatClock(playhead)} / ${formatClock(doc.duration || 0)}`;
    }

    function stopPlay() {
        playing = false;
        playToken += 1;
        motion.pause();
        voiceEl.pause();
        musicEl.pause();
        syncChrome();
    }

    function startPlay() {
        if (!doc.clips.length)
            return;
        if (playhead >= (doc.duration || 0) - 0.02)
            playhead = 0;
        playing = true;
        const token = ++playToken;
        let last = performance.now();
        syncChrome();
        const step = (now) => {
            if (!playing || token !== playToken || !root.isConnected)
                return;
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            playhead = Math.min(doc.duration || 0, playhead + dt);
            placePlayhead();
            void renderFrame();
            if (playhead >= (doc.duration || 0)) {
                stopPlay();
                return;
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function seek(time) {
        playhead = Math.max(0, Math.min(doc.duration || 0, time));
        placePlayhead();
        void renderFrame();
    }

    function timeAt(clientX) {
        const box = ruler.getBoundingClientRect();
        return Math.max(0, Math.min(doc.duration || 0, (clientX - box.left) / pxPerSec));
    }

    function focusClip(id) {
        const node = root.querySelector(`.tl-clip[data-id="${cssEscape(id)}"]`);
        if (node)
            node.focus();
    }

    function laneWidth() {
        return Math.max(160, (doc.duration || 1) * pxPerSec + 28);
    }

    function addRow(track, key) {
        const rowEl = el("div", "tl-row");
        rowEl.dataset.track = track;
        const name = elt("div", "tl-name", key);
        const lane = el("div", "tl-lane");
        lane.dataset.track = track;
        rowEl.append(name, lane);
        sheet.insertBefore(rowEl, playheadEl);
        return lane;
    }

    function layout() {
        if (interacting)
            return;
        frame.style.aspectRatio = `${doc.width || 9} / ${doc.height || 16}`;
        const width = laneWidth();
        sheet.style.width = `${LABEL + width}px`;
        ruler.style.width = `${width}px`;
        ruler.replaceChildren();
        const step = pxPerSec >= 90 ? 0.5 : pxPerSec >= 36 ? 1 : 5;
        for (let i = 0; i <= Math.ceil((doc.duration || 0) / step); i += 1) {
            const time = round3(i * step);
            if (time > (doc.duration || 0) + 0.001)
                break;
            const tick = document.createElement("i");
            tick.className = "tl-tick";
            tick.style.left = `${time * pxPerSec}px`;
            if (step >= 1 || Math.abs(time - Math.round(time)) < 0.001) {
                const label = document.createElement("span");
                label.textContent = String(Math.round(time));
                tick.append(label);
            }
            ruler.append(tick);
        }
        for (const rowEl of sheet.querySelectorAll(".tl-row:not(.tl-ruler-row)"))
            rowEl.remove();
        const picture = addRow("picture", "timeline.picture");
        const captions = addRow("caption", "timeline.caption");
        picture.style.width = `${width}px`;
        captions.style.width = `${width}px`;
        if (!doc.clips.length)
            picture.append(elt("p", "tl-empty", "timeline.empty"));
        for (const clip of doc.clips) {
            const node = el("div", "tl-clip");
            node.tabIndex = 0;
            node.dataset.id = clip.id;
            node.dataset.duration = String(clip.duration);
            node.style.left = `${clip.start * pxPerSec}px`;
            node.style.width = `${Math.max(20, clip.duration * pxPerSec)}px`;
            node.setAttribute("aria-selected", clip.id === selectedId ? "true" : "false");
            node.setAttribute("aria-label", `${clip.id} ${clip.duration}`);
            if (clip.id === selectedId)
                node.classList.add("is-selected");
            const left = el("span", "tl-edge tl-edge-left");
            left.dataset.edge = "left";
            const right = el("span", "tl-edge tl-edge-right");
            right.dataset.edge = "right";
            const source = clip.source || {};
            const kind = source.kind === "card" || !source.path ? t("timeline.card") : baseName(source.path);
            node.append(left, el("span", "tl-clip-label", clip.id), el("span", "tl-clip-kind", kind), right);
            picture.append(node);
            const cap = el("div", "tl-cap", clip.caption || "—");
            cap.dataset.id = clip.id;
            cap.dataset.caption = clip.caption || "";
            cap.style.left = `${clip.start * pxPerSec}px`;
            cap.style.width = `${Math.max(20, clip.duration * pxPerSec)}px`;
            captions.append(cap);
        }
        if (doc.voice?.path) {
            const lane = addRow("voice", "timeline.voice");
            lane.style.width = `${width}px`;
            const span = Math.min(voiceDuration || doc.duration || 0, doc.duration || 0);
            const bar = el("div", "tl-audio", baseName(doc.voice.path));
            bar.style.width = `${Math.max(20, span * pxPerSec)}px`;
            lane.append(bar);
        }
        if (doc.music?.path) {
            const lane = addRow("music", "timeline.music");
            lane.style.width = `${width}px`;
            const bar = el("div", "tl-audio", baseName(doc.music.path));
            bar.style.width = `${Math.max(20, (doc.duration || 0) * pxPerSec)}px`;
            lane.append(bar);
        }
        placePlayhead();
    }

    function fitZoom() {
        const usable = Math.max(180, (scroll.clientWidth || 520) - LABEL - 16);
        const dur = Math.max(Number(doc.duration) || 1, 1);
        pxPerSec = Math.min(160, Math.max(28, usable / dur));
    }

    function snapDuration(start, duration) {
        if (!voiceDuration)
            return duration;
        const slack = Math.max(0.12, 10 / pxPerSec);
        if (Math.abs(start + duration - voiceDuration) <= slack)
            return Math.max(MIN_DURATION, voiceDuration - start);
        return duration;
    }

    function slots() {
        return [...root.querySelectorAll(".tl-clip")].map((node) => {
            const box = node.getBoundingClientRect();
            return { id: node.dataset.id, mid: box.left + box.width / 2 };
        });
    }

    function listen(move, up) {
        const end = (event) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            up(event);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }

    function scrubFrom(event) {
        stopPlay();
        seek(timeAt(event.clientX));
        const move = (ev) => seek(timeAt(ev.clientX));
        listen(move, () => { });
    }

    function trimFrom(event, id, edge) {
        const clip = doc.clips.find((item) => item.id === id);
        if (!clip)
            return;
        interacting = true;
        const originX = event.clientX;
        const startDur = clip.duration;
        const startAt = clip.start;
        const index = doc.clips.indexOf(clip);
        const node = root.querySelector(`.tl-clip[data-id="${cssEscape(id)}"]`);
        const move = (ev) => {
            const dx = (ev.clientX - originX) / pxPerSec;
            let duration = edge === "right" ? startDur + dx : startDur - dx;
            duration = Math.max(MIN_DURATION, duration);
            if (edge === "right")
                duration = snapDuration(startAt, duration);
            duration = round3(duration);
            if (node) {
                node.style.width = `${Math.max(20, duration * pxPerSec)}px`;
                node.dataset.duration = String(duration);
            }
        };
        listen(move, (ev) => {
            interacting = false;
            const dx = (ev.clientX - originX) / pxPerSec;
            let duration = edge === "right" ? startDur + dx : startDur - dx;
            duration = Math.max(MIN_DURATION, duration);
            if (edge === "right")
                duration = snapDuration(startAt, duration);
            duration = round3(duration);
            if (Math.abs(duration - startDur) < 0.001) {
                layout();
                return;
            }
            change(() => {
                if (edge === "right" || index === 0) {
                    clip.duration = duration;
                }
                else {
                    const prev = doc.clips[index - 1];
                    const end = startAt + startDur;
                    const nextStart = round3(Math.min(end - MIN_DURATION, Math.max(prev.start + MIN_DURATION, startAt + (startDur - duration))));
                    prev.duration = round3(nextStart - prev.start);
                    clip.duration = round3(end - nextStart);
                }
                reflow();
            });
        });
    }

    function reorderFrom(event, id) {
        const frozen = slots();
        const originX = event.clientX;
        const originY = event.clientY;
        let moved = false;
        const node = root.querySelector(`.tl-clip[data-id="${cssEscape(id)}"]`);
        interacting = true;
        const move = (ev) => {
            if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < 6)
                return;
            moved = true;
            if (node) {
                node.classList.add("is-dragging");
                node.style.zIndex = "3";
                node.style.transform = `translateX(${ev.clientX - originX}px)`;
            }
        };
        listen(move, (ev) => {
            interacting = false;
            if (node) {
                node.classList.remove("is-dragging");
                node.style.transform = "";
                node.style.zIndex = "";
            }
            const others = frozen.filter((item) => item.id !== id);
            let dest = others.length;
            for (let i = 0; i < others.length; i += 1) {
                if (ev.clientX < others[i].mid) {
                    dest = i;
                    break;
                }
            }
            if (!moved) {
                void openPicker(id);
                return;
            }
            change(() => {
                const from = doc.clips.findIndex((item) => item.id === id);
                if (from < 0)
                    return;
                const [item] = doc.clips.splice(from, 1);
                doc.clips.splice(Math.max(0, Math.min(dest, doc.clips.length)), 0, item);
                reflow();
            });
            focusClip(id);
        });
    }

    async function openPicker(id) {
        if (readOnly)
            return;
        selectedId = id;
        layout();
        picker.hidden = false;
        picker.replaceChildren(elt("p", "tl-picker-title", "timeline.assets"));
        const list = el("div", "tl-picker-list");
        const close = document.createElement("button");
        close.type = "button";
        close.className = "ghost";
        I18N.text(close, "panel.close");
        close.addEventListener("click", () => {
            picker.hidden = true;
        });
        picker.append(list, close);
        let files = [];
        try {
            const res = await getFile("assets");
            if (res.ok && res.headers.get("X-Flowgit-Kind") === "directory") {
                const data = await res.json();
                files = Array.isArray(data.files) ? data.files : [];
            }
        }
        catch {
            files = [];
        }
        const media = files.filter((name) => kindOf(name));
        if (!media.length) {
            list.append(elt("p", "tl-picker-empty", "timeline.assetsEmpty"));
            return;
        }
        for (const name of files) {
            const kind = kindOf(name);
            if (!kind) {
                list.append(el("p", "tl-file-note", name));
                continue;
            }
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = name;
            button.addEventListener("click", () => {
                picker.hidden = true;
                change(() => {
                    const clip = doc.clips.find((item) => item.id === id);
                    if (!clip)
                        return;
                    clip.source = { kind, path: `assets/${name}` };
                });
                shownKey = "";
                void renderFrame();
            });
            list.append(button);
        }
    }

    function editCaption(cap) {
        if (readOnly)
            return;
        const id = cap.dataset.id;
        const clip = doc.clips.find((item) => item.id === id);
        if (!clip)
            return;
        const input = document.createElement("input");
        input.className = "tl-caption-input";
        input.value = clip.caption || "";
        I18N.attr(input, "aria-label", "timeline.caption");
        cap.replaceChildren(input);
        input.focus();
        input.select();
        let closed = false;
        const done = (commit) => {
            if (closed)
                return;
            closed = true;
            const value = input.value;
            if (commit && value !== (clip.caption || "")) {
                change(() => {
                    clip.caption = value;
                });
            }
            else {
                layout();
            }
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                done(true);
            }
            else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                done(false);
            }
        });
        input.addEventListener("blur", () => done(true));
    }

    root.addEventListener("pointerdown", (event) => {
        if (isField(event.target))
            return;
        if (event.target.closest(".tl-ruler, .tl-knob")) {
            event.preventDefault();
            scrubFrom(event);
            return;
        }
        const clip = event.target.closest?.(".tl-clip");
        if (!clip || readOnly)
            return;
        event.preventDefault();
        selectedId = clip.dataset.id || selectedId;
        const edge = event.target.closest(".tl-edge");
        if (edge)
            trimFrom(event, selectedId, edge.dataset.edge || "right");
        else
            reorderFrom(event, selectedId);
    });

    root.addEventListener("dblclick", (event) => {
        const cap = event.target.closest?.(".tl-cap");
        if (!cap)
            return;
        event.preventDefault();
        event.stopPropagation();
        editCaption(cap);
    });

    root.addEventListener("focusin", (event) => {
        const clip = event.target.closest?.(".tl-clip");
        if (!clip)
            return;
        selectedId = clip.dataset.id || selectedId;
        for (const node of root.querySelectorAll(".tl-clip"))
            node.setAttribute("aria-selected", node === clip ? "true" : "false");
    });

    root.addEventListener("keydown", (event) => {
        if (isField(event.target))
            return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey)
                redo();
            else
                undo();
            return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
            event.preventDefault();
            redo();
            return;
        }
        if (event.key === " ") {
            event.preventDefault();
            if (playing)
                stopPlay();
            else
                startPlay();
            return;
        }
        if (readOnly)
            return;
        const index = doc.clips.findIndex((clip) => clip.id === selectedId);
        const clip = doc.clips[index];
        if (!clip)
            return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const to = event.key === "ArrowLeft" ? index - 1 : index + 1;
            if (to < 0 || to >= doc.clips.length)
                return;
            change(() => {
                const [item] = doc.clips.splice(index, 1);
                doc.clips.splice(to, 0, item);
                reflow();
            });
            focusClip(clip.id);
            return;
        }
        if (event.key === "[" || event.key === "]") {
            event.preventDefault();
            const delta = event.key === "]" ? 0.1 : -0.1;
            change(() => {
                clip.duration = round3(Math.max(MIN_DURATION, clip.duration + delta));
                reflow();
            });
            focusClip(clip.id);
        }
    });

    root.addEventListener("wheel", (event) => {
        if (!event.target.closest?.(".tl-ruler"))
            return;
        event.preventDefault();
        pxPerSec = Math.max(20, Math.min(220, pxPerSec * (event.deltaY > 0 ? 0.9 : 1.1)));
        layout();
        syncChrome();
    }, { passive: false });

    zoom.addEventListener("input", () => {
        pxPerSec = Number(zoom.value) || pxPerSec;
        layout();
    });
    undoBtn.addEventListener("click", undo);
    redoBtn.addEventListener("click", redo);
    playBtn.addEventListener("click", () => {
        if (playing)
            stopPlay();
        else
            startPlay();
    });
    snapBtn.addEventListener("click", () => {
        if (!voiceDuration)
            return;
        const weights = doc.clips.map((clip) => [...String(clip.narration || "").replace(/\s+/g, "")].length);
        const useNarration = weights.length > 0 && weights.every((n) => n > 0);
        const shares = useNarration ? weights : doc.clips.map((clip) => clip.duration);
        const sum = shares.reduce((acc, n) => acc + n, 0) || 1;
        change(() => {
            let acc = 0;
            doc.clips.forEach((clip, index) => {
                const raw = (voiceDuration * shares[index]) / sum;
                const duration = index === doc.clips.length - 1 ? Math.max(MIN_DURATION, voiceDuration - acc) : Math.max(MIN_DURATION, raw);
                clip.duration = round3(duration);
                acc += clip.duration;
            });
            reflow();
        });
    });
    reexport.addEventListener("click", () => {
        const id = exportId();
        if (id)
            void startRun(id);
    });
    saveBtn.addEventListener("click", () => {
        void save();
    });

    async function save() {
        saveBtn.disabled = true;
        status.hidden = true;
        try {
            const text = `${JSON.stringify(doc, null, 2)}\n`;
            const res = await saveFile(rel || output?.path || "timeline.json", text);
            const data = await res.json().catch(() => ({}));
            status.hidden = false;
            if (!res.ok) {
                status.className = "panel-error";
                I18N.raw(status, data.error || t("file.notSaved"));
                return;
            }
            saved = snap();
            status.className = "save-ok";
            I18N.text(status, "file.saved");
            await refreshNow();
        }
        catch {
            status.hidden = false;
            status.className = "panel-error";
            I18N.text(status, "file.notSaved");
        }
        finally {
            syncChrome();
        }
    }

    async function measure(audio, filePath) {
        const url = await mediaUrl(filePath);
        if (!url)
            return null;
        audio.src = url;
        await new Promise((resolve) => {
            audio.addEventListener("loadedmetadata", resolve, { once: true });
            audio.addEventListener("error", resolve, { once: true });
        });
        return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
    }

    fitZoom();
    layout();
    syncChrome();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fitZoom();
    layout();
    if (doc.voice?.path)
        voiceDuration = await measure(voiceEl, doc.voice.path);
    if (doc.music?.path)
        await measure(musicEl, doc.music.path);
    layout();
    syncChrome();
    await renderFrame();
    root.dataset.ready = "1";
}
