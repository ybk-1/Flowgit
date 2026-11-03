import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gitFragmentProblem, loadCommunityRegistry, splitGitFragment, validateCommunityRegistry } from "./registry.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "agent-page",
    name: { zh: "一页介绍网页", en: "One-page explainer" },
    description: { zh: "让 agent 做网页。", en: "An agent builds a page." },
    git: "https://github.com/cgold9820-dotcom/Flowgit.git#path=examples/agent-page",
    author: "Flowgit",
    tags: ["agent"],
    language: ["zh", "en"],
    license: "Apache-2.0",
    ...over,
  };
}

describe("community registry schema", () => {
  it("accepts a good entry and the committed registry", async () => {
    const good = validateCommunityRegistry([entry(), entry({ id: "notes", language: ["zh"], ref: "main", tags: [] })]);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.entries.map((item) => item.id)).toEqual(["agent-page", "notes"]);
      expect(good.entries[1]?.ref).toBe("main");
    }

    const committed = await loadCommunityRegistry(path.join(repo, "registry", "community"));
    expect(committed.ok, committed.ok ? "" : committed.errors.join("\n")).toBe(true);
    if (committed.ok) {
      expect(committed.entries[0]).toMatchObject({
        id: "agent-page",
        git: "https://github.com/cgold9820-dotcom/Flowgit.git#path=examples/agent-page",
        license: "Apache-2.0",
      });
    }

    const schema = JSON.parse(fs.readFileSync(path.join(repo, "registry", "community.schema.json"), "utf8")) as {
      type: string;
      $defs: { entry: { required: string[] } };
    };
    expect(schema.type).toBe("array");
    expect([...schema.$defs.entry.required].sort()).toEqual(["author", "description", "git", "id", "language", "license", "name", "tags"]);
  });

  it("rejects bad entries", () => {
    const cases: { name: string; doc: unknown; match: RegExp }[] = [
      { name: "not an array", doc: { templates: [] }, match: /数组|array/ },
      { name: "missing license", doc: [entry({ license: undefined })], match: /license/ },
      { name: "name without english", doc: [entry({ name: { zh: "只有中文" } })], match: /name\/en/ },
      { name: "language fr", doc: [entry({ language: ["zh", "fr"] })], match: /zh 或 en|zh or en/ },
      { name: "empty language", doc: [entry({ language: [] })], match: /language/ },
      { name: "duplicate ids", doc: [entry(), entry()], match: /重复|duplicated/ },
      { name: "extra field", doc: [entry({ homepage: "https://example.com" })], match: /多余|unknown fields/ },
      { name: "git is not a url", doc: [entry({ git: "not a url" })], match: /Git 地址|Git URL/ },
      { name: "path escapes", doc: [entry({ git: "https://github.com/org/repo.git#path=../secret" })], match: /#path=/ },
      { name: "empty tag", doc: [entry({ tags: [""] })], match: /tags\/0/ },
      { name: "empty ref", doc: [entry({ ref: "  " })], match: /ref/ },
      { name: "bad id", doc: [entry({ id: "Agent_Page" })], match: /id/ },
    ];
    for (const item of cases) {
      const result = validateCommunityRegistry(item.doc);
      expect(result.ok, item.name).toBe(false);
      if (!result.ok) expect(result.errors.join("\n"), item.name).toMatch(item.match);
    }
  });

  it("reads #path= off a Git URL and rejects a path that leaves the repo", () => {
    expect(splitGitFragment("https://github.com/org/repo.git#path=examples/agent-page")).toEqual({
      url: "https://github.com/org/repo.git",
      path: "examples/agent-page",
    });
    expect(splitGitFragment("git@github.com:org/repo.git#path=flows/demo")).toEqual({
      url: "git@github.com:org/repo.git",
      path: "flows/demo",
    });
    expect(gitFragmentProblem("https://github.com/org/repo.git#path=../secret")).toMatch(/#path=/);
    expect(gitFragmentProblem("file:///tmp/repo.git#path=examples/mini")).toBeUndefined();
  });

  it("reads the old single-file array, then prefers the published URL and falls back to a directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-registry-"));
    const oldFile = path.join(root, "community.json");
    fs.writeFileSync(oldFile, JSON.stringify([entry({ id: "from-file" })]));
    const old = await loadCommunityRegistry(oldFile);
    expect(old.ok, old.ok ? "" : old.errors.join("\n")).toBe(true);
    if (old.ok) expect(old.entries.map((item) => item.id)).toEqual(["from-file"]);

    const calls: string[] = [];
    const remote = await loadCommunityRegistry(undefined, {
      cwd: root,
      env: {},
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify([entry({ id: "from-url" })]), { status: 200 });
      },
    });
    expect(calls).toEqual(["https://flowgit.dev/registry.json"]);
    expect(remote.ok).toBe(true);
    if (remote.ok) expect(remote.entries[0]?.id).toBe("from-url");

    fs.mkdirSync(path.join(root, "registry", "community"), { recursive: true });
    fs.writeFileSync(path.join(root, "registry", "community", "from-dir.json"), JSON.stringify(entry({ id: "from-dir" })));
    const fallback = await loadCommunityRegistry(undefined, {
      cwd: root,
      env: {},
      fetch: async () => new Response("missing", { status: 404 }),
    });
    expect(fallback.ok, fallback.ok ? "" : fallback.errors.join("\n")).toBe(true);
    if (fallback.ok) expect(fallback.entries.map((item) => item.id)).toEqual(["from-dir"]);

    const overridden = await loadCommunityRegistry(undefined, {
      cwd: root,
      env: { FLOWGIT_REGISTRY: oldFile },
      fetch: async () => {
        throw new Error("FLOWGIT_REGISTRY must not fetch");
      },
    });
    expect(overridden.ok).toBe(true);
    if (overridden.ok) expect(overridden.entries[0]?.id).toBe("from-file");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
