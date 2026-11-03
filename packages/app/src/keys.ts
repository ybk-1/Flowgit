/**
 * Model keys on the page. By default a key lives only in this page's memory and is gone when the
 * page closes; "remember on this device" keeps it in this browser's localStorage. A key is never
 * written to a flow file, a zip or any export: it only goes into the host's environment.
 */

export interface VendorChoice {
  id: string;
  /** "中文 / English" */
  label: string;
  /** The environment variable the provider preset reads (packages/core/src/providers.ts). */
  keyEnv: string;
  /** What FLOWGIT_MODEL becomes, so llm stages without their own model use this vendor. */
  model: string;
  /** Where to get a key. */
  keyUrl: string;
}

/**
 * Vendors whose APIs accept calls straight from a web page (CORS preflight checked 2026-11-03).
 * Other presets (OpenAI, GLM, Kimi, Qwen, OpenRouter) are not offered here: run those on a computer.
 */
export const VENDORS: readonly VendorChoice[] = [
  { id: "deepseek", label: "DeepSeek", keyEnv: "DEEPSEEK_API_KEY", model: "deepseek/deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "anthropic", label: "Anthropic Claude", keyEnv: "ANTHROPIC_API_KEY", model: "anthropic/claude-opus-5-5", keyUrl: "https://console.anthropic.com/settings/keys" },
];

const STORE_KEY = "flowgit.app.keys";

export interface KeySettings {
  vendor: string;
  key: string;
  remember: boolean;
}

export function rememberedKeys(): KeySettings | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<KeySettings>;
    if (typeof value.vendor !== "string" || typeof value.key !== "string") return undefined;
    return { vendor: value.vendor, key: value.key, remember: true };
  } catch {
    return undefined;
  }
}

export function storeKeys(settings: KeySettings | undefined): void {
  try {
    if (settings?.remember && settings.key) localStorage.setItem(STORE_KEY, JSON.stringify({ vendor: settings.vendor, key: settings.key }));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // private window: memory only
  }
}

/** Put the key and the vendor's default model into the host environment, removing the other vendors' keys. */
export function applyKeys(env: Record<string, string | undefined>, settings: KeySettings | undefined): void {
  for (const vendor of VENDORS) delete env[vendor.keyEnv];
  delete env.FLOWGIT_MODEL;
  if (!settings?.key) return;
  const vendor = VENDORS.find((item) => item.id === settings.vendor);
  if (!vendor) return;
  env[vendor.keyEnv] = settings.key;
  env.FLOWGIT_MODEL = vendor.model;
}
