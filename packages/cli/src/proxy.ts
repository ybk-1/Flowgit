import { spawn } from "node:child_process";
import os from "node:os";
import { applyProxy, pickProxy, proxyEnvVars, proxySupport, setProxyState, type ProxyInfo } from "@flowgit/core";

/** Set in the restarted child: the proxy in use and how to put the user's environment back. */
const CHILD_MARK = "FLOWGIT_PROXY_CHILD";

let isChild = false;

/**
 * In a child started by routeThroughProxy(): put the environment back the way the user had it, so
 * the scripts and agents it starts don't inherit NODE_USE_ENV_PROXY. Node has already read the
 * proxy settings at startup. Call this before anything else.
 */
export function restoreProxyChild(env: NodeJS.ProcessEnv = process.env): void {
  const mark = env[CHILD_MARK];
  if (mark === undefined) return;
  delete env[CHILD_MARK];
  isChild = true;
  try {
    const { proxy, restore } = JSON.parse(mark) as { proxy: ProxyInfo; restore: Record<string, string | null> };
    for (const [key, value] of Object.entries(restore)) {
      if (value === null) delete env[key];
      else env[key] = value;
    }
    setProxyState({ proxy, applied: true });
  } catch {
    // Not ours after all; leave the environment as it is.
  }
}

/**
 * Send this command's model and service requests through the user's proxy: HTTP(S)_PROXY, or the
 * system proxy on Windows and macOS (FLOWGIT_PROXY=off skips this). Node 24.14+ can switch in
 * place; Node 22.21+ only reads proxy settings at startup, so there the command runs again in a
 * child process with NODE_USE_ENV_PROXY=1 and this returns the child's exit code.
 */
export async function routeThroughProxy(env: NodeJS.ProcessEnv = process.env): Promise<number | undefined> {
  if (isChild) return undefined;
  const proxy = pickProxy(env);
  if (!proxy) return undefined;
  const nodeReadsEnv = env.NODE_USE_ENV_PROXY === "1" || process.execArgv.includes("--use-env-proxy");
  if (proxy.source === "env" && proxy.usable && nodeReadsEnv) {
    setProxyState({ proxy, applied: true }); // Node set it up at startup
    return undefined;
  }
  const support = proxySupport();
  if (!proxy.usable || support === "none") {
    setProxyState({ proxy, applied: false }); // a connection error will say why
    return undefined;
  }
  const vars = proxyEnvVars(proxy, env);
  if (support === "runtime" && applyProxy({ ...env, ...vars })) {
    setProxyState({ proxy, applied: true });
    return undefined;
  }
  const restore: Record<string, string | null> = {};
  for (const key of [...Object.keys(vars), "NODE_USE_ENV_PROXY"]) restore[key] = env[key] ?? null;
  const code = await runAgain({ ...env, ...vars, NODE_USE_ENV_PROXY: "1", [CHILD_MARK]: JSON.stringify({ proxy, restore }) });
  if (code === undefined) setProxyState({ proxy, applied: false });
  return code;
}

/** Run this same command in a child process with `env`. Undefined when the child can't start. */
function runAgain(env: NodeJS.ProcessEnv): Promise<number | undefined> {
  return new Promise((resolve) => {
    // Node 22 warns that its proxy agent is experimental, on every run; it isn't news to the user.
    const args = [...process.execArgv, "--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)];
    const child = spawn(process.execPath, args, { stdio: "inherit", env });
    // Ctrl+C reaches both processes: the child stops its stages, and this one waits for it.
    const ignore = () => {};
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.on("SIGINT", ignore);
    process.on("SIGTERM", forward);
    process.on("SIGHUP", forward);
    const done = (code: number | undefined) => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", forward);
      process.off("SIGHUP", forward);
      resolve(code);
    };
    child.on("error", () => done(undefined));
    child.on("exit", (code, signal) => {
      if (signal) {
        // Stop the same way the child did, so the shell sees what it would have seen.
        done(128 + (os.constants.signals[signal] ?? 0));
        process.kill(process.pid, signal);
      } else {
        done(code ?? 1);
      }
    });
  });
}
