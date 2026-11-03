/**
 * Shot cards for flowgit/storyboard+json.
 * A shot's picture lives in the assets/ directory output. /api/thumb addresses a
 * stage output (an image output is that file; a directory is not one frame), so
 * the card loads the asset through the file route, the same way a folder card does.
 */
import { getFile } from "../api.js";
import { showPanel } from "../panel.js";
import { el, elt } from "../state.js";

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);
const urls = new Set();

function extOf(name) {
    const base = String(name || "").split("/").pop() || "";
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function findAsset(shot, files) {
    if (shot.asset && files.includes(shot.asset))
        return shot.asset;
    const base = String(shot.asset || shot.id || "").replace(/\.[^.]+$/, "").toLowerCase();
    if (!base)
        return "";
    return files.find((file) => file.replace(/\.[^.]+$/, "").toLowerCase() === base) || "";
}

export async function openStoryboard({ options, response }) {
    for (const url of urls)
        URL.revokeObjectURL(url);
    urls.clear();
    let data;
    try {
        data = JSON.parse(await response.text());
    }
    catch {
        showPanel([elt("p", "panel-error", "file.openError")], options);
        return;
    }
    const shots = Array.isArray(data?.shots) ? data.shots : [];
    let files = [];
    try {
        const listed = await getFile("assets");
        if (listed.ok && listed.headers.get("X-Flowgit-Kind") === "directory") {
            const body = await listed.json();
            files = Array.isArray(body.files) ? body.files : [];
        }
    }
    catch {
        files = [];
    }
    const root = el("div", "storyboard");
    if (data?.title)
        root.append(el("h3", "storyboard-title", data.title));
    if (!shots.length) {
        root.append(elt("p", null, "storyboard.empty"));
        showPanel([root], options);
        return;
    }
    const grid = el("div", "shot-grid");
    root.append(grid);
    for (const shot of shots) {
        const file = findAsset(shot, files);
        const card = el("article", "shot-card");
        card.dataset.uploaded = file ? "yes" : "no";
        card.dataset.id = shot.id || "";
        const thumb = el("div", "shot-thumb");
        const body = el("div", "shot-body");
        const line = shot.narration || shot.caption || "";
        body.append(el("p", "shot-id", shot.id || ""));
        body.append(elt("p", "shot-k", "storyboard.line"));
        body.append(el("p", "shot-line", line));
        body.append(elt("p", "shot-k", "storyboard.duration"));
        body.append(elt("p", "shot-dur", "thumb.seconds", { n: String(shot.duration ?? "") }));
        body.append(elt("p", "shot-k", "storyboard.asset"));
        body.append(el("p", "shot-asset", file || shot.asset || ""));
        body.append(elt("p", file ? "shot-flag is-yes" : "shot-flag", file ? "storyboard.uploaded" : "storyboard.missing"));
        card.append(thumb, body);
        grid.append(card);
        void paintThumb(thumb, file);
    }
    showPanel([root], options);
}

async function paintThumb(node, file) {
    if (!file) {
        node.append(elt("span", "shot-fallback", "storyboard.missing"));
        return;
    }
    const res = await getFile(`assets/${file}`);
    if (!node.isConnected)
        return;
    if (!res.ok) {
        node.append(elt("span", "shot-fallback", "storyboard.missing"));
        return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (!node.isConnected) {
        URL.revokeObjectURL(url);
        return;
    }
    urls.add(url);
    const ext = extOf(file);
    if (VIDEO.has(ext)) {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = url;
        video.addEventListener("loadeddata", () => {
            if (video.duration > 1)
                video.currentTime = 1;
        }, { once: true });
        node.append(video);
        return;
    }
    if (IMAGE.has(ext)) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = url;
        node.append(img);
        return;
    }
    node.append(el("span", "shot-fallback", file));
}
