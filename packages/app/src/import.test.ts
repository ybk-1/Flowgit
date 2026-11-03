import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGitHub, parseGitHubUrl, prepareFlow, text, unzipFlow, zipFlow } from "./import.js";

const flow = {
  format: "flowgit",
  version: "0.1",
  id: "demo",
  name: "Demo",
  stages: [{ id: "a", name: "A", executor: { type: "human" }, outputs: [{ type: "text/markdown", path: "a.md" }] }],
};
const flowJson = strToU8(JSON.stringify(flow));

afterEach(() => vi.unstubAllGlobals());

describe("parseGitHubUrl", () => {
  it("reads repository, tree and #path forms", () => {
    expect(parseGitHubUrl("https://github.com/o/r")).toEqual({ owner: "o", repo: "r" });
    expect(parseGitHubUrl("https://github.com/o/r.git#path=examples/agent-page")).toEqual({ owner: "o", repo: "r", path: "examples/agent-page" });
    expect(parseGitHubUrl("https://github.com/o/r/tree/main/a/b")).toEqual({ owner: "o", repo: "r", ref: "main", path: "a/b" });
    expect(parseGitHubUrl("https://github.com/o/r?ref=release/1#path=x")).toEqual({ owner: "o", repo: "r", ref: "release/1", path: "x" });
  });

  it("refuses other hosts, plain http, other pages and paths that climb", () => {
    for (const bad of ["http://github.com/o/r", "https://gitlab.com/o/r", "https://github.com/o", "https://github.com/o/r/issues/1", "https://github.com/o/r#path=../x", "not a url"]) {
      expect(parseGitHubUrl(bad), bad).toBeUndefined();
    }
  });
});

describe("zip", () => {
  it("round-trips a flow and drops the top folder a zipped folder has", () => {
    const zip = zipFlow({ "flow.json": flowJson, "runs/a/1/run.json": strToU8("{}"), ".flowgit/thumbs/x.jpg": strToU8("x") });
    expect(Object.keys(unzipFlow(zip)).sort()).toEqual(["flow.json", "runs/a/1/run.json"]);
    const folder = zipSync({ "demo/flow.json": flowJson, "demo/a.md": strToU8("hi") });
    expect(Object.keys(unzipFlow(folder)).sort()).toEqual(["a.md", "flow.json"]);
  });

  it("skips entries that would land outside the flow", () => {
    const zip = zipSync({ "flow.json": flowJson, "../evil.txt": strToU8("x"), "/abs.txt": strToU8("x"), "C:/win.txt": strToU8("x"), "__MACOSX/flow.json": strToU8("x") });
    expect(Object.keys(unzipFlow(zip))).toEqual(["flow.json"]);
  });
});

describe("prepareFlow", () => {
  it("keeps everything from a zip, and only what flowgit init copies from a repository, with forkedFrom", () => {
    const files = { "flow.json": flowJson, "a.md": strToU8("output"), "runs/a/1/run.json": strToU8("{}"), "flowgit.local.json": strToU8("{}"), "prompts/p.md": strToU8("p") };
    expect(Object.keys(prepareFlow(files).files).sort()).toEqual(Object.keys(files).sort());
    const forked = { source: "https://github.com/o/r.git", commit: "abc" };
    const copied = prepareFlow(files, { forked });
    expect(Object.keys(copied.files).sort()).toEqual(["flow.json", "prompts/p.md"]);
    expect(JSON.parse(text(copied.files["flow.json"]))).toMatchObject({ id: "demo", forkedFrom: forked });
  });

  it("says when there is no flow", () => {
    expect(() => prepareFlow({ "README.md": strToU8("x") })).toThrow(/flow\.json/);
  });
});

describe("fetchGitHub", () => {
  it("lists the tree at one commit and downloads the files under the path", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url === "https://api.github.com/repos/o/r") return Response.json({ default_branch: "main" });
      if (url === "https://api.github.com/repos/o/r/commits/main") return Response.json({ sha: "c0ffee" });
      if (url.startsWith("https://api.github.com/repos/o/r/git/trees/c0ffee")) {
        return Response.json({
          tree: [
            { path: "flows/demo/flow.json", type: "blob", size: 10 },
            { path: "flows/demo/runs/a/1/run.json", type: "blob", size: 2 },
            { path: "flows/demo", type: "tree" },
            { path: "other.md", type: "blob", size: 1 },
          ],
        });
      }
      if (url === "https://raw.githubusercontent.com/o/r/c0ffee/flows/demo/flow.json") return new Response(flowJson);
      return new Response("", { status: 404 });
    });
    const { files, forked } = await fetchGitHub({ owner: "o", repo: "r", path: "flows/demo" });
    expect(Object.keys(files)).toEqual(["flow.json"]);
    expect(forked).toEqual({ source: "https://github.com/o/r.git", commit: "c0ffee" });
    expect(calls).not.toContain("https://raw.githubusercontent.com/o/r/c0ffee/other.md");
  });

  it("explains a missing repository", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(fetchGitHub({ owner: "o", repo: "nope" })).rejects.toThrow(/public repositories only/);
  });
});
