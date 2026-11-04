/** Collapse bursts of file events into one refresh. */
export function debounce(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export const REFRESH_DEBOUNCE_MS = 300;

const IGNORED = new Set(["node_modules", ".git", ".flowgit"]);

/** Watcher paths that should refresh the sidebar. `runs/` is included; install trees are not. */
export function affectsFlow(fsPath: string): boolean {
  return !fsPath.split(/[\\/]/).some((part) => IGNORED.has(part));
}
