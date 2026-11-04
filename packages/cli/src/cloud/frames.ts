/**
 * One WebSocket frame from GET /api/flows/:id/events.
 * The shape matches the local board's SSE frames: { id, event, data }.
 * A text "ping" is answered with a text "pong" by the server; "pong" is ignored here.
 */

export interface FrameResult {
  lines: string[];
  /** Set when the process should exit. */
  exit?: number;
}

function label(data: Record<string, unknown>): string {
  const name = typeof data.name === "string" ? data.name : "";
  const stage = typeof data.stage === "string" ? data.stage : "";
  if (name && stage) return `${name} (${stage})`;
  return name || stage || "stage";
}

function endOf(data: Record<string, unknown>): FrameResult {
  const waiting = data.waiting;
  if (waiting && typeof waiting === "object") {
    const wait = waiting as { kind?: unknown; stage?: unknown; name?: unknown };
    const stage = typeof wait.stage === "string" ? wait.stage : "";
    const name = typeof wait.name === "string" ? wait.name : "";
    if (wait.kind === "computer") {
      return {
        lines: [
          `这一步要在你的电脑上运行 / this stage needs your computer: ${stage}${name ? ` (${name})` : ""}`,
          "在本地运行这一步，然后 flowgit push，再运行 flowgit cloud run 继续 / run that stage locally, then flowgit push, then flowgit cloud run to continue",
        ],
        exit: 2,
      };
    }
    return { lines: [`在等你 / waiting for you: ${stage}${name ? ` (${name})` : ""}`], exit: 2 };
  }
  if (data.ok === false || typeof data.error === "string" || typeof data.budget === "string") {
    const why = typeof data.error === "string" ? data.error : typeof data.budget === "string" ? data.budget : "运行没有完成 / the run did not finish";
    return { lines: [why], exit: 1 };
  }
  return { lines: ["运行结束 / run finished"], exit: 0 };
}

/** What one frame should print, and whether the run is over. */
export function frameResult(text: string): FrameResult {
  if (text === "pong") return { lines: [] };
  let frame: { event?: unknown; data?: unknown };
  try {
    frame = JSON.parse(text) as { event?: unknown; data?: unknown };
  } catch {
    return { lines: [] };
  }
  if (typeof frame.event !== "string" || !frame.data || typeof frame.data !== "object" || Array.isArray(frame.data)) return { lines: [] };
  const data = frame.data as Record<string, unknown>;
  switch (frame.event) {
    case "stage:start":
      return { lines: [`开始 / start: ${label(data)}`] };
    case "stage:log":
      return { lines: [typeof data.line === "string" ? data.line : ""] };
    case "stage:done":
      return { lines: [`完成 / done: ${label(data)}${data.n !== undefined ? ` v${data.n}` : ""}`] };
    case "stage:error":
      return { lines: [`失败 / failed: ${label(data)}: ${typeof data.error === "string" ? data.error : ""}`] };
    case "run:end":
      return endOf(data);
    default:
      return { lines: [] };
  }
}

export async function frameText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  if (data && typeof (data as { text?: unknown }).text === "function") return (data as { text: () => Promise<string> }).text();
  return "";
}
