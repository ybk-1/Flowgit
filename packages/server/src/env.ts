import type { FlowRoom } from "./rooms/room.js";

/**
 * Bindings and settings, from wrangler.jsonc (vars and bindings) and Worker secrets.
 * Secrets are set in the Cloudflare dashboard (Workers & Pages → the Worker → Settings →
 * Variables and Secrets) and never committed.
 */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ROOMS: DurableObjectNamespace<FlowRoom>;
  /** Static files deployed with the Worker: templates/<id>.json and the console page. */
  ASSETS?: Fetcher;
  /** https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ */
  AUTH_LIMITER?: RateLimit;
  API_LIMITER?: RateLimit;

  /** "production", "staging" or "local". */
  ENVIRONMENT?: string;
  /** Who may sign up without an invite and create sign-up codes: "github:<numeric id>" or "google:<sub>", comma separated. */
  ADMINS?: string;

  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /**
   * "1" turns on POST /api/auth/test (sign in as anyone, no OAuth). Only for the local emulator
   * and tests: it is set in vitest.config.ts and .dev.vars, never in wrangler.jsonc, and the
   * route also refuses unless ENVIRONMENT is "local".
   */
  FLOWGIT_TEST_LOGIN?: string;
}

/** Workers Rate Limiting binding. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
