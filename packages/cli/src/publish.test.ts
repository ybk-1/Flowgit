import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGallery, fetchGithubStars } from "./gallery.js";
import { communityEntryLocation, executePublish, githubNewFileUrl, publishInstructions } from "./commands/publish.js";
import { changedCommunityFiles, checkEntryFile, checkEntryRepository, gitRefProblem, renderRegistryComment } from "./registry-check.js";
import type { CommunityEntry } from "./registry.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;

function goodFlow(dir: string, id = "good-flow") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "flow.json"),
    JSON.stringify(
      {
        format: "flowgit",
        version: "0.1",
        id,
        name: "示例 / Example",
        description: "一个可以发布的流程 / A flow that can be published",
        license: "MIT",
        language: "zh",
        author: { name: "Test" },
        tags: ["demo"],
        stages: [
          {
            id: "note",
            name: "笔记",
            executor: { type: "human", instructions: "写一句话 / Write one line" },
            outputs: [{ type: "text/markdown", path: "note.md" }],
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "README.md"), "# 示例 / Example\n\n## 依据 / Sources\n\n- 测试 / The test.\n");
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT\n");
}

function git(args: string[], cwd: string) {
  const result = spawnSync("git", ["-c", "user.email=dev@example.com", "-c", "user.name=Flowgit", ...args], { cwd, encoding: "utf8" });
  expect(result.status, `${args.join(" ")}\n${result.stdout}${result.stderr}`).toBe(0);
}

async function publish(dir: string, extra: { git?: string; ref?: string } = {}) {
  const lines: string[] = [];
  const code = await executePublish({
    dir,
    ...(extra.git ? { git: extra.git } : {}),
    ...(extra.ref ? { ref: extra.ref } : {}),
    yes: true,
    tty: false,
    ask: async () => "",
    log: (line) => lines.push(line),
  });
  return { code, out: lines.join("\n") };
}

describe("publish instructions", () => {
  it("assembles the registry path and does not invent a prefilled new-file URL", () => {
    expect(githubNewFileUrl()).toBeNull();
    const where = communityEntryLocation("good-flow");
    expect(where.path).toBe("registry/community/good-flow.json");
    expect(where.treeUrl).toBe("https://github.com/cgold9820-dotcom/Flowgit/tree/main");
    const entry: CommunityEntry = {
      id: "good-flow",
      name: { zh: "示例", en: "Example" },
      description: { zh: "说明", en: "About" },
      git: "https://example.com/demo.git",
      author: "Test",
      tags: ["demo"],
      language: ["zh"],
      license: "MIT",
    };
    const text = publishInstructions(entry);
    expect(text).toContain(where.path);
    expect(text).toContain(where.treeUrl);
    expect(text).toContain(`file name, this path once: ${where.path}`);
    expect(text).not.toContain("registry/community/registry/community");
    expect(text).toContain('"id": "good-flow"');
    expect(text).not.toContain("filename=");
    expect(text).not.toContain("value=");
    expect(text).toContain("creating-new-files");
  });
});

describe("flowgit publish", () => {
  it("lists bilingual reasons for a bad flow and accepts a good one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-publish-"));
    const good = path.join(root, "good-flow");
    goodFlow(good);
    const ok = await publish(good, { git: "https://example.com/good.git" });
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toContain("registry/community/good-flow.json");
    expect(ok.out).not.toContain("filename=");
    expect(ok.out).not.toContain("api.github.com");

    const noLicense = path.join(root, "no-license");
    goodFlow(noLicense, "no-license");
    fs.rmSync(path.join(noLicense, "LICENSE"));
    const license = await publish(noLicense, { git: "https://example.com/x.git" });
    expect(license.code).toBe(1);
    expect(license.out).toContain("没有 LICENSE");
    expect(license.out).toContain("no LICENSE");

    const noSources = path.join(root, "no-sources");
    goodFlow(noSources, "no-sources");
    fs.writeFileSync(path.join(noSources, "README.md"), "# 示例 / Example\n\n没有依据这一节。\n");
    const sources = await publish(noSources, { git: "https://example.com/x.git" });
    expect(sources.code).toBe(1);
    expect(sources.out).toContain("依据 / Sources");

    const withRuns = path.join(root, "with-runs");
    goodFlow(withRuns, "with-runs");
    fs.mkdirSync(path.join(withRuns, "runs", "note"), { recursive: true });
    fs.writeFileSync(path.join(withRuns, "runs", "note", "run.json"), "{}");
    const runs = await publish(withRuns, { git: "https://example.com/x.git" });
    expect(runs.code).toBe(1);
    expect(runs.out).toContain("runs/");

    const secret = path.join(root, "secret-flow");
    goodFlow(secret, "secret-flow");
    fs.writeFileSync(path.join(secret, "note.md"), "key sk-abcdefghijklmnopqrstuvwxyz\n");
    const leaked = await publish(secret, { git: "https://example.com/x.git" });
    expect(leaked.code).toBe(1);
    expect(leaked.out).toContain("密钥");
    expect(leaked.out).toContain("API key");
    expect(leaked.out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");

    const invalid = path.join(root, "invalid-flow");
    goodFlow(invalid, "invalid-flow");
    fs.writeFileSync(path.join(invalid, "flow.json"), JSON.stringify({ format: "flowgit", version: "0.1", name: "坏 / Bad" }));
    const broken = await publish(invalid, { git: "https://example.com/x.git" });
    expect(broken.code).toBe(1);
    expect(broken.out).toMatch(/校验 \/ validate|错误 \/ has/);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("checks a local bare repo and reports a bad clone", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-bare-"));
    const good = path.join(root, "good-flow");
    goodFlow(good);
    git(["init", "-b", "main"], good);
    git(["add", "-A"], good);
    git(["commit", "-m", "good flow"], good);
    const bare = path.join(root, "good.git");
    git(["clone", "--bare", good, bare], root);
    const url = pathToFileURL(bare).href;

    const bad = path.join(root, "bad-flow");
    goodFlow(bad, "bad-flow");
    fs.rmSync(path.join(bad, "LICENSE"));
    fs.writeFileSync(path.join(bad, "note.md"), "sk-abcdefghijklmnopqrstuvwxyz\n");
    git(["init", "-b", "main"], bad);
    git(["add", "-A"], bad);
    git(["commit", "-m", "bad flow"], bad);
    const badBare = path.join(root, "bad.git");
    git(["clone", "--bare", bad, badBare], root);

    const entry: CommunityEntry = {
      id: "good-flow",
      name: { zh: "示例", en: "Example" },
      description: { zh: "说明", en: "About" },
      git: url,
      ref: "main",
      author: "Test",
      tags: ["demo"],
      language: ["zh"],
      license: "MIT",
    };
    const passed = checkEntryRepository(entry);
    expect(passed.ok, passed.reasons.join("\n")).toBe(true);
    expect(fs.existsSync(path.join(good, "node_modules"))).toBe(false);

    const failed = checkEntryRepository({ ...entry, id: "bad-flow", git: pathToFileURL(badBare).href });
    expect(failed.ok).toBe(false);
    expect(failed.reasons.join("\n")).toMatch(/LICENSE/);
    expect(failed.reasons.join("\n")).toContain("sk-key");

    const file = path.join(root, "bad-flow.json");
    fs.writeFileSync(file, JSON.stringify({ ...entry, id: "bad-flow", git: pathToFileURL(badBare).href }));
    const comment = renderRegistryComment(checkEntryFile(file));
    expect(comment).toContain("社区登记检查");
    expect(comment).toContain("Community registry check");
    expect(comment).toContain("没通过");
    expect(comment).toContain("Failed");

    const covered = path.join(root, "covered");
    const sub = path.join(covered, "examples", "mini");
    goodFlow(sub, "mini");
    fs.rmSync(path.join(sub, "LICENSE"));
    fs.writeFileSync(path.join(covered, "LICENSE"), "Apache-2.0\n");
    git(["init", "-b", "main"], covered);
    git(["add", "-A"], covered);
    git(["commit", "-m", "subdir flow"], covered);
    const coveredBare = path.join(root, "covered.git");
    git(["clone", "--bare", covered, coveredBare], root);
    const coveredCheck = checkEntryRepository({
      ...entry,
      id: "mini",
      git: `${pathToFileURL(coveredBare).href}#path=examples/mini`,
      license: "MIT",
    });
    expect(coveredCheck.ok, coveredCheck.reasons.join("\n")).toBe(true);

    expect(gitRefProblem("--upload-pack=evil")).toBeTruthy();
    expect(gitRefProblem("main")).toBeUndefined();
    const sneaky = checkEntryRepository({ ...entry, ref: "--upload-pack=evil" });
    expect(sneaky.ok).toBe(false);
    expect(sneaky.reasons.join("\n")).toContain("引用不合法");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("lists renamed registry files and does not treat a failed diff as no changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-diff-"));
    git(["init", "-b", "main"], root);
    fs.mkdirSync(path.join(root, "registry", "community"), { recursive: true });
    fs.writeFileSync(path.join(root, "registry", "community", "old.json"), "{}\n");
    git(["add", "-A"], root);
    git(["commit", "-m", "add"], root);
    git(["mv", "registry/community/old.json", "registry/community/new.json"], root);
    git(["commit", "-m", "rename"], root);
    const renamed = changedCommunityFiles(root, "HEAD~1");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.files).toContain("registry/community/new.json");
    const failed = changedCommunityFiles(root, "does-not-exist");
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.length).toBeGreaterThan(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("gallery stars and comments", () => {
  it("shows a star count from the lookup and hides it, and giscus, when unset", async () => {
    expect(await fetchGithubStars("acme/flowgit", async () => new Response(JSON.stringify({ stargazers_count: 4 }), { status: 200 }))).toBe(4);
    expect(await fetchGithubStars("acme/flowgit", async () => new Response("no", { status: 403 }))).toBeUndefined();

    const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-stars-"));
    const shown = path.join(root, "shown");
    await buildGallery({
      outDir: shown,
      cwd: repo,
      registry: path.join(repo, "registry", "community"),
      stars: async () => 12,
      giscus: { repo: "acme/flowgit", repoId: "R_id", category: "General", categoryId: "C_id", lang: "zh-CN" },
    });
    const home = fs.readFileSync(path.join(shown, "index.html"), "utf8");
    expect(home).toContain("★ 12");
    const detail = fs.readFileSync(path.join(shown, "templates", "weekly-report", "index.html"), "utf8");
    expect(detail).toContain("https://giscus.app/client.js");
    expect(detail).toContain('data-repo="acme/flowgit"');

    const hidden = path.join(root, "hidden");
    await buildGallery({
      outDir: hidden,
      cwd: repo,
      registry: path.join(repo, "registry", "community"),
      stars: async () => undefined,
      giscus: null,
    });
    expect(fs.readFileSync(path.join(hidden, "index.html"), "utf8")).not.toContain("★");
    expect(fs.readFileSync(path.join(hidden, "templates", "weekly-report", "index.html"), "utf8")).not.toContain("giscus.app");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
