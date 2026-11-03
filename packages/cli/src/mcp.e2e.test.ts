import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const example = path.resolve(here, "../../../examples/mcp-echo");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function flowgit(args: string[], cwdEnv: Record<string, string> = {}) {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ECHO_TOKEN: "demo", ...cwdEnv },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("flowgit mcp", () => {
  it("lists the fake server's tools and, on init, the command it would start", () => {
    const listed = flowgit(["-C", example, "mcp", "tools", "echo"]);
    expect(listed.code, listed.out).toBe(0);
    expect(listed.out).toContain("echo");
    expect(listed.out).toContain("text");
    expect(listed.out).toContain("参数 / parameters");
    expect(listed.out).toContain("必填 / required");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-mcp-init-"));
    dirs.push(target);
    const init = flowgit(["init", target, "-t", example]);
    expect(init.code, init.out).toBe(0);
    expect(init.out).toContain("mcp");
    expect(init.out).toContain("node scripts/fake-mcp.mjs");
    expect(init.out).toContain("ECHO_TOKEN");
  });

  it("asks before starting the server of a flow copied from a Git URL", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-mcp-home-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-mcp-forked-"));
    dirs.push(home, dir);
    fs.cpSync(example, dir, { recursive: true });
    const file = path.join(dir, "flow.json");
    const flow = JSON.parse(fs.readFileSync(file, "utf8"));
    flow.forkedFrom = { source: "https://example.com/someone/mcp-echo.git" };
    fs.writeFileSync(file, JSON.stringify(flow, null, 2));

    const refused = flowgit(["-C", dir, "mcp", "tools", "echo"], { FLOWGIT_HOME: home });
    expect(refused.code, refused.out).not.toBe(0);
    expect(refused.out).toContain("node scripts/fake-mcp.mjs");
    expect(refused.out).not.toContain("参数 / parameters");

    const confirmed = flowgit(["-C", dir, "mcp", "tools", "echo", "--yes"], { FLOWGIT_HOME: home });
    expect(confirmed.code, confirmed.out).toBe(0);
    expect(confirmed.out).toContain("参数 / parameters");
  });
});
