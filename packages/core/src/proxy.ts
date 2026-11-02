import { execFileSync } from "node:child_process";
import http from "node:http";

/**
 * Proxies for Flowgit's own model and service requests.
 *
 * Node's fetch ignores HTTPS_PROXY unless it starts with NODE_USE_ENV_PROXY=1, and it never reads
 * the system proxy that Windows and macOS proxy apps set. So the CLI picks a proxy (pickProxy) and
 * routes through it: in-process where Node allows that (applyProxy), otherwise by starting the
 * command again with NODE_USE_ENV_PROXY=1 and the variables from proxyEnvVars().
 * https://nodejs.org/api/http.html#built-in-proxy-support
 */

/** Where a proxy setting came from. */
export type ProxySource = "env" | "windows" | "macos";

export interface ProxyInfo {
  /** The proxy URL, with "http://" added when the setting had no scheme. Print it with showProxy(). */
  url: string;
  source: ProxySource;
  /** The environment variable it came from, for source "env". */
  variable?: string;
  /** Hosts that skip the proxy, in NO_PROXY form. */
  noProxy?: string;
  /** False when Node can't use it, e.g. a socks5:// proxy. */
  usable: boolean;
}

/**
 * How this Node can send fetch through a proxy:
 * "runtime": in-process, with http.setGlobalProxyFromEnv() (Node 24.14+, 25.4+);
 * "restart": only from startup, with NODE_USE_ENV_PROXY=1 (Node 22.21+, 24.0+);
 * "none": not at all (older Node 22, Node 23).
 */
export type ProxySupport = "runtime" | "restart" | "none";

/** Always skipped, so a local model (Ollama) or service never goes through the proxy. */
export const LOCAL_NO_PROXY = "localhost,127.0.0.1,::1";

/** The variables Node reads, in the order it prefers them for HTTPS requests. */
const NODE_PROXY_VARS = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"] as const;

/** A URL Node can use as a proxy: http or https, with "http://" added when the scheme is missing. Undefined otherwise. */
export function usableProxyUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? withScheme : undefined;
  } catch {
    return undefined;
  }
}

/** A proxy URL without its user name and password, for messages. */
export function showProxy(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/\/[^@/]*@/, "//");
  }
}

/** True when FLOWGIT_PROXY=off (or 0) asks Flowgit to leave proxies alone. */
export function proxyOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(off|0)$/i.test(env.FLOWGIT_PROXY?.trim() ?? "");
}

/**
 * The names among `names` that are set in `env`, as `env` spells them, in the order given.
 * Windows matches variable names in any case (`env.https_proxy` there also reads HTTPS_PROXY), so
 * there a name matches whatever case it was set in; elsewhere only the exact name does, as in Node.
 */
function presentVars(env: NodeJS.ProcessEnv, names: readonly string[], platform: NodeJS.Platform): string[] {
  const keys = Object.keys(env);
  const found: string[] = [];
  for (const name of names) {
    const key = keys.find((k) => k === name) ?? (platform === "win32" ? keys.find((k) => k.toLowerCase() === name.toLowerCase()) : undefined);
    if (key && env[key]?.trim() && !found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * The proxy set in the environment: https_proxy, HTTPS_PROXY, http_proxy or HTTP_PROXY, read the
 * way Node reads them, then ALL_PROXY, which Node itself ignores. Not usable when any of Node's
 * variables holds something Node can't use (it would refuse to start with NODE_USE_ENV_PROXY=1).
 */
export function envProxy(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ProxyInfo | undefined {
  const set = presentVars(env, NODE_PROXY_VARS, platform);
  const noProxy = env.no_proxy || env.NO_PROXY || undefined;
  if (set.length) {
    const bad = set.find((k) => !usableProxyUrl(env[k]));
    const variable = bad ?? set[0]!;
    return { url: usableProxyUrl(env[variable]) ?? env[variable]!.trim(), source: "env", variable, noProxy, usable: !bad };
  }
  const [variable] = presentVars(env, ["all_proxy", "ALL_PROXY"], platform);
  if (variable) {
    const raw = env[variable]!.trim();
    return { url: usableProxyUrl(raw) ?? raw, source: "env", variable, noProxy, usable: !!usableProxyUrl(raw) };
  }
  return undefined;
}

/** NO_PROXY from a system bypass list. Node only matches host names and domain suffixes, so IP wildcards and CIDR ranges are left out. */
export function noProxyFrom(entries: string[]): string {
  const hosts = new Set(LOCAL_NO_PROXY.split(","));
  for (const raw of entries) {
    const entry = raw.trim().toLowerCase();
    if (!entry || entry === "<local>" || entry.includes("/")) continue;
    if (/^[\d.*]+$/.test(entry) && entry.includes("*")) continue; // 10.*, 192.168.*
    if (/^[a-z0-9*.:[\]-]+$/.test(entry)) hosts.add(entry);
  }
  return [...hosts].join(",");
}

/**
 * The Windows system proxy, from `reg query` on Internet Settings (what Clash, v2rayN and most
 * proxy apps set in "system proxy" mode). A socks-only setting is left out: Node can't use it.
 */
export function parseWindowsProxy(regOutput: string): ProxyInfo | undefined {
  const value = (name: string) => regOutput.match(new RegExp(`^[ \\t]+${name}[ \\t]+REG_\\w+[ \\t]*(.*)$`, "m"))?.[1]?.trim();
  if (!/^0x0*1$/i.test(value("ProxyEnable") ?? "")) return undefined;
  let server = value("ProxyServer") ?? "";
  if (server.includes("=")) {
    // http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891
    const byProtocol = new Map(
      server.split(";").map((part) => {
        const [k = "", v = ""] = part.split("=");
        return [k.trim().toLowerCase(), v.trim()] as const;
      }),
    );
    server = byProtocol.get("https") || byProtocol.get("http") || "";
  }
  const url = usableProxyUrl(server);
  if (!url) return undefined;
  return { url, source: "windows", noProxy: noProxyFrom(value("ProxyOverride")?.split(";") ?? []), usable: true };
}

/** The macOS system proxy, from `scutil --proxy` (HTTPS first, then HTTP). */
export function parseMacProxy(scutilOutput: string): ProxyInfo | undefined {
  const value = (key: string) => scutilOutput.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, "m"))?.[1];
  const block = scutilOutput.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1] ?? "";
  const exceptions = [...block.matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
  for (const protocol of ["HTTPS", "HTTP"]) {
    if (value(`${protocol}Enable`) !== "1") continue;
    const host = value(`${protocol}Proxy`);
    const port = value(`${protocol}Port`);
    const url = host ? usableProxyUrl(port ? `${host}:${port}` : host) : undefined;
    if (url) return { url, source: "macos", noProxy: noProxyFrom(exceptions), usable: true };
  }
  return undefined;
}

function runQuiet(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

/** The system proxy on Windows and macOS, if one is turned on. Undefined elsewhere. */
export function systemProxy(platform: NodeJS.Platform = process.platform, run: (command: string, args: string[]) => string | undefined = runQuiet): ProxyInfo | undefined {
  if (platform === "win32") {
    const out = run("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"]);
    return out === undefined ? undefined : parseWindowsProxy(out);
  }
  if (platform === "darwin") {
    const out = run("scutil", ["--proxy"]);
    return out === undefined ? undefined : parseMacProxy(out);
  }
  return undefined;
}

/**
 * The proxy Flowgit routes through: the environment's, else the system proxy. An HTTP(S)_PROXY that
 * Node can't use still wins (it is what the user set); an unusable ALL_PROXY gives way to the system
 * proxy. Undefined with FLOWGIT_PROXY=off.
 */
export function pickProxy(env: NodeJS.ProcessEnv = process.env, system: () => ProxyInfo | undefined = systemProxy): ProxyInfo | undefined {
  if (proxyOff(env)) return undefined;
  const fromEnv = envProxy(env);
  if (fromEnv && (fromEnv.usable || !/^all_proxy$/i.test(fromEnv.variable ?? ""))) return fromEnv;
  return system() ?? fromEnv;
}

/** What this Node can do; see ProxySupport. */
export function proxySupport(
  version: string = process.versions.node,
  runtime: boolean = typeof (http as { setGlobalProxyFromEnv?: unknown }).setGlobalProxyFromEnv === "function",
): ProxySupport {
  if (runtime) return "runtime";
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  return (major === 22 && minor >= 21) || major >= 24 ? "restart" : "none";
}

/**
 * The variables to add to `env` so that Node, reading them, uses `proxy`: a scheme added where the
 * user's own variable lacks one, HTTP(S)_PROXY for ALL_PROXY or a system proxy, and NO_PROXY for
 * local addresses unless the user set one.
 */
export function proxyEnvVars(proxy: ProxyInfo, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const vars: Record<string, string> = {};
  if (proxy.source === "env" && /^https?_proxy$/i.test(proxy.variable ?? "")) {
    for (const k of presentVars(env, NODE_PROXY_VARS, platform)) {
      const url = usableProxyUrl(env[k]);
      if (url && url !== env[k]) vars[k] = url;
    }
  } else {
    vars.HTTPS_PROXY = proxy.url;
    vars.HTTP_PROXY = proxy.url;
  }
  if (!env.NO_PROXY && !env.no_proxy) vars.NO_PROXY = proxy.noProxy ?? LOCAL_NO_PROXY;
  return vars;
}

/** Route fetch and http(s).request in this process through the proxy in `env`. False when this Node can't do that at runtime. */
export function applyProxy(env: NodeJS.ProcessEnv): boolean {
  const set = (http as { setGlobalProxyFromEnv?: (env: NodeJS.ProcessEnv) => unknown }).setGlobalProxyFromEnv;
  if (typeof set !== "function") return false;
  try {
    set.call(http, env);
    return true;
  } catch {
    return false;
  }
}

let state: { proxy: ProxyInfo; applied: boolean } | undefined;

/** Record the proxy this process picked and whether its requests go through it, for messages. */
export function setProxyState(next: { proxy: ProxyInfo; applied: boolean } | undefined): void {
  state = next;
}

/** The proxy this process picked, and whether its requests go through it. */
export function proxyState(): { proxy: ProxyInfo; applied: boolean } | undefined {
  return state;
}

/** Where a proxy came from, as [Chinese, English]. */
export function proxySourceLabel(proxy: ProxyInfo): [string, string] {
  if (proxy.source === "windows") return ["Windows 系统代理", "the Windows system proxy"];
  if (proxy.source === "macos") return ["macOS 系统代理", "the macOS system proxy"];
  return [proxy.variable ?? "HTTPS_PROXY", proxy.variable ?? "HTTPS_PROXY"];
}

function isLocalTarget(target: string | undefined): boolean {
  if (!target) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(target).hostname);
  } catch {
    return false;
  }
}

/** Why `proxy` can't be used here, as [Chinese, English], or undefined when it can. */
export function proxyProblem(proxy: ProxyInfo, support: ProxySupport = proxySupport()): [string, string] | undefined {
  const [zh, en] = proxySourceLabel(proxy);
  if (!proxy.usable) {
    return [
      `${zh} 是 ${showProxy(proxy.url)}，Node 只能用 http 代理。Clash 等软件的同一个端口一般也收 http，改成 http://… 试试，或者打开代理软件的 TUN 模式。`,
      `${en} is ${showProxy(proxy.url)}, but Node can only use http proxies. Apps like Clash usually accept http on the same port, so try http://…, or turn on the app's TUN mode.`,
    ];
  }
  if (support === "none") {
    return [
      `检测到 ${zh}（${showProxy(proxy.url)}），但这个版本的 Node（${process.version}）没法走代理。升级到 Node 22.21 以上或 24 以上。`,
      `Found ${en} (${showProxy(proxy.url)}), but this Node (${process.version}) can't use proxies. Update to Node 22.21+ or 24+.`,
    ];
  }
  return undefined;
}

/**
 * Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set, so behind a proxy (or a VPN
 * that only exports proxy variables) requests fail to connect. Returns the name of the proxy
 * variable Node is ignoring in this process, if any.
 */
export function ignoredProxyVar(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (state?.applied) return undefined;
  const proxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].find((k) => env[k]);
  return proxy && env.NODE_USE_ENV_PROXY !== "1" ? proxy : undefined;
}

/**
 * What to add when a request to `target` couldn't connect: which proxy it went through, why a
 * proxy that was found isn't used, or how to set one. Nothing for local addresses.
 */
export function proxyHint(env: NodeJS.ProcessEnv = process.env, target?: string): string[] | undefined {
  if (isLocalTarget(target)) return undefined;
  if (state?.applied) {
    const [zh, en] = proxySourceLabel(state.proxy);
    const where = showProxy(state.proxy.url);
    return [
      `这次请求走的是代理 ${where}（${zh}）。确认代理软件开着、能连外网；不想走代理就设置 FLOWGIT_PROXY=off。`,
      `This request went through the proxy ${where} (${en}). Check that the proxy app is running and online; to skip the proxy, set FLOWGIT_PROXY=off.`,
    ];
  }
  if (proxyOff(env)) return undefined;
  const proxy = state?.proxy ?? envProxy(env);
  if (proxy) {
    const problem = proxyProblem(proxy);
    if (problem) return problem;
    const variable = proxy.variable ?? "HTTPS_PROXY";
    if (proxy.source === "env" && env.NODE_USE_ENV_PROXY !== "1") {
      // Flowgit used as a library: the CLI would have routed through it.
      return [
        `检测到 ${variable}，但 Node 默认不走代理。设置 NODE_USE_ENV_PROXY=1 后重试（PowerShell：$env:NODE_USE_ENV_PROXY="1"；macOS/Linux：export NODE_USE_ENV_PROXY=1），或者用 flowgit 命令来跑。`,
        `${variable} is set, but Node ignores proxies by default. Set NODE_USE_ENV_PROXY=1 and try again (PowerShell: $env:NODE_USE_ENV_PROXY="1"; macOS/Linux: export NODE_USE_ENV_PROXY=1), or run it with the flowgit command.`,
      ];
    }
    return undefined;
  }
  return [
    "用代理或 VPN 上网的话：设置 HTTPS_PROXY（例如 http://127.0.0.1:7890），或者打开代理软件的系统代理或 TUN 模式。",
    "Behind a proxy or VPN? Set HTTPS_PROXY (e.g. http://127.0.0.1:7890), or turn on your proxy app's system proxy or TUN mode.",
  ];
}
