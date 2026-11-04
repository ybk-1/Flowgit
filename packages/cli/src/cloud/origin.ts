/** Default cloud. Only the origin is kept: scheme, host and port. */
export const DEFAULT_CLOUD_ORIGIN = "https://flowgit.dev";

export const SERVER_OPTION = [
  "--server <url>",
  "云端地址（只要协议、主机和端口），默认 https://flowgit.dev，也可用 FLOWGIT_CLOUD_URL / cloud origin (scheme, host and port only); default https://flowgit.dev, or FLOWGIT_CLOUD_URL",
] as const;

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/**
 * The cloud origin for this command.
 * `--server` wins, then `FLOWGIT_CLOUD_URL`, then https://flowgit.dev.
 * Anything after the origin (path, query, hash) is dropped.
 * http is refused except for localhost and 127.0.0.1, so a token is not sent in the clear.
 */
export function cloudOrigin(server: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const raw = (server ?? env.FLOWGIT_CLOUD_URL ?? DEFAULT_CLOUD_ORIGIN).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("云端地址不是合法的网址 / the cloud URL is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("云端地址里不能带用户名或密码 / the cloud URL must not include a username or password");
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol === "http:" && loopback) return url.origin;
  if (url.protocol === "https:") return url.origin;
  throw new Error(
    `云端地址必须是 https://。只有本机的 localhost 和 127.0.0.1 可以用 http://，避免把登录令牌发到不安全的地址。 / The cloud URL must be https://. Only localhost and 127.0.0.1 may use http://, so the sign-in token is not sent to an insecure address.`,
  );
}
