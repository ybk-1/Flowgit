import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFlow, runStage } from "@flowgit/core";
import { afterEach, describe, expect, it } from "vitest";
import { appendShimDir, shimContents, shimFileName, writeShim } from "./shim.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkScript = path.resolve(here, "..", "..", "cli", "templates", "weekly-report", "scripts", "check-report.mjs");
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-desktop-shim-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dirHasNode(dir: string): boolean {
  return ["node", "node.exe", "node.cmd"].some((name) => fs.existsSync(path.join(dir, name)));
}

/** PATH that can start a shell, without any directory that already contains node. */
function pathWithoutNode(shimDir: string): string {
  const shellDirs = process.platform === "win32"
    ? [process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : ""].filter(Boolean)
    : ["/bin", "/usr/bin"].filter((dir) => fs.existsSync(dir) && !dirHasNode(dir));
  return [...shellDirs, shimDir].join(path.delimiter);
}

describe("node shim", () => {
  it("writes this launch's execPath and does not set ELECTRON_RUN_AS_NODE on the environment", () => {
    const dir = tempDir();
    const before = process.env.ELECTRON_RUN_AS_NODE;
    const execPath = process.platform === "win32" ? "C:\\Program Files\\Flowgit\\Flowgit.exe" : "/opt/Flowgit/flowgit";
    writeShim(dir, execPath);
    const text = fs.readFileSync(path.join(dir, shimFileName()), "utf8");
    expect(text).toBe(shimContents(execPath));
    expect(text).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(text).toContain(execPath);
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe(before);

    const env: NodeJS.ProcessEnv = { PATH: ["/usr/local/bin", "/usr/bin"].join(path.delimiter) };
    appendShimDir(env, dir);
    const parts = (env.PATH ?? "").split(path.delimiter);
    expect(parts[parts.length - 1]).toBe(dir);
    expect(parts.slice(0, -1)).toEqual(["/usr/local/bin", "/usr/bin"]);
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    appendShimDir(env, dir);
    expect((env.PATH ?? "").split(path.delimiter).filter((part) => path.resolve(part) === path.resolve(dir))).toHaveLength(1);
  });

  it("runs the weekly-report check script through the shim when node is not on PATH", async () => {
    const root = tempDir();
    const shimDir = path.join(root, "shim");
    writeShim(shimDir, process.execPath);
    const flowDir = path.join(root, "flow");
    fs.mkdirSync(path.join(flowDir, "scripts"), { recursive: true });
    fs.copyFileSync(checkScript, path.join(flowDir, "scripts", "check-report.mjs"));
    fs.writeFileSync(
      path.join(flowDir, "report.md"),
      "# 本周周报\n\n## 本周完成\n- 修好了导出，并且补上了测试\n\n## 下周计划\n- 继续把安装档在这台电脑上跑一遍\n\n## 需要帮助\n- 暂时没有\n",
    );
    fs.writeFileSync(
      path.join(flowDir, "flow.json"),
      JSON.stringify({
        format: "flowgit",
        version: "0.1",
        name: "check",
        inputs: { name: { type: "string", default: "小林" } },
        stages: [
          {
            id: "check",
            name: "检查",
            executor: { type: "script", run: "node scripts/check-report.mjs" },
            outputs: [{ type: "application/json", path: "check.json" }],
          },
        ],
      }),
    );
    const loaded = loadFlow(flowDir);
    await runStage(loaded, "check", { env: { PATH: pathWithoutNode(shimDir) } });
    const check = JSON.parse(fs.readFileSync(path.join(flowDir, "check.json"), "utf8")) as { ok: boolean };
    expect(check.ok).toBe(true);
    expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("uses a node that is already on PATH ahead of the shim", async () => {
    const root = tempDir();
    const early = path.join(root, "early");
    const shimDir = path.join(root, "shim");
    fs.mkdirSync(early, { recursive: true });
    const marker = path.join(root, "which.txt");
    const script = process.platform === "win32"
      ? `@echo off\r\necho early>${marker}\r\n`
      : `#!/bin/sh\necho early > '${marker.replace(/'/g, `'\\''`)}'\n`;
    const name = shimFileName();
    fs.writeFileSync(path.join(early, name), script, { mode: 0o755 });
    writeShim(shimDir, process.execPath);
    const env = { ...process.env, PATH: [early, shimDir].join(path.delimiter) };
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("node -e \"process.stdout.write('shim')\"", {
        shell: true,
        env,
        windowsHide: true,
      });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out}`))));
    });
    expect(fs.readFileSync(marker, "utf8")).toContain("early");
    expect(output).not.toContain("shim");
  });
});
