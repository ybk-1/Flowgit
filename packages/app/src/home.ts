import { I18N } from "./i18n.js";
import { el, type I18nApi } from "./dom.js";
import { defaultStore } from "./storage.js";
import { templateFiles, templateIndex } from "./templates.js";

const i18n = I18N as I18nApi;
const decoder = new TextDecoder();

function boardUrl(id: string): string {
  return `./board.html?flow=${encodeURIComponent(id)}`;
}

function note(text: string): void {
  const node = document.getElementById("home-note");
  if (!node) return;
  node.hidden = false;
  i18n.raw(node, text);
}

async function flowName(store: Awaited<ReturnType<typeof defaultStore>>["store"], id: string): Promise<string> {
  const data = await store.read(id, "flow.json");
  if (!data) return id;
  try {
    const flow = JSON.parse(decoder.decode(data)) as { name?: unknown };
    return typeof flow.name === "string" && flow.name ? flow.name : id;
  } catch {
    return id;
  }
}

/** A new id from the template's: weekly-report, weekly-report-2, ... */
function freeId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

async function main(): Promise<void> {
  if (location.hash === "#missing") note("没有找到这个流程 / That flow was not found");
  const { store, persistent } = await defaultStore();
  if (!persistent) note("这个浏览器不能保存文件，关掉页面就没了 / This browser can't keep files; they are gone when the page closes");

  const mine = document.getElementById("mine")!;
  const empty = document.getElementById("mine-empty")!;
  const ids = await store.list();
  empty.hidden = ids.length > 0;
  for (const id of ids) {
    const item = el(i18n, "li", undefined, { "data-flow": id });
    const title = el(i18n, "h3", await flowName(store, id));
    const row = el(i18n, "div", undefined, { class: "row" });
    const openLink = el(i18n, "a", "打开 / Open", { href: boardUrl(id), class: "button" });
    const remove = el(i18n, "button", "删除 / Delete", { type: "button" });
    remove.addEventListener("click", async () => {
      if (!window.confirm(i18n.pick(`删除「${id}」和它的所有版本？/ Delete "${id}" and all its versions?`))) return;
      await store.remove(id);
      item.remove();
      empty.hidden = mine.children.length > 0;
    });
    row.append(openLink, remove);
    item.append(title, el(i18n, "p", id), row);
    mine.append(item);
  }

  const list = document.getElementById("templates")!;
  for (const template of await templateIndex()) {
    const item = el(i18n, "li", undefined, { "data-template": template.id });
    const button = el(i18n, "button", "用这个模板 / Use this template", { type: "button" });
    button.addEventListener("click", async () => {
      button.setAttribute("disabled", "");
      try {
        const id = freeId(template.id, await store.list());
        const files = await templateFiles(template.id);
        for (const [rel, data] of Object.entries(files)) await store.apply(id, { type: "write", path: rel, data });
        // A first look costs nothing: templates with demo replies start with them on.
        if (template.demo) localStorage.setItem(`flowgit.app.demo.${id}`, "1");
        location.href = boardUrl(id);
      } catch (err) {
        note(err instanceof Error ? err.message : String(err));
        button.removeAttribute("disabled");
      }
    });
    item.append(el(i18n, "h3", template.name), el(i18n, "p", template.description), button);
    list.append(item);
  }
}

void main().catch((err) => note(err instanceof Error ? err.message : String(err)));
