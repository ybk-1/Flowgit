import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cliChildEnv, flowgitEntry } from "./cli-launch.js";

describe("CLI launch", () => {
  it("finds the flowgit package and sets ELECTRON_RUN_AS_NODE only on the child env", () => {
    const entry = flowgitEntry();
    expect(entry.replaceAll("\\", "/")).toMatch(/packages\/cli\/dist\/index\.js$/);
    expect(fs.existsSync(entry)).toBe(true);
    const child = cliChildEnv({ PATH: "/bin" });
    expect(child.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
