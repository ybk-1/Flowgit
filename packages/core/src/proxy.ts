import { execFileSync } from "node:child_process";
import http from "node:http";
import { envProxy, parseMacProxy, parseWindowsProxy, proxyOff, setProxySupportProbe, type ProxyInfo, type ProxySupport } from "./proxy-env.js";

// The parts of proxy handling that need Node: reading the system proxy and routing fetch.
// Everything else lives in proxy-env.ts, which the browser entry can use too.
export * from "./proxy-env.js";

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

setProxySupportProbe(() => proxySupport());
