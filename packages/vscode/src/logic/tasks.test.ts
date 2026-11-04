import { describe, expect, it } from "vitest";
import { spawnSpec, taskLaunch, UnsafeArgumentError, useShellExecution } from "./tasks.js";

const cli = "/opt/My Programs/flowgit";
const flowDir = "/home/me/R&D Flows; rm -rf ~";

describe("taskLaunch", () => {
  it("runs in the flow folder and never passes the folder as an argument", () => {
    const launch = taskLaunch(cli, flowDir, { kind: "run", stageId: "draft_2" });
    expect(launch.command).toBe(cli);
    expect(launch.args).toEqual(["run", "draft_2"]);
    expect(launch.cwd).toBe(flowDir);
    expect(launch.args.some((part) => part.includes("R&D"))).toBe(false);
  });

  it("builds run all, board, diff, trust and status the same way", () => {
    expect(taskLaunch(cli, flowDir, { kind: "run-all" }).args).toEqual(["run", "all"]);
    expect(taskLaunch(cli, flowDir, { kind: "board" }).args).toEqual(["board"]);
    expect(taskLaunch(cli, flowDir, { kind: "trust" }).args).toEqual(["trust"]);
    expect(taskLaunch(cli, flowDir, { kind: "status" }).args).toEqual(["status", "--json"]);
    expect(taskLaunch(cli, flowDir, { kind: "diff", stageId: "outline", version: 2 }).args).toEqual(["diff", "outline", "2"]);
  });

  it("refuses a stage id that the schema would refuse", () => {
    for (const id of ["my stage", "a&calc", "x|y", "Upper", "", "-flag"]) {
      expect(() => taskLaunch(cli, flowDir, { kind: "run", stageId: id })).toThrow(UnsafeArgumentError);
    }
    expect(() => taskLaunch(cli, flowDir, { kind: "diff", stageId: "outline", version: 0 })).toThrow(UnsafeArgumentError);
  });
});

describe("spawnSpec", () => {
  it("spawns a real executable directly", () => {
    expect(spawnSpec("/usr/bin/flowgit", ["status", "--json"], "linux")).toEqual({ command: "/usr/bin/flowgit", args: ["status", "--json"], shell: false });
    expect(spawnSpec("C:\\Tools\\flowgit.exe", ["status", "--json"], "win32").command).toBe("C:\\Tools\\flowgit.exe");
  });

  it("runs a Windows .cmd shim through cmd.exe with its path quoted", () => {
    const winCli = "C:\\Users\\R&D (team)\\AppData\\Roaming\\npm\\flowgit.cmd";
    expect(useShellExecution(winCli, "win32")).toBe(true);
    expect(useShellExecution(winCli, "linux")).toBe(false);
    expect(useShellExecution("C:\\Program Files\\flowgit.exe", "win32")).toBe(false);
    const spec = spawnSpec(winCli, ["status", "--json"], "win32");
    expect(spec.shell).toBe(false);
    expect(spec.windowsVerbatimArguments).toBe(true);
    expect(spec.command.toLowerCase()).toContain("cmd");
    expect(spec.args).toEqual(["/d", "/s", "/c", `""${winCli}" status --json"`]);
  });

  it("refuses anything cmd.exe would read as syntax", () => {
    const winCli = "C:\\npm\\flowgit.cmd";
    for (const arg of ["a&calc", "x|y", "%PATH%", "two words", "^", "a>b"]) {
      expect(() => spawnSpec(winCli, ["run", arg], "win32")).toThrow(UnsafeArgumentError);
    }
    expect(() => spawnSpec("C:\\%TEMP%\\flowgit.cmd", ["status"], "win32")).toThrow(UnsafeArgumentError);
  });
});
