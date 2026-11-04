import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the CLI keeps cloud tokens.
 * Same directory lookup as trusted.json in packages/core/src/trust.ts:
 * $FLOWGIT_HOME, or ~/.flowgit.
 * The file holds one entry per origin. It is never written inside a flow directory.
 */

export interface CloudUser {
  id: string;
  name: string;
}

export interface CloudCredential {
  token: string;
  /** Unix milliseconds, as /api/auth/device/token returns expires_at. */
  expires_at: number;
  user: CloudUser;
}

interface CredentialFile {
  version: 1;
  servers: Record<string, CloudCredential>;
}

export const LOGIN_AGAIN = "登录已失效，请重新运行 flowgit login / sign-in expired; run flowgit login again";

/** ~/.flowgit/credentials.json, or $FLOWGIT_HOME/credentials.json. */
export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.FLOWGIT_HOME || path.join(os.homedir(), ".flowgit");
  return path.join(home, "credentials.json");
}

function emptyFile(): CredentialFile {
  return { version: 1, servers: {} };
}

export function readCredentialFile(env: NodeJS.ProcessEnv = process.env): CredentialFile {
  const file = credentialsPath(env);
  if (!fs.existsSync(file)) return emptyFile();
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} 不是有效的 JSON，修好或删掉它再试 / ${file} is not valid JSON; fix or delete it and try again`);
  }
  const servers = (data as { servers?: unknown } | null)?.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return emptyFile();
  return { version: 1, servers: servers as Record<string, CloudCredential> };
}

/**
 * Write the whole file: temp file mode 0o600, rename into place, then chmod 600.
 * Mode is not checked on Windows, where it is not meaningful.
 */
export function writeCredentialFile(data: CredentialFile, env: NodeJS.ProcessEnv = process.env): void {
  const file = credentialsPath(env);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.credentials.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    try {
      fs.renameSync(tmp, file);
    } catch {
      // Windows rename does not replace an existing file.
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    }
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function saveCredential(origin: string, credential: CloudCredential, env: NodeJS.ProcessEnv = process.env): void {
  const data = readCredentialFile(env);
  data.servers[origin] = {
    token: credential.token,
    expires_at: credential.expires_at,
    user: { id: credential.user.id, name: credential.user.name },
  };
  writeCredentialFile(data, env);
}

export function deleteCredential(origin: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = credentialsPath(env);
  if (!fs.existsSync(file)) return;
  const data = readCredentialFile(env);
  if (!data.servers[origin]) return;
  delete data.servers[origin];
  writeCredentialFile(data, env);
}

export interface CloudSession {
  token: string;
  /** True when FLOWGIT_TOKEN supplied the token. The file is not read in that case. */
  fromEnv: boolean;
  user?: CloudUser;
}

/** FLOWGIT_TOKEN wins and skips the credentials file. An expired file entry is treated as signed out. */
export function cloudSession(origin: string, env: NodeJS.ProcessEnv = process.env): CloudSession {
  const fromEnv = typeof env.FLOWGIT_TOKEN === "string" && env.FLOWGIT_TOKEN.length > 0;
  if (fromEnv) return { token: env.FLOWGIT_TOKEN as string, fromEnv: true };
  const entry = readCredentialFile(env).servers[origin];
  if (!entry || typeof entry.token !== "string" || !entry.token) {
    throw new Error(`还没登录 ${origin}，先运行 flowgit login / not signed in to ${origin}; run flowgit login`);
  }
  if (typeof entry.expires_at === "number" && entry.expires_at <= Date.now()) throw new Error(LOGIN_AGAIN);
  const user = entry.user && typeof entry.user.id === "string" ? { id: entry.user.id, name: typeof entry.user.name === "string" ? entry.user.name : "" } : undefined;
  return { token: entry.token, fromEnv: false, ...(user ? { user } : {}) };
}
