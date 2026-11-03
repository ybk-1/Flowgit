/**
 * Graph editor. Requests go through api.js. Node positions stay in localStorage.
 */
import { getFile, getInputs, putFlow, putStage, saveFile } from "./api.js";
import { I18N } from "./i18n.js";
import { S, el, elt, isRunning, panelBody, panelEl, panelPortal, panelTitle, t } from "./state.js";

const BUSY = "正在运行，结束后再改阶段 / a run is in progress; change stages when it finishes";
const POS_PREFIX = "flowgit.board.nodePos";

/** One example model per built-in provider preset (`flowgit providers`). */
const MODELS = [
    ["claude-opus-5-5", "anthropic · claude-opus-5-5"],
    ["openai/gpt-4o-mini", "openai · gpt-4o-mini"],
    ["glm/glm-5.3", "glm · glm-5.3"],
    ["deepseek/deepseek-chat", "deepseek · deepseek-chat"],
    ["deepseek/deepseek-v4-pro", "deepseek · deepseek-v4-pro"],
    ["moonshot/moonshot-v1-8k", "moonshot · moonshot-v1-8k"],
    ["qwen/qwen-plus", "qwen · qwen-plus"],
    ["openrouter/openai/gpt-5", "openrouter · openai/gpt-5"],
    ["ollama/qwen3:8b", "ollama · qwen3:8b"],
];

const INPUT_TYPES = ["string", "text", "number", "boolean", "file"];
const ADDABLE = [
    ["human", "editor.human"],
    ["llm", "editor.llm"],
    ["script", "editor.script"],
    ["agent", "editor.agentType"],
];
const AGENTS = ["claude-code", "codex", "cursor", "gemini", "custom"];

export function editing() {
    return S.editing === true;
}

function boardBusy() {
    for (const id of S.runningIds) {
        if (isRunning(id))
            return true;
    }
    return false;
}

function posKey() {
    try {
        const id = new URLSearchParams(location.search).get("flow");
        if (id)
            return `${POS_PREFIX}:${id}`;
        const name = S.lastFlow && S.lastFlow.name ? S.lastFlow.name : "local";
        const stages = (S.boardStages || []).map((stage) => stage.id).join(",");
        return `${POS_PREFIX}:${name}:${stages}`;
    }
    catch {
        return POS_PREFIX;
    }
}

/** `{ id: { x, y } }` from localStorage, or {} when storage is blocked. Never read from the flow file. */
export function readPositions() {
    try {
        const raw = localStorage.getItem(posKey());
        if (!raw)
            return {};
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object")
            return {};
        const out = {};
        for (const [id, value] of Object.entries(data)) {
            if (!value || typeof value.x !== "number" || typeof value.y !== "number")
                continue;
            if (!Number.isFinite(value.x) || !Number.isFinite(value.y))
                continue;
            out[id] = { x: value.x, y: value.y };
        }
        return out;
    }
    catch {
        return {};
    }
}

export function writePosition(id, x, y) {
    try {
        const all = readPositions();
        all[id] = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
        localStorage.setItem(posKey(), JSON.stringify(all));
    }
    catch {
        // private mode or a full quota; the node still sits there until the next paint
    }
}

export function editSwitch() {
    const group = el("div", "view-switch graph-edit");
    group.setAttribute("role", "group");
    const button = elt("button", null, "editor.toggle");
    button.type = "button";
    button.id = "graph-edit";
    button.setAttribute("aria-pressed", editing() ? "true" : "false");
    button.addEventListener("click", () => {
        S.editing = !S.editing;
        if (!S.editing)
            S.selectedEdge = null;
        document.dispatchEvent(new Event("flowgit-relayout"));
    });
    const flow = elt("button", null, "editor.flow");
    flow.type = "button";
    flow.id = "edit-flow";
    flow.hidden = !editing();
    flow.addEventListener("click", () => {
        void openFlowEditor();
    });
    group.append(button, flow);
    return group;
}

export function editStatusLine() {
    if (!S.editMessage)
        return null;
    const node = el("p", "edit-status");
    node.id = "graph-edit-status";
    node.setAttribute("role", "status");
    if (editFailed)
        node.classList.add("is-error");
    I18N.raw(node, S.editMessage);
    return node;
}

let editFailed = false;

function showMessage(message, failed) {
    S.editMessage = message || "";
    editFailed = Boolean(failed);
    if (S.editMessage && S.view === "graph" && !document.getElementById("graph-edit-status"))
        document.dispatchEvent(new Event("flowgit-relayout"));
    for (const id of ["graph-edit-status", "edit-status"]) {
        const node = document.getElementById(id);
        if (!node)
            continue;
        node.hidden = !S.editMessage;
        I18N.raw(node, S.editMessage);
        node.classList.toggle("is-error", editFailed);
    }
}

async function errorText(res) {
    const data = await res.json().catch(() => ({}));
    if (data && typeof data.error === "string" && data.error)
        return data.error;
    if (res.status === 409)
        return BUSY;
    return `保存失败 / save failed (${res.status})`;
}

function reveal() {
    document.body.classList.add("panel-open");
    const origin = S.lastPress && performance.now() - S.lastPress.at < 1500 ? S.lastPress : null;
    panelPortal.open(origin);
}

function markNode(id) {
    for (const node of document.querySelectorAll(".flow-node")) {
        const on = node.getAttribute("data-id") === id;
        node.classList.toggle("is-selected", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
    }
}

function inputNames() {
    const flow = S.lastFlow || {};
    const names = new Set([
        ...Object.keys(flow.inputs && typeof flow.inputs === "object" ? flow.inputs : {}),
        ...(Array.isArray(flow.missingInputs) ? flow.missingInputs : []),
    ]);
    for (const node of document.querySelectorAll("[data-input]")) {
        const name = node.getAttribute("data-input");
        if (name)
            names.add(name);
    }
    return [...names];
}

let formTicket = 0;

export function openStageEditor(stage) {
    S.selectedId = stage.id || "";
    S.panelMode = "edit";
    S.returnToStage = null;
    S.selectedEdge = null;
    markNode(stage.id || "");
    reveal();
    void fillStageForm(stage);
}

async function fillStageForm(stage) {
    const ticket = ++formTicket;
    I18N.raw(panelTitle, stage.name || stage.id || "");
    const form = el("form", "edit-form");
    form.id = "edit-stage-form";
    const name = document.createElement("input");
    name.id = "edit-name";
    name.value = stage.name || "";
    name.autocomplete = "off";
    const type = document.createElement("select");
    type.id = "edit-type";
    const current = stage.executor || "";
    const types = ADDABLE.map(([value]) => value);
    if (current && !types.includes(current))
        types.push(current);
    for (const value of types) {
        const known = ADDABLE.find((item) => item[0] === value);
        const option = document.createElement("option");
        option.value = value;
        if (known)
            I18N.text(option, known[1]);
        else
            option.textContent = value;
        if (value === current)
            option.selected = true;
        type.append(option);
    }
    const model = document.createElement("select");
    model.id = "edit-model";
    const blank = document.createElement("option");
    blank.value = "";
    I18N.text(blank, "editor.modelDefault");
    model.append(blank);
    const choices = MODELS.slice();
    if (stage.model && !choices.some((item) => item[0] === stage.model))
        choices.push([stage.model, stage.model]);
    for (const [value, label] of choices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (value === (stage.model || ""))
            option.selected = true;
        model.append(option);
    }
    const promptPath = document.createElement("input");
    promptPath.id = "edit-prompt-path";
    promptPath.value = stage.prompt || (current === "llm" || current === "agent" ? `prompts/${stage.id}.md` : "");
    promptPath.spellcheck = false;
    promptPath.autocomplete = "off";
    const prompt = document.createElement("textarea");
    prompt.id = "edit-prompt";
    prompt.rows = 8;
    prompt.spellcheck = false;
    const run = document.createElement("input");
    run.id = "edit-run";
    run.value = stage.run || "";
    run.spellcheck = false;
    run.autocomplete = "off";
    const timeout = document.createElement("input");
    timeout.id = "edit-timeout";
    timeout.inputMode = "numeric";
    timeout.value = stage.timeoutSec != null ? String(stage.timeoutSec) : "";
    const retries = document.createElement("input");
    retries.id = "edit-retries";
    retries.inputMode = "numeric";
    retries.value = stage.retries != null ? String(stage.retries) : "";
    const agent = document.createElement("select");
    agent.id = "edit-agent";
    for (const value of AGENTS) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        if (value === (stage.agent || "claude-code"))
            option.selected = true;
        agent.append(option);
    }
    const command = document.createElement("input");
    command.id = "edit-command";
    command.value = stage.command || "";
    command.spellcheck = false;
    command.autocomplete = "off";
    const args = document.createElement("textarea");
    args.id = "edit-args";
    args.rows = 3;
    args.value = Array.isArray(stage.args) ? stage.args.join("\n") : "";
    const instructions = document.createElement("textarea");
    instructions.id = "edit-instructions";
    instructions.rows = 3;
    instructions.value = stage.instructions || "";
    const outputs = el("div", "edit-outputs");
    outputs.id = "edit-outputs";
    const initialOutputs = Array.isArray(stage.outputs) && stage.outputs.length ? stage.outputs : [{ type: "text/markdown", path: `${stage.id}.md` }];
    for (const output of initialOutputs) {
        const path = output.directory && output.path && !String(output.path).endsWith("/") ? `${output.path}/` : output.path;
        outputs.append(outputRow(output.type, path));
    }
    const addOutput = elt("button", "ghost", "editor.addOutput");
    addOutput.type = "button";
    addOutput.addEventListener("click", () => outputs.append(outputRow("text/markdown", "")));
    const status = el("p", "edit-status");
    status.id = "edit-status";
    status.hidden = !S.editMessage;
    if (S.editMessage)
        I18N.raw(status, S.editMessage);
    const save = elt("button", "save", "editor.save");
    save.id = "edit-save";
    save.type = "submit";
    form.append(
        labeled("editor.name", name),
        labeled("editor.type", type),
        wrap("edit-model-field", "editor.model", model),
        wrap("edit-prompt-path-field", "editor.promptPath", promptPath),
        wrapPrompt(prompt),
        wrap("edit-run-field", "editor.command", run),
        wrap("edit-agent-field", "editor.agent", agent),
        wrap("edit-command-field", "editor.agentCommand", command),
        wrapHint("edit-args-field", "editor.args", args, "editor.argsHint"),
        wrapHint("edit-timeout-field", "editor.timeout", timeout, "editor.timeoutHint"),
        wrapHint("edit-retries-field", "editor.retries", retries, "editor.retriesHint"),
        wrap("edit-instructions-field", "editor.instructions", instructions),
        sectionOutputs(outputs, addOutput),
        status,
        save,
    );
    const sync = () => syncStageFields(form);
    type.addEventListener("change", sync);
    agent.addEventListener("change", sync);
    sync();
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveStage(stage, form);
    });
    panelBody.replaceChildren(form);
    bindComplete(prompt, () => inputNames());
    if (!panelEl.hidden)
        reveal();
    const loaded = await loadPrompt(promptPath.value);
    if (ticket !== formTicket)
        return;
    // A person may already be typing while the file loads. Don't wipe that.
    if (!prompt.value)
        prompt.value = loaded;
    prompt.dataset.original = loaded;
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
}

function labeled(key, control) {
    const label = el("label", "field");
    label.append(elt("span", "field-name", key), control);
    return label;
}

function wrap(id, key, control) {
    const label = labeled(key, control);
    label.id = id;
    return label;
}

function wrapHint(id, key, control, hintKey) {
    const label = wrap(id, key, control);
    label.append(elt("span", "field-help", hintKey));
    return label;
}

function wrapPrompt(prompt) {
    const label = wrap("edit-prompt-field", "editor.prompt", prompt);
    label.append(elt("span", "field-help", "editor.promptHint"));
    return label;
}

function sectionOutputs(outputs, addOutput) {
    const block = el("div", "edit-block");
    block.append(elt("span", "field-name", "editor.outputs"), outputs, addOutput);
    return block;
}

function outputRow(type, path) {
    const row = el("div", "edit-row");
    row.dataset.output = "";
    const typeInput = document.createElement("input");
    typeInput.dataset.field = "type";
    typeInput.value = type || "";
    typeInput.setAttribute("list", "edit-output-types");
    typeInput.spellcheck = false;
    const pathInput = document.createElement("input");
    pathInput.dataset.field = "path";
    pathInput.value = path || "";
    pathInput.spellcheck = false;
    const remove = elt("button", "ghost", "editor.removeRow");
    remove.type = "button";
    remove.addEventListener("click", () => {
        if (row.parentElement && row.parentElement.children.length > 1)
            row.remove();
    });
    row.append(typeInput, pathInput, remove);
    if (!document.getElementById("edit-output-types")) {
        const list = document.createElement("datalist");
        list.id = "edit-output-types";
        for (const value of ["text/markdown", "text/plain", "application/json", "dir"]) {
            const option = document.createElement("option");
            option.value = value;
            list.append(option);
        }
        document.body.append(list);
    }
    return row;
}

function syncStageFields(form) {
    const type = form.querySelector("#edit-type").value;
    const agent = form.querySelector("#edit-agent").value;
    const show = (id, on) => {
        const node = form.querySelector(`#${id}`);
        if (node)
            node.hidden = !on;
    };
    const prompt = type === "llm" || type === "agent" || type === "image";
    show("edit-model-field", type === "llm" || type === "image");
    show("edit-prompt-path-field", prompt);
    show("edit-prompt-field", prompt);
    show("edit-run-field", type === "script");
    show("edit-agent-field", type === "agent");
    show("edit-command-field", type === "agent" && agent === "custom");
    show("edit-args-field", type === "agent");
    show("edit-timeout-field", ["script", "agent", "service", "mcp", "plugin", "image"].includes(type));
    show("edit-retries-field", type === "llm" || type === "service");
    show("edit-instructions-field", type === "human");
}

async function loadPrompt(rel) {
    if (!rel)
        return "";
    try {
        const res = await getFile(rel);
        if (!res.ok)
            return "";
        return await res.text();
    }
    catch {
        return "";
    }
}

function bindComplete(textarea, names) {
    let list = textarea.parentElement.querySelector(".prompt-complete");
    if (!list) {
        list = el("div", "prompt-complete");
        list.setAttribute("role", "listbox");
        list.hidden = true;
        textarea.parentElement.append(list);
    }
    let items = [];
    let active = 0;
    const hide = () => {
        list.hidden = true;
        items = [];
    };
    const tokenAt = () => {
        const pos = textarea.selectionStart || 0;
        const before = textarea.value.slice(0, pos);
        const match = /\{\{([A-Za-z0-9_.]*)$/.exec(before);
        if (!match)
            return null;
        return { partial: match[1], start: pos - match[0].length, end: pos };
    };
    const insert = (token, start, end) => {
        const next = textarea.value.slice(0, start) + `{{${token}}}` + textarea.value.slice(end);
        textarea.value = next;
        const caret = start + token.length + 4;
        textarea.setSelectionRange(caret, caret);
        hide();
        textarea.focus();
    };
    const show = () => {
        const found = tokenAt();
        if (!found) {
            hide();
            return;
        }
        items = names().map((name) => `inputs.${name}`).filter((token) => token.startsWith(found.partial));
        list.replaceChildren();
        if (!items.length) {
            hide();
            return;
        }
        active = Math.min(active, items.length - 1);
        items.forEach((token, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "prompt-option";
            button.setAttribute("role", "option");
            button.textContent = `{{${token}}}`;
            if (index === active)
                button.setAttribute("aria-selected", "true");
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const again = tokenAt();
                insert(token, again ? again.start : found.start, again ? again.end : found.end);
            });
            list.append(button);
        });
        list.hidden = false;
    };
    textarea.addEventListener("input", show);
    textarea.addEventListener("keyup", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Tab" || event.key === "Escape")
            return;
        show();
    });
    textarea.addEventListener("keydown", (event) => {
        if (list.hidden)
            return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            active = (active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
            show();
        }
        else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const found = tokenAt();
            if (found && items[active])
                insert(items[active], found.start, found.end);
        }
        else if (event.key === "Escape") {
            event.preventDefault();
            hide();
        }
    });
    textarea.addEventListener("blur", () => {
        setTimeout(hide, 200);
    });
}

async function saveStage(stage, form) {
    if (boardBusy()) {
        showMessage(BUSY, true);
        return;
    }
    const type = form.querySelector("#edit-type").value;
    const body = {
        id: stage.id,
        name: form.querySelector("#edit-name").value.trim(),
        type,
        outputs: [...form.querySelectorAll("[data-output]")].map((row) => ({
            type: row.querySelector("[data-field=type]").value.trim(),
            path: row.querySelector("[data-field=path]").value.trim(),
        })),
    };
    if (!body.name) {
        showMessage("名称必须是非空字符串 / name must be a non-empty string", true);
        return;
    }
    if (type === "llm" || type === "agent" || type === "image")
        body.prompt = form.querySelector("#edit-prompt-path").value.trim();
    if (type === "llm" || type === "image")
        body.model = form.querySelector("#edit-model").value || null;
    if (type === "llm" || type === "service") {
        const retries = form.querySelector("#edit-retries").value.trim();
        body.retries = retries === "" ? null : Number(retries);
    }
    if (type === "script")
        body.run = form.querySelector("#edit-run").value;
    if (type === "agent") {
        body.agent = form.querySelector("#edit-agent").value;
        if (body.agent === "custom")
            body.command = form.querySelector("#edit-command").value.trim();
        const args = form.querySelector("#edit-args").value.split("\n").map((line) => line.trim()).filter(Boolean);
        body.args = args.length ? args : null;
    }
    if (["script", "agent", "service", "mcp", "plugin", "image"].includes(type)) {
        const timeout = form.querySelector("#edit-timeout").value.trim();
        body.timeoutSec = timeout === "" ? null : Number(timeout);
    }
    if (type === "human")
        body.instructions = form.querySelector("#edit-instructions").value;
    const promptBox = form.querySelector("#edit-prompt");
    if (body.prompt && promptBox && promptBox.dataset.original !== promptBox.value) {
        let saved;
        try {
            saved = await saveFile(body.prompt, promptBox.value);
        }
        catch {
            showMessage("保存失败 / save failed", true);
            return;
        }
        if (!saved.ok) {
            showMessage(await errorText(saved), true);
            return;
        }
    }
    let res;
    try {
        res = await putStage(body);
    }
    catch {
        showMessage("保存失败 / save failed", true);
        return;
    }
    if (!res.ok) {
        showMessage(await errorText(res), true);
        return;
    }
    if (promptBox)
        promptBox.dataset.original = promptBox.value;
    showMessage("已保存 / Saved", false);
    document.dispatchEvent(new Event("flowgit-edited"));
}

export async function openFlowEditor() {
    S.panelMode = "edit";
    S.returnToStage = null;
    S.selectedId = "";
    reveal();
    I18N.text(panelTitle, "editor.flow");
    const flow = S.lastFlow || {};
    const form = el("form", "edit-form");
    form.id = "edit-flow-form";
    const name = document.createElement("input");
    name.id = "edit-flow-name";
    name.value = flow.name || "";
    const description = document.createElement("textarea");
    description.id = "edit-flow-description";
    description.rows = 3;
    description.value = flow.description || "";
    const concurrency = document.createElement("input");
    concurrency.id = "edit-flow-concurrency";
    concurrency.inputMode = "numeric";
    concurrency.value = flow.concurrency != null ? String(flow.concurrency) : "";
    const rows = el("div", "edit-inputs");
    rows.id = "edit-flow-inputs";
    let defs = [];
    try {
        const res = await getInputsSafe();
        defs = res;
    }
    catch {
        defs = [];
    }
    if (!defs.length && flow.inputs)
        defs = Object.keys(flow.inputs).map((key) => ({ name: key, type: "string" }));
    for (const def of defs)
        rows.append(inputRow(def));
    const add = elt("button", "ghost", "editor.addInput");
    add.type = "button";
    add.id = "edit-add-input";
    add.addEventListener("click", () => {
        rows.append(inputRow({ name: "", type: "string" }));
    });
    const status = el("p", "edit-status");
    status.id = "edit-status";
    const save = elt("button", "save", "editor.save");
    save.id = "edit-flow-save";
    save.type = "submit";
    form.append(
        labeled("editor.flowName", name),
        wrap("edit-flow-description-field", "editor.description", description),
        wrapHint("edit-flow-concurrency-field", "editor.concurrency", concurrency, "editor.concurrencyHint"),
        sectionInputs(rows, add),
        status,
        save,
    );
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveFlow(form);
    });
    panelBody.replaceChildren(form);
}

async function getInputsSafe() {
    const res = await getInputs();
    if (!res.ok)
        return [];
    const data = await res.json();
    return Array.isArray(data.inputs) ? data.inputs : [];
}

function sectionInputs(rows, add) {
    const block = el("div", "edit-block");
    block.append(elt("span", "field-name", "editor.inputs"), rows, add);
    return block;
}

function inputRow(def) {
    const row = el("div", "edit-input");
    row.dataset.inputRow = "";
    const name = document.createElement("input");
    name.dataset.field = "name";
    name.value = def.name || "";
    name.autocomplete = "off";
    name.spellcheck = false;
    const type = document.createElement("select");
    type.dataset.field = "type";
    for (const value of INPUT_TYPES) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        if (value === (def.type || "string"))
            option.selected = true;
        type.append(option);
    }
    const enumBox = document.createElement("input");
    enumBox.dataset.field = "enum";
    enumBox.value = Array.isArray(def.enum) ? def.enum.join(", ") : "";
    enumBox.placeholder = t("editor.inputEnum");
    const fallback = document.createElement("input");
    fallback.dataset.field = "default";
    fallback.value = def.default == null ? "" : String(def.default);
    fallback.placeholder = t("editor.inputDefault");
    const description = document.createElement("input");
    description.dataset.field = "description";
    description.value = def.description || "";
    description.placeholder = t("editor.inputDescription");
    const required = document.createElement("input");
    required.type = "checkbox";
    required.dataset.field = "required";
    required.checked = def.required === true;
    const requiredLabel = el("label", "edit-required");
    requiredLabel.append(required, elt("span", null, "editor.inputRequired"));
    const remove = elt("button", "ghost", "editor.removeRow");
    remove.type = "button";
    remove.addEventListener("click", () => row.remove());
    const nameLabel = el("label", "field");
    nameLabel.append(elt("span", "field-name", "editor.inputName"), name);
    const typeLabel = el("label", "field");
    typeLabel.append(elt("span", "field-name", "editor.inputType"), type);
    row.append(nameLabel, typeLabel, enumBox, fallback, description, requiredLabel, remove);
    return row;
}

async function saveFlow(form) {
    if (boardBusy()) {
        showMessage(BUSY, true);
        return;
    }
    const inputs = {};
    for (const row of form.querySelectorAll("[data-input-row]")) {
        const name = row.querySelector("[data-field=name]").value.trim();
        if (!name)
            continue;
        const type = row.querySelector("[data-field=type]").value;
        const def = { type };
        const description = row.querySelector("[data-field=description]").value;
        if (description.trim())
            def.description = description;
        const enumText = row.querySelector("[data-field=enum]").value.trim();
        if (enumText) {
            const parts = enumText.split(",").map((part) => part.trim()).filter(Boolean);
            if (type === "number")
                def.enum = parts.map((part) => Number(part));
            else if (type === "boolean")
                def.enum = parts.map((part) => part === "true");
            else
                def.enum = parts;
        }
        const rawDefault = row.querySelector("[data-field=default]").value;
        if (rawDefault !== "") {
            if (type === "number")
                def.default = Number(rawDefault);
            else if (type === "boolean")
                def.default = rawDefault === "true";
            else
                def.default = rawDefault;
        }
        if (row.querySelector("[data-field=required]").checked)
            def.required = true;
        inputs[name] = def;
    }
    const concurrencyText = form.querySelector("#edit-flow-concurrency").value.trim();
    const body = {
        name: form.querySelector("#edit-flow-name").value,
        description: form.querySelector("#edit-flow-description").value,
        concurrency: concurrencyText === "" ? null : Number(concurrencyText),
        inputs,
    };
    let res;
    try {
        res = await putFlow(body);
    }
    catch {
        showMessage("保存失败 / save failed", true);
        return;
    }
    if (!res.ok) {
        showMessage(await errorText(res), true);
        return;
    }
    showMessage("已保存 / Saved", false);
    document.dispatchEvent(new Event("flowgit-edited"));
}

async function addEdge(from, to) {
    if (boardBusy()) {
        showMessage(BUSY, true);
        return;
    }
    const stage = S.boardStages.find((item) => item.id === to);
    const inputs = [...(stage && Array.isArray(stage.inputs) ? stage.inputs : [])];
    if (inputs.includes(from)) {
        showMessage("已经有这条依赖 / That dependency is already there", true);
        return;
    }
    inputs.push(from);
    let res;
    try {
        res = await putStage({ id: to, inputs });
    }
    catch {
        showMessage("保存失败 / save failed", true);
        return;
    }
    if (!res.ok) {
        showMessage(await errorText(res), true);
        return;
    }
    showMessage("已加上依赖 / Dependency added", false);
    document.dispatchEvent(new Event("flowgit-edited"));
}

async function removeEdge(edge) {
    if (boardBusy()) {
        showMessage(BUSY, true);
        return;
    }
    const stage = S.boardStages.find((item) => item.id === edge.to);
    const inputs = (stage && Array.isArray(stage.inputs) ? stage.inputs : []).filter((id) => id !== edge.from);
    let res;
    try {
        res = await putStage({ id: edge.to, inputs });
    }
    catch {
        showMessage("保存失败 / save failed", true);
        return;
    }
    if (!res.ok) {
        showMessage(await errorText(res), true);
        return;
    }
    S.selectedEdge = null;
    showMessage("已去掉依赖 / Dependency removed", false);
    document.dispatchEvent(new Event("flowgit-edited"));
}

function svgPoint(svg, event) {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm)
        return { x: event.clientX, y: event.clientY };
    const point = pt.matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
}

function drawDraft(root, node, event) {
    const svg = root.querySelector("svg");
    if (!svg)
        return;
    let path = svg.querySelector(".edge-draft");
    if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "edge-draft");
        svg.append(path);
    }
    const from = {
        x: (Number(node.dataset.x) || 0) + (Number(node.dataset.w) || 0),
        y: (Number(node.dataset.y) || 0) + (Number(node.dataset.h) || 0) / 2,
    };
    const to = svgPoint(svg, event);
    path.setAttribute("d", `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
}

function clearDraft(root) {
    root.querySelector(".edge-draft")?.remove();
}

function selectEdge(edge) {
    const from = edge.getAttribute("data-from") || "";
    const to = edge.getAttribute("data-to") || "";
    if (!from || !to)
        return;
    S.selectedEdge = { from, to };
    const svg = edge.ownerSVGElement || document;
    for (const path of svg.querySelectorAll(".flow-edge")) {
        const on = path.getAttribute("data-from") === from && path.getAttribute("data-to") === to;
        path.classList.toggle("is-selected", on);
    }
    showMessage("选中了连线，按 Delete 去掉 / Edge selected, press Delete to remove it", false);
}

function startMove(node, event) {
    const svg = node.ownerSVGElement || node.closest(".graph-scroll")?.querySelector("svg");
    const origin = { x: Number(node.dataset.x) || 0, y: Number(node.dataset.y) || 0 };
    const start = svg ? svgPoint(svg, event) : { x: event.clientX, y: event.clientY };
    const id = node.getAttribute("data-id") || "";
    const move = (ev) => {
        const now = svg ? svgPoint(svg, ev) : { x: ev.clientX, y: ev.clientY };
        const dx = now.x - start.x;
        const dy = now.y - start.y;
        if (node.ownerSVGElement)
            node.setAttribute("transform", `translate(${dx} ${dy})`);
        else {
            node.style.left = `${origin.x + dx}px`;
            node.style.top = `${origin.y + dy}px`;
        }
    };
    const up = (ev) => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        const now = svg ? svgPoint(svg, ev) : { x: ev.clientX, y: ev.clientY };
        writePosition(id, origin.x + (now.x - start.x), origin.y + (now.y - start.y));
        document.dispatchEvent(new Event("flowgit-relayout"));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
}

/** Pointer gestures on a freshly drawn graph: drag between nodes adds a dependency, the grip moves a node. */
export function bindGraph(root) {
    if (!editing())
        return;
    root.classList.add("is-editing");
    root.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0)
            return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target)
            return;
        const node = target.closest(".flow-node");
        if (target.closest(".node-grip") && node) {
            event.preventDefault();
            event.stopPropagation();
            startMove(node, event);
            return;
        }
        const edge = target.closest(".flow-edge-hit, .flow-edge");
        if (edge && !node) {
            event.preventDefault();
            selectEdge(edge);
            return;
        }
        if (!node)
            return;
        const id = node.getAttribute("data-id") || "";
        const originX = event.clientX;
        const originY = event.clientY;
        const svg = root.querySelector("svg");
        const start = svg ? svgPoint(svg, event) : { x: event.clientX, y: event.clientY };
        let moved = false;
        const move = (ev) => {
            if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < 6)
                return;
            moved = true;
            drawDraft(root, node, ev);
        };
        const up = (ev) => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            clearDraft(root);
            if (!moved) {
                const stage = S.boardStages.find((item) => item.id === id);
                if (stage)
                    openStageEditor(stage);
                return;
            }
            const hit = document.elementFromPoint(ev.clientX, ev.clientY);
            const dest = hit instanceof Element ? hit.closest(".flow-node") : null;
            const to = dest ? dest.getAttribute("data-id") || "" : "";
            if (to && to !== id) {
                void addEdge(id, to);
                return;
            }
            // Let go in empty space: keep the node where it was dragged. The flow file is not touched.
            if (!svg)
                return;
            const now = svgPoint(svg, ev);
            writePosition(id, (Number(node.dataset.x) || 0) + (now.x - start.x), (Number(node.dataset.y) || 0) + (now.y - start.y));
            document.dispatchEvent(new Event("flowgit-relayout"));
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    });
}

export function startEditor() {
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Delete" && event.key !== "Backspace")
            return;
        if (!editing() || !S.selectedEdge)
            return;
        const target = event.target;
        if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']"))
            return;
        event.preventDefault();
        void removeEdge(S.selectedEdge);
    });
}
