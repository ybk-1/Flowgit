/*
 * Registers the shell service worker and, while offline, tells Run that it
 * needs a network. The two strings match offline.needsNetwork in both
 * dictionaries of packages/web/public/i18n.js. The language key is the board's.
 * https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
 */
"use strict";

const NEEDS_NETWORK = { zh: "需要网络", en: "Needs a network" };

function lang() {
  try {
    const stored = localStorage.getItem("flowgit.board.lang");
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // Storage can throw. Follow the browser language.
  }
  return navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function showNeedsNetwork() {
  const text = NEEDS_NETWORK[lang()];
  const notice = document.getElementById("notice");
  if (notice) {
    notice.hidden = false;
    notice.textContent = text;
    return;
  }
  let note = document.getElementById("offline-run");
  if (!note) {
    note = document.createElement("p");
    note.id = "offline-run";
    note.className = "notice";
    document.body.prepend(note);
  }
  note.hidden = false;
  note.textContent = text;
}

function blockOfflineRun(event) {
  if (navigator.onLine) return;
  const target = event.target instanceof Element ? event.target : null;
  const button = target && target.closest("#run-all, button.run");
  if (!button) return;
  // The board's hold-to-run listens for pointerdown and cancels the click, so this
  // has to run on pointerdown as well. Capture runs before that listener.
  event.preventDefault();
  event.stopPropagation();
  showNeedsNetwork();
}
document.addEventListener("pointerdown", blockOfflineRun, true);
document.addEventListener("click", blockOfflineRun, true);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Registration can fail in a private window. The page still works online.
    });
  });
}

/* Two-finger pinch scales the graph. One finger still pans via overflow. */
(function armGraphPinch() {
  let pinch = null;
  const distance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy) || 1;
  };
  document.addEventListener(
    "touchstart",
    (event) => {
      const scroller = event.target instanceof Element ? event.target.closest(".graph-scroll") : null;
      if (!scroller || event.touches.length !== 2) return;
      const current = Number(scroller.dataset.pinchScale || "1");
      pinch = { scroller, start: distance(event.touches), scale: current };
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      if (!pinch || event.touches.length < 2) return;
      const next = Math.min(2.5, Math.max(0.6, pinch.scale * (distance(event.touches) / pinch.start)));
      pinch.scroller.dataset.pinchScale = String(next);
      pinch.scroller.style.transform = `scale(${next})`;
      pinch.scroller.style.transformOrigin = "0 0";
    },
    { passive: true },
  );
  document.addEventListener("touchend", () => {
    pinch = null;
  });
})();
