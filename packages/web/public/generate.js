/** The "generate a flow from one sentence" panel: a dry run first, files written only after confirming. */
import { inPage, postGenerate } from "./api.js";
import { I18N } from "./i18n.js";
import { refreshNow } from "./run.js";
import { planLabel } from "./state.js";

const generateForm = document.getElementById("generate-form");
const generateStatus = document.getElementById("generate-status");
const generateResult = document.getElementById("generate-result");
const generatePlan = document.getElementById("generate-plan");
const generateFiles = document.getElementById("generate-files");
const generateCommands = document.getElementById("generate-commands");
const generateGo = document.getElementById("generate-go");
const generateWrite = document.getElementById("generate-write");
let generateBody = null;

function showGenerateStatus(message, key) {
  if (!generateStatus) return;
  generateStatus.hidden = false;
  if (message) I18N.raw(generateStatus, message);
  else I18N.text(generateStatus, key);
}

function renderGeneratePreview(body) {
  if (!generateResult || !generatePlan || !generateFiles || !generateCommands || !generateWrite) return;
  generateBody = body;
  generateResult.hidden = false;
  generatePlan.replaceChildren();
  for (const step of body.plan || []) {
    const li = document.createElement("li");
    li.append(document.createTextNode(`${step.name} (${step.id}) · ${planLabel(step.action)}`));
    if (step.detail) {
      li.append(document.createTextNode(" — "));
      const detail = document.createElement("span");
      I18N.raw(detail, step.detail);
      li.append(detail);
    }
    generatePlan.appendChild(li);
  }
  generateFiles.textContent = (body.files || []).join("\n");
  generateCommands.hidden = !body.runsCommands;
  generateWrite.disabled = Boolean(body.exists);
  if (body.exists) showGenerateStatus("", "generate.exists");
}

async function sendGenerate(payload) {
  const res = await postGenerate(payload);
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { res, body };
}

/** Wires the "generate a flow from one sentence" panel. */
export function startGenerate() {
  // Generating writes a new flow next to the board's, which only the local server can do.
  if (inPage) {
    const panel = generateForm?.closest("section");
    if (panel) panel.hidden = true;
    return;
  }
  if (generateForm && generateGo && generateWrite) {
    generateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const description = document.getElementById("generate-description").value.trim();
      const payload = { description, md: document.getElementById("generate-md").checked };
      const folder = document.getElementById("generate-folder").value.trim();
      const model = document.getElementById("generate-model").value.trim();
      const language = document.getElementById("generate-language").value;
      if (folder) payload.dir = folder;
      if (model) payload.model = model;
      if (language) payload.language = language;
      generateGo.disabled = true;
      showGenerateStatus("", "generate.working");
      void sendGenerate(payload)
        .then(({ res, body }) => {
          if (!res.ok) {
            generateResult.hidden = true;
            generateBody = null;
            showGenerateStatus(body.error, "generate.failed");
            return;
          }
          renderGeneratePreview(body);
          if (!body.exists) generateStatus.hidden = true;
        })
        .catch(() => {
          showGenerateStatus("", "generate.failed");
        })
        .finally(() => {
          generateGo.disabled = false;
        });
    });
    generateWrite.addEventListener("click", () => {
      if (!generateBody?.id || generateWrite.disabled) return;
      generateWrite.disabled = true;
      showGenerateStatus("", "generate.working");
      void sendGenerate({ confirm: true, id: generateBody.id })
        .then(async ({ res, body }) => {
          if (!res.ok) {
            generateWrite.disabled = Boolean(generateBody?.exists);
            showGenerateStatus(body.error, "generate.failed");
            return;
          }
          generateResult.hidden = true;
          generateBody = null;
          showGenerateStatus("", "generate.wrote");
          await refreshNow();
        })
        .catch(() => {
          generateWrite.disabled = false;
          showGenerateStatus("", "generate.failed");
        });
    });
    document.getElementById("generate-cancel").addEventListener("click", () => {
      generateResult.hidden = true;
      generateBody = null;
      generateStatus.hidden = true;
    });
    I18N.onChange(() => {
      if (generateBody && !generateResult.hidden) renderGeneratePreview(generateBody);
    });
  }
}
