/**
 * Desktop releases are tagged `desktop-v*`. CLI releases are tagged `v*` and
 * must never be offered as an app update.
 *
 * electron-builder records the prefix on the GitHub publisher
 * (https://www.electron.build/publish — GithubOptions.tagNamePrefix, default "v").
 * electron-updater 6.8's GitHubProvider still chooses a version from GitHub's
 * `/releases/latest` redirect and does not apply tagNamePrefix when it searches,
 * so a newer `v*` CLI release would look like an update. This module picks the
 * release instead, and the app opens that release's page. It does not download
 * or install by itself.
 *
 * https://www.electron.build/auto-update
 */

export const DESKTOP_TAG_PREFIX = "desktop-v";

/** What electron-builder writes for the GitHub provider. Tag prefix is desktop-v, not v. */
export const DESKTOP_PUBLISH = {
  provider: "github" as const,
  owner: "cgold9820-dotcom",
  repo: "Flowgit",
  releaseType: "release" as const,
  tagNamePrefix: DESKTOP_TAG_PREFIX,
};

export interface GitHubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
}

export interface DesktopUpdate {
  tag: string;
  version: string;
  url: string;
}

function parseVersion(tag: string): number[] | null {
  if (!tag.startsWith(DESKTOP_TAG_PREFIX)) return null;
  const raw = tag.slice(DESKTOP_TAG_PREFIX.length);
  if (!/^\d+\.\d+\.\d+$/.test(raw)) return null;
  return raw.split(".").map((part) => Number(part));
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

/**
 * The newest published `desktop-v*` release newer than `currentVersion`.
 * Drafts, prereleases, and any tag that does not start with `desktop-v`
 * (including CLI `v*` tags) are ignored.
 */
export function pickDesktopUpdate(releases: readonly GitHubRelease[], currentVersion: string): DesktopUpdate | null {
  const current = parseVersion(`${DESKTOP_TAG_PREFIX}${currentVersion}`);
  if (!current) return null;
  let best: { version: number[]; update: DesktopUpdate } | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const tag = release.tag_name;
    if (!tag || !release.html_url) continue;
    if (!tag.startsWith(DESKTOP_TAG_PREFIX)) continue;
    const version = parseVersion(tag);
    if (!version || compare(version, current) <= 0) continue;
    if (!best || compare(version, best.version) > 0) {
      best = { version, update: { tag, version: version.join("."), url: release.html_url } };
    }
  }
  return best?.update ?? null;
}

/** GitHub releases API body → the desktop update, or null. Never throws on a bad body. */
export function pickDesktopUpdateFromJson(body: unknown, currentVersion: string): DesktopUpdate | null {
  if (!Array.isArray(body)) return null;
  const releases: GitHubRelease[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const row = item as GitHubRelease;
    releases.push({
      tag_name: typeof row.tag_name === "string" ? row.tag_name : undefined,
      draft: row.draft === true,
      prerelease: row.prerelease === true,
      html_url: typeof row.html_url === "string" ? row.html_url : undefined,
    });
  }
  return pickDesktopUpdate(releases, currentVersion);
}

export async function checkForDesktopUpdate(currentVersion: string, fetchImpl: typeof fetch = fetch): Promise<DesktopUpdate | null> {
  const response = await fetchImpl(`https://api.github.com/repos/${DESKTOP_PUBLISH.owner}/${DESKTOP_PUBLISH.repo}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "flowgit-desktop" },
  });
  if (!response.ok) return null;
  return pickDesktopUpdateFromJson(await response.json(), currentVersion);
}
