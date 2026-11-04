import { ignoredSyncPath } from "./files.js";

/**
 * Three-way compare of cloud sha256, the last sync (the base), and the local files.
 * A path under runs/ that exists on both sides with different bytes is a conflict
 * even when one side still matches the base: the same version number is not overwritten quietly.
 */

export type FileHashes = Map<string, string>;

export type PullKind = "download" | "delete" | "conflict";

export interface PullOp {
  path: string;
  kind: PullKind;
}

export function hashMap(files: { path: string; sha256: string }[]): FileHashes {
  const map: FileHashes = new Map();
  for (const file of files) {
    if (!ignoredSyncPath(file.path)) map.set(file.path, file.sha256);
  }
  return map;
}

export function classifyPull(local: FileHashes, cloud: FileHashes, base: FileHashes): PullOp[] {
  const paths = [...new Set([...local.keys(), ...cloud.keys(), ...base.keys()])].sort();
  const ops: PullOp[] = [];
  for (const rel of paths) {
    if (ignoredSyncPath(rel)) continue;
    const localSha = local.get(rel);
    const cloudSha = cloud.get(rel);
    const baseSha = base.get(rel);
    if (localSha === cloudSha) continue;
    const runsFile = rel.startsWith("runs/");
    if (runsFile && localSha !== undefined && cloudSha !== undefined && localSha !== cloudSha) {
      ops.push({ path: rel, kind: "conflict" });
      continue;
    }
    // Cloud changed and local still matches the last sync (or the file is new on the cloud).
    if (cloudSha !== undefined && localSha === baseSha) {
      ops.push({ path: rel, kind: "download" });
      continue;
    }
    // Local only, or a local edit while the cloud still matches the base: leave the local file.
    if (localSha !== undefined && cloudSha === baseSha) continue;
    // The cloud deleted a file the local side has not edited. runs/ history is not deleted quietly.
    if (cloudSha === undefined && localSha === baseSha) {
      if (!runsFile) ops.push({ path: rel, kind: "delete" });
      continue;
    }
    // Already gone locally, and the cloud copy is unchanged.
    if (localSha === undefined && cloudSha === baseSha) continue;
    ops.push({ path: rel, kind: "conflict" });
  }
  return ops;
}

/** Paths the cloud changed since the base. A push refuses these and asks for a pull. */
export function cloudChanges(cloud: FileHashes, base: FileHashes): string[] {
  const out: string[] = [];
  for (const [rel, sha] of cloud) {
    if (ignoredSyncPath(rel)) continue;
    if (base.get(rel) !== sha) out.push(rel);
  }
  for (const rel of base.keys()) {
    if (ignoredSyncPath(rel)) continue;
    if (!cloud.has(rel)) out.push(rel);
  }
  return [...new Set(out)].sort();
}

export function planPush(local: FileHashes, base: FileHashes): { upload: string[]; remove: string[] } {
  const upload: string[] = [];
  const remove: string[] = [];
  for (const [rel, sha] of local) {
    if (ignoredSyncPath(rel)) continue;
    if (base.get(rel) !== sha) upload.push(rel);
  }
  for (const rel of base.keys()) {
    if (ignoredSyncPath(rel)) continue;
    if (!local.has(rel)) remove.push(rel);
  }
  upload.sort();
  remove.sort();
  return { upload, remove };
}

/**
 * The base after a pull that finished writing.
 * Choosing the local side of a conflict records the cloud sha, so the next push
 * sees an unchanged cloud and uploads the local file. Choosing the cloud side
 * records that sha too, after the bytes were written.
 */
export function baseAfterPull(local: FileHashes, cloud: FileHashes, base: FileHashes, choices: Map<string, "local" | "cloud">): Record<string, string> {
  const out: Record<string, string> = {};
  const paths = new Set([...local.keys(), ...cloud.keys(), ...base.keys()]);
  for (const rel of paths) {
    if (ignoredSyncPath(rel)) continue;
    const choice = choices.get(rel);
    const localSha = local.get(rel);
    const cloudSha = cloud.get(rel);
    const baseSha = base.get(rel);
    if (choice) {
      if (cloudSha) out[rel] = cloudSha;
      continue;
    }
    if (localSha !== undefined && cloudSha !== undefined && localSha === cloudSha) {
      out[rel] = localSha;
      continue;
    }
    if (cloudSha !== undefined && localSha === baseSha) {
      out[rel] = cloudSha;
      continue;
    }
    if (localSha !== undefined && cloudSha !== undefined && cloudSha === baseSha) {
      out[rel] = cloudSha;
    }
  }
  return out;
}

/** `https://host/app/board.html?flow=cloud-<id>` or `?flow=<id>`, or a bare id. */
export function parseCloneTarget(input: string, fallbackOrigin: string, originOf: (server: string) => string): { origin: string; flowId: string } {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("克隆地址不是合法的网址 / the clone URL is not a valid URL");
    }
    const origin = originOf(url.origin);
    const flow = url.searchParams.get("flow");
    if (!flow) throw new Error("网址里没有 flow= / the URL has no flow=");
    return { origin, flowId: stripFlowPrefix(flow) };
  }
  return { origin: fallbackOrigin, flowId: stripFlowPrefix(trimmed) };
}

function stripFlowPrefix(id: string): string {
  const bare = id.startsWith("cloud-") ? id.slice("cloud-".length) : id;
  if (!/^[A-Za-z0-9_-]+$/.test(bare)) throw new Error(`流程 id 不合法 / invalid flow id: ${id}`);
  return bare;
}

export interface WorkspaceChoice {
  id: string;
  name: string;
}

export async function chooseWorkspace(args: {
  workspaces: WorkspaceChoice[];
  explicit?: string;
  tty: boolean;
  ask: (question: string) => Promise<string>;
}): Promise<string> {
  if (args.explicit) {
    const found = args.workspaces.find((workspace) => workspace.id === args.explicit);
    if (!found) throw new Error(`没有这个工作区 / no such workspace: ${args.explicit}`);
    return found.id;
  }
  if (args.workspaces.length === 1) return args.workspaces[0]!.id;
  if (args.workspaces.length === 0) {
    throw new Error("你还没有工作区。先在网页上建一个，再用 --workspace <id> / you have no workspace yet. Create one on the web, then pass --workspace <id>");
  }
  if (!args.tty) {
    const ids = args.workspaces.map((workspace) => workspace.id).join(", ");
    throw new Error(`有多个工作区，请加上 --workspace <id> / more than one workspace; pass --workspace <id>: ${ids}`);
  }
  const lines = args.workspaces.map((workspace, index) => `  ${index + 1}. ${workspace.name} (${workspace.id})`);
  const answer = (await args.ask(`选择工作区 / choose a workspace:\n${lines.join("\n")}\n输入编号或 id / number or id: `)).trim();
  const asNumber = Number(answer);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= args.workspaces.length) return args.workspaces[asNumber - 1]!.id;
  const found = args.workspaces.find((workspace) => workspace.id === answer);
  if (!found) throw new Error(`没有这个工作区 / no such workspace: ${answer}`);
  return found.id;
}
