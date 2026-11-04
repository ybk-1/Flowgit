/**
 * Window and IPC rules for the desktop shell.
 *
 * Electron security checklist:
 * 7. Content-Security-Policy — https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy
 * 17. Validate the sender of every IPC message — https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
 * 18. Custom protocol instead of file:// — https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols
 */

/** Scheme registered with protocol.handle. Host is `app` (flowgit://app/...). */
export const HOME_SCHEME = "flowgit";
export const HOME_HOST = "app";
export const HOME_URL = `${HOME_SCHEME}://${HOME_HOST}/index.html`;

/**
 * CSP for the home page. default-src is none; scripts and styles are same-origin
 * files of this scheme only. No inline scripts, no remote content.
 */
export const HOME_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const HOME_LANG_ARG = "--flowgit-lang=";

/** The language argument passed to a renderer via additionalArguments. */
export function languageArgument(lang: "zh" | "en" | null): string[] {
  return lang ? [`${HOME_LANG_ARG}${lang}`] : [];
}

/** Read `--flowgit-lang=` from a renderer's argv. Anything else is ignored. */
export function languageFromArgv(argv: readonly string[]): "zh" | "en" | null {
  const item = argv.find((entry) => entry.startsWith(HOME_LANG_ARG));
  if (!item) return null;
  const value = item.slice(HOME_LANG_ARG.length);
  return value === "zh" || value === "en" ? value : null;
}

/** True for the desktop home page served by the custom protocol. */
export function isHomeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${HOME_SCHEME}:` && parsed.hostname === HOME_HOST;
  } catch {
    return false;
  }
}

/** True for a page on the board server this process started (127.0.0.1 and that port only). */
export function isBoardUrl(url: string, boardOrigin: string | null): boolean {
  if (!boardOrigin) return false;
  let page: URL;
  let board: URL;
  try {
    page = new URL(url);
    board = new URL(boardOrigin);
  } catch {
    return false;
  }
  return page.protocol === "http:" && page.hostname === "127.0.0.1" && page.port === board.port && board.hostname === "127.0.0.1";
}

/**
 * A window may navigate only to the home pages and, for a board window, that board's origin.
 * about:blank is the empty document Electron creates before the first load.
 */
export function isAllowedNavigation(url: string, boardOrigin: string | null): boolean {
  if (url === "about:blank") return true;
  return isHomeUrl(url) || isBoardUrl(url, boardOrigin);
}

/** External links leave the app only for http and https, via shell.openExternal. */
export function isAllowedExternal(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** IPC from the home page only. Board windows do not get the home preload. */
export function isTrustedIpcSender(url: string | undefined): boolean {
  return !!url && isHomeUrl(url);
}

/** A bundled template id, as `flowgit templates --json` prints them. */
export function isTemplateId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}
