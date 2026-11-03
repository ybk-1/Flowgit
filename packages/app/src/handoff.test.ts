import { describe, expect, it } from "vitest";
import { LocalBoard, parseBoardLink, sameFlow, UNREACHABLE, type RemoteFlow } from "./handoff.js";

describe("handing stages to the local board", () => {
  it("takes only a flowgit board link on this computer, with its token", () => {
    expect(parseBoardLink(" http://127.0.0.1:4747/?token=abcdef0123456789abcdef \n")).toEqual({
      origin: "http://127.0.0.1:4747",
      token: "abcdef0123456789abcdef",
    });
    expect(parseBoardLink("http://localhost:5000/?token=0123456789abcdef").origin).toBe("http://localhost:5000");
    // The token never goes to another machine.
    expect(() => parseBoardLink("http://192.168.1.5:4747/?token=0123456789abcdef")).toThrow(/this computer/);
    expect(() => parseBoardLink("https://evil.example/?token=0123456789abcdef")).toThrow(/this computer/);
    expect(() => parseBoardLink("http://127.0.0.1:4747/")).toThrow(/no token/);
    expect(() => parseBoardLink("flowgit board")).toThrow(/whole link/);
  });

  it("sends the token, no cookies, and explains an unreachable board", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = new LocalBoard({ origin: "http://127.0.0.1:4747", token: "t0k3n" }, async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(await ok.run("check", "deepseek/deepseek-chat")).toEqual({ status: 200, body: { ok: true } });
    expect(seen[0]!.url).toBe("http://127.0.0.1:4747/api/run");
    expect(seen[0]!.init.credentials).toBe("omit");
    expect((seen[0]!.init.headers as Record<string, string>)["X-Flowgit-Token"]).toBe("t0k3n");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ stage: "check", model: "deepseek/deepseek-chat" });

    const down = new LocalBoard({ origin: "http://127.0.0.1:4747", token: "t" }, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(down.flow()).rejects.toThrow(UNREACHABLE);
    const restarted = new LocalBoard({ origin: "http://127.0.0.1:4747", token: "old" }, async () => new Response("{}", { status: 401 }));
    await expect(restarted.flow()).rejects.toThrow(/new link/);
  });

  it("treats the same stages and run history as the same flow", () => {
    const flow: RemoteFlow = {
      name: "周报",
      stages: [
        { id: "draft", executor: "llm", runs: 2, latest: { n: 2, time: "2026-11-03T09:00:00Z" } },
        { id: "check", executor: "script", runs: 0, latest: null },
      ],
    };
    expect(sameFlow(flow, structuredClone(flow))).toBe(true);
    const behind = structuredClone(flow);
    behind.stages[0]!.runs = 1;
    expect(sameFlow(flow, behind)).toBe(false);
    expect(sameFlow(flow, { ...flow, name: "别的" })).toBe(false);
  });
});
