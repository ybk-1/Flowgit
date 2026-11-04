import type { FlowRoom } from "./rooms/room.js";
import type { Sandbox } from "./runs/sandbox.js";
import type { RunParams } from "./runs/workflow.js";

/**
 * Bindings and settings, from wrangler.jsonc (vars and bindings) and Worker secrets.
 * Secrets are set in the Cloudflare dashboard (Workers & Pages → the Worker → Settings →
 * Variables and Secrets) and never committed.
 */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ROOMS: DurableObjectNamespace<FlowRoom>;
  /** Cloud runs: https://developers.cloudflare.com/workflows/ */
  RUNS: Workflow<RunParams>;
  /** Runs commands for script stages (#175). Unset until then: those stages need a computer. */
  SANDBOX?: Sandbox;
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
  /**
   * Canned model replies for cloud runs, as a folder inside the flow (e.g. "demo-replies").
   * Only honored when ENVIRONMENT is "local" (tests and the emulator).
   */
  FLOWGIT_TEST_LLM_MOCK_DIR?: string;

  /** 32 random bytes, base64: the key vault's master key (vault/vault.ts). A Worker secret. */
  VAULT_MASTER_KEY?: string;
  /** Web Push (notify/webpush.ts): base64url P-256 key pair, and a mailto: or https: contact. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

/** Workers Rate Limiting binding. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
