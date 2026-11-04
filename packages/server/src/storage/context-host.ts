import { AsyncLocalStorage } from "node:async_hooks";
import { createMemoryHost, type Host, setHost } from "@flowgit/core/browser";

/**
 * Core reads the current host through a module global (`host()`). One Worker isolate serves many
 * requests and many flow rooms at once, so a plain setHost() per request would let one request's
 * files leak into another's when they interleave at an `await`. Instead the global host is this
 * proxy, which forwards every call to the host of the request it runs in, kept in
 * AsyncLocalStorage (https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/).
 * Outside a request it refuses, so nothing ever falls back to a shared host.
 */
const storage = new AsyncLocalStorage<Host>();

function current(): Host {
  const found = storage.getStore();
  if (!found) throw new Error("没有当前流程的 Host / no flow host for this call");
  return found;
}

const contextHost: Host = {
  get name() {
    return "cloud";
  },
  get platform() {
    return current().platform;
  },
  get pid() {
    return current().pid;
  },
  get path() {
    return current().path;
  },
  get env() {
    return current().env;
  },
  readFile: ((p: string, encoding?: "utf8") => (encoding ? current().readFile(p, encoding) : current().readFile(p))) as Host["readFile"],
  writeFile: (p, data) => current().writeFile(p, data),
  readdir: ((p: string, options?: { withFileTypes: true }) => (options ? current().readdir(p, options) : current().readdir(p))) as Host["readdir"],
  stat: (p) => current().stat(p),
  lstat: (p) => current().lstat(p),
  mkdir: (p, options) => current().mkdir(p, options),
  rm: (p, options) => current().rm(p, options),
  rename: (from, to) => current().rename(from, to),
  exists: (p) => current().exists(p),
  realpath: (p) => current().realpath(p),
  copy: (from, to) => current().copy(from, to),
  hash: () => current().hash(),
  exec: (options) => current().exec(options),
  which: (program, env) => current().which(program, env),
  resolveModule: (parent, spec) => current().resolveModule(parent, spec),
  importModule: (abs) => current().importModule(abs),
  fetch: (input, init) => current().fetch(input, init),
  homedir: () => current().homedir(),
  now: () => current().now(),
};

let installed = false;

/** Make core use the per-request host. Idempotent. */
export function installContextHost(): void {
  if (installed) return;
  installed = true;
  setHost(contextHost);
}

/** Run `fn` with `host` as core's host, also across awaits inside `fn`. */
export function withFlowHost<T>(host: Host, fn: () => T | Promise<T>): Promise<T> {
  installContextHost();
  return Promise.resolve(storage.run(host, fn));
}

export { createMemoryHost };
