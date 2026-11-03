/** Board inputs. */
import { getInputs, putInputs } from "./api.js";
import { I18N } from "./i18n.js";
import { refresh } from "./run.js";
import { S, el, elr, elt, inputsEl, inputsSave, inputsStatus, setError } from "./state.js";

export function editingInputs() {
    const active = document.activeElement;
    return Boolean(active && inputsEl.contains(active) && active.matches("input, textarea, select"));
}

export async function loadInputs() {
    if (editingInputs())
        return false;
    let res;
    try {
        res = await getInputs();
    }
    catch {
        return false;
    }
    if (!res.ok)
        return false;
    const data = await res.json();
    renderInputs(Array.isArray(data.inputs) ? data.inputs : []);
    return true;
}

export function renderInputs(fields) {
    inputsEl.replaceChildren();
    if (!fields.length) {
        inputsEl.append(elt("p", "field-help", "inputs.none"));
        inputsSave.hidden = true;
        return;
    }
    inputsSave.hidden = false;
    inputsSave.disabled = false;
    for (const field of fields)
        inputsEl.append(renderInput(field));
}

export function renderInput(field) {
    const wrap = el("label", "field");
    const name = el("span", "field-name", field.name || "");
    if (field.required)
        name.append(elt("span", "req", "inputs.required"));
    wrap.append(name, controlFor(field));
    if (field.description)
        wrap.append(elr("span", "field-help", field.description));
    return wrap;
}

export function controlFor(field) {
    const value = field.value == null ? "" : field.value;
    if (Array.isArray(field.enum) && field.enum.length) {
        const select = document.createElement("select");
        select.dataset.input = field.name;
        select.dataset.type = field.type || "string";
        const options = field.enum.slice();
        if (value !== "" && !options.some((item) => String(item) === String(value)))
            options.unshift(value);
        for (const option of options) {
            const node = document.createElement("option");
            node.value = String(option);
            node.textContent = String(option);
            if (String(option) === String(value))
                node.selected = true;
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
    }
    else {
        input.type = "text";
        input.value = value === "" ? "" : String(value);
    }
    if (field.required)
        input.required = true;
    input.autocomplete = "off";
    return input;
}

export async function saveInputs(event) {
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
            if (control.value === "")
                continue;
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
        const res = await putInputs(payload);
        const data = await res.json().catch(() => ({}));
        inputsStatus.hidden = false;
        if (!res.ok) {
            inputsStatus.className = "inputs-status error";
            setError(inputsStatus, data.error, "file.notSaved", res.status);
            return;
        }
        inputsStatus.className = "inputs-status ok";
        I18N.text(inputsStatus, "file.saved");
        S.lastInputValues = "";
        await refresh();
    }
    catch {
        inputsStatus.hidden = false;
        inputsStatus.className = "inputs-status error";
        I18N.text(inputsStatus, "file.notSaved");
    }
    finally {
        inputsSave.disabled = false;
    }
}
