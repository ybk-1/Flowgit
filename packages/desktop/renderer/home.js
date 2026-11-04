"use strict";

/**
 * Desktop home. Strings match the `desktop` keys in both dictionaries of
 * packages/web/public/i18n.js. The language key is the board's
 * `flowgit.board.lang`.
 */

const STRINGS = {
  zh: {
    title: "不用命令行的 Flowgit",
    tagline: "打开文件夹，或从模板新建一个流程。",
    recent: "最近打开",
    recentEmpty: "还没有打开过流程。",
    open: "打开文件夹",
    create: "从模板新建",
    doctor: "这台电脑",
    doctorEmpty: "正在检查…",
    opening: "正在打开…",
    creating: "正在创建…",
    failed: "没有完成",
    lang: "语言",
  },
  en: {
    title: "Flowgit without the command line",
    tagline: "Open a folder, or start a flow from a template.",
    recent: "Recent",
    recentEmpty: "No flows opened yet.",
    open: "Open a folder",
    create: "New from a template",
    doctor: "This computer",
    doctorEmpty: "Checking…",
    opening: "Opening…",
    creating: "Creating…",
    failed: "That didn't finish",
    lang: "Language",
  },
};

const HAN = /[㐀-鿿豈-﫿]/;
const LATIN = /[A-Za-z]/;

function storedLang() {
  try {
    const value = localStorage.getItem("flowgit.board.lang");
    if (value === "zh" || value === "en") return value;
  } catch {
    // Storage can throw. Fall through to the browser language.
  }
  return navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let lang = storedLang();

function t(key) {
  return STRINGS[lang][key];
}

/** One language from a bilingual "中文 / English" line, same rule as the board. */
function pick(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      let from = 0;
      for (;;) {
        const at = line.indexOf("/ ", from);
        if (at < 0) return line;
        const before = at === 0 ? "" : line[at - 1];
        if (at > 0 && (before === " " || HAN.test(before) || /[。？！，；：）」]/.test(before))) {
          const left = line.slice(0, at).trimEnd();
          const right = line.slice(at + 2).trim();
          if (HAN.test(left) && LATIN.test(right) && !HAN.test(right)) return lang === "en" ? right : left;
        }
        from = at + 2;
      }
    })
    .join("\n");
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function renderStatic() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.getElementById("title").textContent = t("title");
  document.getElementById("tagline").textContent = t("tagline");
  document.getElementById("recent-heading").textContent = t("recent");
  document.getElementById("recent-empty").textContent = t("recentEmpty");
  document.getElementById("open").textContent = t("open");
  document.getElementById("create-heading").textContent = t("create");
  document.getElementById("doctor-heading").textContent = t("doctor");
  document.getElementById("lang-group").setAttribute("aria-label", t("lang"));
  for (const button of document.querySelectorAll(".lang-switch button")) {
    button.setAttribute("aria-pressed", button.getAttribute("data-lang") === lang ? "true" : "false");
  }
}

function baseName(folder) {
  const parts = String(folder).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || folder;
}

async function renderRecent() {
  const list = document.getElementById("recent");
  const empty = document.getElementById("recent-empty");
  const paths = await window.flowgit.recent();
  list.replaceChildren();
  empty.hidden = paths.length > 0;
  for (const folder of paths) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.title = folder;
    button.textContent = baseName(folder);
    const small = document.createElement("small");
    small.textContent = folder;
    button.append(small);
    button.addEventListener("click", () => {
      void openResult(window.flowgit.openRecent(folder), t("opening"));
    });
    item.append(button);
    list.append(item);
  }
}

function renderTemplates(templates) {
  const list = document.getElementById("templates");
  list.replaceChildren();
  for (const template of templates) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = template.name || template.id;
    const small = document.createElement("small");
    small.textContent = template.description ? `${template.id} · ${pick(template.description)}` : template.id;
    button.append(small);
    button.addEventListener("click", () => {
      void openResult(window.flowgit.createFromTemplate(template.id), t("creating"));
    });
    item.append(button);
    list.append(item);
  }
}

function renderDoctor(checks) {
  const list = document.getElementById("doctor");
  list.replaceChildren();
  if (!checks.length) {
    const item = document.createElement("li");
    item.textContent = t("doctorEmpty");
    list.append(item);
    return;
  }
  for (const check of checks) {
    const item = document.createElement("li");
    item.className = check.level || "";
    item.textContent = pick(check.message);
    if (check.hint) {
      const hint = document.createElement("p");
      const text = pick(check.hint);
      const url = /^https?:\/\//.test(text) ? text : (text.match(/https?:\/\/\S+/) || [])[0];
      if (url) {
        hint.textContent = text.replace(url, "").trim();
        const link = document.createElement("a");
        link.href = url;
        link.textContent = url;
        hint.append(link);
      } else {
        hint.textContent = text;
      }
      item.append(hint);
    }
    list.append(item);
  }
}

async function openResult(pending, busy) {
  setStatus(busy);
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    const result = await pending;
    if (result && result.error) setStatus(`${t("failed")}: ${pick(result.error)}`);
    else setStatus("");
    await renderRecent();
  } catch (err) {
    setStatus(`${t("failed")}: ${err && err.message ? err.message : String(err)}`);
  } finally {
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
  }
}

document.getElementById("open").addEventListener("click", () => {
  void openResult(window.flowgit.openFolder(), t("opening"));
});

document.querySelector(".lang-switch").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-lang]");
  if (!button) return;
  const next = button.getAttribute("data-lang");
  if (next !== "zh" && next !== "en") return;
  lang = next;
  try {
    localStorage.setItem("flowgit.board.lang", next);
  } catch {
    // The choice still applies to this page.
  }
  renderStatic();
});

renderStatic();
renderDoctor([]);
void window.flowgit.recent().then(renderRecent).catch((err) => setStatus(String(err)));
void window.flowgit.templates().then(renderTemplates).catch((err) => setStatus(String(err)));
void window.flowgit.doctor().then(renderDoctor).catch((err) => setStatus(String(err)));
