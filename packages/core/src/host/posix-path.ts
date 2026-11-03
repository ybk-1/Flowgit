import type { HostPath } from "./types.js";

// POSIX path rules, following Node's lib/path.js, for hosts without `node:path`.

function normalizeString(p: string, allowAboveRoot: boolean): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (allowAboveRoot) out.push("..");
    } else out.push(part);
  }
  return out.join("/");
}

/** A POSIX `path` whose `resolve` starts from `cwd()`. */
export function posixPath(cwd: () => string = () => "/"): HostPath {
  const isAbsolute = (p: string) => p.startsWith("/");
  const normalize = (p: string): string => {
    if (!p) return ".";
    const abs = isAbsolute(p);
    const trailing = p.endsWith("/");
    let n = normalizeString(p, !abs);
    if (!n && !abs) n = ".";
    if (n && trailing) n += "/";
    return abs ? `/${n}` : n;
  };
  const resolve = (...parts: string[]): string => {
    let resolved = "";
    for (let i = parts.length - 1; i >= -1 && !isAbsolute(resolved); i--) {
      const p = i >= 0 ? parts[i]! : cwd();
      if (!p) continue;
      resolved = resolved ? `${p}/${resolved}` : p;
    }
    const n = normalizeString(resolved, false);
    return `/${n}`;
  };
  // Like Node: cut at the last slash, after trailing slashes; repeated slashes before it stay.
  const dirname = (p: string): string => {
    if (!p) return ".";
    const trimmed = p.replace(/(.)\/+$/, "$1");
    const i = trimmed.lastIndexOf("/");
    if (i === -1) return ".";
    return i === 0 ? "/" : trimmed.slice(0, i);
  };
  const basename = (p: string, ext?: string): string => {
    const trimmed = p.replace(/\/+$/, "");
    let b = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
    return b;
  };
  const extname = (p: string): string => {
    const b = basename(p);
    const i = b.lastIndexOf(".");
    return i <= 0 || b === ".." ? "" : b.slice(i);
  };
  const relative = (from: string, to: string): string => {
    const a = resolve(from).split("/").filter(Boolean);
    const b = resolve(to).split("/").filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
  };
  const join = (...parts: string[]): string => {
    const joined = parts.filter((p) => p.length > 0).join("/");
    return joined ? normalize(joined) : ".";
  };
  return { sep: "/", delimiter: ":", join, resolve, relative, dirname, basename, extname, isAbsolute, normalize };
}
