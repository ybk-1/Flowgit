import type { MemoryChange } from "@flowgit/core";

/**
 * Where a flow's files live between visits: the browser's private storage (OPFS,
 * https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).
 * The board works on a memory host; every change is written here in the background, in order.
 */
export interface FlowStore {
  /** Every file of a flow, by path relative to the flow directory. */
  load(id: string): Promise<Record<string, Uint8Array>>;
  /** Write one change, given with a path relative to the flow directory. */
  apply(id: string, change: MemoryChange): Promise<void>;
  /** One file of a flow, or undefined. */
  read(id: string, rel: string): Promise<Uint8Array | undefined>;
  /** Flow ids, sorted. */
  list(): Promise<string[]>;
  remove(id: string): Promise<void>;
}

const ROOT = "flows";

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT, { create: true });
}

async function dirAt(base: FileSystemDirectoryHandle, parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = base;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function readTree(dir: FileSystemDirectoryHandle, prefix: string, out: Record<string, Uint8Array>): Promise<void> {
  for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") await readTree(handle as FileSystemDirectoryHandle, rel, out);
    else out[rel] = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
  }
}

function split(rel: string): string[] {
  return rel.split("/").filter(Boolean);
}

export function opfsStore(): FlowStore {
  return {
    async load(id) {
      const out: Record<string, Uint8Array> = {};
      await readTree(await dirAt(await opfsRoot(), [id], true), "", out);
      return out;
    },
    async apply(id, change) {
      const flowDir = await dirAt(await opfsRoot(), [id], true);
      const parts = split(change.path);
      if (change.type === "mkdir") {
        if (parts.length) await dirAt(flowDir, parts, true);
        return;
      }
      const name = parts.pop();
      if (!name) return;
      if (change.type === "write") {
        const parent = await dirAt(flowDir, parts, true);
        const file = await parent.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(change.data as unknown as BufferSource);
        await writable.close();
        return;
      }
      try {
        const parent = await dirAt(flowDir, parts, false);
        await parent.removeEntry(name, { recursive: true });
      } catch {
        // already gone
      }
    },
    async read(id, rel) {
      try {
        const parts = split(rel);
        const name = parts.pop()!;
        const dir = await dirAt(await dirAt(await opfsRoot(), [id], false), parts, false);
        return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
      } catch {
        return undefined;
      }
    },
    async list() {
      const ids: string[] = [];
      for await (const [name, handle] of (await opfsRoot() as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === "directory") ids.push(name);
      }
      return ids.sort();
    },
    async remove(id) {
      await (await opfsRoot()).removeEntry(id, { recursive: true });
    },
  };
}

/** Keeps nothing: for a browser without OPFS. The page says so. */
export function memoryOnlyStore(): FlowStore {
  const flows = new Map<string, Record<string, Uint8Array>>();
  return {
    async load(id) {
      return { ...(flows.get(id) ?? {}) };
    },
    async apply(id, change) {
      const files = flows.get(id) ?? {};
      flows.set(id, files);
      if (change.type === "write") files[change.path] = change.data;
      else if (change.type === "rm") {
        for (const rel of Object.keys(files)) if (rel === change.path || rel.startsWith(`${change.path}/`)) delete files[rel];
      }
    },
    async read(id, rel) {
      return flows.get(id)?.[rel];
    },
    async list() {
      return [...flows.keys()];
    },
    async remove(id) {
      flows.delete(id);
    },
  };
}

export async function defaultStore(): Promise<{ store: FlowStore; persistent: boolean }> {
  try {
    if (typeof (navigator.storage as { getDirectory?: unknown } | undefined)?.getDirectory === "function") {
      const root = await opfsRoot();
      // Safari before 26 has OPFS but not createWritable; check once with a probe file.
      const probe = await root.getFileHandle(".probe", { create: true });
      if (typeof (probe as { createWritable?: unknown }).createWritable === "function") {
        await root.removeEntry(".probe");
        return { store: opfsStore(), persistent: true };
      }
      await root.removeEntry(".probe");
    }
  } catch {
    // fall through
  }
  return { store: memoryOnlyStore(), persistent: false };
}
