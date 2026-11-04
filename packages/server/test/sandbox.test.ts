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
        return { code: 0, output: "counting\n", changed: { "count.txt": new TextEncoder().encode("2 notes.md\n"), "../escape.txt": new Uint8Array([1]), "old.txt": null, "big.bin": { blob: { sha256: "a".repeat(64), size: 5_000_000 } }, "bad.bin": { blob: { sha256: "../x", size: 1 } } } };
      },
    };
    const host = createMemoryHost({ cwd: "/flow", home: "/home", env: {}, files: { "/flow/flow.json": JSON.stringify(flow), "/flow/notes.md": "a\nb\n", "/flow/old.txt": "x" } });
    const stubFor = (ref: { sha256: string }) => new TextEncoder().encode(`stub ${ref.sha256}`);
    const exec = sandboxExec(sandbox, host, "/flow", { flowId: "flw_test", withheld: ["EXAMPLE_API_KEY"], stubFor });
    const withSandbox = { ...host, env: { EXAMPLE_API_KEY: "k", PLAIN: "p" }, exec };
    await withFlowHost(withSandbox, async () => {
      await runStage(loadFlow("/flow"), "count");
    });
    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    expect(request.command).toBe("wc -l notes.md > count.txt");
    expect(request.cwd).toBe("");
    expect(Object.keys(request.files).sort()).toEqual(["flow.json", "notes.md", "old.txt"]);
    // Vault keys never reach the sandbox; other variables do.
    expect(request.env.EXAMPLE_API_KEY).toBeUndefined();
    expect(request.env.PLAIN).toBe("p");
    expect(request.flowId).toBe("flw_test");
    expect(request.blobPrefix).toBe("flows/flw_test/.flowgit-blobs/");
    // A stage can't ask for more than the ceiling; the network is off unless the room turns it on.
    expect(request.limits).toMatchObject({ timeSec: 3600, network: false });
    expect(host.readFile("/flow/count.txt", "utf8")).toBe("2 notes.md\n");
    expect(host.exists("/flow/old.txt")).toBe(false);
    expect(host.exists("/escape.txt")).toBe(false);
    // A large file the sandbox stored itself comes back as a stub; a bad ref is ignored.
    expect(host.readFile("/flow/big.bin", "utf8")).toBe(`stub ${"a".repeat(64)}`);
    expect(host.exists("/flow/bad.bin")).toBe(false);
    await withFlowHost(host, async () => {
      expect(listRuns("/flow", "count")[0]).toMatchObject({ status: "ok", n: 1 });
    });
  });

  it("refuses a changed file over the size limit and writes nothing", async () => {
    const { MAX_FILE_BYTES } = await import("../src/storage/flow-store.js");
    const sandbox: Sandbox = {
      async run() {
        return { code: 0, output: "", changed: { "small.txt": new Uint8Array([1]), "huge.bin": { blob: { sha256: "b".repeat(64), size: MAX_FILE_BYTES + 1 } } } };
      },
    };
    const host = createMemoryHost({ cwd: "/flow", home: "/home", env: {}, files: { "/flow/flow.json": "{}" } });
    const exec = sandboxExec(sandbox, host, "/flow", { flowId: "flw_test", stubFor: () => new Uint8Array([0]) });
    await expect(exec({ command: "true", cwd: "/flow", env: {} } as never)).rejects.toThrow("huge.bin");
    expect(host.exists("/flow/small.txt")).toBe(false);
    expect(host.exists("/flow/huge.bin")).toBe(false);
  });
});
