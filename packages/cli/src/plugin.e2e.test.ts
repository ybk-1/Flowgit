import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "dist", "index.js");
const example = path.resolve(here, "../../../examples/plugin-echo");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function flowgit(args: string[]) {
  if (!fs.existsSync(cli)) throw new Error("Build the CLI first: pnpm -r run build");
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("flowgit plugins", () => {
  it("lists the example plugin and, on init, where it resolves", () => {
    const listed = flowgit(["-C", example, "plugins"]);
    expect(listed.code, listed.out).toBe(0);
    expect(listed.out).toContain("./plugins/echo");
    expect(listed.out).toContain("plugins/echo");
    expect(listed.out).toContain("1.0.0");

    const json = flowgit(["-C", example, "plugins", "--json"]);
    expect(json.code, json.out).toBe(0);
    const parsed = JSON.parse(json.out) as { plugins: { plugin: string; path: string; version: string; missing: boolean }[] };
    expect(parsed.plugins).toEqual([expect.objectContaining({ plugin: "./plugins/echo", path: "plugins/echo", version: "1.0.0", missing: false })]);

    const doctor = flowgit(["-C", example, "doctor"]);
    expect(doctor.code, doctor.out).toBe(0);
    expect(doctor.out).toContain("plugins/echo");
    expect(doctor.out).toContain("1.0.0");

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-plugin-init-"));
    dirs.push(target);
    const init = flowgit(["init", target, "-t", example]);
    expect(init.code, init.out).toBe(0);
    expect(init.out).toContain("plugin");
    expect(init.out).toContain("./plugins/echo");
    expect(init.out).toContain("plugins/echo");
  });

  it("points at npm install when a package plugin is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-plugin-missing-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "flow.json"),
      `${JSON.stringify(
        {
          format: "flowgit",
          version: "0.1",
          name: "missing",
          stages: [
            {
              id: "work",
              name: "work",
              executor: { type: "plugin", plugin: "echo-plugin" },
              outputs: [{ type: "text/plain", path: "out.txt" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const listed = flowgit(["-C", dir, "plugins"]);
    expect(listed.code, listed.out).toBe(1);
    expect(listed.out).toContain("npm install echo-plugin");
    expect(listed.out).toContain("找不到插件");
    expect(listed.out).toContain("was not found");
  });
});
