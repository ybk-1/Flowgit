import { createHash } from "node:crypto";
import fs from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryHost, type MemoryChange } from "./host/memory.js";
import { host, withHost } from "./host/current.js";
import { posixPath } from "./host/posix-path.js";
import { sha256 } from "./host/sha256.js";
import type { HostExecOptions } from "./host/types.js";
import { loadFlow } from "./load.js";
import { runAll, runStage } from "./run.js";
import { listRuns, loadFlowInputs, statusAll } from "./runs.js";
import { readFlowText, base64ToBytes } from "./util.js";

const TEMPLATE = nodePath.resolve(import.meta.dirname, "../../cli/templates/weekly-report");

/** Every file of a directory on disk, keyed by its path under `to` in a memory host. */
function filesFrom(dir: string, to: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = nodePath.join(entry.parentPath, entry.name);
    out[`${to}/${nodePath.relative(dir, abs).split(nodePath.sep).join("/")}`] = fs.readFileSync(abs);
  }
  return out;
}

describe("sha256", () => {
  it("matches node:crypto, across block boundaries and for bytes", () => {
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "流程".repeat(100), "x".repeat(1000)]) {
      expect(sha256().update(s).digest()).toBe(createHash("sha256").update(s).digest("hex"));
    }
    const bytes = new Uint8Array(300).map((_, i) => i % 256);
    expect(sha256().update(bytes.subarray(0, 7)).update(bytes.subarray(7)).digest()).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("posixPath", () => {
  const p = posixPath(() => "/work/flow");
  const node = nodePath.posix;
  it("behaves like node:path/posix", () => {
    const cases: string[][] = [["a", "b"], ["/a", "../b"], ["a/", "./b/"], ["", ""], ["/a/b", "../../.."], ["a", "/b"]];
    for (const c of cases) expect(p.join(...c)).toBe(node.join(...c));
    for (const x of ["/a/b/c.txt", "a/b/", "c", "/", "", "a//b", ".hidden", "x.tar.gz", "a/.."]) {
      expect(p.dirname(x)).toBe(node.dirname(x));
      expect(p.basename(x)).toBe(node.basename(x));
      expect(p.extname(x)).toBe(node.extname(x));
      expect(p.normalize(x)).toBe(node.normalize(x));
      expect(p.isAbsolute(x)).toBe(node.isAbsolute(x));
    }
    expect(p.basename("/a/b.md", ".md")).toBe("b");
    expect(p.resolve("x", "../y")).toBe("/work/flow/y");
    expect(p.resolve("/a", "b", "/c", "d")).toBe("/c/d");
    expect(p.relative("/a/b", "/a/c/d")).toBe(node.relative("/a/b", "/a/c/d"));
    expect(p.relative("/a/b", "/a/b")).toBe("");
  });
});

describe("memory host", () => {
  it("acts like a file system and reports changes", () => {
    const changes: MemoryChange[] = [];
    const h = createMemoryHost({ files: { "/f/a.txt": "hi" }, onChange: (c) => changes.push(c) });
    expect(h.readFile("/f/a.txt", "utf8")).toBe("hi");
    expect(() => h.readFile("/f/missing")).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(() => h.writeFile("/nope/x", "1")).toThrow(expect.objectContaining({ code: "ENOENT" }));
    h.mkdir("/f/d/e", { recursive: true });
    h.writeFile("/f/d/e/b.bin", new Uint8Array([1, 2, 3]));
    expect(h.stat("/f/d/e/b.bin").size).toBe(3);
    expect(h.readdir("/f")).toEqual(["a.txt", "d"]);
    expect(h.readdir("/f", { withFileTypes: true }).map((d) => [d.name, d.isDirectory()])).toEqual([["a.txt", false], ["d", true]]);
    h.copy("/f/d", "/g");
    expect(h.readFile("/g/e/b.bin")).toEqual(new Uint8Array([1, 2, 3]));
    h.rename("/g", "/h");
    expect(h.exists("/g")).toBe(false);
    expect(h.files()).toContain("/h/e/b.bin");
    expect(() => h.rm("/h")).toThrow();
    h.rm("/h", { recursive: true });
    h.rm("/h", { force: true });
    expect(h.exists("/h/e/b.bin")).toBe(false);
    expect(changes.some((c) => c.type === "write" && c.path === "/f/d/e/b.bin")).toBe(true);
    expect(changes.some((c) => c.type === "rm" && c.path === "/h")).toBe(true);
  });

  it("refuses to run commands with a bilingual message", async () => {
    await expect(createMemoryHost().exec({ command: "echo hi", cwd: "/", env: {} })).rejects.toThrow(
      /要在电脑上运行.*needs to run on a computer/,
    );
  });

  it("decodes base64 like Buffer", () => {
    for (const s of ["aGVsbG8=", "aGVsbG8", "aGV sbG8=\n", "_-8", ""]) {
      expect(Array.from(base64ToBytes(s))).toEqual(Array.from(Buffer.from(s, "base64")));
    }
  });
});

describe("weekly-report on a memory host", () => {
  it("runs every stage, keeps versions in runs/, and never overwrites a hand edit", async () => {
    const commands: HostExecOptions[] = [];
    const mem = createMemoryHost({
      files: filesFrom(TEMPLATE, "/flow"),
      env: { FLOWGIT_LLM_MOCK_DIR: "/flow/demo-replies", FLOWGIT_HOME: "/home/.flowgit" },
      // A stand-in for `node scripts/check-report.mjs`: reads the report and writes check.json through the host.
      exec: async (options) => {
        commands.push(options);
        const report = host().readFile(host().path.join(options.cwd, "report.md"), "utf8");
        const ok = report.includes("## ");
        host().writeFile(host().path.join(options.cwd, "check.json"), `${JSON.stringify({ ok }, null, 2)}\n`);
        options.onLine?.(ok ? "all checks passed" : "missing sections");
        return { code: ok ? 0 : 1, output: "" };
      },
    });

    await withHost(mem, async () => {
      const loaded = loadFlow("/flow");
      expect(loaded.flow.id).toBe("weekly-report");
      const inputs = { name: "Ada" };

      // The person has not written notes.md yet.
      await expect(runStage(loaded, "notes", { inputs })).rejects.toThrow(/notes\.md/);
      host().writeFile("/flow/notes.md", host().readFile("/flow/sample-notes.md"));

      const records = await runAll(loaded, { inputs });
      expect(records.map((r) => [r.stage, r.n, r.status])).toEqual([
        ["notes", 1, "ok"],
        ["draft", 1, "ok"],
        ["check", 1, "ok"],
      ]);
      expect(host().readFile("/flow/report.md", "utf8")).toBe(host().readFile("/flow/demo-replies/draft.md", "utf8"));
      expect(JSON.parse(host().readFile("/flow/check.json", "utf8"))).toEqual({ ok: true });
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toBe("node scripts/check-report.mjs");
      expect(commands[0]!.cwd).toBe("/flow");
      expect(commands[0]!.env.FLOWGIT_STAGE).toBe("check");
      expect(JSON.parse(commands[0]!.env.FLOWGIT_FLOW_INPUTS!)).toMatchObject({ name: "Ada", language: "zh" });
      expect(host().exists("/flow/runs/draft/1/run.json")).toBe(true);
      expect(host().exists("/flow/runs/draft/1/outputs/report.md")).toBe(true);
      const flowInputs = loadFlowInputs("/flow", loaded.flow, inputs);
      expect(statusAll(loaded, flowInputs).map((s) => s.state)).toEqual(["ok", "ok", "ok"]);

      // Nothing changed: running again does nothing.
      expect(await runAll(loaded, { inputs })).toEqual([]);

      // A hand edit of the report is kept as its own version, and the check re-runs on it.
      const edited = `${host().readFile("/flow/report.md", "utf8")}\n- 手动补充的一行\n`;
      host().writeFile("/flow/report.md", edited);
      expect(statusAll(loaded, flowInputs).map((s) => s.state)).toEqual(["ok", "edited", "stale"]);
      const second = await runAll(loaded, { inputs });
      expect(second.map((r) => [r.stage, r.n, r.executor])).toEqual([
        ["draft", 2, "manual"],
        ["check", 2, "script"],
      ]);
      expect(host().readFile("/flow/report.md", "utf8")).toBe(edited);
      expect(host().readFile("/flow/runs/draft/2/outputs/report.md", "utf8")).toBe(edited);

      // Re-running the model replaces report.md, but the hand edit stays in v2.
      const rerun = await runStage(loaded, "draft", { inputs });
      expect(rerun.n).toBe(3);
      expect(host().readFile("/flow/report.md", "utf8")).not.toBe(edited);
      expect(listRuns("/flow", "draft").map((r) => [r.n, r.executor])).toEqual([
        [1, "llm"],
        [2, "manual"],
        [3, "llm"],
      ]);
      expect(host().readFile("/flow/runs/draft/2/outputs/report.md", "utf8")).toBe(edited);
      expect(readFlowText("/flow", "prompts/draft.md")).toContain("{{");
    });

    // The memory host wrote nothing to disk and the Node host is back.
    expect(fs.existsSync(nodePath.join(TEMPLATE, "runs"))).toBe(false);
    expect(host().name).toBe("node");
  });
});
