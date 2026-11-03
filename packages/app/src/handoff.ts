// Hand a stage the browser can't run (script, agent, MCP, plugin) to the local board that
// `flowgit board` started on this computer. The board only answers https://flowgit.dev (or an
// origin passed with --allow-origin) and still wants its token, which the person pastes here.
import type { RemoteRunner } from "./router.js";

/** Executors a browser can't run: they start programs on a computer. */
export const COMPUTER_EXECUTORS = ["script", "agent", "mcp", "plugin"];

export interface BoardLink {
  /** "http://127.0.0.1:4747" */
  origin: string;
  token: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The link `flowgit board` prints ("http://127.0.0.1:4747/?token=…"), checked to point at this computer. */
export function parseBoardLink(text: string): BoardLink {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error("请粘贴 flowgit board 打印的整个链接 / Paste the whole link that flowgit board printed");
  }
  // The token must never leave this computer: only a board on loopback gets it.
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    throw new Error("链接要指向这台电脑（http://127.0.0.1:…）/ The link must point at this computer (http://127.0.0.1:…)");
  }
  const token = url.searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{16,128}$/i.test(token)) {
    throw new Error("链接里没有令牌（结尾应该是 ?token=…）/ The link has no token (it should end with ?token=…)");
  }
  return { origin: url.origin, token };
}

/** What the local board's GET /api/flow returns, as far as the handoff needs it. */
export interface RemoteFlow {
  name: string;
  stages: { id: string; executor: string; runs: number; latest: { n: number; time: string } | null }[];
}

export const UNREACHABLE =
  "连不上本机看板：确认 flowgit board 还开着、链接是最新的，并在浏览器问的时候允许访问本地网络 / Can't reach the local board: check that flowgit board is still running and the link is current, and allow local network access when the browser asks";

export class LocalBoard {
  constructor(
    readonly link: BoardLink,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async request(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.link.origin}${path}`, {
        ...init,
        // No cookies or cached answers: the token is the only credential.
        credentials: "omit",
        cache: "no-store",
        headers: { ...(init.headers as Record<string, string> | undefined), "X-Flowgit-Token": this.link.token },
      });
    } catch {
      throw new Error(UNREACHABLE);
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // empty or not JSON
    }
    if (res.status === 401) throw new Error("本机看板不接受这个令牌：它重启过的话，请粘贴新的链接 / The local board refused the token; if it restarted, paste its new link");
    return { status: res.status, body };
  }

  async flow(): Promise<RemoteFlow> {
    const { status, body } = await this.request("/api/flow");
    if (status !== 200) throw new Error(typeof body.error === "string" ? body.error : UNREACHABLE);
    return body as unknown as RemoteFlow;
  }

  run(stage: string, model?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    return this.request("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(model ? { stage, model } : { stage }),
    });
  }
}

/**
 * True when the local board shows the same flow as the page: same name, stages and executors, and
 * the same run history (count and time of the latest run), which in practice means the same folder.
 */
export function sameFlow(local: RemoteFlow, page: RemoteFlow): boolean {
  const key = (flow: RemoteFlow) =>
    JSON.stringify([flow.name, flow.stages.map((stage) => [stage.id, stage.executor, stage.runs, stage.latest?.n ?? 0, stage.latest?.time ?? ""])]);
  return key(local) === key(page);
}

export const NOT_IN_FOLDER =
  "这个流程存在浏览器里，本机看板看不到它：先点“存到文件夹”，再在那个文件夹里运行 flowgit board / This flow is kept in the browser, where the local board can't see it: use “Save to a folder”, then run flowgit board in that folder";

export function otherFlowMessage(folder: string): string {
  return `本机看板打开的不是这个流程：请在文件夹「${folder}」里运行 flowgit board / The local board has another flow open: run flowgit board in the folder "${folder}"`;
}

export interface HandOffPage {
  /** The folder's name when the flow is a folder on the computer; undefined when it lives in the browser. */
  folder?: string;
  /** The page's own GET /api/flow (flowBoard on the page's host). */
  flow(): RemoteFlow;
  /** Read the folder now, so what the local board wrote reaches the page. */
  poll?(): Promise<void>;
}

/** Run stages on the local board, which works on the same folder as the page; then read back what it wrote. */
export function handOff(link: LocalBoard, page: HandOffPage): RemoteRunner {
  return {
    async run(stage, model) {
      if (!page.folder || !page.poll) throw new Error(NOT_IN_FOLDER);
      if (!sameFlow(await link.flow(), page.flow())) throw new Error(otherFlowMessage(page.folder));
      const result = await link.run(stage, model);
      await page.poll();
      return result;
    },
  };
}
