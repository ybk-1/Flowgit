/** Board startup: listeners, hold-to-run, and the first load. */
import { startActivity } from "./activity.js";
import { closeMenus, openAddStage, paintBoard, render, requestRemove, setView, submitStage, syncStageFields, syncViewToggle } from "./cards.js";
import { startComments } from "./comments.js";
import { startEditor } from "./editor.js";
import { FX } from "./fx.js";
import { startGenerate } from "./generate.js";
import { I18N } from "./i18n.js";
import { saveInputs } from "./inputs.js";
import { startLocks } from "./lock.js";
import { startPresence } from "./presence.js";
import { closePanel, notePress } from "./panel.js";
import { appendLog, connectEvents, previewAll, refresh, refreshNow, runAll, runHeld, startHoldPreview } from "./run.js";
import { HOLD_MS, S, TAP_MS, boardEl, clearPlan, inputsForm, paintUsageTotal, panelEl, panelPortal, previewButton, removeDialog, removeForce, runAllButton, stageDialog, stageForm, t } from "./state.js";

export function start() {
  // Depth: the card under the mouse tilts; the 3D graph's floor turns a little. A card stays flat
  // while it waits for upstream (it sits pressed into the page), while one of its fields has focus,
  // or while its menu is open (the menu is position: fixed, so a transformed card would move it).
  FX.tilt(boardEl, {
      selector: ".card",
      skip: (card) => card.dataset.state === "waiting-upstream" ||
          Boolean(card.querySelector(".menu:not([hidden])")) ||
          (card.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")),
  });
  FX.orbit(boardEl, { area: ".graph-3d", plane: ".iso-plane" });
  document.getElementById("panel-close").addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape")
          return;
      if (event.target instanceof Element && event.target.closest("dialog"))
          return;
      if (closeMenus())
          return;
      if (!panelEl.hidden && !panelPortal.closing()) {
          closePanel();
          return;
      }
      clearPlan();
  });
  // Remember where each press happened, so the side panel can open as a circle from there.
  document.addEventListener("pointerdown", (event) => notePress(event.target), true);
  document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ")
          notePress(event.target);
  }, true);
  document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".card-menu"))
          return;
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
  if (previewButton)
      previewButton.addEventListener("click", () => {
          void previewAll();
      });
  S.runHold = FX.hold(runAllButton, {
      ms: HOLD_MS,
      onStart: startHoldPreview,
      onCancel(progress, heldMs) {
          S.lastPressEnd = performance.now();
          S.holdTicket += 1;
          clearPlan();
          if (heldMs < TAP_MS) {
              void runAll();
              return;
          }
          const pct = Math.round(progress * 100);
          appendLog(t("run.released", { pct }));
      },
      onDone() {
          S.lastPressEnd = performance.now();
          void runHeld();
      },
  })
  runAllButton.addEventListener("click", () => {
      // Presses are handled by the hold. A click with no press before it (a screen reader's) still runs.
      if (S.runHold.holding() || performance.now() - S.lastPressEnd < 600)
          return;
      void runAll();
  });
  inputsForm.addEventListener("submit", (event) => {
      void saveInputs(event);
  });
  // A language switch: marked text has already changed in place; the board, the stage panel and
  // the legend are drawn again. Badges decode into the new words.
  I18N.onChange(() => {
      if (S.lastFlow)
          render(S.lastFlow);
      else
          paintBoard();
      paintUsageTotal();
      if (!stageDialog.open)
          return;
      syncStageFields();
  });
  startGenerate();
  startEditor();
  document.addEventListener("flowgit-edited", () => {
    void refreshNow();
  });
  connectEvents();
  refresh();
  startPresence();
  startLocks();
  startComments();
  startActivity();
}
