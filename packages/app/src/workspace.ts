import { createMemoryHost, type HostExecOptions, type MemoryChange, type MemoryHost, setHost } from "@flowgit/core";
import { defaultStore, type FlowStore } from "./storage.js";
import { useInterpretingSchemas } from "./schema.js";

/** Flows live at /flows/<id> on the page's memory host. */
export const FLOWS_ROOT = "/flows";
/** FLOWGIT_HOME on the page: confirmations of copied flows (trusted.json) live here. */
export const HOME = "/home/.flowgit";
const TRUST_KEY = "flowgit.app.trusted";

export function flowDir(id: string): string {
  return `${FLOWS_ROOT}/${id}`;
}

/** A flow id is a folder name: letters, digits, "-" and "_". */
export function validFlowId(id: string | null): id is string {
  return !!id && /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id);
}

/** Bilingual message for a stage that has to run on a computer, naming the command. */
export function computerOnly(options: HostExecOptions): Error {
  const stage = options.env.FLOWGIT_STAGE ?? "";
  const cli = stage ? `flowgit run ${stage}` : "flowgit run";
  return Object.assign(
    new Error(
      `这一步要在电脑上运行：在流程文件夹里运行 ${options.command}，或者用 ${cli} / This step needs to run on a computer: in the flow folder, run ${options.command}, or use ${cli}`,
    ),
    { code: "FLOWGIT_NEEDS_COMPUTER" },
  );
}

function readTrust(): string | undefined {
  try {
    return localStorage.getItem(TRUST_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeTrust(text: string | undefined): void {
  try {
    if (text === undefined) localStorage.removeItem(TRUST_KEY);
    else localStorage.setItem(TRUST_KEY, text);
  } catch {
    // private window: confirmations last for this page only
  }
}

export interface Workspace {
  host: MemoryHost;
  store: FlowStore;
  /** False when the browser can't keep files (no OPFS): the page says so. */
  persistent: boolean;
  /** Mutable environment the host reads: keys, FLOWGIT_MODEL, FLOWGIT_LLM_MOCK_DIR. */
  env: Record<string, string | undefined>;
  /** Resolves when every change so far is saved. */
  saved(): Promise<void>;
}

/**
 * The page's host: files in memory, loaded from the browser's storage, with every change saved
 * back in order. Commands never run here; they fail with the command to run on a computer.
 */
export async function openWorkspace(flowId?: string): Promise<Workspace> {
  const { store, persistent } = await defaultStore();
  const env: Record<string, string | undefined> = { FLOWGIT_HOME: HOME };
  const files: Record<string, Uint8Array> = {};
  if (flowId) {
    for (const [rel, data] of Object.entries(await store.load(flowId))) files[`${flowDir(flowId)}/${rel}`] = data;
  }
  const trusted = readTrust();
  if (trusted) files[`${HOME}/trusted.json`] = new TextEncoder().encode(trusted);
  let queue: Promise<void> = Promise.resolve();
  const onChange = (change: MemoryChange) => {
    if (change.path === `${HOME}/trusted.json`) {
      writeTrust(change.type === "write" ? new TextDecoder().decode(change.data) : undefined);
      return;
    }
    const prefix = `${FLOWS_ROOT}/`;
    if (!change.path.startsWith(prefix)) return;
    const [id, ...rest] = change.path.slice(prefix.length).split("/");
    if (!id || !rest.length) return;
    const rel = rest.join("/");
    queue = queue.then(() => store.apply(id, { ...change, path: rel })).catch((err) => console.error("save failed", err));
  };
  // The host reports the files it starts with too; those are already stored.
  let loading = true;
  const host = createMemoryHost({
    files,
    env,
    platform: "browser",
    home: "/home",
    exec: async (options) => Promise.reject(computerOnly(options)),
    onChange: (change) => {
      if (!loading) onChange(change);
    },
  });
  loading = false;
  setHost(host);
  useInterpretingSchemas();
  return { host, store, persistent, env, saved: () => queue };
}
