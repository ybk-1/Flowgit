import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_INSTALL_HINT, cliCandidatePaths, resolveCli, resolveConfiguredCli } from "./cli.js";

describe("resolveCli", () => {
  it("uses the setting and does not fall through when that file is missing", () => {
    const resolved = resolveCli(
      {
        configured: "/opt/missing/flowgit",
        workspaceFolders: ["/work/my flow"],
        pathEnv: "/usr/bin",
        platform: "linux",
        allowWorkspaceBin: true,
      },
      (file) => file === "/work/my flow/node_modules/.bin/flowgit" || file === "/usr/bin/flowgit",
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe("setting-missing");
      expect(resolved.hint).toBe(CLI_INSTALL_HINT);
      expect(resolved.hint.includes("npx")).toBe(false);
    }
  });

  it("prefers the workspace bin, then PATH, and skips the workspace bin in Restricted Mode", () => {
    const workspace = "/work/my flow/node_modules/.bin/flowgit";
    const onPath = "/opt/flow git/bin/flowgit";
    const search = {
      workspaceFolders: ["/work/my flow"],
      pathEnv: "/opt/flow git/bin:/usr/bin",
      platform: "linux" as const,
      allowWorkspaceBin: true,
    };
    const exists = (file: string) => file === workspace || file === onPath;
    expect(resolveCli(search, exists)).toEqual({ ok: true, path: workspace, source: "workspace" });
    expect(resolveCli({ ...search, allowWorkspaceBin: false }, exists)).toEqual({ ok: true, path: onPath, source: "path" });
  });

  it("names the install command when nothing is found", () => {
    const resolved = resolveCli({ workspaceFolders: ["/work"], pathEnv: "", platform: "linux", allowWorkspaceBin: true }, () => false);
    expect(resolved).toEqual({ ok: false, reason: "not-found", hint: CLI_INSTALL_HINT });
  });

  it("builds Windows candidates with drive letters and spaces", () => {
    const paths = cliCandidatePaths({
      workspaceFolders: ["C:\\work\\my flow"],
      pathEnv: "C:\\Program Files\\Flowgit;C:\\Windows",
      platform: "win32",
      allowWorkspaceBin: true,
    }).map((candidate) => candidate.path);
    expect(paths).toContain(path.win32.join("C:\\work\\my flow", "node_modules", ".bin", "flowgit.cmd"));
    expect(paths).toContain(path.win32.join("C:\\Program Files\\Flowgit", "flowgit.cmd"));
    expect(paths.some((file) => file.includes("flowgit.cmd") && file.includes("my flow"))).toBe(true);
  });

  it("resolves a relative setting from the workspace folder", () => {
    expect(resolveConfiguredCli("bin/flowgit", "/work/my flow", "linux")).toBe("/work/my flow/bin/flowgit");
    expect(resolveConfiguredCli("bin\\flowgit.cmd", "C:\\work\\my flow", "win32")).toBe(path.win32.join("C:\\work\\my flow", "bin", "flowgit.cmd"));
    expect(resolveConfiguredCli("  ", "/work", "linux")).toBe("");
  });
});
