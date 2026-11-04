import type { MemoryChange } from "@flowgit/core";
import { sha256Hex } from "../http.js";

/**
 * A flow's files in R2, one object per file under `flows/<flow id>/<path>`. Empty directories are
 * kept as zero-byte markers whose key ends in "/". Files over LARGE_BYTES (videos, audio, big
 * pictures) are never loaded into a room's memory: their bytes live once in
 * `flows/<flow id>/.flowgit-blobs/<sha-256>`, and the file itself holds a short stub naming that
 * blob. Core hashes the stub, which changes whenever the content does, so staleness still works,
 * and copies into runs/ copy only the stub.
 */
export const LARGE_BYTES = 4 * 1024 * 1024;
/** Largest single file or upload. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Most files one flow may have (including runs/ history). */
export const MAX_FLOW_FILES = 5000;
/** Storage per workspace in the beta. */
export const WORKSPACE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

export const BLOB_DIR = ".flowgit-blobs";
const STUB_MAGIC = "\u0000flowgit-blob\u0000";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface BlobRef {
  sha256: string;
  size: number;
}

export function prefixOf(flowId: string): string {
  return `flows/${flowId}/`;
}

export function blobKey(flowId: string, sha: string): string {
  return `${prefixOf(flowId)}${BLOB_DIR}/${sha}`;
}

export function makeStub(ref: BlobRef): Uint8Array {
  return encoder.encode(`${STUB_MAGIC}${JSON.stringify(ref)}\n`);
}

/** The blob a stub names, or undefined when `data` is an ordinary file. */
export function readStub(data: Uint8Array): BlobRef | undefined {
  if (data.length > 200 || data.length < STUB_MAGIC.length || data[0] !== 0) return undefined;
  const text = decoder.decode(data);
  if (!text.startsWith(STUB_MAGIC)) return undefined;
  try {
    const ref = JSON.parse(text.slice(STUB_MAGIC.length)) as BlobRef;
    if (typeof ref.sha256 === "string" && /^[0-9a-f]{64}$/.test(ref.sha256) && Number.isSafeInteger(ref.size)) return ref;
  } catch {
    // not a stub
  }
  return undefined;
}

/**
 * A relative path a person may write: posix, no "..", not absolute, not inside .git or the blob
 * store. Null otherwise.
 */
export function cleanPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 500 || raw.includes("\0") || raw.includes("\\")) return null;
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return null;
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.includes("..")) return null;
  if (parts[0] === BLOB_DIR || parts[0] === ".git") return null;
  return parts.join("/");
}

export interface LoadedFlow {
  files: Record<string, Uint8Array>;
  dirs: string[];
}

/** Every file of a flow (stubs for large ones), by relative path. */
export async function loadFlowFiles(bucket: R2Bucket, flowId: string): Promise<LoadedFlow> {
  const prefix = prefixOf(flowId);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const files: Record<string, Uint8Array> = {};
  const dirs: string[] = [];
  const wanted = keys.filter((key) => !key.startsWith(`${prefix}${BLOB_DIR}/`));
  // A few reads at a time.
  for (let i = 0; i < wanted.length; i += 16) {
    await Promise.all(
      wanted.slice(i, i + 16).map(async (key) => {
        const rel = key.slice(prefix.length);
        if (rel.endsWith("/")) {
          if (rel.length > 1) dirs.push(rel.slice(0, -1));
          return;
        }
        const object = await bucket.get(key);
        if (object) files[rel] = new Uint8Array(await object.arrayBuffer());
      }),
    );
  }
  return { files, dirs };
}

/**
 * Write one memory-host change (path relative to the flow) to R2. A large write stores the blob
 * and a stub and returns the stub, which the caller swaps into memory.
 */
export async function persistChange(bucket: R2Bucket, flowId: string, change: MemoryChange): Promise<Uint8Array | undefined> {
  const prefix = prefixOf(flowId);
  if (change.type === "mkdir") {
    if (change.path) await bucket.put(`${prefix}${change.path}/`, new Uint8Array());
    return undefined;
  }
  if (change.type === "rm") {
    await deletePrefix(bucket, `${prefix}${change.path}/`);
    await bucket.delete(`${prefix}${change.path}`);
    return undefined;
  }
  if (change.data.length > LARGE_BYTES && !readStub(change.data)) {
    const sha = await sha256Hex(change.data);
    const key = blobKey(flowId, sha);
    if (!(await bucket.head(key))) await bucket.put(key, change.data);
    const stub = makeStub({ sha256: sha, size: change.data.length });
    await bucket.put(`${prefix}${change.path}`, stub);
    return stub;
  }
  await bucket.put(`${prefix}${change.path}`, change.data);
  return undefined;
}

export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    const keys = page.objects.map((object) => object.key);
    // R2's delete takes up to 1000 keys at once.
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
