/**
 * Retries for llm and service calls. Only network errors, HTTP 429 and 5xx
 * are retried. Other 4xx and schema failures are not.
 */

export interface RetryRecord {
  /** 1-based index of this retry (the first retry is 1, not the first attempt). */
  n: number;
  /** HTTP status when the failure had one. */
  status?: number;
  /** First line of the error, trimmed so run.json stays small. */
  error: string;
  delayMs: number;
}

const BASE_MS = 200;
const CAP_MS = 30_000;

const NETWORK =
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|fetch failed|socket hang up|network|timed out|TimeoutError|AbortError|APIConnection|connect/i;

export function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; statusCode?: unknown };
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  return undefined;
}

/** True when another attempt might succeed: no status and a network failure, 429, or 5xx. */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const marked = (err as { retryable?: unknown }).retryable;
  if (marked === false) return false;
  const status = errorStatus(err);
  if (status === 429) return true;
  if (status !== undefined && status >= 500 && status <= 599) return true;
  if (status !== undefined && status >= 400 && status < 500) return false;
  if (marked === true) return true;
  const e = err as { name?: unknown; message?: unknown };
  const text = `${typeof e.name === "string" ? e.name : ""} ${typeof e.message === "string" ? e.message : ""}`;
  return status === undefined && NETWORK.test(text);
}

/**
 * Wait before retry `n` (1-based): 200ms, then double, plus jitter in [0, 200), capped at 30s.
 * `random` is in [0, 1), the same contract as Math.random.
 */
export function retryDelayMs(n: number, random = Math.random()): number {
  const exp = BASE_MS * 2 ** Math.max(0, n - 1);
  const jitter = Math.floor(Math.min(0.999999, Math.max(0, random)) * BASE_MS);
  return Math.min(CAP_MS, exp + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function retryErrorLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0]!.slice(0, 300);
}
