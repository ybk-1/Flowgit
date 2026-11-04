import type { Env as ServerEnv } from "../src/env.js";

declare global {
  namespace Cloudflare {
    interface Env extends ServerEnv {}
  }
}
