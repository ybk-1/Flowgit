import path from "node:path";

/** Shown when no CLI is found. Nothing is downloaded, and the latest CLI is not fetched on demand. */
export const CLI_INSTALL_HINT = "npm i -g flowgit";

export interface CliSearch {
  /** Already resolved. Empty means the setting is unset. */
  configured?: string;
  workspaceFolders: string[];
  pathEnv?: string;
  platform: NodeJS.Platform;
  /** Restricted Mode must not run a binary from the workspace's node_modules. */
  allowWorkspaceBin: boolean;
}

export type CliResolution =
  | { ok: true; path: string; source: "setting" | "workspace" | "path" }
  | { ok: false; reason: "not-found" | "setting-missing"; configured?: string; hint: string };

export function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

export function resolveConfiguredCli(configured: string, workspaceFolder: string | undefined, platform: NodeJS.Platform = process.platform): string {
  const p = pathFor(platform);
  const trimmed = configured.trim();
  if (!trimmed) return "";
  if (p.isAbsolute(trimmed)) return trimmed;
  if (workspaceFolder) return p.resolve(workspaceFolder, trimmed);
  return p.resolve(trimmed);
}

function executableNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["flowgit.cmd", "flowgit.exe", "flowgit"] : ["flowgit"];
}

/** Candidate executables, in the order they are tried. */
export function cliCandidatePaths(search: CliSearch): { path: string; source: "setting" | "workspace" | "path" }[] {
  const configured = search.configured?.trim() ?? "";
  if (configured) return [{ path: configured, source: "setting" }];

  const p = pathFor(search.platform);
  const names = executableNames(search.platform);
  const out: { path: string; source: "workspace" | "path" }[] = [];
  if (search.allowWorkspaceBin) {
    for (const folder of search.workspaceFolders) {
      for (const name of names) out.push({ path: p.join(folder, "node_modules", ".bin", name), source: "workspace" });
    }
  }
  const delimiter = search.platform === "win32" ? ";" : ":";
  for (const dir of (search.pathEnv ?? "").split(delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    for (const name of names) out.push({ path: p.join(trimmed, name), source: "path" });
  }
  return out;
}

export function resolveCli(search: CliSearch, exists: (file: string) => boolean): CliResolution {
  const candidates = cliCandidatePaths(search);
  if ((search.configured?.trim() ?? "") && candidates.length === 1 && !exists(candidates[0]!.path)) {
    return { ok: false, reason: "setting-missing", configured: candidates[0]!.path, hint: CLI_INSTALL_HINT };
  }
  for (const candidate of candidates) {
    if (exists(candidate.path)) return { ok: true, path: candidate.path, source: candidate.source };
  }
  return { ok: false, reason: "not-found", hint: CLI_INSTALL_HINT };
}
