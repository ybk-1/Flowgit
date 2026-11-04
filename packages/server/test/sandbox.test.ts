import { listRuns, loadFlow, runStage } from "@flowgit/core";
import { describe, expect, it } from "vitest";
import { type Sandbox, type SandboxRequest, sandboxExec } from "../src/runs/sandbox.js";
import { createMemoryHost, withFlowHost } from "../src/storage/context-host.js";

describe("the sandbox interface", () => {
  it("sends the flow's files, env and limits, and writes back what changed", async () => {
    const flow = {
      format: "flowgit",
      version: "0.1",
      id: "s",
      name: "S",
      stages: [{ id: "count", name: "Count", executor: { type: "script", run: "wc -l notes.md > count.txt", timeoutSec: 99999 }, outputs: [{ path: "count.txt", type: "text/plain" }] }],
    };
    const seen: SandboxRequest[] = [];
    const sandbox: Sandbox = {
      async run(request, onLine) {
        seen.push(request);
        onLine?.("counting");
        return { code: 0, output: "counting\n", changed: { "count.txt": new TextEncoder().encode("2 notes.md\n"), "../escape.txt": new Uint8Array([1]), "old.txt": null } };
      },
    };
    const host = createMemoryHost({ cwd: "/flow", home: "/home", env: {}, files: { "/flow/flow.json": JSON.stringify(flow), "/flow/notes.md": "a\nb\n", "/flow/old.txt": "x" } });
    const withSandbox = { ...host, env: { EXAMPLE_API_KEY: "k" }, exec: sandboxExec(sandbox, host, "/flow") };
    await withFlowHost(withSandbox, async () => {
      await runStage(loadFlow("/flow"), "count");
    });
    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    expect(request.command).toBe("wc -l notes.md > count.txt");
    expect(request.cwd).toBe("");
    expect(Object.keys(request.files).sort()).toEqual(["flow.json", "notes.md", "old.txt"]);
    expect(request.env.EXAMPLE_API_KEY).toBe("k");
    // A stage can't ask for more than the ceiling; the network is off unless the room turns it on.
    expect(request.limits).toMatchObject({ timeSec: 3600, network: false });
    expect(host.readFile("/flow/count.txt", "utf8")).toBe("2 notes.md\n");
    expect(host.exists("/flow/old.txt")).toBe(false);
    expect(host.exists("/escape.txt")).toBe(false);
    await withFlowHost(host, async () => {
      expect(listRuns("/flow", "count")[0]).toMatchObject({ status: "ok", n: 1 });
    });
  });
});
