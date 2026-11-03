import type { Host, HostPath } from "./types.js";

let current: Host | undefined;

/**
 * The host core uses. The Node entry (`@flowgit/core`) sets the Node host when
 * it loads; the browser entry sets a memory host. Call setHost() to use another.
 */
export function host(): Host {
  if (!current) {
    throw new Error(
      "还没有设置 Host：从 @flowgit/core 导入，或先调用 setHost() / No host is set: import from @flowgit/core, or call setHost() first",
    );
  }
  return current;
}

/** Use `next` for every file, command and request from now on. Returns the previous host. */
export function setHost(next: Host): Host | undefined {
  const previous = current;
  current = next;
  return previous;
}

/** Run `fn` with `next` as the host, then put the previous host back (also when `fn` fails). */
export async function withHost<T>(next: Host, fn: () => T | Promise<T>): Promise<T> {
  const previous = setHost(next);
  try {
    return await fn();
  } finally {
    if (previous) setHost(previous);
    else current = undefined;
  }
}

/** The current host's path functions, looked up on every call. */
export const path: HostPath = {
  get sep() {
    return host().path.sep;
  },
  get delimiter() {
    return host().path.delimiter;
  },
  join: (...parts) => host().path.join(...parts),
  resolve: (...parts) => host().path.resolve(...parts),
  relative: (from, to) => host().path.relative(from, to),
  dirname: (p) => host().path.dirname(p),
  basename: (p, ext) => host().path.basename(p, ext),
  extname: (p) => host().path.extname(p),
  isAbsolute: (p) => host().path.isAbsolute(p),
  normalize: (p) => host().path.normalize(p),
};
