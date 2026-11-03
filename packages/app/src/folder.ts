import type { MemoryChange } from "@flowgit/core";
import type { FlowStore } from "./storage.js";

/**
 * A flow in a folder on the person's computer, through the File System Access API
 * (https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker, Chrome and Edge).
 * The files are the same ones the CLI reads and writes, so the two can take turns on one folder:
 * the page writes every change back, and polls for changes made outside it.
 */

/** Folders that are not part of a flow and can be large: never loaded or watched. */
const SKIP = new Set([".git", "node_modules", ".flowgit"]);

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

/** size and modification time, enough to see that a file changed. */
type Stamp = string;

export interface FolderStore extends FlowStore {
  readonly handle: FileSystemDirectoryHandle;
  /** Changes made outside the page since the last load, apply or poll. */
  poll(): Promise<{ changed: Record<string, Uint8Array>; removed: string[] }>;
}

function split(rel: string): string[] {
  return rel.split("/").filter(Boolean);
}

async function dirAt(base: FileSystemDirectoryHandle, parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = base;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

function stampOf(file: File): Stamp {
  return `${file.size}:${file.lastModified}`;
}

/** Every file under `dir` with its stamp, skipping SKIP folders. */
async function scan(dir: FileSystemDirectoryHandle, prefix: string, out: Map<string, { stamp: Stamp; handle: FileSystemFileHandle }>): Promise<void> {
  for await (const [name, handle] of (dir as unknown as Entries).entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      if (!SKIP.has(name)) await scan(handle as FileSystemDirectoryHandle, rel, out);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.set(rel, { stamp: stampOf(file), handle: handle as FileSystemFileHandle });
    }
  }
}

async function bytes(handle: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export function folderStore(handle: FileSystemDirectoryHandle): FolderStore {
  const stamps = new Map<string, Stamp>();
  const store: FolderStore = {
    handle,
    async load() {
      const found = new Map<string, { stamp: Stamp; handle: FileSystemFileHandle }>();
      await scan(handle, "", found);
      stamps.clear();
      const out: Record<string, Uint8Array> = {};
      for (const [rel, entry] of found) {
        out[rel] = await bytes(entry.handle);
        stamps.set(rel, entry.stamp);
      }
      return out;
    },
    async apply(_id, change: MemoryChange) {
      const parts = split(change.path);
      if (!parts.length || SKIP.has(parts[0]!)) return;
      if (change.type === "mkdir") {
        await dirAt(handle, parts, true);
        return;
      }
      const name = parts.pop()!;
      if (change.type === "write") {
        const file = await (await dirAt(handle, parts, true)).getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(change.data as unknown as BufferSource);
        await writable.close();
        // Our own write is not an outside change.
        stamps.set(change.path, stampOf(await file.getFile()));
        return;
      }
      try {
        await (await dirAt(handle, parts, false)).removeEntry(name, { recursive: true });
      } catch {
        // already gone
      }
      for (const rel of [...stamps.keys()]) if (rel === change.path || rel.startsWith(`${change.path}/`)) stamps.delete(rel);
    },
    async read(_id, rel) {
      try {
        const parts = split(rel);
        const name = parts.pop()!;
        return await bytes(await (await dirAt(handle, parts, false)).getFileHandle(name));
      } catch {
        return undefined;
      }
    },
    async list() {
      return [];
    },
    async remove() {
      // A folder on the computer is never deleted from the page; forgetting it is folders.ts's job.
    },
    async poll() {
      const found = new Map<string, { stamp: Stamp; handle: FileSystemFileHandle }>();
      await scan(handle, "", found);
      const changed: Record<string, Uint8Array> = {};
      const removed: string[] = [];
      for (const [rel, entry] of found) {
        if (stamps.get(rel) === entry.stamp) continue;
        changed[rel] = await bytes(entry.handle);
        stamps.set(rel, entry.stamp);
      }
      for (const rel of [...stamps.keys()]) {
        if (found.has(rel)) continue;
        stamps.delete(rel);
        removed.push(rel);
      }
      return { changed, removed };
    },
  };
  return store;
}

/** Ask for read and write access; `prompt` only works during a click. */
export async function folderAccess(handle: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  type Permissioned = {
    queryPermission?(o: { mode: string }): Promise<string>;
    requestPermission?(o: { mode: string }): Promise<string>;
  };
  const h = handle as unknown as Permissioned;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  if (!prompt || !h.requestPermission) return false;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

export function canOpenFolders(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/**
 * Keep a folder flow in step with changes made outside the page (the CLI, an editor): poll the
 * folder, copy changed files into the host without writing them back, and call `onChange`.
 * Polls run in the workspace's save queue, so they never race the page's own writes.
 */
export function watchFolder(
  ws: { enqueue(task: () => Promise<void>): Promise<void>; quietly(task: () => void): void; host: { mkdir(p: string, o: { recursive: boolean }): void; writeFile(p: string, d: Uint8Array): void; rm(p: string, o: { recursive: boolean; force: boolean }): void } },
  store: FolderStore,
  dir: string,
  onChange: (paths: string[]) => void,
  everyMs = 1500,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    let paths: string[] = [];
    await ws.enqueue(async () => {
      const { changed, removed } = await store.poll();
      paths = [...Object.keys(changed), ...removed];
      if (!paths.length) return;
      ws.quietly(() => {
        for (const [rel, data] of Object.entries(changed)) {
          const abs = `${dir}/${rel}`;
          ws.host.mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
          ws.host.writeFile(abs, data);
        }
        for (const rel of removed) ws.host.rm(`${dir}/${rel}`, { recursive: true, force: true });
      });
    });
    if (paths.length) onChange(paths);
    if (!stopped) timer = setTimeout(() => void tick(), everyMs);
  };
  timer = setTimeout(() => void tick(), everyMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
