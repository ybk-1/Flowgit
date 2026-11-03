import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function flowgit(dir: string, args: string[]) {
  const r = spawnSync(process.execPath, [cli, "-C", dir, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function writeRun(dir: string, stage: string, n: number, output: string, content: string): void {
  const base = path.join(dir, "runs", stage, String(n));
  fs.mkdirSync(path.join(base, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(base, "outputs", output), content);
  fs.writeFileSync(path.join(base, "pad.bin"), Buffer.alloc(128, n));
  const record = {
    stage,
    n,
    status: "ok",
    executor: "script",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    inputHash: "x",
    inputs: [],
    flowInputs: {},
    outputs: [{ path: output, type: "text/plain", sha256: sha(content), bytes: Buffer.byteLength(content), isDir: false }],
  };
  fs.writeFileSync(path.join(base, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
}

function seed(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-prune-e2e-"));
  const flow = {
    format: "flowgit",
    version: "0.1",
    name: "prune",
    stages: [
      {
        id: "draft",
        name: "草稿",
        executor: { type: "script", run: "node write.cjs" },
        outputs: [{ type: "text/plain", path: "note.txt" }],
      },
      {
        id: "other",
        name: "其他",
        executor: { type: "script", run: "node other.cjs" },
        outputs: [{ type: "text/plain", path: "other.txt" }],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
  for (let n = 1; n <= 6; n += 1) writeRun(dir, "draft", n, "note.txt", `draft-${n}`);
  for (let n = 1; n <= 4; n += 1) writeRun(dir, "other", n, "other.txt", `other-${n}`);
  fs.writeFileSync(path.join(dir, "note.txt"), "draft-6");
  fs.writeFileSync(path.join(dir, "other.txt"), "other-4");
  return dir;
}

function dirs(dir: string, stage: string): string[] {
  return fs
    .readdirSync(path.join(dir, "runs", stage))
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
}

describe("flowgit prune", () => {
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists versions and the space they would free with --dry-run, and does not delete", () => {
    if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
    const dir = seed();
    made.push(dir);
    const listed = flowgit(dir, ["prune", "--keep", "2", "--dry-run"]);
    expect(listed.code, listed.out).toBe(0);
    expect(listed.out).toContain("不会删除任何版本");
    expect(listed.out).toContain("nothing will be deleted");
    expect(listed.out).toContain("释放");
    expect(listed.out).toContain("frees");
    expect(listed.out).toContain("KB");
    expect(listed.out).toMatch(/draft\s+v1\s+/);
    expect(listed.out).toMatch(/other\s+v2\s+/);
    expect(listed.out).not.toContain("已删除");
    expect(dirs(dir, "draft")).toEqual(["1", "2", "3", "4", "5", "6"]);

    const alsoYes = flowgit(dir, ["prune", "--keep", "2", "--dry-run", "--yes"]);
    expect(alsoYes.code, alsoYes.out).toBe(0);
    expect(dirs(dir, "draft")).toEqual(["1", "2", "3", "4", "5", "6"]);

    const one = flowgit(dir, ["prune", "--keep", "2", "--stage", "other", "--dry-run"]);
    expect(one.code, one.out).toBe(0);
    expect(one.out).toMatch(/other\s+v1\s+/);
    expect(one.out).not.toContain("draft");
  });

  it("refuses to delete outside a terminal unless --yes is set", () => {
    const dir = seed();
    made.push(dir);
    const refused = flowgit(dir, ["prune", "--keep", "2"]);
    expect(refused.code, refused.out).toBe(1);
    expect(refused.out).toContain("不在终端里，没有删除。确认删除请加上 --yes");
    expect(refused.out).toContain("Not a terminal, so nothing was deleted. Add --yes to delete.");
    expect(refused.out).toContain("释放");
    expect(dirs(dir, "draft")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(dirs(dir, "other")).toEqual(["1", "2", "3", "4"]);

    const bad = flowgit(dir, ["prune", "--keep", "0"]);
    expect(bad.code, bad.out).toBe(1);
    expect(bad.out).toContain("至少是 1");
    expect(bad.out).toContain("at least 1");
    expect(dirs(dir, "draft")).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("deletes with --yes, and log, diff and restore still work across the gap", () => {
    const dir = seed();
    made.push(dir);
    const deleted = flowgit(dir, ["prune", "--keep", "2", "--yes"]);
    expect(deleted.code, deleted.out).toBe(0);
    expect(deleted.out).toContain("已删除 6 个版本");
    expect(deleted.out).toContain("deleted 6 version(s)");
    expect(deleted.out).toContain("释放");
    expect(deleted.out).toContain("freed");
    expect(dirs(dir, "draft")).toEqual(["5", "6"]);
    expect(dirs(dir, "other")).toEqual(["3", "4"]);
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("draft-6");

    const log = flowgit(dir, ["log", "draft"]);
    expect(log.code, log.out).toBe(0);
    expect(log.out).toContain("v6");
    expect(log.out).toContain("v5");
    expect(log.out).not.toMatch(/(^|\s)v1(\s|$)/);

    const all = flowgit(dir, ["log"]);
    expect(all.code, all.out).toBe(0);
    expect(all.out).toContain("v6");
    expect(all.out).not.toMatch(/(^|\s)v1(\s|$)/);

    const diff = flowgit(dir, ["diff", "draft", "5", "6"]);
    expect(diff.code, diff.out).toBe(0);
    expect(diff.out).toContain("v5 → v6");
    expect(diff.out).toContain("draft-5");
    expect(diff.out).toContain("draft-6");

    const missing = flowgit(dir, ["diff", "draft", "1", "6"]);
    expect(missing.code, missing.out).toBe(1);
    expect(missing.out).toContain("没有 v1");
    expect(missing.out).toContain("has no run #1");

    const restored = flowgit(dir, ["restore", "draft", "5"]);
    expect(restored.code, restored.out).toBe(0);
    expect(restored.out).toContain("已回退到 / restored draft v5");
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("draft-5");
  });

  it("adds a last line to status when runs/ is over 500 MB", () => {
    const dir = seed();
    made.push(dir);
    const quiet = flowgit(dir, ["status"]);
    expect(quiet.code, quiet.out).toBe(0);
    expect(quiet.out).not.toContain("flowgit prune");

    const bytes = Math.round(1.2 * 1024 ** 3);
    const pad = path.join(dir, "runs", "pad.bin");
    const fd = fs.openSync(pad, "w");
    fs.ftruncateSync(fd, bytes);
    fs.closeSync(fd);

    const line = "runs/ 占用 1.2 GB，可以用 flowgit prune 清理 / runs/ uses 1.2 GB; clean up with flowgit prune";
    const loud = flowgit(dir, ["status"]);
    expect(loud.code, loud.out).toBe(0);
    expect(loud.out.trimEnd().endsWith(line)).toBe(true);

    const json = flowgit(dir, ["status", "--json"]);
    expect(json.code, json.out).toBe(0);
    expect(json.out).not.toContain("flowgit prune");
    expect(JSON.parse(json.out).flow.name).toBe("prune");
  });
});
