import { describe, expect, it } from "vitest";
import {
  HOME_CSP,
  HOME_URL,
  isAllowedExternal,
  isAllowedNavigation,
  isTemplateId,
  isTrustedIpcSender,
  languageFromArgv,
} from "./policy.js";

const board = "http://127.0.0.1:43123";

describe("desktop navigation policy", () => {
  it("keeps a strict home content security policy", () => {
    expect(HOME_CSP).toContain("default-src 'none'");
    expect(HOME_CSP).toContain("script-src 'self'");
    expect(HOME_CSP).not.toContain("unsafe-eval");
    expect(HOME_CSP).not.toContain("unsafe-inline");
  });

  it("allows the home page and that board's origin, and nothing else", () => {
    expect(isAllowedNavigation(HOME_URL, null)).toBe(true);
    expect(isAllowedNavigation(`${board}/?token=abc`, board)).toBe(true);
    expect(isAllowedNavigation(`${board}/style.css`, board)).toBe(true);
    expect(isAllowedNavigation("about:blank", null)).toBe(true);
    expect(isAllowedNavigation("https://example.com/", board)).toBe(false);
    expect(isAllowedNavigation("http://127.0.0.1:1/", board)).toBe(false);
    expect(isAllowedNavigation("http://localhost:43123/", board)).toBe(false);
    expect(isAllowedNavigation("file:///etc/passwd", board)).toBe(false);
    expect(isAllowedNavigation(`${board}/`, null)).toBe(false);
  });

  it("opens only http and https outside the window", () => {
    expect(isAllowedExternal("https://ffmpeg.org/download.html")).toBe(true);
    expect(isAllowedExternal("http://127.0.0.1:9/nope")).toBe(true);
    expect(isAllowedExternal("file:///tmp/x")).toBe(false);
    expect(isAllowedExternal("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternal("flowgit://app/index.html")).toBe(false);
  });

  it("accepts IPC only from the home origin", () => {
    expect(isTrustedIpcSender(HOME_URL)).toBe(true);
    expect(isTrustedIpcSender("flowgit://app/home.js")).toBe(true);
    expect(isTrustedIpcSender(`${board}/?token=abc`)).toBe(false);
    expect(isTrustedIpcSender("https://example.com/")).toBe(false);
    expect(isTrustedIpcSender(undefined)).toBe(false);
  });

  it("reads only a zh or en language argument", () => {
    expect(languageFromArgv(["electron", "--flowgit-lang=en"])).toBe("en");
    expect(languageFromArgv(["--flowgit-lang=zh"])).toBe("zh");
    expect(languageFromArgv(["--flowgit-lang=fr"])).toBeNull();
    expect(languageFromArgv([])).toBeNull();
    expect(isTemplateId("weekly-report")).toBe(true);
    expect(isTemplateId("../etc")).toBe(false);
    expect(isTemplateId("")).toBe(false);
  });
});
