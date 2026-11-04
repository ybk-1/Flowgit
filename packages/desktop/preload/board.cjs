"use strict";

/**
 * Board preload. It writes the desktop's remembered language into the board's
 * localStorage key before the page scripts run, and exposes nothing.
 * Board windows never load the home preload.
 *
 * https://www.electronjs.org/docs/latest/tutorial/security#3-enable-context-isolation
 */

const arg = process.argv.find((item) => String(item).startsWith("--flowgit-lang="));
const lang = arg ? String(arg).slice("--flowgit-lang=".length) : "";
if (lang === "zh" || lang === "en") {
  try {
    localStorage.setItem("flowgit.board.lang", lang);
  } catch {
    // The board then follows the browser language for this visit.
  }
}
