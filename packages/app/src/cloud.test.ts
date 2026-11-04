import { describe, expect, it } from "vitest";
import { bytesToBase64, planCloudUpload } from "./cloud.js";
import { cloudBoardRequest } from "./router.js";

const text = (value: string) => new TextEncoder().encode(value);

describe("cloud board requests", () => {
  it("rewrites a board URL onto a flow and a share", () => {
    expect(cloudBoardRequest("/api/flow", { flowId: "flw_abc", share: null })).toBe("/api/flows/flw_abc/board/flow");
    expect(cloudBoardRequest("/api/file?path=notes.md", { flowId: "flw_abc", share: null })).toBe("/api/flows/flw_abc/board/file?path=notes.md");
    expect(cloudBoardRequest("/api/runs?stage=notes", { flowId: null, share: "tok_en" })).toBe("/api/share/tok_en/board/runs?stage=notes");
  });
});

describe("planCloudUpload", () => {
  it("sends the flow together when it fits, and never sends flowgit.local.json", () => {
    const plan = planCloudUpload({
      "flow.json": text("{}"),
      "notes.md": text("hi"),
      "runs/notes/1/run.json": text("{}"),
      "flowgit.local.json": text("secret"),
    });
    expect(Object.keys(plan.batch).sort()).toEqual(["flow.json", "notes.md", "runs/notes/1/run.json"]);
    expect(plan.rest).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(bytesToBase64(text("hi"))).toBe(btoa("hi"));
  });

  it("sends the flow file first when the total is over 50 MB, and skips one huge file", () => {
    const big = new Uint8Array(40 * 1024 * 1024);
    const huge = new Uint8Array(50 * 1024 * 1024 + 1);
    const plan = planCloudUpload({
      "flow.json": text("{}"),
      "a.bin": big,
      "b.bin": big,
      "huge.bin": huge,
      "nested/flowgit.local.json": text("nope"),
    });
    expect(Object.keys(plan.batch)).toEqual(["flow.json"]);
    expect(plan.rest.map((file) => file.path)).toEqual(["a.bin", "b.bin"]);
    expect(plan.skipped).toEqual(["huge.bin"]);
  });
});