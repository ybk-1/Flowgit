import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const i18nSource = readFileSync(path.join(root, "public/i18n.js"), "utf8");
const appSource = readFileSync(path.join(root, "public/app.js"), "utf8");
const htmlSource = readFileSync(path.join(root, "public/index.html"), "utf8");

interface I18nApi {
  MESSAGES: Record<string, { zh?: unknown; en?: unknown }>;
  t: (key: string, vars?: Record<string, unknown>) => string;
  apiText: (message: string) => string;
  setLang: (lang: string) => string;
  currentLang: () => string;
}

function loadI18n(options: { language?: string; storage?: "memory" | "throw" | "missing"; stored?: string | null } = {}) {
  const memory = new Map<string, string>();
  if (options.stored) memory.set("flowgit.board.lang", options.stored);
  const localStorage =
    options.storage === "missing"
      ? undefined
      : options.storage === "throw"
        ? {
            getItem(): string {
              throw new Error("denied");
            },
            setItem(): void {
              throw new Error("denied");
            },
          }
        : {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => {
              memory.set(key, value);
            },
          };
  const documentElement = { lang: "zh", dataset: {} as Record<string, string> };
  const sandbox: Record<string, unknown> = {
    navigator: { language: options.language ?? "en-US" },
    document: {
      documentElement,
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    console,
    window: { localStorage },
  };
  runInContext(i18nSource, createContext(sandbox), { filename: "i18n.js" });
  return { api: sandbox.flowgitI18n as I18nApi, memory, documentElement };
}

function usedKeys(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter((key): key is string => Boolean(key));
}

describe("board i18n dictionary", () => {
  const keysInApp = [
    ...usedKeys(appSource, /\bt\(\s*["']([^"']+)["']/g),
    ...usedKeys(appSource, /\btApi\(\s*["']([^"']+)["']/g),
    ...usedKeys(appSource, /\bshowNotice\(\s*["']([^"']+)["']/g),
    ...usedKeys(appSource, /\btitled\([^,\n]*,\s*["']([^"']+)["']/g),
    ...usedKeys(appSource, /\bkey:\s*["']([^"']+)["']/g),
  ];
  const keysInHtml = usedKeys(htmlSource, /data-i18n(?:-[a-z]+)?="([^"]+)"/g);
  const used = [...new Set([...keysInApp, ...keysInHtml])];

  it("gives every dictionary entry both zh and en", () => {
    const { api } = loadI18n();
    const entries = Object.entries(api.MESSAGES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(typeof value.zh, key).toBe("string");
      expect(typeof value.en, key).toBe("string");
      expect(String(value.zh).length, key).toBeGreaterThan(0);
      expect(String(value.en).length, key).toBeGreaterThan(0);
    }
  });

  it("finds every key used by the page in the dictionary", () => {
    const { api } = loadI18n();
    expect(used.length).toBeGreaterThan(0);
    const missing = used.filter((key) => !Object.hasOwn(api.MESSAGES, key));
    expect(missing).toEqual([]);
  });

  it("keeps UI strings out of app.js", () => {
    expect(appSource).not.toMatch(/[\u3400-\u9fff]/);
  });

  it("follows the browser language and remembers a choice", () => {
    const zh = loadI18n({ language: "zh-CN" });
    expect(zh.api.currentLang()).toBe("zh");
    expect(zh.documentElement.lang).toBe("zh");
    expect(zh.api.t("state.ok")).toBe("已完成");

    const en = loadI18n({ language: "en-GB" });
    expect(en.api.currentLang()).toBe("en");
    expect(en.documentElement.lang).toBe("en");
    expect(en.api.t("state.ok")).toBe("ok");

    const stored = loadI18n({ language: "zh-CN", stored: "en" });
    expect(stored.api.currentLang()).toBe("en");
    stored.api.setLang("both");
    expect(stored.memory.get("flowgit.board.lang")).toBe("both");
    expect(stored.api.currentLang()).toBe("both");
    expect(stored.documentElement.lang).toBe("zh");
    expect(stored.documentElement.dataset.lang).toBe("both");
    expect(stored.api.t("state.ok")).toBe("已完成 / ok");
    expect(stored.api.t("card.runs", { n: 2 })).toBe("2 个版本 / 2 run(s)");
    expect(stored.api.t("model.placeholder")).toBe("provider/model");
  });

  it("splits API errors on the first slash and still renders when storage throws", () => {
    const broken = loadI18n({ language: "fr", storage: "throw" });
    expect(broken.api.currentLang()).toBe("en");
    expect(() => broken.api.setLang("zh")).not.toThrow();
    expect(broken.api.currentLang()).toBe("zh");
    expect(broken.api.apiText("已有运行在进行 / a run is already in progress")).toBe("已有运行在进行");
    broken.api.setLang("en");
    expect(broken.api.apiText("已有运行在进行 / a run is already in progress")).toBe("a run is already in progress");
    expect(broken.api.apiText("a / b / c")).toBe("b / c");
    broken.api.setLang("both");
    expect(broken.api.apiText("已有运行在进行 / a run is already in progress")).toBe("已有运行在进行 / a run is already in progress");
    expect(broken.api.apiText("not bilingual")).toBe("not bilingual");

    const missing = loadI18n({ language: "zh-Hant", storage: "missing" });
    expect(missing.api.currentLang()).toBe("zh");
    expect(missing.api.t("doc.boardName")).toBe("看板");
  });
});
