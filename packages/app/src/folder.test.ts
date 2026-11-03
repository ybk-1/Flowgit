// Folder mode against a real folder and the real CLI: the page writes through a directory handle,
// `flowgit status` sees the page's hand edit, and changes made by the CLI reach the page.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { host, setHost, setSchemaCompiler } from "@flowgit/core";
import { flowBoard } from "../../web/src/routes/flow.js";
import { folderStore, watchFolder } from "./folder.js";
import { handOff, LocalBoard, parseBoardLink, type RemoteFlow } from "./handoff.js";
import { BrowserBoard } from "./router.js";
import { flowDir, openWorkspace } from "./workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../../cli/dist/index.js");
const template = path.resolve(here, "../../cli/templates/weekly-report");

/** The parts of FileSystemDirectoryHandle / FileSystemFileHandle the app uses, over node:fs. */
class NodeFile {
  readonly kind = "file";
  constructor(
    readonly abs: string,
    readonly name: string,
  ) {}
  async getFile() {
    const stat = fs.statSync(this.abs);
    const data = fs.readFileSync(this.abs);
    return { size: stat.size, lastModified: Math.floor(stat.mtimeMs), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (data: Uint8Array) => void chunks.push(new Uint8Array(data)),
      close: async () => fs.writeFileSync(this.abs, Buffer.concat(chunks)),
    };
  }
}

class NodeDir {
  readonly kind = "directory";
  constructor(
    readonly abs: string,
    readonly name = path.basename(abs),
  ) {}
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const abs = path.join(this.abs, name);
    if (!fs.existsSync(abs)) {
      if (!options.create) throw Object.assign(new Error("NotFoundError"), { name: "NotFoundError" });
      fs.mkdirSync(abs);
    }
    return new NodeDir(abs);
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const abs = path.join(this.abs, name);
    if (!fs.existsSync(abs)) {
      if (!options.create) throw Object.assign(new Error("NotFoundError"), { name: "NotFoundError" });
      fs.writeFileSync(abs, "");
    }
    return new NodeFile(abs, name);
  }
  async removeEntry(name: string, options: { recursive?: boolean } = {}) {
    fs.rmSync(path.join(this.abs, name), { recursive: !!options.recursive });
  }
  async *entries(): AsyncIterable<[string, NodeDir | NodeFile]> {
    for (const entry of fs.readdirSync(this.abs, { withFileTypes: true })) {
      const abs = path.join(this.abs, entry.name);
      yield [entry.name, entry.isDirectory() ? new NodeDir(abs) : new NodeFile(abs, entry.name)];
    }
  }
}

let folder: string;
let home: string;
// The Node host vitest starts with; openWorkspace swaps in the page's memory host.
const startHost = host();

function flowgit(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: folder,
    encoding: "utf8",
    env: { ...process.env, FLOWGIT_HOME: home, FLOWGIT_LLM_MOCK_DIR: path.join(folder, "demo-replies"), NO_COLOR: "1" },
  });
}

async function call(board: BrowserBoard, url: string, init?: RequestInit) {
  const res = await board.fetch(url, init);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-app-folder-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-app-home-"));
  fs.cpSync(template, folder, { recursive: true });
  for (const junk of ["runs", "notes.md", "report.md", "check.json", "flowgit.local.json"]) fs.rmSync(path.join(folder, junk), { recursive: true, force: true });
});

afterAll(() => {
  setHost(startHost);
  setSchemaCompiler();
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe.skipIf(!fs.existsSync(cli))("folder mode (run pnpm build first)", () => {
  it("shares one folder with the CLI in both directions", async () => {
    const id = "folder-weekly";
    const dir = flowDir(id);
    const store = folderStore(new NodeDir(folder) as unknown as FileSystemDirectoryHandle);
    const ws = await openWorkspace(id, { store, persistent: true });
    ws.env.FLOWGIT_LLM_MOCK_DIR = `${dir}/demo-replies`;
    const board = new BrowserBoard({ dir, settled: () => ws.saved() });

    // The page fills the inputs, writes the notes and runs two stages; the files land in the folder.
    expect((await call(board, "/api/inputs", { method: "PUT", body: JSON.stringify({ name: "小林" }) })).status).toBe(200);
    expect((await call(board, "/api/file?path=notes.md", { method: "PUT", body: "- 修好了导出\n" })).status).toBe(200);
    expect((await call(board, "/api/run", { method: "POST", body: JSON.stringify({ stage: "notes" }) })).status).toBe(200);
    expect((await call(board, "/api/run", { method: "POST", body: JSON.stringify({ stage: "draft" }) })).status).toBe(200);
    expect(fs.existsSync(path.join(folder, "runs/draft/1/run.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "flowgit.local.json"), "utf8"))).toMatchObject({ inputs: { name: "小林" } });

    // A hand edit made on the page is a hand edit to the CLI.
    expect((await call(board, "/api/file?path=report.md", { method: "PUT", body: "# 手改的周报\n" })).status).toBe(200);
    const status = flowgit("status");
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/draft.*edited/);

    // The CLI runs draft again (keeping the hand edit as v2); the page picks the change up.
    const seen: string[][] = [];
    const stop = watchFolder(ws, store, dir, (paths) => seen.push(paths), 50);
    const run = flowgit("run", "draft");
    expect(run.status, run.stderr).toBe(0);
    await expect.poll(() => ws.host.exists(`${dir}/runs/draft/3/run.json`), { timeout: 5000 }).toBe(true);
    stop();
    expect(ws.host.readFile(`${dir}/runs/draft/2/outputs/report.md`, "utf8")).toBe("# 手改的周报\n");
    expect(ws.host.readFile(`${dir}/report.md`, "utf8")).toBe(fs.readFileSync(path.join(folder, "report.md"), "utf8"));
    expect(seen.flat()).toContain("report.md");
    const runs = await call(board, "/api/runs?stage=draft");
    expect((runs.body.runs as { n: number }[]).map((r) => r.n)).toEqual(expect.arrayContaining([1, 2, 3]));

    // Deleting a file outside the page removes it from the page too.
    fs.rmSync(path.join(folder, "check.json"), { force: true });
    fs.rmSync(path.join(folder, "notes.md"));
    const stop2 = watchFolder(ws, store, dir, () => {}, 50);
    await expect.poll(() => ws.host.exists(`${dir}/notes.md`), { timeout: 5000 }).toBe(false);
    stop2();
  });

  it("hands a script stage to the local board the CLI started on the same folder, and reads its result back", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-app-handoff-"));
    fs.cpSync(template, work, { recursive: true });
    for (const junk of ["runs", "notes.md", "report.md", "check.json", "flowgit.local.json"]) fs.rmSync(path.join(work, junk), { recursive: true, force: true });
    const id = "folder-handoff";
    const dir = flowDir(id);
    const store = folderStore(new NodeDir(work) as unknown as FileSystemDirectoryHandle);
    const ws = await openWorkspace(id, { store, persistent: true });
    ws.env.FLOWGIT_LLM_MOCK_DIR = `${dir}/demo-replies`;
    const watcher = watchFolder(ws, store, dir, () => {}, 60_000);
    let local: LocalBoard | undefined;
    const page = { folder: "handoff", flow: () => flowBoard(dir) as unknown as RemoteFlow, poll: watcher.now };
    const board = new BrowserBoard({ dir, settled: () => ws.saved(), remote: () => (local ? handOff(local, page) : undefined) });
    const child = spawn(process.execPath, [cli, "board", "--no-open", "--port", "0"], {
      cwd: work,
      env: { ...process.env, FLOWGIT_HOME: home, NO_COLOR: "1" },
    });
    try {
      // The browser runs what it can.
      expect((await call(board, "/api/inputs", { method: "PUT", body: JSON.stringify({ name: "小林" }) })).status).toBe(200);
      expect((await call(board, "/api/file?path=notes.md", { method: "PUT", body: "- 修好了导出\n" })).status).toBe(200);
      expect((await call(board, "/api/run", { method: "POST", body: JSON.stringify({ stage: "notes" }) })).status).toBe(200);
      expect((await call(board, "/api/run", { method: "POST", body: JSON.stringify({ stage: "draft" }) })).status).toBe(200);

      // Without a local board the script stage says it needs a computer.
      const alone = await call(board, "/api/run", { method: "POST", body: JSON.stringify({ stage: "check" }) });
      expect(alone.status).toBe(500);
      expect(String(alone.body.error)).toMatch(/电脑上运行/);

      // With the link `flowgit board` printed, the stage runs there and its run comes back.
      const link = await new Promise<string>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          const found = /http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+/.exec(out);
          if (found) resolve(found[0]);
        });
        child.on("exit", (code) => reject(new Error(`flowgit board exited (${code})`)));
      });
      local = new LocalBoard(parseBoardLink(link));
      const events: string[] = [];
      const stream = board.events("/api/events");
      for (const type of ["stage:start", "stage:error", "run:end"]) stream.addEventListener(type, () => events.push(type));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const handed = await call(board, "/api/run", { method: "POST", body: JSON.stringify({ stage: "check" }) });
      expect(handed.status, JSON.stringify(handed.body)).toBe(200);
      // (The stream first replays the earlier failed run, like the local board does for a late client.)
      expect(events.slice(events.lastIndexOf("stage:start"))).toEqual(["stage:start", "run:end"]);
      stream.close();
      expect(fs.existsSync(path.join(work, "runs/check/2/run.json"))).toBe(true);
      expect(ws.host.exists(`${dir}/runs/check/2/run.json`)).toBe(true);
      expect(ws.host.readFile(`${dir}/check.json`, "utf8")).toBe(fs.readFileSync(path.join(work, "check.json"), "utf8"));
      const shown = await call(board, "/api/flow");
      // v1 is the browser's failed try; v2 is the local board's run, now current on the page too.
      expect((shown.body.stages as { id: string }[]).find((stage) => stage.id === "check")).toMatchObject({ state: "ok", runs: 2, latest: { n: 2, status: "ok" } });

      // A board on another flow is refused before anything runs there.
      const other = handOff(local, { ...page, flow: () => ({ name: "别的流程", stages: [] }) });
      await expect(other.run("check")).rejects.toThrow(/another flow open/);
      // A flow kept in the browser can't be handed off at all.
      await expect(handOff(local, { flow: page.flow }).run("check")).rejects.toThrow(/Save to a folder/);
    } finally {
      watcher();
      // Windows keeps the folder busy until the board (its working directory) has exited.
      const exited = new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(null) : child.once("exit", resolve)));
      child.kill();
      await exited;
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 30_000);
});
