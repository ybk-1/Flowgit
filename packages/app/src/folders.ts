/**
 * The folders a person opened, remembered in IndexedDB (a directory handle can be stored there
 * but not in localStorage). Only the handle and a name are kept; the files stay in the folder.
 */
export interface FolderEntry {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
}

const DB = "flowgit-app";
const STORE = "folders";
/** Folder flow ids start with this, so they never clash with flows kept in the browser. */
export const FOLDER_PREFIX = "folder-";

export function isFolderId(id: string): boolean {
  return id.startsWith(FOLDER_PREFIX);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function listFolders(): Promise<FolderEntry[]> {
  try {
    return ((await tx("readonly", (s) => s.getAll())) as FolderEntry[]).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function getFolder(id: string): Promise<FolderEntry | undefined> {
  try {
    return (await tx("readonly", (s) => s.get(id))) as FolderEntry | undefined;
  } catch {
    return undefined;
  }
}

/** Remember a folder; the same folder opened again keeps its id. */
export async function addFolder(handle: FileSystemDirectoryHandle): Promise<FolderEntry> {
  const all = await listFolders();
  for (const entry of all) {
    const same = (entry.handle as unknown as { isSameEntry?(o: FileSystemHandle): Promise<boolean> }).isSameEntry;
    if (same && (await same.call(entry.handle, handle))) return entry;
  }
  const slug = handle.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "flow";
  let id = `${FOLDER_PREFIX}${slug}`;
  for (let n = 2; all.some((entry) => entry.id === id); n++) id = `${FOLDER_PREFIX}${slug}-${n}`;
  const entry: FolderEntry = { id, name: handle.name, handle };
  await tx("readwrite", (s) => s.put(entry));
  return entry;
}

/** Forget a folder. Its files are not touched. */
export async function forgetFolder(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
