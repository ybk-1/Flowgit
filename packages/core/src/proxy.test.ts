import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_NO_PROXY,
  envProxy,
  noProxyFrom,
  parseMacProxy,
  parseWindowsProxy,
  pickProxy,
  proxyEnvVars,
  proxyHint,
  proxySupport,
  setProxyState,
  showProxy,
  systemProxy,
  usableProxyUrl,
  type ProxyInfo,
} from "./proxy.js";

// `reg query` on Internet Settings with Clash's "system proxy" switched on (CRLF, like the real thing).
const WINDOWS = [
  "",
  "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
  "    User Agent    REG_SZ    Mozilla/4.0 (compatible; MSIE 8.0; Win32)",
  "    ProxyEnable    REG_DWORD    0x1",
  "    ProxyServer    REG_SZ    127.0.0.1:7890",
  "    ProxyOverride    REG_SZ    localhost;127.*;10.*;172.16.*;192.168.*;*.lan;<local>",
  "",
  "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\5.0",
  "",
].join("\r\n");

// `scutil --proxy` on macOS with the HTTP and HTTPS proxies on.
const MAC = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : localhost
    3 : *.local
  }
  ExcludeSimpleHostnames : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7891
  SOCKSProxy : 127.0.0.1
}
`;

const windowsProxy: ProxyInfo = { url: "http://127.0.0.1:7890", source: "windows", noProxy: `${LOCAL_NO_PROXY},*.lan`, usable: true };

afterEach(() => setProxyState(undefined));

describe("proxy settings", () => {
  it("takes http and https proxy URLs, adds a missing scheme, and hides credentials in messages", () => {
    expect(usableProxyUrl("127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(usableProxyUrl(" https://proxy.example.com:8443 ")).toBe("https://proxy.example.com:8443");
    expect(usableProxyUrl("socks5://127.0.0.1:7891")).toBeUndefined();
    expect(usableProxyUrl("")).toBeUndefined();
    expect(showProxy("http://me:secret@127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
  });

  it("reads the environment the way Node does, then ALL_PROXY", () => {
    expect(envProxy({})).toBeUndefined();
    expect(envProxy({ HTTPS_PROXY: "http://a:1", https_proxy: "http://b:2", HTTP_PROXY: "http://c:3" })).toMatchObject({ url: "http://b:2", variable: "https_proxy", usable: true });
    expect(envProxy({ HTTP_PROXY: "http://c:3", NO_PROXY: "corp.example" })).toMatchObject({ url: "http://c:3", variable: "HTTP_PROXY", noProxy: "corp.example" });
    expect(envProxy({ ALL_PROXY: "http://d:4" })).toMatchObject({ url: "http://d:4", variable: "ALL_PROXY", usable: true });
    // one bad variable makes the lot unusable: Node would refuse to start with it
    expect(envProxy({ HTTPS_PROXY: "http://a:1", HTTP_PROXY: "socks5://e:5" })).toMatchObject({ variable: "HTTP_PROXY", usable: false });
    // Windows reads names in any case, and messages use the name as it was set
    expect(envProxy({ Https_Proxy: "http://a:1" }, "linux")).toBeUndefined();
    expect(envProxy({ Https_Proxy: "http://a:1" }, "win32")).toMatchObject({ url: "http://a:1", variable: "Https_Proxy" });
    expect(envProxy({ HTTPS_PROXY: "http://a:1" }, "win32")?.variable).toBe("HTTPS_PROXY");
  });

  it("reads the Windows system proxy from the registry", () => {
    expect(parseWindowsProxy(WINDOWS)).toEqual(windowsProxy);
    expect(parseWindowsProxy(WINDOWS.replace("0x1", "0x0"))).toBeUndefined();
    const perProtocol = WINDOWS.replace("127.0.0.1:7890", "http=127.0.0.1:7890;https=127.0.0.1:7897;socks=127.0.0.1:7891");
    expect(parseWindowsProxy(perProtocol)?.url).toBe("http://127.0.0.1:7897");
    expect(parseWindowsProxy(WINDOWS.replace("127.0.0.1:7890", "socks=127.0.0.1:7891"))).toBeUndefined();
  });

  it("reads the macOS system proxy from scutil, HTTPS first", () => {
    expect(parseMacProxy(MAC)).toEqual({ url: "http://127.0.0.1:7897", source: "macos", noProxy: `${LOCAL_NO_PROXY},*.local`, usable: true });
    expect(parseMacProxy(MAC.replace("HTTPSEnable : 1", "HTTPSEnable : 0"))?.url).toBe("http://127.0.0.1:7890");
    expect(parseMacProxy("<dictionary> {\n  HTTPEnable : 0\n}\n")).toBeUndefined();
  });

  it("keeps host names from a bypass list, and always local addresses", () => {
    expect(noProxyFrom(["localhost", "127.*", "10.0.0.0/8", "<local>", "*.corp.example", "printer.lan", "192.168.1.10"])).toBe(
      "localhost,127.0.0.1,::1,*.corp.example,printer.lan,192.168.1.10",
    );
  });

  it("asks the operating system only on Windows and macOS", () => {
    const calls: string[] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      return command === "reg" ? WINDOWS : MAC;
    };
    expect(systemProxy("linux", run)).toBeUndefined();
    expect(systemProxy("win32", run)).toEqual(windowsProxy);
    expect(systemProxy("darwin", run)?.source).toBe("macos");
    expect(calls).toEqual(["reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "scutil --proxy"]);
    expect(systemProxy("win32", () => undefined)).toBeUndefined();
  });

  it("prefers the environment over the system proxy, unless FLOWGIT_PROXY=off", () => {
    const system = () => windowsProxy;
    expect(pickProxy({}, system)).toBe(windowsProxy);
    expect(pickProxy({ HTTPS_PROXY: "http://a:1" }, system)).toMatchObject({ source: "env", variable: "HTTPS_PROXY" });
    expect(pickProxy({ FLOWGIT_PROXY: "off" }, system)).toBeUndefined();
    // a socks ALL_PROXY gives way to the system proxy; a socks HTTPS_PROXY is what the user chose
    expect(pickProxy({ ALL_PROXY: "socks5://e:5" }, system)).toBe(windowsProxy);
    expect(pickProxy({ ALL_PROXY: "socks5://e:5" }, () => undefined)).toMatchObject({ variable: "ALL_PROXY", usable: false });
    expect(pickProxy({ HTTPS_PROXY: "socks5://e:5" }, system)).toMatchObject({ variable: "HTTPS_PROXY", usable: false });
  });

  it("knows which Node versions can use a proxy, and how", () => {
    expect(proxySupport("22.20.0", false)).toBe("none");
    expect(proxySupport("22.21.0", false)).toBe("restart");
    expect(proxySupport("23.11.1", false)).toBe("none");
    expect(proxySupport("24.0.0", false)).toBe("restart");
    expect(proxySupport("v24.13.1", false)).toBe("restart");
    expect(proxySupport("24.14.0", true)).toBe("runtime");
  });

  it("tells Node about the proxy with HTTP(S)_PROXY and NO_PROXY", () => {
    expect(proxyEnvVars(windowsProxy, {})).toEqual({ HTTPS_PROXY: windowsProxy.url, HTTP_PROXY: windowsProxy.url, NO_PROXY: windowsProxy.noProxy });
    // the user's own variables stay; only a missing scheme is filled in
    const env = { HTTPS_PROXY: "127.0.0.1:7890", HTTP_PROXY: "http://127.0.0.1:7890", NO_PROXY: "corp.example" };
    expect(proxyEnvVars(envProxy(env)!, env)).toEqual({ HTTPS_PROXY: "http://127.0.0.1:7890" });
    const all = { ALL_PROXY: "http://127.0.0.1:7890" };
    expect(proxyEnvVars(envProxy(all)!, all)).toEqual({ HTTPS_PROXY: "http://127.0.0.1:7890", HTTP_PROXY: "http://127.0.0.1:7890", NO_PROXY: LOCAL_NO_PROXY });
  });

  it("explains a failed connection: the proxy used, a proxy Node can't use, or how to set one", () => {
    const target = "https://api.example.com/v1";
    expect(proxyHint({}, "http://localhost:11434/v1")).toBeUndefined();
    expect(proxyHint({}, target)?.join("\n")).toMatch(/Set HTTPS_PROXY/);
    expect(proxyHint({ FLOWGIT_PROXY: "off" }, target)).toBeUndefined();
    expect(proxyHint({ HTTPS_PROXY: "socks5://127.0.0.1:7891" }, target)?.join("\n")).toMatch(/Node can only use http proxies/);
    setProxyState({ proxy: { ...windowsProxy, url: "http://me:secret@127.0.0.1:7890" }, applied: true });
    const hint = proxyHint({}, target)?.join("\n");
    expect(hint).toContain("went through the proxy http://127.0.0.1:7890 (the Windows system proxy)");
    expect(hint).not.toContain("secret");
  });
});
