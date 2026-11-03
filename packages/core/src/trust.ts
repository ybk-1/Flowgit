import { host, path } from "./host/current.js";
import { flowActions, type FlowAction } from "./actions.js";
import type { LoadedFlow } from "./types.js";

/**
 * Confirming a copied flow before its first run.
 *
 * A flow that `flowgit init` copied from a Git URL (it has `forkedFrom`) and that
 * runs commands, starts agents, calls services or runs sub-flows must be confirmed
 * once on this computer before anything in it runs. The confirmation is the list
 * of those actions, so it is asked again only when that list changes.
 *
 * Confirmations live in ~/.flowgit/trusted.json (or $FLOWGIT_HOME/trusted.json),
 * never in the flow directory, so a flow can't ship its own confirmation.
 */

export type TrustReason =
  /** Not copied from a Git URL: nothing to confirm. */
  | "not-forked"
  /** Copied, but runs nothing on this computer beyond model calls. */
  | "no-actions"
  /** Confirmed, and the actions are the same as when it was confirmed. */
  | "trusted"
  /** Copied and never confirmed here. */
  | "new"
  /** Confirmed before, but the actions changed since. */
  | "changed";

export interface TrustState {
  /** True when the flow must be confirmed before it runs. */
  needed: boolean;
  reason: TrustReason;
  /** forkedFrom.source, when the flow has one. */
  source?: string;
  /** What the flow does on this computer, as `flowActions` lists it (sub-flows included). */
  actions: FlowAction[];
  /** sha256 of the actions; a confirmation is stored against it. */
  fingerprint: string;
}

interface TrustEntry {
  fingerprint: string;
  source?: string;
  trustedAt: string;
}

interface TrustStore {
  version: 1;
  flows: Record<string, TrustEntry>;
}

/** ~/.flowgit/trusted.json, or $FLOWGIT_HOME/trusted.json. */
export function trustFile(env: NodeJS.ProcessEnv = host().env): string {
  return path.join(env.FLOWGIT_HOME || path.join(host().homedir(), ".flowgit"), "trusted.json");
}

/** The key a flow is stored under: its real directory, so a symlink or `..` points at the same entry. */
function flowKey(dir: string): string {
  let real: string;
  try {
    real = host().realpath(dir);
  } catch {
    real = path.resolve(dir);
  }
  // Windows paths are case-insensitive
  return host().platform === "win32" ? real.toLowerCase() : real;
}

function readStore(env: NodeJS.ProcessEnv): TrustStore {
  const file = trustFile(env);
  if (!host().exists(file)) return { version: 1, flows: {} };
  let data: unknown;
  try {
    data = JSON.parse(host().readFile(file, "utf8"));
  } catch {
    throw new Error(`${file} 不是有效的 JSON，修好或删掉它再试 / ${file} is not valid JSON; fix or delete it and try again`);
  }
  const flows = (data as { flows?: unknown } | null)?.flows;
  if (!flows || typeof flows !== "object" || Array.isArray(flows)) return { version: 1, flows: {} };
  return { version: 1, flows: flows as Record<string, TrustEntry> };
}

export function trustFingerprint(actions: FlowAction[]): string {
  const canonical = actions.map((a) => ({ stage: a.stage, kind: a.kind, detail: a.detail, env: a.env ?? [] }));
  return `sha256:${host().hash().update(JSON.stringify(canonical)).digest()}`;
}

/** Whether this flow must be confirmed before it runs, and what would be confirmed. */
export function trustState(loaded: LoadedFlow, env: NodeJS.ProcessEnv = host().env): TrustState {
  const actions = flowActions(loaded.flow, loaded.dir);
  const fingerprint = trustFingerprint(actions);
  const source = loaded.flow.forkedFrom?.source;
  const base = { actions, fingerprint, ...(source ? { source } : {}) };
  if (!loaded.flow.forkedFrom) return { needed: false, reason: "not-forked", ...base };
  if (!actions.length) return { needed: false, reason: "no-actions", ...base };
  const entry = readStore(env).flows[flowKey(loaded.dir)];
  if (!entry) return { needed: true, reason: "new", ...base };
  if (entry.fingerprint !== fingerprint) return { needed: true, reason: "changed", ...base };
  return { needed: false, reason: "trusted", ...base };
}

/**
 * Record that the person looked at this flow's actions and wants it to run.
 * Pass the fingerprint of the list they were shown: if the flow changed since,
 * nothing is recorded and an error says to look again.
 */
export function trustFlow(loaded: LoadedFlow, fingerprint?: string, env: NodeJS.ProcessEnv = host().env): TrustState {
  const state = trustState(loaded, env);
  if (fingerprint !== undefined && fingerprint !== state.fingerprint) {
    throw new TrustChangedError(loaded, state);
  }
  if (state.reason === "not-forked" || state.reason === "no-actions") return state;
  const store = readStore(env);
  store.flows[flowKey(loaded.dir)] = {
    fingerprint: state.fingerprint,
    ...(state.source ? { source: state.source } : {}),
    trustedAt: new Date().toISOString(),
  };
  const file = trustFile(env);
  host().mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${host().pid}.tmp`;
  host().writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
  host().rename(tmp, file);
  return { ...state, needed: false, reason: "trusted" };
}

/** Thrown before anything runs in a copied flow that hasn't been confirmed on this computer. */
export class TrustNeededError extends Error {
  constructor(
    loaded: LoadedFlow,
    public readonly state: TrustState,
  ) {
    const from = state.source ?? "?";
    super(
      state.reason === "changed"
        ? `「${loaded.flow.name}」要运行的命令和你上次确认的不一样了，先运行 flowgit trust 再看一遍并确认 / The commands in "${loaded.flow.name}" changed since you confirmed them; run flowgit trust to look again and confirm`
        : `「${loaded.flow.name}」是从 ${from} 复制来的，第一次运行前先运行 flowgit trust，看一眼它会在你的电脑上做什么并确认 / "${loaded.flow.name}" was copied from ${from}; before its first run, run flowgit trust to see what it does on your computer and confirm`,
    );
    this.name = "TrustNeededError";
  }
}

/** The list shown for confirmation changed between showing it and confirming. */
export class TrustChangedError extends Error {
  constructor(
    loaded: LoadedFlow,
    public readonly state: TrustState,
  ) {
    super(`「${loaded.flow.name}」在你查看之后又改了，请重新看一遍再确认 / "${loaded.flow.name}" changed after you looked at it; look again before you confirm`);
    this.name = "TrustChangedError";
  }
}

/** Throws TrustNeededError when the flow must be confirmed first. */
export function assertTrusted(loaded: LoadedFlow, env: NodeJS.ProcessEnv = host().env): void {
  const state = trustState(loaded, env);
  if (state.needed) throw new TrustNeededError(loaded, state);
}
