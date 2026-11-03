import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  TrustNeededError,
  doctor,
  flowActions,
  listPlugins,
  listRuns,
  loadFlow,
  parseFlowMd,
  renderFlowMd,
  runAll,
  runStage,
  stageConfigHash,
  stageStatus,
  validateFlow,
  type ExecutorPlugin,
  type Flow,
} from "./index.js";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exampleDir = path.join(repoDir, "examples/plugin-echo");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeFlow(dir: string, flow: Flow): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
}

function writeFolderPlugin(dir: string, rel: string, source: string, version = "1.0.0"): void {
  const folder = path.join(dir, rel);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "package.json"),
    `${JSON.stringify({ name: path.basename(rel), version, private: true, type: "module", main: "index.js" }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(folder, "index.js"), source);
}

function writePackagePlugin(root: string, name: string, version: string, source: string): void {
  const folder = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "package.json"),
    `${JSON.stringify({ name, version, type: "module", main: "index.js" }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(folder, "index.js"), source);
}

function pluginFlow(plugin: string, extra: Partial<ExecutorPlugin> = {}, outputs = [{ type: "text/plain", path: "out.txt" }]): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "plugin",
    stages: [
      {
        id: "work",
        name: "work",
        executor: { type: "plugin", plugin, ...extra },
        outputs,
      },
    ],
  };
}

const writer = (body: string) => `export default {
  flowgitPlugin: 1,
  name: "writer",
  executor: {
    run(ctx) {
      ${body}
    },
  },
};
`;

describe("plugin validation", () => {
  it("rejects a plugin path that leaves the flow directory", () => {
    for (const plugin of ["../outside", "./../outside", "/tmp/outside"]) {
      const msgs = validateFlow(pluginFlow(plugin)).map((issue) => issue.message).join("\n");
      expect(msgs, plugin).toContain("插件路径必须留在流程目录内");
      expect(msgs, plugin).toContain("stay inside the flow directory");
      expect(msgs, plugin).toContain(plugin);
    }
  });
});

describe("folder plugin", () => {
  it("runs the plugin-echo example and writes the prefixed upstream text", async () => {
    const dir = tempDir("flowgit-plugin-echo-");
    fs.cpSync(exampleDir, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "source.txt"), "hello\n");
    const loaded = loadFlow(dir);
    expect(validateFlow(loaded.flow, { dir })).toEqual([]);
    expect(parseFlowMd(renderFlowMd(loaded.flow))).toEqual(loaded.flow);
    expect(flowActions(loaded.flow, dir)).toEqual([{ stage: "echo", kind: "plugin", detail: "./plugins/echo 1.0.0 → plugins/echo" }]);
    expect(flowActions(loaded.flow)).toEqual([{ stage: "echo", kind: "plugin", detail: "./plugins/echo" }]);
    expect(listPlugins(loaded)).toMatchObject([{ stage: "echo", plugin: "./plugins/echo", missing: false, version: "1.0.0", path: "plugins/echo" }]);
    const checks = doctor(loaded);
    expect(checks).toContainEqual(expect.objectContaining({ level: "ok", stage: "echo", message: expect.stringContaining("plugins/echo") }));
    expect(checks.some((check) => check.message.includes("1.0.0"))).toBe(true);

    await runStage(loaded, "source");
    const run = await runStage(loaded, "echo");
    expect(run.status).toBe("ok");
    expect(fs.readFileSync(path.join(dir, "echo.txt"), "utf8")).toBe("echo: hello\n");
    expect(stageStatus(loaded, "echo", {}).state).toBe("ok");

    const echo = loaded.flow.stages[1]!;
    if (echo.executor.type !== "plugin") throw new Error("expected plugin");
    echo.executor.config = { prefix: "other: " };
    expect(stageStatus(loaded, "echo", {}).state).toBe("stale");
    echo.executor.config = { prefix: "echo: " };
    expect(stageStatus(loaded, "echo", {}).state).toBe("ok");

    const before = stageConfigHash(dir, echo, new Set(), loaded.flow);
    fs.appendFileSync(path.join(dir, "plugins/echo/index.js"), "\n// touched\n");
    expect(stageConfigHash(dir, echo, new Set(), loaded.flow)).not.toBe(before);
    expect(stageStatus(loaded, "echo", {}).state).toBe("stale");
  });

  it("does not read or write outside the flow directory", async () => {
    const dir = tempDir("flowgit-plugin-escape-");
    const outside = path.join(path.dirname(dir), "outside.txt");
    writeFolderPlugin(
      dir,
      "plugins/escape",
      writer(`
        let text = "blocked";
        try { text = ctx.upstream.read("../../etc/passwd"); } catch { text = "blocked"; }
        ctx.writeOutput("out.txt", text.includes("root:") ? "leaked" : "blocked");
        ctx.writeOutput("../outside.txt", "nope");
      `),
    );
    writeFlow(dir, pluginFlow("./plugins/escape"));
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/stay inside the flow directory|流程目录内/);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.readFileSync(path.join(dir, "out.txt"), "utf8")).toBe("blocked");
  });
});

describe("package plugin", () => {
  const parentSource = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "leaked.txt"), "leaked");
export default {
  flowgitPlugin: 1,
  name: "echo-plugin",
  executor: { run(ctx) { ctx.writeOutput(ctx.stage.outputs[0].path, "PARENT"); } },
};
`;
  const childSource = `export default {
  flowgitPlugin: 1,
  name: "echo-plugin",
  executor: { run(ctx) { ctx.writeOutput(ctx.stage.outputs[0].path, "CHILD:" + ctx.config.tag); } },
};
`;

  it("resolves a package from the flow directory and ignores a parent node_modules", async () => {
    const root = tempDir("flowgit-plugin-pkg-");
    const dir = path.join(root, "flow");
    fs.mkdirSync(dir);
    writePackagePlugin(root, "echo-plugin", "9.9.9", parentSource);
    writeFlow(dir, pluginFlow("echo-plugin", { config: { tag: "ok" } }));

    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/npm install echo-plugin/);
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/找不到插件/);
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/was not found/);
    expect(fs.existsSync(path.join(dir, "out.txt"))).toBe(false);
    expect(fs.existsSync(path.join(root, "node_modules/echo-plugin/leaked.txt"))).toBe(false);
    const missing = doctor(loadFlow(dir));
    expect(missing).toContainEqual(expect.objectContaining({ level: "error", stage: "work", hint: "npm install echo-plugin" }));
    expect(flowActions(loadFlow(dir).flow, dir)[0]?.detail).toBe(
      "echo-plugin（找不到，npm install echo-plugin / not found, npm install echo-plugin）",
    );

    writePackagePlugin(dir, "echo-plugin", "1.2.3", childSource);
    const loaded = loadFlow(dir);
    expect(listPlugins(loaded)).toMatchObject([{ plugin: "echo-plugin", missing: false, version: "1.2.3", path: "node_modules/echo-plugin" }]);
    const run = await runStage(loaded, "work");
    expect(run.status).toBe("ok");
    expect(fs.readFileSync(path.join(dir, "out.txt"), "utf8")).toBe("CHILD:ok");
    expect(fs.existsSync(path.join(root, "node_modules/echo-plugin/leaked.txt"))).toBe(false);

    const stage = loaded.flow.stages[0]!;
    const before = stageConfigHash(dir, stage, new Set(), loaded.flow);
    const pkgPath = path.join(dir, "node_modules/echo-plugin/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
    pkg.version = "1.2.4";
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    expect(stageConfigHash(dir, stage, new Set(), loaded.flow)).not.toBe(before);
    expect(stageStatus(loaded, "work", {}).state).toBe("stale");
  });
});

describe("plugin failures", () => {
  it("rejects a plugin whose flowgitPlugin is not 1", async () => {
    const dir = tempDir("flowgit-plugin-v2-");
    writeFolderPlugin(
      dir,
      "plugins/next",
      `export default { flowgitPlugin: 2, name: "next", executor: { run() {} } };\n`,
    );
    writeFlow(dir, pluginFlow("./plugins/next"));
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/flowgitPlugin 是 2/);
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/Upgrade Flowgit or the plugin/);
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/升级 Flowgit 或这个插件/);
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/"next"/);
  });

  it("fails the stage when the plugin throws, and names the plugin", async () => {
    const dir = tempDir("flowgit-plugin-throw-");
    writeFolderPlugin(
      dir,
      "plugins/boom",
      `export default { flowgitPlugin: 1, name: "boom", executor: { run() { throw new Error("nope"); } } };\n`,
    );
    writeFlow(dir, pluginFlow("./plugins/boom"));
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/插件 "boom" 运行失败 \/ plugin "boom" failed: nope/);
    const record = listRuns(dir, "work").at(-1);
    expect(record?.status).toBe("error");
    expect(record?.error).toContain("boom");
    expect(record?.error).not.toContain("work");
  });

  it("aborts signal when timeoutSec elapses", async () => {
    const dir = tempDir("flowgit-plugin-timeout-");
    writeFolderPlugin(
      dir,
      "plugins/slow",
      `import fs from "node:fs";
import path from "node:path";
export default {
  flowgitPlugin: 1,
  name: "slow",
  executor: {
    run(ctx) {
      ctx.signal.addEventListener("abort", () => {
        fs.writeFileSync(path.join(ctx.flowDir, "signal.txt"), "aborted");
      });
      return new Promise(() => {});
    },
  },
};
`,
    );
    writeFlow(dir, pluginFlow("./plugins/slow", { timeoutSec: 1 }));
    await expect(runStage(loadFlow(dir), "work")).rejects.toThrow(/超时（1 秒），已停止 \/ Timed out after 1s and was stopped/);
    expect(fs.readFileSync(path.join(dir, "signal.txt"), "utf8")).toBe("aborted");
    expect(listRuns(dir, "work").at(-1)?.status).toBe("error");
  }, 15_000);
});

describe("confirming a copied flow before a plugin loads", () => {
  it("throws TrustNeededError and loads nothing when the flow was copied from Git", async () => {
    const home = tempDir("flowgit-plugin-home-");
    const previousHome = process.env.FLOWGIT_HOME;
    process.env.FLOWGIT_HOME = home;
    try {
      const dir = tempDir("flowgit-plugin-trust-");
      writeFolderPlugin(
        dir,
        "plugins/mark",
        `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "loaded.txt"), "loaded\\n");
export default {
  flowgitPlugin: 1,
  name: "mark",
  executor: { run(ctx) { ctx.writeOutput("out.txt", "ran"); } },
};
`,
      );
      const flow = pluginFlow("./plugins/mark");
      flow.name = "copied";
      flow.forkedFrom = { source: "https://example.com/someone/flow.git", commit: "abc123" };
      writeFlow(dir, flow);
      const loaded = loadFlow(dir);
      const actions = flowActions(loaded.flow, dir);
      expect(actions).toEqual([{ stage: "work", kind: "plugin", detail: "./plugins/mark 1.0.0 → plugins/mark" }]);
      expect(flowActions(pluginFlow("./missing"), dir)).toEqual([
        { stage: "work", kind: "plugin", detail: "./missing（找不到，确认这个路径是对的 / not found, check that path）" },
      ]);

      const refused = await runStage(loaded, "work").catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(TrustNeededError);
      expect((refused as TrustNeededError).message).toContain("flowgit trust");
      expect((refused as TrustNeededError).state.actions).toEqual(actions);
      await expect(runAll(loaded)).rejects.toBeInstanceOf(TrustNeededError);
      expect(fs.existsSync(path.join(dir, "plugins/mark/loaded.txt"))).toBe(false);
      expect(fs.existsSync(path.join(dir, "out.txt"))).toBe(false);
      expect(listRuns(dir, "work")).toEqual([]);
      expect(fs.existsSync(path.join(home, "trusted.json"))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.FLOWGIT_HOME;
      else process.env.FLOWGIT_HOME = previousHome;
    }
  });
});
