import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSpec, taskLaunch, useShellExecution } from "./tasks.js";

const cli = "/opt/My Programs/flowgit";
const flowDir = "/home/me/My Flows";

describe("taskLaunch", () => {
  it("keeps stage ids and paths as their own arguments", () => {
    const launch = taskLaunch(cli, flowDir, { kind: "run", stageId: "my stage" });
    expect(launch.command).toBe(cli);
    expect(launch.args).toEqual(["-C", flowDir, "run", "my stage"]);
    expect(launch.cwd).toBe(flowDir);
    const parts = [launch.command, ...launch.args];
    expect(parts.filter((part) => part.includes("my stage"))).toEqual(["my stage"]);
    expect(parts.filter((part) => part.includes("My Flows"))).toEqual([flowDir]);
    expect(parts.some((part) => part.includes("&&") || part.includes("|"))).toBe(false);
  });

  it("builds run all, board, diff, trust and status the same way", () => {
    expect(taskLaunch(cli, flowDir, { kind: "run-all" }).args).toEqual(["-C", flowDir, "run", "all"]);
    expect(taskLaunch(cli, flowDir, { kind: "board" }).args).toEqual(["-C", flowDir, "board"]);
    expect(taskLaunch(cli, flowDir, { kind: "trust" }).args).toEqual(["-C", flowDir, "trust"]);
    expect(taskLaunch(cli, flowDir, { kind: "status" }).args).toEqual(["-C", flowDir, "status", "--json"]);
    expect(taskLaunch(cli, flowDir, { kind: "diff", stageId: "my stage", version: 2 }).args).toEqual(["-C", flowDir, "diff", "my stage", "2"]);
  });

  it("does the same for a Windows path and a .cmd shim", () => {
    const winCli = "C:\\Program Files\\flowgit.cmd";
    const winDir = "D:\\My Flows\\week";
    const launch = taskLaunch(winCli, winDir, { kind: "run", stageId: "stage one" });
    expect(launch.args).toEqual(["-C", winDir, "run", "stage one"]);
    expect(useShellExecution(winCli, "win32")).toBe(true);
    expect(useShellExecution(winCli, "linux")).toBe(false);
    expect(useShellExecution("C:\\Program Files\\flowgit.exe", "win32")).toBe(false);
    const spec = spawnSpec(winCli, launch.args, "win32");
    expect(spec.shell).toBe(false);
    expect(spec.args.slice(-4)).toEqual(["-C", winDir, "run", "stage one"]);
    expect(spec.command.toLowerCase()).toContain("cmd");
    expect(path.win32.basename(spec.args[3] ?? "")).toBe("flowgit.cmd");
  });
});
