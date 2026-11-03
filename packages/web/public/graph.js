/** Board graph. */
import { getGraph } from "./api.js";
import { paintBoard } from "./cards.js";
import { I18N } from "./i18n.js";
import { openStage } from "./panel.js";
import { GAP_X, GAP_Y, GRID_3D, NODE_H, NODE_W, PAD, RUNNING, S, STATES, SVG_NS, boardEl, clipLabel, el, elt, isRunning, labelText, paintPlanNode, stageUsageLine, stateLabel, storeGraphStyle, t, withStatus } from "./state.js";

export async function reloadGraph() {
    const ticket = ++S.graphTicket;
    try {
        const res = await getGraph();
        const data = await res.json().catch(() => ({}));
        if (ticket !== S.graphTicket)
            return;
        if (!res.ok) {
            S.graphPayload = null;
            S.graphError = data.error || withStatus("graph.error", res.status);
            return;
        }
        S.graphPayload = data;
        S.graphError = "";
    }
    catch {
        if (ticket !== S.graphTicket)
            return;
        S.graphPayload = null;
        S.graphError = ["graph.error"];
    }
}

export async function loadAndPaintGraph() {
    await reloadGraph();
    if (S.view !== "graph")
        return;
    paintBoard();
}

export function renderGraphView() {
    const wrap = el("div", "graph-view");
    if (S.graphError) {
        const node = el("p", "graph-empty");
        if (Array.isArray(S.graphError))
            I18N.text(node, ...S.graphError);
        else
            I18N.raw(node, S.graphError);
        wrap.append(node);
        return wrap;
    }
    if (!S.graphPayload) {
        wrap.append(elt("p", "graph-empty", "graph.loading"));
        return wrap;
    }
    const bar = el("div", "graph-bar");
    bar.append(renderLegend(), renderGraphStyleSwitch());
    wrap.append(bar, S.graphStyle === "flat" ? drawGraph(S.graphPayload) : drawGraph3d(S.graphPayload));
    return wrap;
}

export function renderGraphStyleSwitch() {
    const group = el("div", "view-switch graph-style");
    group.setAttribute("role", "group");
    I18N.attr(group, "aria-label", "graph.mode");
    for (const [value, key] of [["depth", "graph.depth"], ["flat", "graph.flat"]]) {
        const button = elt("button", null, key);
        button.type = "button";
        button.dataset.style = value;
        button.setAttribute("aria-pressed", S.graphStyle === value ? "true" : "false");
        button.addEventListener("click", () => {
            if (S.graphStyle === value)
                return;
            S.graphStyle = value;
            storeGraphStyle(value);
            paintBoard();
        });
        group.append(button);
    }
    return group;
}

export function renderLegend() {
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

export function stageForNode(node) {
    const found = S.boardStages.find((stage) => stage.id === node.id);
    if (found)
        return found;
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

export function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs || {})) {
        if (value != null)
            node.setAttribute(key, String(value));
    }
    return node;
}

/**
 * Where each stage sits and how each edge runs, in px: one column per layer, rows inside it.
 * An edge that skips layers runs along its own lane under the stages.
 */
export function graphLayout(nodes, edges, grid) {
    const { w, h, gx, gy, pad } = grid;
    let maxLayer = 0;
    let maxRow = 0;
    const pos = new Map();
    for (const node of nodes) {
        const layer = Number(node.layer) || 0;
        const row = Number(node.row) || 0;
        if (layer > maxLayer)
            maxLayer = layer;
        if (row > maxRow)
            maxRow = row;
        pos.set(node.id, { x: pad + layer * (w + gx), y: pad + row * (h + gy), layer });
    }
    const laneGap = 14;
    const bottom = pad + (maxRow + 1) * h + maxRow * gy + 12;
    const routes = [];
    let longLanes = 0;
    for (const edge of edges) {
        const from = pos.get(edge.from);
        const to = pos.get(edge.to);
        if (!from || !to)
            continue;
        const x1 = from.x + w;
        const y1 = from.y + h / 2;
        const x2 = to.x;
        const y2 = to.y + h / 2;
        let d;
        if (to.layer - from.layer > 1) {
            const yb = bottom + longLanes++ * laneGap;
            d = `M ${x1} ${y1} H ${x1 + 18} V ${yb} H ${x2 - 18} V ${y2} H ${x2}`;
        }
        else if (Math.abs(y1 - y2) < 0.5) {
            d = `M ${x1} ${y1} H ${x2}`;
        }
        else {
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
export function graphEdges(layout, className) {
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
        if (isRunning(route.to))
            path.setAttribute("data-running", "");
        svg.append(path);
    }
    return svg;
}

/** What a graph node says to a screen reader and in its tooltip. */
export function nodeLabels(node) {
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
export function wireNode(target, node) {
    const stage = stageForNode(node);
    const open = () => openStage(stage);
    target.addEventListener("click", open);
    target.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ")
            return;
        event.preventDefault();
        open();
    });
}

export function drawGraph(payload) {
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
        if (!place)
            continue;
        const labels = nodeLabels(node);
        const selected = node.id === S.selectedId;
        const g = svgEl("g", {
            class: selected ? "flow-node is-selected" : "flow-node",
            role: "button",
            tabindex: "0",
            "data-id": node.id,
            "data-state": node.state || "",
            "aria-pressed": selected ? "true" : "false",
            "aria-label": labels.aria,
        });
        if (isRunning(node.id))
            g.setAttribute("data-running", "");
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
export function drawGraph3d(payload) {
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
        if (ready && paths[i])
            paths[i].setAttribute("data-ready", "");
    });
    plane.append(floor, svg);
    for (const node of nodes) {
        const place = layout.pos.get(node.id);
        if (!place)
            continue;
        const labels = nodeLabels(node);
        const selected = node.id === S.selectedId;
        const block = el("div", selected ? "flow-node iso-node is-selected" : "flow-node iso-node");
        block.setAttribute("role", "button");
        block.tabIndex = 0;
        block.dataset.id = node.id;
        block.dataset.state = node.state || "";
        block.setAttribute("aria-pressed", selected ? "true" : "false");
        block.setAttribute("aria-label", labels.aria);
        block.title = labels.title;
        if (isRunning(node.id))
            block.setAttribute("data-running", "");
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
        for (const face of faces)
            face.setAttribute("aria-hidden", "true");
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
export function fitGraph3d(scroll, stage, plane, layout) {
    const avail = scroll.clientWidth || boardEl.clientWidth || 960;
    const scale = Math.max(0.5, Math.min(1, (avail - 24) / (layout.width * 1.04)));
    plane.style.setProperty("--s", scale.toFixed(3));
    stage.style.width = `${Math.max(avail, Math.round(layout.width * scale * 1.04 + 24))}px`;
    stage.style.height = `${Math.round(layout.height * scale * 0.8 + 150 * scale)}px`;
}

export function watchGraph3d(scroll, refit) {
    if (typeof ResizeObserver !== "function")
        return;
    if (S.graphResize)
        S.graphResize.disconnect();
    let width = 0;
    S.graphResize = new ResizeObserver(() => {
        if (!scroll.isConnected) {
            S.graphResize.disconnect();
            return;
        }
        if (scroll.clientWidth === width)
            return;
        width = scroll.clientWidth;
        refit();
    });
    S.graphResize.observe(scroll);
}

export function markSelected() {
    for (const node of boardEl.querySelectorAll(".flow-node")) {
        const on = node.getAttribute("data-id") === S.selectedId;
        node.classList.toggle("is-selected", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
    }
}
