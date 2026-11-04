import readline from "node:readline/promises";
import type { Command } from "commander";
import { openBrowser } from "@flowgit/web";
import { cloudOrigin, SERVER_OPTION } from "../cloud/origin.js";
import { cloudSession, deleteCredential, readCredentialFile, saveCredential, type CloudUser } from "../cloud/credentials.js";
import { cloudCall, cloudJson, failure } from "../cloud/http.js";
import { pollDeviceToken, startDevice } from "../cloud/device.js";
import { c } from "../format.js";

/**
 * `flowgit login`, `logout` and `whoami`.
 * The device code flow is RFC 8628: https://www.rfc-editor.org/rfc/rfc8628
 * The token is stored under FLOWGIT_HOME and is never printed.
 */

interface MeResponse {
  user?: { id?: string; name?: string };
}

export interface LoginCommand {
  server?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  open?: (url: string) => void;
  fetchImpl?: typeof fetch;
}

async function who(origin: string, token: string, fetchImpl?: typeof fetch): Promise<CloudUser> {
  const me = await cloudJson<MeResponse>({ origin, token, method: "GET", path: "/api/me", fetchImpl });
  const id = me.user?.id;
  const name = me.user?.name;
  if (!id || !name) throw new Error("账号信息里没有名字 / the account response has no name");
  return { id, name };
}

export async function executeLogin(args: LoginCommand = {}): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const origin = cloudOrigin(args.server, env);
  const started = await startDevice(origin, args.fetchImpl);
  log(`登录码 / code: ${started.user_code}`);
  log("在浏览器打开这个地址并确认 / open this address and approve:");
  log(started.verification_uri_complete);
  try {
    (args.open ?? openBrowser)(started.verification_uri_complete);
  } catch {
    // No browser. The address is already printed.
  }
  log("等待确认… / waiting for approval…");
  const token = await pollDeviceToken({
    origin,
    deviceCode: started.device_code,
    intervalSec: started.interval,
    expiresInSec: started.expires_in,
    sleep: args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    fetchImpl: args.fetchImpl,
  });
  const user = await who(origin, token.token, args.fetchImpl);
  saveCredential(origin, { token: token.token, expires_at: token.expires_at, user }, env);
  log(`${c.green("✓")} 已登录 / signed in: ${user.name} (${user.id})`);
  return 0;
}

export async function executeLogout(args: LoginCommand = {}): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const origin = cloudOrigin(args.server, env);
  let token: string | undefined;
  let fromEnv = false;
  try {
    const session = cloudSession(origin, env);
    token = session.token;
    fromEnv = session.fromEnv;
  } catch {
    log("还没登录 / not signed in");
    return 1;
  }
  const result = await cloudCall({ origin, token, method: "POST", path: "/api/auth/logout", json: {}, fetchImpl: args.fetchImpl });
  // 401 means the token was already dead. The local entry still goes.
  if (result.status !== 401 && (result.status < 200 || result.status >= 300)) throw failure(result);
  deleteCredential(origin, env);
  log(`${c.green("✓")} 已退出 / signed out: ${origin}`);
  if (fromEnv) log("环境变量 FLOWGIT_TOKEN 还在，这个会话已经在服务器上退出 / FLOWGIT_TOKEN is still set; this session was logged out on the server");
  return 0;
}

export async function executeWhoami(args: LoginCommand = {}): Promise<number> {
  const env = args.env ?? process.env;
  const log = args.log ?? ((line: string) => console.log(line));
  const origin = cloudOrigin(args.server, env);
  const session = cloudSession(origin, env);
  const user = await who(origin, session.token, args.fetchImpl);
  if (!session.fromEnv) {
    const existing = readCredentialFile(env).servers[origin];
    saveCredential(origin, { token: session.token, expires_at: existing?.expires_at ?? Date.now(), user }, env);
  }
  log(`${user.name} (${user.id})`);
  log(origin);
  return 0;
}

export function registerLogin(program: Command, fail: (err: unknown) => never): void {
  program
    .command("login")
    .description("用设备码登录云端 / sign in to the cloud with a device code")
    .option(...SERVER_OPTION)
    .action(async (opts: { server?: string }) => {
      try {
        await executeLogin({ server: opts.server });
      } catch (err) {
        fail(err);
      }
    });
}

export function registerLogout(program: Command, fail: (err: unknown) => never): void {
  program
    .command("logout")
    .description("退出云端并删掉本机凭证 / sign out of the cloud and delete the local credential")
    .option(...SERVER_OPTION)
    .action(async (opts: { server?: string }) => {
      try {
        const code = await executeLogout({ server: opts.server });
        if (code) process.exitCode = code;
      } catch (err) {
        fail(err);
      }
    });
}

export function registerWhoami(program: Command, fail: (err: unknown) => never): void {
  program
    .command("whoami")
    .description("看当前登录的云端账号 / show the signed-in cloud account")
    .option(...SERVER_OPTION)
    .action(async (opts: { server?: string }) => {
      try {
        await executeWhoami({ server: opts.server });
      } catch (err) {
        fail(err);
      }
    });
}

export async function askLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
