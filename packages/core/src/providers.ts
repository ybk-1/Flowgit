import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_FILE } from "./runs.js";

/**
 * Model providers: where an llm stage sends its request.
 *
 * flow.json only names a model ("glm/glm-4.6"); the endpoint and the key live on
 * the user's machine (built-in presets, ~/.flowgit/providers.json, and the
 * `providers` key of flowgit.local.json). Keys are only ever read from the
 * environment variable named by `apiKeyEnv`, never from a file.
 */

/** The two wire protocols Flowgit speaks. */
export type ProviderProtocol = "anthropic" | "openai";

export const PROVIDER_PROTOCOLS: readonly ProviderProtocol[] = ["anthropic", "openai"];

/** One provider entry as written in a config file. */
export interface ProviderConfig {
  protocol?: ProviderProtocol;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export type ProviderSource = "preset" | "global" | "flow";

/** A provider after presets and config files are merged. */
export interface Provider {
  id: string;
  protocol: ProviderProtocol;
  /** Undefined only for the anthropic/openai presets, which then follow ANTHROPIC_BASE_URL / OPENAI_BASE_URL or the SDK default. */
  baseUrl?: string;
  /** Environment variable holding the key. Undefined = no key needed (e.g. a local Ollama). */
  apiKeyEnv?: string;
  /** Where the final values came from (the last layer that touched this provider). */
  source: ProviderSource;
  /** Vendor documentation for presets. */
  docs?: string;
}

/** A provider ready to call: the effective endpoint is known. */
export interface ResolvedProvider extends Provider {
  baseUrl: string;
  /** True when this is Anthropic's own API, the only place Claude-only parameters are sent. */
  claudeApi: boolean;
  /** True when this is OpenAI's own API. */
  openaiApi: boolean;
}

export const DEFAULT_PROVIDER = "anthropic";

const ANTHROPIC_API_URL = "https://api.anthropic.com";
const OPENAI_API_URL = "https://api.openai.com/v1";

/**
 * Built-in presets. Every baseUrl and protocol comes from the vendor's official
 * docs, linked next to it. Users override any field in their own config.
 */
export const PROVIDER_PRESETS: Readonly<Record<string, Omit<Provider, "id" | "source">>> = {
  // https://docs.claude.com/en/api/overview (base URL https://api.anthropic.com; the SDK adds /v1/messages)
  anthropic: { protocol: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", docs: "https://docs.claude.com/en/api/overview" },
  // https://developers.openai.com/api/reference/overview (base URL https://api.openai.com/v1)
  openai: { protocol: "openai", apiKeyEnv: "OPENAI_API_KEY", docs: "https://developers.openai.com/api/reference/overview" },
  // https://openrouter.ai/docs/quickstart (OpenAI-compatible, base URL https://openrouter.ai/api/v1)
  openrouter: {
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    docs: "https://openrouter.ai/docs/quickstart",
  },
  // https://docs.bigmodel.cn/cn/guide/develop/claude (Anthropic-compatible endpoint, Bearer key).
  // Note: GLM Coding Plan quota only applies inside the tools Zhipu lists
  // (https://docs.bigmodel.cn/cn/coding-plan/overview), so Flowgit uses regular API balance.
  glm: {
    protocol: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    apiKeyEnv: "GLM_API_KEY",
    docs: "https://docs.bigmodel.cn/cn/guide/develop/claude",
  },
  // https://api-docs.deepseek.com/ (OpenAI-compatible, base URL https://api.deepseek.com, no /v1)
  deepseek: {
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    docs: "https://api-docs.deepseek.com/",
  },
  // https://platform.kimi.com/docs/get-api-key (OpenAI-compatible, base URL https://api.moonshot.cn/v1)
  moonshot: {
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    docs: "https://platform.kimi.com/docs/get-api-key",
  },
  // https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope (OpenAI-compatible,
  // path /compatible-mode/v1). The page lists per-workspace hosts and says the shared Beijing host
  // dashscope.aliyuncs.com still works; Singapore keys need dashscope-intl.aliyuncs.com instead.
  qwen: {
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    docs: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
  },
  // https://docs.ollama.com/openai (local server, OpenAI-compatible; the key is "required but ignored")
  ollama: { protocol: "openai", baseUrl: "http://localhost:11434/v1", docs: "https://docs.ollama.com/openai" },
};

/** ~/.flowgit/providers.json, or $FLOWGIT_HOME/providers.json. */
export function globalProvidersFile(): string {
  const home = process.env.FLOWGIT_HOME || path.join(os.homedir(), ".flowgit");
  return path.join(home, "providers.json");
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALLOWED_FIELDS = new Set(["protocol", "baseUrl", "apiKeyEnv"]);

/** Check the `providers` object of one config file. Throws ProviderConfigError with a bilingual message. */
export function checkProvidersConfig(value: unknown, file: string): Record<string, ProviderConfig> {
  const where = (id?: string) => (id ? `${file} → providers.${id}` : `${file} → providers`);
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderConfigError(`${where()} 要是一个对象 / must be an object`);
  }
  const out: Record<string, ProviderConfig> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!ID_RE.test(id) || id.includes("/")) {
      throw new ProviderConfigError(`${where(id)}: 名字只能用字母、数字、点、下划线和连字符 / name may only use letters, digits, ".", "_" and "-"`);
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ProviderConfigError(`${where(id)} 要是一个对象 / must be an object`);
    }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (/key|token|secret|password/i.test(key) && key !== "apiKeyEnv") {
        throw new ProviderConfigError(
          `${where(id)}.${key}: 不要把密钥写进文件，用 apiKeyEnv 写环境变量的名字 / never put a key in a file; set apiKeyEnv to the name of an environment variable`,
        );
      }
      if (!ALLOWED_FIELDS.has(key)) {
        throw new ProviderConfigError(`${where(id)}.${key}: 不认识的字段，只能用 protocol、baseUrl、apiKeyEnv / unknown field; allowed: protocol, baseUrl, apiKeyEnv`);
      }
    }
    if (e.protocol !== undefined && !PROVIDER_PROTOCOLS.includes(e.protocol as ProviderProtocol)) {
      throw new ProviderConfigError(`${where(id)}.protocol 只能是 "anthropic" 或 "openai" / must be "anthropic" or "openai", got ${JSON.stringify(e.protocol)}`);
    }
    if (e.baseUrl !== undefined) {
      let ok = typeof e.baseUrl === "string";
      if (ok) {
        try {
          ok = ["http:", "https:"].includes(new URL(e.baseUrl as string).protocol);
        } catch {
          ok = false;
        }
      }
      if (!ok) throw new ProviderConfigError(`${where(id)}.baseUrl 要是 http(s) 地址 / must be an http(s) URL, got ${JSON.stringify(e.baseUrl)}`);
    }
    if (e.apiKeyEnv !== undefined && (typeof e.apiKeyEnv !== "string" || !ENV_RE.test(e.apiKeyEnv))) {
      throw new ProviderConfigError(`${where(id)}.apiKeyEnv 要是环境变量的名字，比如 GLM_API_KEY / must be an environment variable name such as GLM_API_KEY, got ${JSON.stringify(e.apiKeyEnv)}`);
    }
    out[id] = e as ProviderConfig;
  }
  return out;
}

function readProvidersFile(file: string): Record<string, ProviderConfig> {
  if (!fs.existsSync(file)) return {};
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ProviderConfigError(`${file} 不是合法的 JSON / is not valid JSON: ${(err as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ProviderConfigError(`${file} 要是一个 JSON 对象 / must be a JSON object`);
  }
  return checkProvidersConfig((data as { providers?: unknown }).providers, file);
}

export interface ProviderFiles {
  /** Global config file (may not exist). */
  global: string;
  /** flowgit.local.json of the flow, when a flow directory is given. */
  flow?: string;
}

export function providerFiles(dir?: string): ProviderFiles {
  return { global: globalProvidersFile(), flow: dir ? path.join(dir, LOCAL_FILE) : undefined };
}

/** Presets, then the global file, then the flow's flowgit.local.json; later layers override field by field. */
export function loadProviders(dir?: string): Record<string, Provider> {
  const files = providerFiles(dir);
  const out: Record<string, Provider> = {};
  for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) out[id] = { id, ...preset, source: "preset" };
  const layers: [ProviderSource, string | undefined][] = [
    ["global", files.global],
    ["flow", files.flow],
  ];
  for (const [source, file] of layers) {
    if (!file) continue;
    for (const [id, cfg] of Object.entries(readProvidersFile(file))) {
      const base = out[id];
      const merged = { ...(base ?? {}), ...cfg, id, source } as Provider;
      if (!base && (!merged.protocol || !merged.baseUrl)) {
        throw new ProviderConfigError(`${file} → providers.${id}: 新的 provider 要写 protocol 和 baseUrl / a new provider needs protocol and baseUrl`);
      }
      out[id] = merged;
    }
  }
  return out;
}

/** "glm/glm-4.6" → { provider: "glm", model: "glm-4.6" }; no prefix means anthropic. Only the first "/" splits. */
export function parseModelSpec(spec: string): { provider: string; model: string } {
  const s = spec.trim();
  const i = s.indexOf("/");
  const provider = i < 0 ? DEFAULT_PROVIDER : s.slice(0, i);
  const model = i < 0 ? s : s.slice(i + 1);
  if (!provider || !model) {
    throw new ProviderConfigError(`模型要写成 <provider>/<model>，比如 glm/glm-4.6 / Model must look like <provider>/<model>, e.g. glm/glm-4.6, got "${spec}"`);
  }
  return { provider, model };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isClaudeApi(baseUrl: string): boolean {
  return hostOf(baseUrl) === "api.anthropic.com";
}

export function isOpenAiApi(baseUrl: string): boolean {
  return hostOf(baseUrl) === "api.openai.com";
}

/** The endpoint a provider will actually call, following ANTHROPIC_BASE_URL / OPENAI_BASE_URL for the two vendor presets. */
export function effectiveProvider(p: Provider, env: NodeJS.ProcessEnv = process.env): ResolvedProvider {
  let baseUrl = p.baseUrl;
  if (!baseUrl && p.id === "anthropic") baseUrl = env.ANTHROPIC_BASE_URL || ANTHROPIC_API_URL;
  if (!baseUrl && p.id === "openai") baseUrl = env.OPENAI_BASE_URL || OPENAI_API_URL;
  if (!baseUrl) baseUrl = p.protocol === "anthropic" ? ANTHROPIC_API_URL : OPENAI_API_URL;
  return {
    ...p,
    baseUrl,
    claudeApi: p.protocol === "anthropic" && isClaudeApi(baseUrl),
    openaiApi: p.protocol === "openai" && isOpenAiApi(baseUrl),
  };
}

/** Resolve "<provider>/<model>" against presets and config files. */
export function resolveModel(spec: string, dir?: string): { provider: ResolvedProvider; model: string } {
  const { provider: id, model } = parseModelSpec(spec);
  const providers = loadProviders(dir);
  const p = Object.hasOwn(providers, id) ? providers[id] : undefined;
  if (!p) {
    const known = Object.keys(providers).join(", ");
    throw new ProviderConfigError(
      `不认识的 provider "${id}"（来自模型 "${spec}"）。可用的有：${known}。用 flowgit providers 查看，或在 ${globalProvidersFile()} 里添加。\n` +
        `Unknown provider "${id}" (from model "${spec}"). Known: ${known}. Run flowgit providers, or add it to ${globalProvidersFile()}.`,
    );
  }
  return { provider: effectiveProvider(p), model };
}

/**
 * The address this flow's own flowgit.local.json gives a provider that sends a key, if it gives one.
 * A folder downloaded with git clone keeps that file, so it could point a key you already use at
 * another server; doctor and the run log say so. (flowgit init and share never copy the file.)
 */
export function flowKeyEndpoint(p: Provider, dir: string): string | undefined {
  if (!p.apiKeyEnv) return undefined;
  const file = providerFiles(dir).flow;
  if (!file) return undefined;
  const local = readProvidersFile(file);
  return Object.hasOwn(local, p.id) ? local[p.id]?.baseUrl : undefined;
}

/** Bilingual note for flowKeyEndpoint. */
export function flowKeyEndpointNote(p: Provider, baseUrl: string): string {
  return `${p.id} 的地址是这个流程的 flowgit.local.json 设的：${baseUrl}，密钥 ${p.apiKeyEnv} 会发到那里 / flowgit.local.json in this flow sets the address for ${p.id} to ${baseUrl}; your ${p.apiKeyEnv} key is sent there`;
}

/** Whether the provider's key is available. "none" = this provider needs no key. */
export function providerKeyState(p: Provider, env: NodeJS.ProcessEnv = process.env): "set" | "unset" | "none" {
  if (!p.apiKeyEnv) return "none";
  if (env[p.apiKeyEnv]) return "set";
  // The Anthropic SDK also accepts ANTHROPIC_AUTH_TOKEN for the default provider.
  if (p.id === DEFAULT_PROVIDER && p.apiKeyEnv === "ANTHROPIC_API_KEY" && env.ANTHROPIC_AUTH_TOKEN) return "set";
  return "unset";
}

/** Bilingual "set this env var" message, with PowerShell and bash examples. */
export function missingKeyMessage(p: Provider): string {
  const v = p.apiKeyEnv ?? "";
  return (
    `缺少密钥：provider "${p.id}" 的密钥从环境变量 ${v} 读取，请先设置它。PowerShell：$env:${v}="..."；macOS/Linux：export ${v}=...\n` +
    `Missing key: provider "${p.id}" reads its key from the environment variable ${v}. Set it first. PowerShell: $env:${v}="..."; macOS/Linux: export ${v}=...`
  );
}
